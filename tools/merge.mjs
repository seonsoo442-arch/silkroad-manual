// 여러 HWPX 문서를 하나의 HWPX로 합친다 (한글 프로그램 없이 XML을 직접 병합).
//
// 방식
// - 첫 문서를 바탕으로 삼고, 뒤 문서들의 서식 목록(글꼴·테두리·글자/문단 모양·탭·번호·글머리표)을
//   바탕 문서의 header.xml 뒤에 이어 붙인다. 이때 ID가 겹치지 않도록 번호를 밀어 주고,
//   본문(section)의 참조 번호도 같이 고친다.
// - 스타일은 이름이 같으면 바탕 문서의 스타일을 같이 쓴다 (스타일 목록에 같은 이름이 여러 개 생기지 않게).
//   문단마다 글자·문단 모양 번호를 직접 갖고 있어 보이는 모양은 바뀌지 않는다.
// - 그림(BinData)은 image1, image2 … 로 새로 번호를 매긴다.
// - 각 문서의 본문은 별도 구역(section)으로 붙인다. 구역이 바뀌면 새 쪽에서 시작한다.
import { unzipSync, zipSync, strFromU8, strToU8 } from 'fflate';

const NONE = 4294967295; // HWPX에서 "참조 없음"을 뜻하는 값

// 서식 목록 종류: [refList 안 그룹 태그, 항목 태그, 이 항목을 가리키는 속성 이름들]
const CATS = [
  ['borderFills', 'borderFill', ['borderFillIDRef']],
  ['charProperties', 'charPr', ['charPrIDRef']],
  ['tabProperties', 'tabPr', ['tabPrIDRef']],
  ['numberings', 'numbering', ['outlineShapeIDRef']],
  ['bullets', 'bullet', []],
  ['paraProperties', 'paraPr', ['paraPrIDRef']],
];
const FONT_LANGS = { HANGUL: 'hangul', LATIN: 'latin', HANJA: 'hanja', JAPANESE: 'japanese', OTHER: 'other', SYMBOL: 'symbol', USER: 'user' };

const escRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const ids = (xml, tag) => [...xml.matchAll(new RegExp(`<hh:${tag}\\b[^>]*?\\sid="(\\d+)"`, 'g'))].map((m) => +m[1]);
// <hh:group ...>내용</hh:group> 의 [시작 위치, 내용 시작, 내용 끝, 끝] 을 찾는다
function block(xml, group) {
  const open = xml.match(new RegExp(`<hh:${group}\\b[^>]*>`));
  if (!open) return null;
  const s = open.index, cs = s + open[0].length;
  const ce = xml.indexOf(`</hh:${group}>`, cs);
  if (ce < 0) return null;
  return { s, cs, ce, e: ce + `</hh:${group}>`.length, open: open[0] };
}
const setAttr = (tag, name, val) => tag.replace(new RegExp(`\\s${name}="[^"]*"`), ` ${name}="${val}"`);

// 문서 하나의 XML(header 항목 + section)에 들어 있는 참조 번호를 바꾼다
function remapRefs(xml, map) {
  // 일반 참조 속성
  xml = xml.replace(/\s(\w+IDRef)="(\d+)"/g, (all, name, v) => {
    const f = map.attr[name];
    if (!f || +v === NONE) return all;
    return ` ${name}="${f(+v)}"`;
  });
  // 문단 머리(번호·글머리표): type에 따라 idRef가 가리키는 목록이 다르다
  xml = xml.replace(/<hh:heading\b[^>]*>/g, (tag) => {
    const type = tag.match(/type="(\w+)"/)?.[1];
    const v = tag.match(/idRef="(\d+)"/)?.[1];
    if (v === undefined || +v === NONE) return tag;
    // 개요 문단의 idRef 0은 "구역의 개요 번호 모양을 따름"이라는 뜻이라 바꾸지 않는다
    if (type === 'OUTLINE' && +v === 0) return tag;
    if (type === 'OUTLINE' || type === 'NUMBER') return setAttr(tag, 'idRef', map.cat.numbering(+v));
    if (type === 'BULLET') return setAttr(tag, 'idRef', map.cat.bullet(+v));
    return tag;
  });
  // 글꼴 참조 (언어별 목록)
  xml = xml.replace(/<hh:fontRef\b[^>]*>/g, (tag) =>
    tag.replace(/\s(\w+)="(\d+)"/g, (all, lang, v) => (map.font[lang] ? ` ${lang}="${map.font[lang](+v)}"` : all)));
  // 그림
  xml = xml.replace(/\sbinaryItemIDRef="([^"]+)"/g, (all, v) => (map.bin[v] ? ` binaryItemIDRef="${map.bin[v]}"` : all));
  return xml;
}

