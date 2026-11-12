// 변환 + 버전 등록 공통 로직 (CLI와 로컬 관리 도구가 함께 사용)
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import bmp from 'bmp-js';
import { convertHwpx } from './hwpx.mjs';

export const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const siteDir = path.join(root, 'site');
const manifestPath = path.join(siteDir, 'data', 'manuals.json');
export const MAX_BYTES = 300 * 1024 * 1024;

export const ID_RE = /^[a-z0-9][a-z0-9-]{0,39}$/;
export const VER_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,29}$/;

export function readManifest() {
  return fs.existsSync(manifestPath) ? JSON.parse(fs.readFileSync(manifestPath, 'utf8')) : { manuals: [] };
}
function writeManifest(m) {
  fs.mkdirSync(path.dirname(manifestPath), { recursive: true });
  fs.writeFileSync(manifestPath, JSON.stringify(m, null, 1), 'utf8');
}

export const sha256 = (buf) => crypto.createHash('sha256').update(buf).digest('hex');

export function checkHwpx(buf) {
  if (buf.length > MAX_BYTES) throw new Error('파일이 너무 큽니다 (300MB 초과).');
  if (buf.length < 4 || buf.readUInt32LE(0) !== 0x04034b50) throw new Error('HWPX 파일이 아닙니다. 한글에서 HWPX로 저장한 파일을 선택하세요.');
}

// 파일명으로 같은 메뉴얼인지 구분한다.
// "01 Project - 수정완료.hwpx" -> 키 "project", "05 Requirement.hwpx" -> 키 "requirement"
// 앞의 순번("01 ")과 " - 뒤 설명", 확장자, (v1.2)/_v2 같은 버전 표기는 무시한다.
export function nameStem(fileName) {
  let s = path.basename(String(fileName)).replace(/\.hwpx$/i, '');
  s = s.split(/\s+[-–—]\s+/)[0]; // " - 수정완료" 등 제거
  s = s.replace(/^\s*\d+[\s._-]+/, ''); // 앞 순번 제거
  s = s.replace(/[\s_-]*\(?v?\d+(\.\d+)*\)?\s*$/i, ''); // 끝의 버전 표기 제거
  return s.trim();
}
export const nameKey = (fileName) => nameStem(fileName).toLowerCase().replace(/\s+/g, ' ');
export function slugOf(fileName) {
  return nameKey(fileName).replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40);
}
// 업로드 파일과 같은 메뉴얼을 찾는다 (이름 키 일치 → ID 일치)
export function findManualByFile(manifest, fileName) {
  const key = nameKey(fileName);
  const slug = slugOf(fileName);
  if (!key) return null;
  return manifest.manuals.find((m) => m.nameKey === key) ?? (slug && manifest.manuals.find((m) => m.id === slug)) ?? null;
}

// 다음 버전 제안: 1.0 -> 1.1, 2 -> 3
export function suggestVersion(latest) {
  if (!latest) return '1.0';
  const m = latest.match(/^(.*?)(\d+)$/);
  return m ? m[1] + (parseInt(m[2]) + 1) : latest + '.1';
}

async function toWebp(entry, bytes) {
  const ext = path.extname(entry).toLowerCase();
  if (!bytes?.length) return null; // 원본에 빈 그림 파일이 들어 있는 경우: [그림 누락]으로 표시
  try {
    return await encodeWebp(ext, bytes);
  } catch (e) {
    console.warn(`그림 변환 실패 (${entry}): ${e.message}`);
    return null;
  }
}

async function encodeWebp(ext, bytes) {
  let img;
  // 확장자와 실제 형식이 다른 경우가 있어(예: 이름은 .bmp인데 내용은 PNG) 파일 앞부분으로 판별한다
  const isBmp = bytes[0] === 0x42 && bytes[1] === 0x4d; // 'BM'
  if (ext === '.bmp' && !isBmp) ext = '.png'; // sharp가 실제 형식(PNG/JPEG/GIF/WebP)을 자동 인식
  if (isBmp) {
    const d = bmp.decode(Buffer.from(bytes));
    const rgba = Buffer.alloc(d.width * d.height * 4);
    for (let i = 0; i < d.width * d.height; i++) {
      rgba[i * 4] = d.data[i * 4 + 3];
      rgba[i * 4 + 1] = d.data[i * 4 + 2];
      rgba[i * 4 + 2] = d.data[i * 4 + 1];
      rgba[i * 4 + 3] = 255;
    }
    img = sharp(rgba, { raw: { width: d.width, height: d.height, channels: 4 } });
  } else if (['.png', '.jpg', '.jpeg', '.gif', '.webp'].includes(ext)) {
    img = sharp(Buffer.from(bytes));
  } else return null; // wmf/emf 등 미지원
  return img.webp({ quality: 85 }).toBuffer();
}

