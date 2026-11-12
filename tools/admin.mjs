// 로컬 관리 도구: npm run admin  ->  http://127.0.0.1:5174
// 내 PC(127.0.0.1)에서만 열리며, 업로드한 HWPX를 변환해 site/ 에 새 버전으로 등록한다.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { registerVersion, deleteVersion, readManifest, checkHwpx, sha256, suggestVersion, findManualByFile, slugOf, nameStem, MAX_BYTES, siteDir, ID_RE, VER_RE } from './register.mjs';
import { mergeHwpx } from './merge.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.argv[2]) || 5174;
const SESSION = crypto.randomBytes(24).toString('hex'); // 이 실행에서만 유효한 토큰 (CSRF 방지)
const uploads = new Map(); // token -> {buffer, name, sha, at}

const send = (res, code, obj) => {
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(obj));
};
function readBody(req, limit) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let n = 0;
    req.on('data', (c) => {
      n += c.length;
      if (n > limit) { reject(new Error('파일이 너무 큽니다 (300MB 초과).')); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

http
  .createServer(async (req, res) => {
    try {
      // DNS 리바인딩 방지: Host 확인
      if (!/^(127\.0\.0\.1|localhost):\d+$/.test(req.headers.host ?? '')) { res.writeHead(403); return res.end(); }
      const url = new URL(req.url, 'http://x');

      if (req.method === 'GET' && url.pathname === '/') {
        const html = fs.readFileSync(path.join(here, 'admin.html'), 'utf8').replace('__SESSION__', SESSION);
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', 'X-Frame-Options': 'DENY', 'X-Content-Type-Options': 'nosniff' });
        return res.end(html);
      }
      if (!url.pathname.startsWith('/api/')) { res.writeHead(404); return res.end(); }
      if (req.headers['x-session'] !== SESSION) return send(res, 403, { error: '세션이 만료되었습니다. 페이지를 새로고침하세요.' });

      if (req.method === 'GET' && url.pathname === '/api/manuals') return send(res, 200, readManifest());

      if (req.method === 'POST' && url.pathname === '/api/upload') {
        const name = decodeURIComponent(req.headers['x-filename'] ?? 'upload.hwpx');
        if (!/\.hwpx$/i.test(name)) return send(res, 400, { error: 'HWPX 파일(.hwpx)만 올릴 수 있습니다. HWP는 한글에서 HWPX로 저장 후 올려 주세요.' });
        const buffer = await readBody(req, MAX_BYTES);
        checkHwpx(buffer);
        const hash = sha256(buffer);
        const token = crypto.randomBytes(16).toString('hex');
        for (const [k, v] of uploads) if (Date.now() - v.at > 30 * 60 * 1000) uploads.delete(k);
        uploads.set(token, { buffer, name, sha: hash, at: Date.now() });
        const dup = readManifest().manuals.flatMap((m) => m.versions.filter((v) => v.sha256 === hash).map((v) => ({ id: m.id, title: m.title, version: v.version })));
        const manifest = readManifest();
        const match = findManualByFile(manifest, name);
        const guess = {
          matchId: match?.id ?? null, // 파일명으로 인식한 기존 문서 (없으면 새 문서)
          newId: slugOf(name),
          newTitle: nameStem(name),
          version: suggestVersion(match?.latest),
        };
        return send(res, 200, { token, name, bytes: buffer.length, sha256: hash, duplicates: dup, guess });
      }

      if (req.method === 'POST' && url.pathname === '/api/register') {
        const body = JSON.parse((await readBody(req, 1e5)).toString('utf8'));
        const up = uploads.get(body.token);
        if (!up) return send(res, 400, { error: '업로드가 만료되었습니다. 파일을 다시 선택하세요.' });
        const r = await registerVersion({
          buffer: up.buffer,
          sourceName: up.name,
          id: String(body.id ?? ''),
          title: String(body.title ?? '').slice(0, 100),
          version: String(body.version ?? ''),
          note: String(body.note ?? '').slice(0, 500),
          overwrite: body.overwrite === true,
        });
        uploads.delete(body.token);
        return send(res, 200, r);
      }

      // 문서 병합: 선택한 문서·버전을 순서대로 합쳐 새 문서(또는 기존 병합 문서의 새 버전)로 등록
      if (req.method === 'POST' && url.pathname === '/api/merge') {
        const body = JSON.parse((await readBody(req, 1e5)).toString('utf8'));
        const items = Array.isArray(body.items) ? body.items : [];
        if (items.length < 2) throw new Error('병합할 문서를 2개 이상 선택하세요.');
        if (items.length > 50) throw new Error('한 번에 50개까지 병합할 수 있습니다.');
        const manifest = readManifest();
        // 새 문서 ID를 비워 두면 자동으로 만든다: 영문 제목이면 제목에서, 아니면 merged / merged-2 …
        if (body.isNew === true && !String(body.id ?? '').trim()) {
          const base = String(body.title ?? '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 34) || 'merged';
          let id = base, n = 1;
          while (manifest.manuals.some((x) => x.id === id)) id = `${base}-${++n}`;
          body.id = id;
        }
        // 오래 걸리는 병합 전에 입력값부터 확인한다
        if (!ID_RE.test(String(body.id ?? ''))) throw new Error('문서 ID는 영문 소문자·숫자·하이픈(-)만 사용할 수 있습니다. (띄어쓰기 불가, 예: user-manual-all)');
        if (!VER_RE.test(String(body.version ?? ''))) throw new Error('버전은 영문·숫자·점·하이픈·밑줄만 사용할 수 있습니다. (예: 1.0)');
        const target = manifest.manuals.find((x) => x.id === body.id);
        if (body.isNew === true && target) throw new Error(`이미 사용 중인 문서 ID입니다: ${body.id} (${target.title}). 다른 ID를 입력하세요.`);
        if (target?.versions.some((v) => v.version === body.version) && body.overwrite !== true) throw new Error(`이미 존재하는 버전입니다: ${body.id} v${body.version} (버전을 바꾸거나 덮어쓰기를 선택하세요)`);
        const docs = [];
        const mergedFrom = [];
        for (const it of items) {
          const id = String(it?.id ?? ''), version = String(it?.version ?? '');
          if (!ID_RE.test(id) || !VER_RE.test(version)) throw new Error('잘못된 문서 선택입니다.');
          const m = manifest.manuals.find((x) => x.id === id);
          const v = m?.versions.find((x) => x.version === version);
          if (!v) throw new Error(`존재하지 않는 문서·버전입니다: ${id} v${version}`);
          docs.push({ name: `${m.title} v${version}`, buffer: fs.readFileSync(path.join(siteDir, 'm', id, version, 'source.hwpx')) });
          mergedFrom.push({ id, version, title: m.title });
        }
        const title = String(body.title ?? '').trim().slice(0, 100);
        if (!title) throw new Error('병합 문서 제목을 입력하세요.');
        const buffer = mergeHwpx(docs, { title });
        // 다운로드 파일 이름: 제목에서 파일명에 쓸 수 없는 문자 제거
        const sourceName = `${title.replace(/[\\/:*?"<>|\x00-\x1f]/g, '_').trim() || 'merged'}.hwpx`;
        const r = await registerVersion({
          buffer, sourceName,
          id: String(body.id ?? ''),
          title,
          version: String(body.version ?? ''),
          note: String(body.note ?? '').slice(0, 500),
          overwrite: body.overwrite === true,
          mergedFrom,
        });
        return send(res, 200, { ...r, bytes: buffer.length });
      }

      if (req.method === 'POST' && url.pathname === '/api/delete') {
        const body = JSON.parse((await readBody(req, 1e4)).toString('utf8'));
        deleteVersion(String(body.id), String(body.version));
        return send(res, 200, { ok: true });
      }

      if (req.method === 'GET' && url.pathname === '/api/suggest') {
        const m = readManifest().manuals.find((x) => x.id === url.searchParams.get('id'));
        return send(res, 200, { version: suggestVersion(m?.latest), title: m?.title ?? '' });
      }
      send(res, 404, { error: 'not found' });
    } catch (e) {
      // 내부 경로 등은 노출하지 않고 메시지만 전달
      console.error('오류:', e.message);
      send(res, 400, { error: e.message || '처리 중 오류가 발생했습니다.' });
    }
  })
  .listen(PORT, '127.0.0.1', () => console.log(`관리 화면: http://127.0.0.1:${PORT}\n(열람 사이트 미리보기는 별도로 npm run serve)`));
