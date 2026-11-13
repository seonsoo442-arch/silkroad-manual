const q = new URLSearchParams(location.search);
const $ = (id) => document.getElementById(id);
const doc = $('doc'), toc = $('toc'), side = $('side');
const fmt = (iso) => new Date(iso).toLocaleString('ko-KR', { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
const mb = (n) => (n >= 1048576 ? (n / 1048576).toFixed(1) + 'MB' : Math.max(1, Math.round(n / 1024)) + 'KB');
const fail = (msg) => { doc.innerHTML = ''; const d = document.createElement('div'); d.className = 'err'; d.textContent = msg; doc.append(d); };
const DEEP = 2; // 목차가 길면 이 단계까지만 기본 표시

async function main() {
  const id = q.get('m');
  if (!id || !/^[a-z0-9-]+$/.test(id)) return fail('문서가 지정되지 않았습니다.');
  // 배포 직후에도 새 버전이 보이도록 브라우저 캐시를 쓰지 않고 서버에 확인한다 (바뀌지 않았으면 304로 가볍게 응답)
  const manifest = await fetch('data/manuals.json', { cache: 'no-cache' }).then((r) => r.json());
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
  sel.disabled = m.versions.length < 2;
  sel.onchange = () => { location.search = `?m=${id}&v=${encodeURIComponent(sel.value)}`; };
  $('vinfo').textContent = `${fmt(ver.date)} 등록`;
  // 병합 문서는 변경 내용 대신 포함 문서 목록을 접어서 보여 준다
  if (ver.mergedFrom?.length) {
    $('partsSum').textContent = `포함된 메뉴얼 ${ver.mergedFrom.length}개`;
    for (const p of ver.mergedFrom) { const li = document.createElement('li'); li.textContent = `${p.title} v${p.version}`; $('partsList').append(li); }
    $('parts').hidden = false;
  } else if (ver.note) {
    $('vnote').textContent = ver.note; $('vnote').hidden = false;
  }
  const base = `m/${id}/${ver.version}/`;
  // 100MB가 넘는 원본은 GitHub 릴리스에 있으므로 그 주소를 쓴다
  const dl = $('dlSrc'); dl.href = ver.downloadUrl || base + 'source.hwpx'; dl.setAttribute('download', ver.sourceName);
  dl.title = `원본 다운로드: ${ver.sourceName} (${mb(ver.sourceBytes)})`;
  dl.setAttribute('aria-label', `원본(HWPX) 다운로드, ${mb(ver.sourceBytes)}`);
  dl.hidden = false;

  const hist = $('history');
  const tbl = document.createElement('table');
  tbl.innerHTML = '<thead><tr><th>버전</th><th>등록일시</th><th>변경 내용</th><th>원본 크기</th><th></th></tr></thead>';
  const tb = document.createElement('tbody');
  for (const v of m.versions) {
    const tr = document.createElement('tr');
    if (v.version === ver.version) tr.className = 'cur';
    const note = v.mergedFrom ? `병합 (${v.mergedFrom.length}개 메뉴얼)` : v.note || '-';
    for (const t of [`v${v.version}${v.version === m.latest ? ' (최신)' : ''}`, fmt(v.date), note, mb(v.sourceBytes)]) {
      const td = document.createElement('td'); td.textContent = t; tr.append(td);
    }
    const td = document.createElement('td');
    if (v.version === ver.version) td.textContent = '보는 중';
    else { const a = document.createElement('a'); a.href = `?m=${id}&v=${encodeURIComponent(v.version)}`; a.textContent = '열기'; td.append(a); }
    tr.append(td); tb.append(tr);
  }
  tbl.append(tb); hist.append(tbl);
  $('histBtn').onclick = () => { hist.hidden = !hist.hidden; $('histBtn').setAttribute('aria-expanded', String(!hist.hidden)); };
  $('panel').hidden = false;

  const [html, items] = await Promise.all([
    fetch(base + 'content.html', { cache: 'no-cache' }).then((r) => { if (!r.ok) throw new Error(); return r.text(); }),
    fetch(base + 'toc.json', { cache: 'no-cache' }).then((r) => r.json()),
  ]);
  const tpl = document.createElement('template');
  tpl.innerHTML = html; // 변환기가 이스케이프해 생성한 허용 목록 태그만 포함
  doc.innerHTML = ''; doc.append(tpl.content);
  for (const img of doc.querySelectorAll('img')) img.src = base + img.getAttribute('src');

  for (const it of items) {
    const a = document.createElement('a');
    a.href = '#' + it.id; a.className = 'l' + it.level; a.dataset.id = it.id; a.dataset.level = it.level;
    const n = document.createElement('span'); n.className = 'n'; n.textContent = it.num;
    a.append(n, document.createTextNode(it.text)); toc.append(a);
  }

  // 목차가 길면 큰 항목만 보여 주고, 체크하면 세부 항목까지 펼친다. 검색 중에는 모든 단계에서 찾는다.
  const long = items.length > 120;
  $('depthWrap').hidden = !long;
  $('depthAll').checked = !long;
  const applyToc = () => {
    const k = $('tocFilter').value.trim().toLowerCase();
    const all = $('depthAll').checked;
    for (const a of toc.children) a.hidden = k ? !a.textContent.toLowerCase().includes(k) : !all && +a.dataset.level > DEEP;
  };
  $('tocFilter').oninput = applyToc;
  $('depthAll').onchange = applyToc;
  applyToc();
  toc.onclick = (e) => { if (e.target.closest('a')) closeSide(); };

  const heads = [...doc.querySelectorAll('h1,h2,h3,h4,h5,h6')];
  const links = new Map([...toc.children].map((a) => [a.dataset.id, a]));
  const io = new IntersectionObserver((es) => {
    for (const e of es) if (e.isIntersecting) {
      toc.querySelector('.active')?.classList.remove('active');
      // 접힌 세부 항목이면 위쪽의 보이는 상위 항목을 표시
      let a = links.get(e.target.id);
      while (a && a.hidden) a = a.previousElementSibling;
      a?.classList.add('active');
      a?.scrollIntoView({ block: 'nearest' });
    }
  }, { rootMargin: '-70px 0px -75% 0px' });
  heads.forEach((h) => io.observe(h));
  if (location.hash) document.getElementById(location.hash.slice(1))?.scrollIntoView();
}

// 모바일 목차 열기/닫기
const openSide = () => { side.classList.add('open'); $('scrim').hidden = false; $('menuBtn').setAttribute('aria-expanded', 'true'); };
const closeSide = () => { side.classList.remove('open'); $('scrim').hidden = true; $('menuBtn').setAttribute('aria-expanded', 'false'); };
$('menuBtn').onclick = () => (side.classList.contains('open') ? closeSide() : openSide());
$('scrim').onclick = closeSide;
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeSide(); });

// 맨 위로
const toTop = $('toTop');
addEventListener('scroll', () => { toTop.hidden = scrollY < 600; }, { passive: true });
toTop.onclick = () => scrollTo({ top: 0, behavior: 'smooth' });

main().catch(() => fail('문서를 불러오지 못했습니다. 잠시 후 새로고침해 주세요.'));