export async function registerVersion({ buffer, sourceName, id, title, version, note = '', overwrite = false, mergedFrom = null }) {
  checkHwpx(buffer);
  if (!ID_RE.test(id)) throw new Error('문서 ID는 영문 소문자·숫자·하이픈만 사용할 수 있습니다.');
  if (!VER_RE.test(version)) throw new Error('버전은 영문·숫자·점·하이픈·밑줄만 사용할 수 있습니다.');
  const manifest = readManifest();
  const existing = manifest.manuals.find((x) => x.id === id);
  if (existing?.versions.some((v) => v.version === version) && !overwrite) throw new Error(`이미 존재하는 버전입니다: ${version}`);

  // 임시 폴더에 먼저 변환하고 성공하면 교체 (실패 시 기존 버전 보존)
  const finalDir = path.join(siteDir, 'm', id, version);
  const tmpDir = path.join(siteDir, 'm', id, `.tmp-${process.pid}-${Date.now()}`);
  fs.mkdirSync(path.join(tmpDir, 'img'), { recursive: true });
  let before = 0, after = 0;
  try {
    const imageHandler = async (imgId, entry, bytes) => {
      const out = await toWebp(entry, bytes);
      if (!out) return null;
      fs.writeFileSync(path.join(tmpDir, 'img', `${imgId}.webp`), out);
      before += bytes.length; after += out.length;
      return `img/${imgId}.webp`;
    };
    const { html, toc, stats, warnings } = await convertHwpx(buffer, { imageHandler });
    if (!stats.headings && !stats.paragraphs) throw new Error('변환된 내용이 없습니다. 파일을 확인하세요.');
    fs.writeFileSync(path.join(tmpDir, 'content.html'), html, 'utf8');
    fs.writeFileSync(path.join(tmpDir, 'toc.json'), JSON.stringify(toc, null, 1), 'utf8');
    fs.writeFileSync(path.join(tmpDir, 'source.hwpx'), buffer);
    const convertedAt = new Date().toISOString();
    const hash = sha256(buffer);
    fs.writeFileSync(path.join(tmpDir, 'meta.json'), JSON.stringify({ id, version, note, sourceName, sourceBytes: buffer.length, sha256: hash, convertedAt, stats, warnings, imageBytesBefore: before, imageBytesAfter: after, ...(mergedFrom ? { mergedFrom } : {}) }, null, 1), 'utf8');

    fs.rmSync(finalDir, { recursive: true, force: true });
    fs.renameSync(tmpDir, finalDir);

    let m = existing;
    if (!m) { m = { id, title: title || toc[0]?.text || id, nameKey: nameKey(sourceName), versions: [] }; manifest.manuals.push(m); }
    else {
      if (title) m.title = title;
      if (!m.nameKey) m.nameKey = nameKey(sourceName);
    }
    m.versions = m.versions.filter((v) => v.version !== version);
    m.versions.push({ version, date: convertedAt, note, sha256: hash, sourceName, sourceBytes: buffer.length, headings: stats.headings, tables: stats.tables, images: stats.images, ...(mergedFrom ? { mergedFrom } : {}) });
    m.versions.sort((a, b) => b.date.localeCompare(a.date));
    m.latest = m.versions[0].version;
    writeManifest(manifest);
    return { id, version, stats, warnings, imageBytesBefore: before, imageBytesAfter: after };
  } catch (e) {
    fs.rmSync(tmpDir, { recursive: true, force: true });
    throw e;
  }
}

export function deleteVersion(id, version) {
  if (!ID_RE.test(id) || !VER_RE.test(version)) throw new Error('잘못된 요청입니다.');
  const manifest = readManifest();
  const m = manifest.manuals.find((x) => x.id === id);
  if (!m || !m.versions.some((v) => v.version === version)) throw new Error('존재하지 않는 버전입니다.');
  fs.rmSync(path.join(siteDir, 'm', id, version), { recursive: true, force: true });
  m.versions = m.versions.filter((v) => v.version !== version);
  if (!m.versions.length) {
    manifest.manuals = manifest.manuals.filter((x) => x.id !== id);
    fs.rmSync(path.join(siteDir, 'm', id), { recursive: true, force: true });
  } else {
    m.latest = m.versions[0].version;
  }
  writeManifest(manifest);
}