const MEDIA = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', bmp: 'image/bmp', wmf: 'image/x-wmf', emf: 'image/x-emf', tif: 'image/tiff', tiff: 'image/tiff' };

/**
 * @param {{name:string, buffer:Buffer|Uint8Array}[]} docs 병합 순서대로
 * @param {{title?:string}} opts
 * @returns {Buffer} 병합된 HWPX
 */
export function mergeHwpx(docs, { title } = {}) {
  if (!Array.isArray(docs) || docs.length < 2) throw new Error('병합하려면 문서가 2개 이상 필요합니다.');
  const pkgs = docs.map((d) => {
    const files = unzipSync(new Uint8Array(d.buffer));
    for (const n of Object.keys(files)) if (n.includes('..') || n.startsWith('/') || n.includes('\\')) throw new Error(`잘못된 압축 경로: ${d.name}`);
    const header = files['Contents/header.xml'];
    if (!header) throw new Error(`HWPX 서식 정보(header.xml)가 없습니다: ${d.name}`);
    const sections = Object.keys(files).filter((n) => /^Contents\/section\d+\.xml$/.test(n))
      .sort((a, b) => parseInt(a.match(/\d+/)[0]) - parseInt(b.match(/\d+/)[0]));
    if (!sections.length) throw new Error(`HWPX 본문이 없습니다: ${d.name}`);
    return { name: d.name, files, header: strFromU8(header), sections };
  });

  const base = pkgs[0];
  let header = base.header;
  const outFiles = {};
  const manifestItems = [];
  const spine = [];
  let secNo = 0, imgNo = 0;

  // 바탕 문서 이외의 공통 파일은 바탕 문서 것을 그대로 쓴다
  for (const n of ['mimetype', 'version.xml', 'settings.xml', 'META-INF/container.xml', 'META-INF/manifest.xml', 'META-INF/container.rdf', 'Preview/PrvText.txt', 'Preview/PrvImage.png']) {
    if (base.files[n]) outFiles[n] = base.files[n];
  }

  // 바탕 문서 스타일 이름 -> id
  const baseStyles = new Map();
  for (const m of base.header.matchAll(/<hh:style\b[^>]*>/g)) {
    const id = +m[0].match(/\sid="(\d+)"/)[1];
    const name = m[0].match(/\sname="([^"]*)"/)?.[1] ?? '';
    if (!baseStyles.has(name)) baseStyles.set(name, id);
  }

  pkgs.forEach((pkg, di) => {
    const isBase = di === 0;
    const map = { attr: {}, cat: {}, font: {}, bin: {} };
    const ident = (v) => v;

    // 그림: 새 번호 부여
    const binOf = {};
    for (const n of Object.keys(pkg.files)) {
      const m = n.match(/^BinData\/([^/]+)\.([A-Za-z0-9]+)$/);
      if (!m) continue;
      const newId = `image${++imgNo}`;
      const ext = m[2].toLowerCase();
      map.bin[m[1]] = newId;
      binOf[newId] = { path: `BinData/${newId}.${ext}`, ext, data: pkg.files[n] };
    }

    // 서식 목록: 바탕 문서는 그대로, 뒤 문서는 번호를 밀어서 이어 붙일 준비
    const appendParts = {}; // group -> 이어 붙일 XML
    for (const [group, tag, attrs] of CATS) {
      const b = block(pkg.header, group);
      let f = ident;
      if (!isBase && b) {
        const mine = ids(pkg.header.slice(b.cs, b.ce), tag);
        const cur = block(header, group);
        const existing = cur ? ids(header.slice(cur.cs, cur.ce), tag) : [];
        if (mine.length) {
          const offset = (existing.length ? Math.max(...existing) + 1 : Math.min(...mine)) - Math.min(...mine);
          f = (v) => v + offset;
        }
        appendParts[group] = { inner: pkg.header.slice(b.cs, b.ce), tag, f };
      }
      map.cat[tag] = f;
      for (const a of attrs) map.attr[a] = f;
    }
    // 글꼴: 언어별
    const fontAppend = {};
    for (const [LANG, attr] of Object.entries(FONT_LANGS)) {
      const re = new RegExp(`<hh:fontface\\b[^>]*lang="${LANG}"[^>]*>([\\s\\S]*?)</hh:fontface>`);
      const mine = pkg.header.match(re);
      let f = ident;
      if (!isBase && mine) {
        const cur = header.match(re);
        const existing = cur ? ids(cur[1], 'font') : [];
        const own = ids(mine[1], 'font');
        if (own.length) {
          const offset = (existing.length ? Math.max(...existing) + 1 : 0) - Math.min(...own);
          f = (v) => v + offset;
        }
        fontAppend[LANG] = { inner: mine[1], f };
      }
      map.font[attr] = f;
    }
    // 스타일: 같은 이름은 바탕 문서 스타일 사용, 새 이름만 추가
    const styleBlock = block(pkg.header, 'styles');
    const newStyles = [];
    if (!isBase && styleBlock) {
      const cur = block(header, 'styles');
      let next = Math.max(-1, ...ids(header.slice(cur.cs, cur.ce), 'style')) + 1;
      const smap = {};
      const tags = [...pkg.header.slice(styleBlock.cs, styleBlock.ce).matchAll(/<hh:style\b[^>]*?(?:\/>|>[\s\S]*?<\/hh:style>)/g)].map((m) => m[0]);
      for (const t of tags) {
        const id = +t.match(/\sid="(\d+)"/)[1];
        const name = t.match(/\sname="([^"]*)"/)?.[1] ?? '';
        if (baseStyles.has(name)) smap[id] = baseStyles.get(name);
        else { smap[id] = next++; baseStyles.set(name, smap[id]); newStyles.push({ id, xml: t }); }
      }
      map.attr.styleIDRef = (v) => smap[v] ?? v;
      map.attr.nextStyleIDRef = (v) => smap[v] ?? v;
      for (const s of newStyles) s.xml = setAttr(remapRefs(s.xml, map), 'id', smap[s.id]);
    }

    // header에 이어 붙이기
    if (!isBase) {
      for (const [group, { inner, tag, f }] of Object.entries(appendParts)) {
        let part = remapRefs(inner, map).replace(new RegExp(`(<hh:${escRe(tag)}\\b[^>]*?\\sid=")(\\d+)"`, 'g'), (all, p, v) => `${p}${f(+v)}"`);
        const cur = block(header, group);
        if (cur) {
          const items = ids(header.slice(cur.cs, cur.ce) + part, tag).length;
          const open = setAttr(cur.open, 'itemCnt', items);
          header = header.slice(0, cur.s) + open + header.slice(cur.cs, cur.ce) + part + header.slice(cur.ce);
        } else {
          const rl = header.indexOf('</hh:refList>');
          header = header.slice(0, rl) + `<hh:${group} itemCnt="${ids(part, tag).length}">${part}</hh:${group}>` + header.slice(rl);
        }
      }
      for (const [LANG, { inner, f }] of Object.entries(fontAppend)) {
        const part = inner.replace(/(<hh:font\b[^>]*?\sid=")(\d+)"/g, (all, p, v) => `${p}${f(+v)}"`);
        header = header.replace(new RegExp(`(<hh:fontface\\b[^>]*lang="${LANG}"[^>]*>)([\\s\\S]*?)(</hh:fontface>)`), (all, open, body, close) =>
          setAttr(open, 'fontCnt', ids(body + part, 'font').length) + body + part + close);
      }
      if (newStyles.length) {
        const cur = block(header, 'styles');
        const part = newStyles.map((s) => s.xml).join('');
        const open = setAttr(cur.open, 'itemCnt', ids(header.slice(cur.cs, cur.ce) + part, 'style').length);
        header = header.slice(0, cur.s) + open + header.slice(cur.cs, cur.ce) + part + header.slice(cur.ce);
      }
    } else {
      // 바탕 문서도 그림 번호는 새로 매겼으므로 header 안 그림 참조를 고친다
      header = remapRefs(header, { attr: {}, cat: { numbering: (v) => v, bullet: (v) => v }, font: {}, bin: map.bin });
    }

    // 그림 파일
    for (const [id, b] of Object.entries(binOf)) {
      outFiles[b.path] = b.data;
      manifestItems.push(`<opf:item id="${id}" href="${b.path}" media-type="${MEDIA[b.ext] ?? 'application/octet-stream'}" isEmbeded="1"/>`);
    }
    // 본문 구역
    for (const sn of pkg.sections) {
      const xml = remapRefs(strFromU8(pkg.files[sn]), isBase ? { attr: {}, cat: { numbering: (v) => v, bullet: (v) => v }, font: {}, bin: map.bin } : map);
      const name = `section${secNo++}`;
      outFiles[`Contents/${name}.xml`] = strToU8(xml);
      manifestItems.push(`<opf:item id="${name}" href="Contents/${name}.xml" media-type="application/xml"/>`);
      spine.push(`<opf:itemref idref="${name}" linear="yes"/>`);
    }
  });

  // 구역 수
  header = header.replace(/(<hh:head\b[^>]*?\ssecCnt=")\d+"/, `$1${secNo}"`);
  outFiles['Contents/header.xml'] = strToU8(header);

  // content.hpf: 바탕 문서의 metadata를 쓰고 manifest/spine은 새로 만든다
  const hpf = strFromU8(base.files['Contents/content.hpf']);
  const head = hpf.slice(0, hpf.indexOf('<opf:manifest>'));
  const tail = hpf.slice(hpf.indexOf('</opf:spine>') + '</opf:spine>'.length);
  let newHpf = head
    + '<opf:manifest><opf:item id="header" href="Contents/header.xml" media-type="application/xml"/>'
    + manifestItems.join('')
    + (base.files['settings.xml'] ? '<opf:item id="settings" href="settings.xml" media-type="application/xml"/>' : '')
    + '</opf:manifest><opf:spine><opf:itemref idref="header" linear="yes"/>' + spine.join('') + '</opf:spine>' + tail;
  if (title) {
    const t = String(title).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    newHpf = newHpf.replace(/<opf:title>[^<]*<\/opf:title>|<opf:title\/>/, `<opf:title>${t}</opf:title>`);
  }
  outFiles['Contents/content.hpf'] = strToU8(newHpf);
  // 미리보기 텍스트는 바탕 문서 것이라 맞지 않으므로 뺀다
  delete outFiles['Preview/PrvText.txt'];
  delete outFiles['Preview/PrvImage.png'];

  // mimetype은 압축하지 않고 맨 앞에 둔다 (HWPX/OCF 규칙)
  const ordered = { mimetype: [outFiles.mimetype ?? strToU8('application/hwp+zip'), { level: 0 }] };
  // 이미 압축된 그림(png/jpg/gif)은 다시 압축하지 않는다
  for (const [k, v] of Object.entries(outFiles)) if (k !== 'mimetype') ordered[k] = /^BinData\/.*\.(png|jpe?g|gif)$/i.test(k) ? [v, { level: 0 }] : v;
  return Buffer.from(zipSync(ordered, { level: 6 }));
}
