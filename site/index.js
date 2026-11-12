const list = document.getElementById('list');
const fmt = (iso) => new Date(iso).toLocaleDateString('ko-KR', { year: 'numeric', month: '2-digit', day: '2-digit' });
fetch('data/manuals.json')
  .then((r) => { if (!r.ok) throw new Error(); return r.json(); })
  .then(({ manuals }) => {
    if (!manuals.length) { list.innerHTML = '<div class="empty">등록된 메뉴얼이 없습니다.</div>'; return; }
    list.textContent = '';
    for (const m of manuals) {
      const latest = m.versions.find((v) => v.version === m.latest);
      const a = document.createElement('a');
      a.className = 'card';
      a.href = `viewer.html?m=${encodeURIComponent(m.id)}`;
      const h = document.createElement('h2'); h.textContent = m.title;
      const c = document.createElement('div'); c.className = 'chips';
      for (const t of [`v${latest.version}`, fmt(latest.date), `항목 ${latest.headings}`, `표 ${latest.tables}`, `그림 ${latest.images}`, `버전 ${m.versions.length}개`]) {
        const s = document.createElement('span'); s.className = 'chip'; s.textContent = t; c.append(s);
      }
      a.append(h, c); list.append(a);
    }
  })
  .catch(() => { list.innerHTML = '<div class="err">목록을 불러오지 못했습니다.</div>'; });
