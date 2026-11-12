// HWPX -> HTML 변환 라이브러리.
// 입력 파일은 신뢰할 수 없는 데이터로 취급한다: 모든 텍스트는 이스케이프하고, 허용 목록 태그만 출력한다.
import { unzipSync, strFromU8 } from 'fflate';
import { XMLParser } from 'fast-xml-parser';

const HWPUNIT_PER_PX = 75; // 1/7200 inch -> 96dpi px

const esc = (s) =>
  String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

// ---------- 번호 서식 ----------
const JAMO = 'ㄱㄴㄷㄹㅁㅂㅅㅇㅈㅊㅋㅌㅍㅎ';
const SYLL = '가나다라마바사아자차카타파하';
function toRoman(n) {
  const t = [[1000, 'M'], [900, 'CM'], [500, 'D'], [400, 'CD'], [100, 'C'], [90, 'XC'], [50, 'L'], [40, 'XL'], [10, 'X'], [9, 'IX'], [5, 'V'], [4, 'IV'], [1, 'I']];
  let r = '';
  for (const [v, s] of t) while (n >= v) { r += s; n -= v; }
  return r;
}
function fmtNum(n, f) {
  switch (f) {
    case 'DIGIT': return String(n);
    case 'CIRCLED_DIGIT': return n >= 1 && n <= 20 ? String.fromCharCode(0x2460 + n - 1) : `(${n})`;
    case 'HANGUL_JAMO': return JAMO[(n - 1) % JAMO.length];
    case 'HANGUL_SYLLABLE': return SYLL[(n - 1) % SYLL.length];
    case 'CIRCLED_HANGUL_JAMO': return String.fromCharCode(0x3260 + ((n - 1) % 14));
    case 'CIRCLED_HANGUL_SYLLABLE': return String.fromCharCode(0x326e + ((n - 1) % 14));
    case 'LATIN_SMALL': return String.fromCharCode(97 + ((n - 1) % 26));
    case 'LATIN_CAPITAL': return String.fromCharCode(65 + ((n - 1) % 26));
    case 'ROMAN_SMALL': return toRoman(n).toLowerCase();
    case 'ROMAN_CAPITAL': return toRoman(n);
    default: return String(n);
  }
}

// ---------- XML 유틸 (preserveOrder 노드) ----------
const tagOf = (n) => Object.keys(n).find((k) => k !== ':@' && k !== '#text');
const kidsOf = (n) => n[tagOf(n)] ?? [];
const attrOf = (n, a) => n[':@']?.['@' + a];

function parseHeader(xml) {
  const p = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: '@',
    isArray: (n) => ['hh:paraPr', 'hh:numbering', 'hh:bullet', 'hh:charPr', 'hh:style', 'hh:borderFill', 'hh:paraHead'].includes(n),
  });
  const r = p.parse(xml)['hh:head']['hh:refList'];
  const byId = (arr) => Object.fromEntries((arr ?? []).map((x) => [x['@id'], x]));
  return {
    charPr: byId(r['hh:charProperties']?.['hh:charPr']),
    paraPr: byId(r['hh:paraProperties']?.['hh:paraPr']),
    style: byId(r['hh:styles']?.['hh:style']),
    borderFill: byId(r['hh:borderFills']?.['hh:borderFill']),
    numbering: byId(r['hh:numberings']?.['hh:numbering']),
    bullet: byId(r['hh:bullets']?.['hh:bullet']),
  };
}

