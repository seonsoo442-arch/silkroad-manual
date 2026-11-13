// GitHub 파일 한도(100MB)를 넘는 원본 HWPX를 GitHub 릴리스 첨부파일로 올린다.
//   npm run release-large
// - site/m/<id>/<version>/source.hwpx 중 LIMIT 이상인 파일을 찾아 릴리스(태그 file-<id>-<version>)에 첨부
// - manuals.json 의 해당 버전에 downloadUrl 을 기록 (열람 화면의 다운로드 버튼이 이 주소를 사용)
// - 그 파일은 .gitignore 에 추가해 저장소에는 올리지 않는다
// 필요: GitHub CLI(gh) 로그인, origin 원격 저장소
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { root, siteDir, readManifest } from './register.mjs';

const LIMIT = 95 * 1024 * 1024; // GitHub 한도 100MB보다 약간 낮게
const manifestPath = path.join(siteDir, 'data', 'manuals.json');
const gitignorePath = path.join(root, '.gitignore');

function ghPath() {
  for (const p of ['C:\\Program Files\\GitHub CLI\\gh.exe', 'gh']) {
    try { execFileSync(p, ['--version'], { stdio: 'ignore' }); return p; } catch { /* 다음 후보 */ }
  }
  throw new Error('GitHub CLI(gh)를 찾을 수 없습니다.');
}
const gh = ghPath();
const run = (args, opts = {}) => execFileSync(gh, args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], ...opts });

const remote = execFileSync('git', ['remote', 'get-url', 'origin'], { cwd: root, encoding: 'utf8' }).trim();
const repo = remote.match(/github\.com[:/](.+?\/.+?)(?:\.git)?$/)?.[1];
if (!repo) throw new Error(`GitHub 원격 저장소를 알 수 없습니다: ${remote}`);

const manifest = readManifest();
let changed = 0;
for (const m of manifest.manuals) {
  for (const v of m.versions) {
    const rel = `site/m/${m.id}/${v.version}/source.hwpx`;
    const file = path.join(root, rel);
    if (!fs.existsSync(file) || fs.statSync(file).size < LIMIT) continue;
    const tag = `file-${m.id}-${v.version}`;
    const asset = `${m.id}-v${v.version}.hwpx`; // 릴리스 첨부파일 이름은 영문으로
    const url = `https://github.com/${repo}/releases/download/${tag}/${asset}`;

    if (v.downloadUrl !== url) {
      const tmp = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'release-')), asset);
      fs.copyFileSync(file, tmp);
      const mb = (fs.statSync(file).size / 1048576).toFixed(1);
      let exists = true;
      try { run(['release', 'view', tag, '-R', repo]); } catch { exists = false; }
      console.log(`${m.title} v${v.version} (${mb}MB) → 릴리스 ${tag} 업로드 중…`);
      if (exists) run(['release', 'upload', tag, tmp, '--clobber', '-R', repo]);
      else run(['release', 'create', tag, tmp, '-R', repo, '--title', `${m.title} v${v.version} 원본`, '--notes', `${v.sourceName} (${mb}MB). 메뉴얼 사이트의 다운로드 버튼이 이 파일을 사용합니다.`]);
      fs.rmSync(path.dirname(tmp), { recursive: true, force: true });
      v.downloadUrl = url;
      changed++;
    }
    // 저장소에는 올리지 않는다
    const ig = fs.readFileSync(gitignorePath, 'utf8');
    if (!ig.split(/\r?\n/).includes(`/${rel}`)) {
      fs.appendFileSync(gitignorePath, `${ig.endsWith('\n') ? '' : '\n'}# 100MB 초과 원본: GitHub 릴리스에 첨부 (npm run release-large)\n/${rel}\n`);
    }
    console.log(`완료: ${m.id} v${v.version} → ${url}`);
  }
}
if (changed) fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 1), 'utf8');
console.log(changed ? `${changed}개 파일을 릴리스로 올렸습니다. 이제 커밋·푸시하세요.` : '릴리스로 올릴 큰 파일이 없습니다.');
