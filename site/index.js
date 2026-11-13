const list = document.getElementById('list');
const q = document.getElementById('q');
const fmt = (iso) => new Date(iso).toLocaleDateString('ko-KR', { year: 'numeric', month: '2-digit', day: '2-digit' });
const mb = (n) => (n >= 1048576 ? (n / 1048576).toFixed(1) + 'MB' : Math.max(1, Math.round(n / 1024)) + 'KB');
const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };

// 분류: 병합 문서 → 통합본, 나머지(사용자 가이드 포함) → 기능별 메뉴얼
const groupOf = (m, latest) => (latest.mergedFrom ? 'merged' : 'module');
const GROUPS = [
  ['merged', '통합본', '여러 메뉴얼을 하나로 합친 문서입니다.'],
  ['module', '기능별 메뉴얼', ''],
];

// 번호: manuals.json 순서대로 01, 02 … (통합본은 번호 대신 "통합"). 관리 화면과 같은 규칙.
function numbering(manuals) {
  const map = new Map();
  let n = 0;
  for (const m of manuals) {
    const latest = m.versions.find((v) => v.version === m.latest) ?? m.versions[0];
    map.set(m.id, latest.mergedFrom ? null : String(++n).padStart(2, '0'));
  }
  return map;
}

function card(m, latest, num) {
  const c = el('div', 'card' + (latest.mergedFrom ? ' featured' : ''));
  const head = el('div', 'card-head');
  head.append(el('span', 'num' + (num ? '' : ' merged'), num ?? '통합'));
  const a = el('a', 'card-link', m.title);
  a.href = `viewer.html?m=${encodeURIComponent(m.id)}`;
  head.append(a);
  c.append(head);

  if (latest.mergedFrom) c.append(el('p', 'card-desc', `${latest.mergedFrom.length}개 메뉴얼 병합 · ${latest.mergedFrom.slice(0, 3).map((x) => x.title).join(', ')} 외`));
  const meta = el('div', 'meta');
  meta.append(el('span', 'ver', `v${latest.version}`), el('span', '', fmt(latest.date)));
  if (m.versions.length > 1) meta.append(el('span', '', `버전 ${m.versions.length}개`));
  c.append(meta);
  const stats = el('div', 'stats', `항목 ${latest.headings} · 표 ${latest.tables} · 그림 ${latest.images}`);
  c.append(stats);

  const dl = el('a', 'dl', `HWPX ${mb(latest.sourceBytes)}`);
  dl.href = latest.downloadUrl || `m/${m.id}/${latest.version}/source.hwpx`;
  dl.setAttribute('download', latest.sourceName);
  dl.title = `원본 다운로드: ${latest.sourceName}`;
  dl.setAttribute('aria-label', `${m.title} 원본(HWPX) 다운로드, ${mb(latest.sourceBytes)}`);
  c.append(dl);
  c.dataset.key = ((num ?? '통합') + ' ' + m.title + ' ' + m.id).toLowerCase();
  return c;
}

function render(manuals) {
  list.textContent = '';
  if (!manuals.length) { list.append(el('div', 'empty', '등록된 메뉴얼이 없습니다.')); return; }
  const by = {};
  const nums = numbering(manuals);
  for (const m of manuals) {
    const latest = m.versions.find((v) => v.version === m.latest) ?? m.versions[0];
    (by[groupOf(m, latest)] ??= []).push(card(m, latest, nums.get(m.id)));
  }
  for (const [key, title, desc] of GROUPS) {
    if (!by[key]?.length) continue;
    const sec = el('section', 'group');
    const h = el('h2', 'group-title', title);
    h.append(el('span', 'count', String(by[key].length)));
    sec.append(h);
    if (desc) sec.append(el('p', 'group-desc', desc));
    const grid = el('div', 'grid');
    grid.append(...by[key]);
    sec.append(grid);
    list.append(sec);
  }
  const nr = el('div', 'empty', '검색 결과가 없습니다.');
  nr.id = 'noResult'; nr.hidden = true;
  list.append(nr);
}

function filter() {
  const k = q.value.trim().toLowerCase();
  let shown = 0;
  for (const sec of list.querySelectorAll('.group')) {
    let n = 0;
    for (const c of sec.querySelectorAll('.card')) { const ok = !k || c.dataset.key.includes(k); c.hidden = !ok; if (ok) n++; }
    sec.hidden = n === 0;
    shown += n;
  }
  const nr = document.getElementById('noResult');
  if (nr) nr.hidden = shown > 0;
}
q.addEventListener('input', filter);

// 배포 직후에도 새 목록이 보이도록 브라우저 캐시를 쓰지 않고 서버에 확인한다
fetch('data/manuals.json', { cache: 'no-cache' })
  .then((r) => { if (!r.ok) throw new Error(); return r.json(); })
  .then(({ manuals }) => {
    document.getElementById('summary').textContent = `메뉴얼 ${manuals.length}개 · 문서를 선택하면 웹에서 바로 열람하고, 원본(HWPX)도 받을 수 있습니다.`;
    render(manuals);
    filter();
  })
  .catch(() => { list.textContent = ''; list.append(el('div', 'err', '목록을 불러오지 못했습니다. 잠시 후 새로고침해 주세요.')); });