// ---------- 스타일 변환 ----------
function borderCss(b) {
  if (!b || b['@type'] === 'NONE') return 'none';
  const mm = parseFloat(b['@width']) || 0.12;
  const w = Math.max(1, Math.round(mm * 3.78));
  const type = { SOLID: 'solid', DASH: 'dashed', DOT: 'dotted', DOUBLE_SLIM: 'double', DOUBLE: 'double' }[b['@type']] ?? 'solid';
  return `${w}px ${type} ${b['@color'] ?? '#000'}`;
}
function cellStyle(bf) {
  if (!bf) return '';
  const s = [];
  for (const [k, css] of [['hh:leftBorder', 'left'], ['hh:rightBorder', 'right'], ['hh:topBorder', 'top'], ['hh:bottomBorder', 'bottom']]) {
    s.push(`border-${css}:${borderCss(bf[k])}`);
  }
  const face = bf['hc:fillBrush']?.['hc:winBrush']?.['@faceColor'];
  if (face && face !== 'none' && /^#[0-9a-fA-F]{6}$/.test(face)) s.push(`background:${face}`);
  return s.join(';');
}
const safeColor = (c) => (typeof c === 'string' && /^#[0-9a-fA-F]{6}$/.test(c) ? c : null);

// ---------- 변환 본체 ----------
export async function convertHwpx(buffer, { imageHandler } = {}) {
  const files = unzipSync(new Uint8Array(buffer));
  const names = Object.keys(files);
  for (const n of names) {
    if (n.includes('..') || n.startsWith('/') || n.includes('\\')) throw new Error('잘못된 압축 경로');
  }
  const get = (n) => (files[n] ? strFromU8(files[n]) : null);
  const hdr = parseHeader(get('Contents/header.xml'));
  const sectionNames = names.filter((n) => /^Contents\/section\d+\.xml$/.test(n)).sort((a, b) => parseInt(a.match(/\d+/)[0]) - parseInt(b.match(/\d+/)[0]));
  if (!sectionNames.length) throw new Error('HWPX 본문(section)을 찾을 수 없음');

  const secParser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: '@', preserveOrder: true, trimValues: false, parseTagValue: false, parseAttributeValue: false });

  // BinData 매핑 (image2 -> BinData/image2.bmp)
  const binMap = {};
  for (const n of names) {
    const m = n.match(/^BinData\/([^/]+)\.[A-Za-z0-9]+$/);
    if (m) binMap[m[1]] = n;
  }
  const imageCache = new Map();
  const stats = { paragraphs: 0, headings: 0, tables: 0, images: 0, missingImages: 0 };
  const warnings = new Map();
  const warn = (k) => warnings.set(k, (warnings.get(k) ?? 0) + 1);
  const toc = [];
  let headingSeq = 0;

  const counters = {}; // numberingId -> [n per level]
  let outlineId = '13';

  function nextNumber(numId, level) {
    const c = (counters[numId] ??= []);
    const def = hdr.numbering[numId]?.['hh:paraHead'] ?? [];
    for (let i = 0; i <= level; i++) if (c[i] === undefined) c[i] = (parseInt(def[i]?.['@start'] ?? '1') || 1) - (i === level ? 1 : 0);
    c[level] = (c[level] ?? 0) + 1;
    c.length = level + 1;
    return c;
  }
  function label(numId, level, c) {
    const def = hdr.numbering[numId]?.['hh:paraHead'] ?? [];
    const head = def.find((d) => d['@level'] === String(level + 1)) ?? def[level];
    if (!head) return '';
    const tmpl = typeof head['#text'] === 'string' ? head['#text'] : '^' + (level + 1);
    return tmpl.replace(/\^(\d)/g, (_, d) => {
      const i = parseInt(d) - 1;
      const f = def.find((x) => x['@level'] === String(i + 1))?.['@numFormat'] ?? 'DIGIT';
      return fmtNum(c[i] ?? 1, f);
    });
  }

  async function imageUrl(id) {
    if (imageCache.has(id)) return imageCache.get(id);
    const entry = binMap[id];
    let url = null;
    if (entry && imageHandler) url = await imageHandler(id, entry, files[entry]);
    imageCache.set(id, url);
    return url;
  }

  function runStyle(charPrId, baseCharPrId) {
    const c = hdr.charPr[charPrId];
    if (!c) return '';
    const s = [];
    const base = hdr.charPr[baseCharPrId];
    const color = safeColor(c['@textColor']);
    if (color && color.toLowerCase() !== '#000000') s.push(`color:${color}`);
    const shade = safeColor(c['@shadeColor']);
    if (shade && shade.toLowerCase() !== '#ffffff') s.push(`background:${shade}`);
    if ('hh:bold' in c) s.push('font-weight:700');
    if ('hh:italic' in c) s.push('font-style:italic');
    if (c['hh:underline'] && c['hh:underline']['@type'] && c['hh:underline']['@type'] !== 'NONE') s.push('text-decoration:underline');
    if (c['hh:strikeout'] && c['hh:strikeout']['@shape'] && c['hh:strikeout']['@shape'] !== 'NONE') s.push('text-decoration:line-through');
    if (base && c['@height'] && c['@height'] !== base['@height']) {
      const pt = parseInt(c['@height']) / 100;
      if (pt >= 6 && pt <= 40) s.push(`font-size:${pt}pt`);
    }
    return s.join(';');
  }

  async function renderPic(pic) {
    stats.images++;
    let ref = null;
    let curW = null;
    for (const k of kidsOf(pic)) {
      if (tagOf(k) === 'hc:img') ref = attrOf(k, 'binaryItemIDRef');
      if (tagOf(k) === 'hp:curSz') curW = parseInt(attrOf(k, 'width'));
    }
    const url = ref ? await imageUrl(ref) : null;
    if (!url) { stats.missingImages++; return '<span class="img-missing">[그림 누락]</span>'; }
    const w = curW ? Math.round(curW / HWPUNIT_PER_PX) : null;
    return `<img src="${esc(url)}" alt="그림" loading="lazy"${w ? ` width="${w}"` : ''}>`;
  }

  // 묶음 개체(hp:container): 한 그림을 여러 조각으로 잘라(예: 긴 화면의 위·아래만) 붙여 둔 경우가 많다.
  // hp:imgClip 은 이름과 달리 left=x0, right=y0, top=x1, bottom=y1 (원본 그림 좌표) 순서로 기록된다.
  // 조각을 원본 위→아래 순서로 쌓고, 각 조각은 잘라낸 영역만 보이도록 출력한다.
  function collectPics(node, out) {
    for (const k of kidsOf(node)) {
      const t = tagOf(k);
      if (t === 'hp:pic') out.push(k);
      else if (t === 'hp:container') collectPics(k, out);
      else if (['hp:rect', 'hp:ellipse', 'hp:line', 'hp:polygon', 'hp:arc', 'hp:curve', 'hp:connectLine', 'hp:textart'].includes(t)) warn(`container>${t}`);
    }
    return out;
  }
  async function renderContainer(ct) {
    let width = null;
    for (const k of kidsOf(ct)) if (tagOf(k) === 'hp:sz') width = Math.round(parseInt(attrOf(k, 'width')) / HWPUNIT_PER_PX);
    const pieces = [];
    for (const pic of collectPics(ct, [])) {
      let ref = null, clip = null;
      for (const k of kidsOf(pic)) {
        if (tagOf(k) === 'hc:img') ref = attrOf(k, 'binaryItemIDRef');
        if (tagOf(k) === 'hp:imgClip') {
          const [x0, y0, x1, y1] = ['left', 'right', 'top', 'bottom'].map((a) => parseInt(attrOf(k, a)) || 0);
          if (x1 > x0 && y1 > y0) clip = { x0, y0, x1, y1 };
        }
      }
      pieces.push({ pic, ref, clip });
    }
    if (!pieces.length) { warn('hp:container(empty)'); return ''; }
    // 같은 그림의 조각들: 가장 넓은 조각 폭을 원본 폭으로 본다
    const fullW = {};
    for (const p of pieces) if (p.clip) fullW[p.ref] = Math.max(fullW[p.ref] ?? 0, p.clip.x1);
    pieces.sort((a, b) => (a.ref === b.ref && a.clip && b.clip ? a.clip.y0 - b.clip.y0 : 0));
    const pct = (n) => +(n * 100).toFixed(4) + '%';
    let out = `<span class="grp" style="display:block;${width ? `max-width:${width}px` : ''}">`;
    for (const { pic, ref, clip } of pieces) {
      if (!clip) { out += `<span style="display:block">${await renderPic(pic)}</span>`; continue; }
      stats.images++;
      const url = ref ? await imageUrl(ref) : null;
      if (!url) { stats.missingImages++; out += '<span class="img-missing">[그림 누락]</span>'; continue; }
      const w = clip.x1 - clip.x0, h = clip.y1 - clip.y0;
      out += `<span style="display:block;position:relative;overflow:hidden;aspect-ratio:${w}/${h}">` +
        `<img src="${esc(url)}" alt="그림" loading="lazy" style="position:absolute;max-width:none;height:auto;` +
        `width:${pct(fullW[ref] / w)};left:${pct(-clip.x0 / w)};top:${pct(-clip.y0 / h)}"></span>`;
    }
    return out + '</span>';
  }

  async function renderTable(tbl) {
    stats.tables++;
    const width = (() => {
      for (const k of kidsOf(tbl)) if (tagOf(k) === 'hp:sz') return Math.round(parseInt(attrOf(k, 'width')) / HWPUNIT_PER_PX);
      return null;
    })();
    let out = `<div class="tbl-wrap"><table${width ? ` style="width:${width}px"` : ''}>`;
    for (const tr of kidsOf(tbl)) {
      if (tagOf(tr) !== 'hp:tr') continue;
      out += '<tr>';
      for (const tc of kidsOf(tr)) {
        if (tagOf(tc) !== 'hp:tc') continue;
        const isHeader = attrOf(tc, 'header') === '1';
        let colSpan = 1, rowSpan = 1, w = null, vAlign = 'top', inner = '';
        for (const k of kidsOf(tc)) {
          const t = tagOf(k);
          if (t === 'hp:cellSpan') { colSpan = parseInt(attrOf(k, 'colSpan')) || 1; rowSpan = parseInt(attrOf(k, 'rowSpan')) || 1; }
          else if (t === 'hp:cellSz') w = Math.round(parseInt(attrOf(k, 'width')) / HWPUNIT_PER_PX);
          else if (t === 'hp:subList') {
            vAlign = { CENTER: 'middle', BOTTOM: 'bottom', TOP: 'top' }[attrOf(k, 'vertAlign')] ?? 'top';
            inner = await renderParagraphs(kidsOf(k), { inCell: true });
          }
        }
        const st = [cellStyle(hdr.borderFill[attrOf(tc, 'borderFillIDRef')])];
        if (w) st.push(`width:${w}px`);
        st.push(`vertical-align:${vAlign}`);
        const tag = isHeader ? 'th' : 'td';
        out += `<${tag}${colSpan > 1 ? ` colspan="${colSpan}"` : ''}${rowSpan > 1 ? ` rowspan="${rowSpan}"` : ''} style="${st.filter(Boolean).join(';')}">${inner}</${tag}>`;
      }
      out += '</tr>';
    }
    return out + '</table></div>';
  }

  async function renderParagraph(p, { inCell }) {
    const paraPr = hdr.paraPr[attrOf(p, 'paraPrIDRef')];
    const style = hdr.style[attrOf(p, 'styleIDRef')];
    const baseChar = style?.['@charPrIDRef'];
    const heading = paraPr?.['hh:heading'];
    const align = paraPr?.['hh:align']?.['@horizontal'];
    const margin = paraPr?.['hh:margin'];
    const left = margin ? parseInt(margin['hc:left']?.['@value'] ?? '0') : 0;
    const indent = margin ? parseInt(margin['hc:intent']?.['@value'] ?? '0') : 0;

    let inline = '';
    const blocks = []; // [html before table..]
    let plain = '';
    let sawContent = false;
    const flush = () => {
      const html = inline;
      inline = '';
      return html;
    };
    const parts = []; // ordered: {type:'p', html} | {type:'raw', html}

    for (const run of kidsOf(p)) {
      if (tagOf(run) !== 'hp:run') continue;
      const cid = attrOf(run, 'charPrIDRef');
      const st = runStyle(cid, baseChar);
      for (const k of kidsOf(run)) {
        const t = tagOf(k);
        if (t === 'hp:t') {
          let txt = '';
          for (const c of kidsOf(k)) {
            if ('#text' in c) txt += esc(c['#text']);
            else {
              const ct = tagOf(c);
              if (ct === 'hp:lineBreak') txt += '<br>';
              else if (ct === 'hp:tab') txt += '&emsp;';
              else if (ct === 'hp:nbSpace' || ct === 'hp:fwSpace') txt += '&nbsp;';
              else if (ct === 'hp:hyphen') txt += '-';
            }
          }
          const rawText = kidsOf(k).map((c) => c['#text'] ?? '').join('');
          if (rawText.trim()) { sawContent = true; plain += rawText; }
          if (txt) inline += st ? `<span style="${st}">${txt}</span>` : txt;
        } else if (t === 'hp:pic') {
          sawContent = true;
          inline += await renderPic(k);
        } else if (t === 'hp:container') {
          sawContent = true;
          inline += await renderContainer(k);
        } else if (t === 'hp:tbl') {
          sawContent = true;
          parts.push({ type: 'p', html: flush() });
          parts.push({ type: 'raw', html: await renderTable(k) });
        } else if (['hp:secPr', 'hp:ctrl', 'hp:linesegarray'].includes(t)) {
          // 구역/컨트롤 정보: 변환 대상 아님
        } else {
          warn(t);
        }
      }
    }
    parts.push({ type: 'p', html: flush() });

    let out = '';
    for (const part of parts) {
      if (part.type === 'raw') { out += part.html; continue; }
      const html = part.html;
      if (!html.replace(/<br>|&nbsp;/g, '').trim() && !html.includes('<img')) continue;
      stats.paragraphs++;

      const cls = [];
      const st = [];
      if (align === 'CENTER' || align === 'RIGHT') st.push(`text-align:${align.toLowerCase()}`);
      if (!inCell && left > 0) st.push(`margin-left:${Math.round(left / HWPUNIT_PER_PX)}px`);

      const type = heading?.['@type'];
      const level = parseInt(heading?.['@level'] ?? '0');
      if (type === 'OUTLINE' && !inCell) {
        const lvl = Math.min(level, 5);
        const c = nextNumber(outlineId, lvl);
        for (const k of Object.keys(counters)) if (k !== outlineId) delete counters[k]; // 목록 번호는 제목마다 재시작
        const num = label(outlineId, lvl, c);
        const id = `h${++headingSeq}`;
        stats.headings++;
        toc.push({ id, level: lvl + 1, num, text: plain.trim() });
        out += `<h${lvl + 1} id="${id}"><span class="hnum">${esc(num)}</span> ${html}</h${lvl + 1}>`;
        continue;
      }
      let prefix = '';
      if (type === 'NUMBER' && !inCell) {
        const numId = heading['@idRef'];
        const c = nextNumber(numId, level);
        prefix = `<span class="lbl">${esc(label(numId, level, c))}</span> `;
        cls.push('li');
      } else if (type === 'BULLET' && !inCell) {
        const b = hdr.bullet[heading['@idRef']];
        prefix = `<span class="lbl">${esc(b?.['@char'] ?? '•')}</span> `;
        cls.push('li');
      }
      if (style?.['@name']?.includes('참고')) cls.push('note');
      if (inCell) cls.push('c');
      out += `<p${cls.length ? ` class="${cls.join(' ')}"` : ''}${st.length ? ` style="${st.join(';')}"` : ''}>${prefix}${html}</p>`;
    }
    return out;
  }

  async function renderParagraphs(nodes, opts = {}) {
    let out = '';
    for (const n of nodes) if (tagOf(n) === 'hp:p') out += await renderParagraph(n, opts);
    return out;
  }

  let html = '';
  for (const sn of sectionNames) {
    const xml = get(sn);
    const m = xml.match(/outlineShapeIDRef="(\d+)"/);
    if (m) outlineId = m[1];
    const tree = secParser.parse(xml);
    const sec = tree.find((n) => tagOf(n) === 'hs:sec');
    html += await renderParagraphs(kidsOf(sec));
  }

  return { html, toc, stats, warnings: Object.fromEntries(warnings) };
}
