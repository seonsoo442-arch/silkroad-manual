const q = new URLSearchParams(location.search);
const $ = (id) => document.getElementById(id);
const doc = $('doc'), toc = $('toc'), side = $('side');
const fmt = (iso) => new Date(iso).toLocaleString('ko-KR', { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
const mb = (n) => (n / 1048576).toFixed(1) + 'MB';
const fail = (msg) => { doc.innerHTML = ''; const d = document.createElement('div'); d.className = 'err'; d.textContent = msg; doc.append(d); };

async function main() {
  const id = q.get('m');
  if (!id || !/^[a-z0-9-]+$/.test(id)) return fail('문서가 지정되지 않았습니다.');
  const manifest = await fetch('data/manuals.json').then((r) => r.json());
  const m = manifest.manuals.find((x) => x.id === id);
  if (!m) return fail('존재하지 않는 문서입니다.');
  const ver = m.versions.find((v) => v.version === q.get('v')) ?? m.versions.find((v) => v.version === m.latest);
  document.title = `${m.title} v${ver.version} - SILKROAD 메뉴얼`;
  $('docTitle').textContent = m.title;

  const sel = $('verSel');
  for (const v of m.versions) {
    const o = document.createElement('option');
    o.value = v.version; o.textContent = `v${v.version}${v.version === m.latest ? ' (최신)' : ''}`;
    if (v.version === ver.version) o.selected = true;
    sel.append(o);
  }
  sel.onchange = () => { location.search = `?m=${id}&v=${encodeURIComponent(sel.value)}`; };
  $('vinfo').textContent = `${fmt(ver.date)} · ${ver.note || '변경 내용 없음'}`;
  const base = `m/${id}/${ver.version}/`;
  const dl = $('dlSrc'); dl.href = base + 'source.hwpx'; dl.setAttribute('download', ver.sourceName);

  const hist = $('history');
  const tbl = document.createElement('table');
  tbl.innerHTML = '<thead><tr><th>버전</th><th>등록일시</th><th>변경 내용</th><th>원본 크기</th><th></th></tr></thead>';
  const tb = document.createElement('tbody');
  for (const v of m.versions) {
    const tr = document.createElement('tr');
    for (const t of [`v${v.version}${v.version === m.latest ? ' (최신)' : ''}`, fmt(v.date), v.note || '-', mb(v.sourceBytes)]) {
      const td = document.createElement('td'); td.textContent = t; tr.append(td);
    }
    const td = document.createElement('td');
    const a = document.createElement('a'); a.href = `?m=${id}&v=${encodeURIComponent(v.version)}`; a.textContent = v.version === ver.version ? '보는 중' : '열기';
    td.append(a); tr.append(td); tb.append(tr);
  }
  tbl.append(tb); hist.append(tbl);
  $('histBtn').onclick = () => { hist.hidden = !hist.hidden; $('histBtn').setAttribute('aria-expanded', String(!hist.hidden)); };
  $('panel').hidden = false;

  const [html, items] = await Promise.all([
    fetch(base + 'content.html').then((r) => { if (!r.ok) throw new Error(); return r.text(); }),
    fetch(base + 'toc.json').then((r) => r.json()),
  ]);
  const tpl = document.createElement('template');
  tpl.innerHTML = html; // 변환기가 이스케이프해 생성한 허용 목록 태그만 포함
  doc.innerHTML = ''; doc.append(tpl.content);
  for (const img of doc.querySelectorAll('img')) img.src = base + img.getAttribute('src');

  for (const it of items) {
    const a = document.createElement('a');
    a.href = '#' + it.id; a.className = 'l' + it.level; a.dataset.id = it.id;
    const n = document.createElement('span'); n.className = 'n'; n.textContent = it.num;
    a.append(n, document.createTextNode(it.text)); toc.append(a);
  }
  $('tocFilter').oninput = (e) => {
    const k = e.target.value.trim().toLowerCase();
    for (const a of toc.children) a.hidden = !!k && !a.textContent.toLowerCase().includes(k);
  };
  toc.onclick = () => side.classList.remove('open');

  const heads = [...doc.querySelectorAll('h1,h2,h3,h4,h5,h6')];
  const links = new Map([...toc.children].map((a) => [a.dataset.id, a]));
  const io = new IntersectionObserver((es) => {
    for (const e of es) if (e.isIntersecting) {
      toc.querySelector('.active')?.classList.remove('active');
      const a = links.get(e.target.id); a?.classList.add('active');
      a?.scrollIntoView({ block: 'nearest' });
    }
  }, { rootMargin: '-60px 0px -75% 0px' });
  heads.forEach((h) => io.observe(h));
  if (location.hash) document.getElementById(location.hash.slice(1))?.scrollIntoView();
}
$('menuBtn').onclick = () => { const o = side.classList.toggle('open'); $('menuBtn').setAttribute('aria-expanded', String(o)); };
main().catch(() => fail('문서를 불러오지 못했습니다.'));
