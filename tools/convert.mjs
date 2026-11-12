// CLI: node tools/convert.mjs "<파일.hwpx>" --id project --title "프로젝트" --version 1.1 --note "변경 내용"
// (일반적으로는 `npm run admin` 의 웹 화면을 사용)
import fs from 'node:fs';
import path from 'node:path';
import { registerVersion } from './register.mjs';

const args = process.argv.slice(2);
const input = args.find((a) => !a.startsWith('--'));
const opt = (name, def) => {
  const i = args.indexOf('--' + name);
  return i >= 0 && args[i + 1] ? args[i + 1] : def;
};
if (!input) {
  console.error('사용법: node tools/convert.mjs <파일.hwpx> --id <id> --title <제목> --version <버전> --note <변경내용>');
  process.exit(1);
}
const r = await registerVersion({
  buffer: fs.readFileSync(input),
  sourceName: path.basename(input),
  id: opt('id', 'manual'),
  title: opt('title', ''),
  version: opt('version', new Date().toISOString().slice(0, 10)),
  note: opt('note', ''),
  overwrite: args.includes('--overwrite'),
});
console.log(`완료: ${r.id}@${r.version}`, r.stats, '미처리 요소:', r.warnings);
