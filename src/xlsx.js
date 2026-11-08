/* ==========================================================================
   xlsx.js — leitura/escrita de planilhas sem bibliotecas externas
   - gera .xlsx (ZIP "store" + SpreadsheetML), com fórmulas e imagem do gráfico
   - lê .xlsx (usa DecompressionStream do navegador), .csv e texto colado
   ========================================================================== */
const GranuloIO = (() => {
  'use strict';
  const C = (typeof GranuloCore !== 'undefined') ? GranuloCore : require('./core.js');
  const enc = new TextEncoder();
  const dec = new TextDecoder('utf-8');

  /* ------------------------------------------------------------------ ZIP */
  const CRC_TABLE = (() => {
    const t = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1;
      t[n] = c >>> 0;
    }
    return t;
  })();
  function crc32(bytes) {
    let c = 0xFFFFFFFF;
    for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xFF] ^ (c >>> 8);
    return (c ^ 0xFFFFFFFF) >>> 0;
  }

  function zipStore(files) {
    const parts = [], central = [];
    let offset = 0;
    const DOS_TIME = (12 << 11), DOS_DATE = ((2024 - 1980) << 9) | (1 << 5) | 1;
    for (const f of files) {
      const name = enc.encode(f.name);
      const data = typeof f.data === 'string' ? enc.encode(f.data) : f.data;
      const crc = crc32(data);
      const lh = new DataView(new ArrayBuffer(30));
      lh.setUint32(0, 0x04034b50, true); lh.setUint16(4, 20, true); lh.setUint16(6, 0x0800, true);
      lh.setUint16(8, 0, true); lh.setUint16(10, DOS_TIME, true); lh.setUint16(12, DOS_DATE, true);
      lh.setUint32(14, crc, true); lh.setUint32(18, data.length, true); lh.setUint32(22, data.length, true);
      lh.setUint16(26, name.length, true); lh.setUint16(28, 0, true);
      parts.push(new Uint8Array(lh.buffer), name, data);

      const ch = new DataView(new ArrayBuffer(46));
      ch.setUint32(0, 0x02014b50, true); ch.setUint16(4, 20, true); ch.setUint16(6, 20, true);
      ch.setUint16(8, 0x0800, true); ch.setUint16(10, 0, true); ch.setUint16(12, DOS_TIME, true); ch.setUint16(14, DOS_DATE, true);
      ch.setUint32(16, crc, true); ch.setUint32(20, data.length, true); ch.setUint32(24, data.length, true);
      ch.setUint16(28, name.length, true); ch.setUint32(42, offset, true);
      central.push(new Uint8Array(ch.buffer), name);
      offset += 30 + name.length + data.length;
    }
    const cdSize = central.reduce((s, x) => s + x.length, 0);
    const end = new DataView(new ArrayBuffer(22));
    end.setUint32(0, 0x06054b50, true); end.setUint16(8, files.length, true); end.setUint16(10, files.length, true);
    end.setUint32(12, cdSize, true); end.setUint32(16, offset, true);
    const all = [...parts, ...central, new Uint8Array(end.buffer)];
    const out = new Uint8Array(all.reduce((s, x) => s + x.length, 0));
    let p = 0;
    for (const x of all) { out.set(x, p); p += x.length; }
    return out;
  }

  async function inflateRaw(bytes) {
    const ds = new DecompressionStream('deflate-raw');
    const stream = new Blob([bytes]).stream().pipeThrough(ds);
    return new Uint8Array(await new Response(stream).arrayBuffer());
  }

  async function unzip(buf) {
    const u8 = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
    const dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
    let eocd = -1;
    for (let i = u8.length - 22; i >= Math.max(0, u8.length - 65557); i--) {
      if (dv.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
    }
    if (eocd < 0) throw new Error('Arquivo não é um .xlsx válido.');
    const n = dv.getUint16(eocd + 10, true);
    let p = dv.getUint32(eocd + 16, true);
    const entries = {};
    for (let i = 0; i < n; i++) {
      if (dv.getUint32(p, true) !== 0x02014b50) break;
      const method = dv.getUint16(p + 10, true);
      const csize = dv.getUint32(p + 20, true);
      const nlen = dv.getUint16(p + 28, true), elen = dv.getUint16(p + 30, true), clen = dv.getUint16(p + 32, true);
      const lho = dv.getUint32(p + 42, true);
      const name = dec.decode(u8.subarray(p + 46, p + 46 + nlen));
      entries[name] = { method, csize, lho };
      p += 46 + nlen + elen + clen;
    }
    const read = async (name) => {
      const e = entries[name];
      if (!e) return null;
      const nl = dv.getUint16(e.lho + 26, true), el = dv.getUint16(e.lho + 28, true);
      const start = e.lho + 30 + nl + el;
      const raw = u8.subarray(start, start + e.csize);
      if (e.method === 0) return raw;
      if (e.method === 8) {
        if (typeof DecompressionStream === 'undefined') throw new Error('Este navegador não consegue abrir .xlsx — salve a planilha como CSV.');
        return inflateRaw(raw);
      }
      throw new Error('Compressão de .xlsx não suportada.');
    };
    return { names: Object.keys(entries), read };
  }

  /* ------------------------------------------------------------ XML utils */
  const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  const unesc = (s) => s.replace(/&(#x?[0-9a-fA-F]+|amp|lt|gt|quot|apos);/g, (m, g) => {
    if (g[0] === '#') return String.fromCodePoint(g[1] === 'x' || g[1] === 'X' ? parseInt(g.slice(2), 16) : parseInt(g.slice(1), 10));
    return { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" }[g];
  });
  const colName = (i) => { let s = ''; i++; while (i > 0) { const m = (i - 1) % 26; s = String.fromCharCode(65 + m) + s; i = Math.floor((i - 1) / 26); } return s; };
  const colIndex = (letters) => { let n = 0; for (const ch of letters) n = n * 26 + (ch.charCodeAt(0) - 64); return n - 1; };
  const attrs = (str) => { const o = {}; str.replace(/([\w:.-]+)\s*=\s*"([^"]*)"/g, (_, k, v) => { o[k] = unesc(v); }); return o; };

  /* ---------------------------------------------------------- Escrita XLSX */
  // estilos: 0 normal | 1 cabeçalho | 2 título | 3 0,00 | 4 0,0 | 5 nota | 6 0,000 | 7 negrito
  const STYLES = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
<numFmts count="2"><numFmt numFmtId="164" formatCode="0.0"/><numFmt numFmtId="165" formatCode="0.000"/></numFmts>
<fonts count="4">
<font><sz val="11"/><name val="Calibri"/></font>
<font><b/><sz val="11"/><name val="Calibri"/></font>
<font><b/><sz val="14"/><color rgb="FF1E3A5F"/><name val="Calibri"/></font>
<font><i/><sz val="10"/><color rgb="FF6B7280"/><name val="Calibri"/></font>
</fonts>
<fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill>
<fill><patternFill patternType="solid"><fgColor rgb="FFDCEBFA"/><bgColor indexed="64"/></patternFill></fill></fills>
<borders count="2"><border><left/><right/><top/><bottom/><diagonal/></border>
<border><left/><right/><top/><bottom style="thin"><color rgb="FF9DB4CC"/></bottom><diagonal/></border></borders>
<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
<cellXfs count="8">
<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>
<xf numFmtId="0" fontId="1" fillId="2" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center" wrapText="1"/></xf>
<xf numFmtId="0" fontId="2" fillId="0" borderId="0" xfId="0" applyFont="1"/>
<xf numFmtId="2" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>
<xf numFmtId="164" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>
<xf numFmtId="0" fontId="3" fillId="0" borderId="0" xfId="0" applyFont="1"/>
<xf numFmtId="165" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>
<xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/>
</cellXfs>
<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>
</styleSheet>`;

  function cellXml(ref, c) {
    if (c == null || c === '') return '';
    let v = c, s = null, f = null;
    if (typeof c === 'object') { v = c.v; s = c.s; f = c.f; }
    const sa = s != null ? ` s="${s}"` : '';
    if (f != null) {
      if (typeof v === 'string') return `<c r="${ref}"${sa} t="str"><f>${esc(f)}</f><v>${esc(v)}</v></c>`;
      return `<c r="${ref}"${sa}><f>${esc(f)}</f>${v == null || !isFinite(v) ? '' : `<v>${v}</v>`}</c>`;
    }
    if (typeof v === 'number') return isFinite(v) ? `<c r="${ref}"${sa}><v>${v}</v></c>` : '';
    return `<c r="${ref}"${sa} t="inlineStr"><is><t xml:space="preserve">${esc(v)}</t></is></c>`;
  }

  function sheetXml(sh, hasDrawing) {
    const cols = sh.cols && sh.cols.length
      ? `<cols>${sh.cols.map((w, i) => `<col min="${i + 1}" max="${i + 1}" width="${w}" customWidth="1"/>`).join('')}</cols>` : '';
    const rows = sh.rows.map((r, i) => {
      const cells = r.map((c, j) => cellXml(colName(j) + (i + 1), c)).join('');
      const ht = sh.rowHeights && sh.rowHeights[i] ? ` ht="${sh.rowHeights[i]}" customHeight="1"` : '';
      return cells || ht ? `<row r="${i + 1}"${ht}>${cells}</row>` : '';
    }).join('');
    return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">${sh.freeze ? `<sheetViews><sheetView workbookViewId="0"><pane ySplit="${sh.freeze}" topLeftCell="A${sh.freeze + 1}" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>` : ''}${cols}<sheetData>${rows}</sheetData><pageMargins left="0.7" right="0.7" top="0.75" bottom="0.75" header="0.3" footer="0.3"/>${hasDrawing ? '<drawing r:id="rId1"/>' : ''}</worksheet>`;
  }

  function safeSheetName(name, used) {
    let n = String(name).replace(/[\[\]:*?\/\\]/g, '-').replace(/^'+|'+$/g, '').trim().slice(0, 31) || 'Ensaio';
    let base = n, k = 2;
    while (used.has(n.toLowerCase())) { const suf = ` (${k++})`; n = base.slice(0, 31 - suf.length) + suf; }
    used.add(n.toLowerCase());
    return n;
  }

  // sheets: [{name, rows, cols, freeze, image:{png:Uint8Array,w,h}}]
  function buildXlsx(sheets) {
    const used = new Set();
    sheets = sheets.map(s => ({ ...s, name: safeSheetName(s.name, used) }));
    const files = [];
    let drawingN = 0, imageN = 0;
    const ctSheets = [], wbSheets = [], wbRels = [];

    sheets.forEach((sh, i) => {
      const n = i + 1;
      const hasImg = !!sh.image;
      files.push({ name: `xl/worksheets/sheet${n}.xml`, data: sheetXml(sh, hasImg) });
      ctSheets.push(`<Override PartName="/xl/worksheets/sheet${n}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`);
      wbSheets.push(`<sheet name="${esc(sh.name)}" sheetId="${n}" r:id="rId${n}"/>`);
      wbRels.push(`<Relationship Id="rId${n}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${n}.xml"/>`);
      if (hasImg) {
        drawingN++; imageN++;
        files.push({ name: `xl/worksheets/_rels/sheet${n}.xml.rels`, data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/drawing" Target="../drawings/drawing${drawingN}.xml"/></Relationships>` });
        const cx = Math.round(sh.image.w * 9525), cy = Math.round(sh.image.h * 9525);
        files.push({ name: `xl/drawings/drawing${drawingN}.xml`, data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><xdr:wsDr xmlns:xdr="http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><xdr:oneCellAnchor><xdr:from><xdr:col>0</xdr:col><xdr:colOff>0</xdr:colOff><xdr:row>0</xdr:row><xdr:rowOff>0</xdr:rowOff></xdr:from><xdr:ext cx="${cx}" cy="${cy}"/><xdr:pic><xdr:nvPicPr><xdr:cNvPr id="2" name="Curva granulométrica"/><xdr:cNvPicPr><a:picLocks noChangeAspect="1"/></xdr:cNvPicPr></xdr:nvPicPr><xdr:blipFill><a:blip r:embed="rId1"/><a:stretch><a:fillRect/></a:stretch></xdr:blipFill><xdr:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${cx}" cy="${cy}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></xdr:spPr></xdr:pic><xdr:clientData/></xdr:oneCellAnchor></xdr:wsDr>` });
        files.push({ name: `xl/drawings/_rels/drawing${drawingN}.xml.rels`, data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="../media/image${imageN}.png"/></Relationships>` });
        files.push({ name: `xl/media/image${imageN}.png`, data: sh.image.png });
        ctSheets.push(`<Override PartName="/xl/drawings/drawing${drawingN}.xml" ContentType="application/vnd.openxmlformats-officedocument.drawing+xml"/>`);
      }
    });
    const stN = sheets.length + 1;
    wbRels.push(`<Relationship Id="rId${stN}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>`);

    files.unshift(
      { name: '[Content_Types].xml', data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Default Extension="png" ContentType="image/png"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>${ctSheets.join('')}</Types>` },
      { name: '_rels/.rels', data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>` },
      { name: 'xl/workbook.xml', data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>${wbSheets.join('')}</sheets></workbook>` },
      { name: 'xl/_rels/workbook.xml.rels', data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${wbRels.join('')}</Relationships>` },
      { name: 'xl/styles.xml', data: STYLES },
    );
    return zipStore(files);
  }

  /* ------------------------------------------ Relatório de ensaios (Excel) */
  // items: [{ name, ensaio, a (analyze) }]
  function buildReport(items, opts = {}) {
    const sys = C.SYSTEMS[opts.system] || C.SYSTEMS.abnt;
    const today = new Date().toLocaleDateString('pt-BR');
    const num = (x, s) => (x == null || !isFinite(x)) ? '' : { v: x, s };

    const head = ['Ensaio', 'D10 (mm)', 'D30 (mm)', 'D60 (mm)', 'Cu = D60/D10', 'Cc = D30²/(D10×D60)', 'Classificação (Cu)', 'Classificação (Cc)', 'Graduação', 'SUCS (preliminar)', '% Pedregulho', '% Areia', '% Silte', '% Argila', '% Finos sem sedimentação', 'D15 (mm)', 'D85 (mm)'];
    const rows = [
      [{ v: 'Análise granulométrica — resumo', s: 2 }],
      [{ v: `Frações: ${sys.name} · gerado em ${today}`, s: 5 }],
      [],
      head.map(h => ({ v: h, s: 1 })),
    ];
    items.forEach((it, i) => {
      const r = 5 + i, a = it.a;
      if (!a || !a.valid) { rows.push([it.name, { v: 'dados insuficientes', s: 5 }]); return; }
      const co = a.coef, g = (k) => a.comp.groups.find(x => x.key === k);
      rows.push([
        it.name,
        num(co.D10.d, 6), num(co.D30.d, 6), num(co.D60.d, 6),
        { f: `IF(AND(ISNUMBER(B${r}),ISNUMBER(D${r})),D${r}/B${r},"")`, v: co.Cu == null ? '' : co.Cu, s: 3 },
        { f: `IF(AND(ISNUMBER(B${r}),ISNUMBER(C${r}),ISNUMBER(D${r})),C${r}^2/(B${r}*D${r}),"")`, v: co.Cc == null ? '' : co.Cc, s: 3 },
        a.cuClass ? `${a.cuClass.label} (${a.cuClass.note})` : '—',
        a.ccClass ? `${a.ccClass.label} (${a.ccClass.note})` : '—',
        a.grading.label,
        a.sucs ? a.sucs.symbol : '—',
        num(g('pedregulho').pct, 4), num(g('areia').pct, 4), num(g('silte').pct, 4), num(g('argila').pct, 4),
        a.comp.rest ? num(a.comp.rest.pct, 4) : '',
        num(co.D15.d, 6), num(co.D85.d, 6),
      ]);
    });
    rows.push([]);
    rows.push([{ v: 'Critérios', s: 7 }]);
    [
      'Cu < 5: muito uniforme (mal graduado) · 5 ≤ Cu ≤ 15: uniformidade média · Cu > 15: heterogêneo (bem graduado).',
      'Cc entre 1 e 3: curva harmônica (bem graduado); fora dessa faixa: mal graduado.',
      'Bem graduado (SUCS): 1 ≤ Cc ≤ 3 e Cu ≥ 4 (pedregulho) ou Cu ≥ 6 (areia).',
      'D10, D30 e D60 obtidos por interpolação linear do % passante contra log(D) entre pontos medidos.',
    ].forEach(t => rows.push([{ v: t, s: 5 }]));

    const sheets = [{ name: 'Resumo', rows, cols: [34, 11, 11, 11, 14, 18, 36, 36, 30, 22, 13, 11, 11, 11, 16, 11, 11], rowHeights: { 3: 32 }, }];
    if (opts.png) sheets.push({ name: 'Gráfico', rows: [[]], image: opts.png });

    items.forEach(it => {
      const a = it.a;
      const hdr = ['Diâmetro (mm)', '% Passante', '% Retida acumulada', 'Peneira'].map(h => ({ v: h, s: 1 }));
      const r = [hdr];
      if (a && a.pts.length) {
        [...a.pts].sort((x, y) => y.d - x.d).forEach((p, k) => {
          const sv = C.sieveFor(p.d);
          const row = k + 2;
          r.push([
            { v: p.d, s: p.d < 0.1 ? 6 : 0 },
            { v: Math.round(p.p * 1e6) / 1e6, s: 4 },
            { f: `100-B${row}`, v: 100 - p.p, s: 4 },
            sv ? sv.label : (p.d < 0.075 ? 'sedimentação' : ''),
          ]);
        });
      }
      sheets.push({ name: it.name, rows: r, cols: [15, 13, 19, 14], freeze: 1 });
    });
    return buildXlsx(sheets);
  }

  /* ------------------------------------------------------------- Leitura */
  async function readXlsx(buf) {
    const z = await unzip(buf);
    const text = async (n) => { const b = await z.read(n); return b ? dec.decode(b) : null; };
    const wb = await text('xl/workbook.xml');
    if (!wb) throw new Error('Arquivo .xlsx sem workbook.');
    const rels = await text('xl/_rels/workbook.xml.rels') || '';
    const relMap = {};
    (rels.match(/<Relationship\b[^>]*>/g) || []).forEach(t => { const a = attrs(t); relMap[a.Id] = a.Target; });
    const sst = [];
    const sstXml = await text('xl/sharedStrings.xml');
    if (sstXml) {
      (sstXml.match(/<si\b[\s\S]*?<\/si>|<si\s*\/>/g) || []).forEach(si => {
        const noPh = si.replace(/<rPh\b[\s\S]*?<\/rPh>/g, '');
        let t = '';
        noPh.replace(/<t\b[^>]*>([\s\S]*?)<\/t>/g, (_, x) => { t += unesc(x); return ''; });
        sst.push(t);
      });
    }
    const out = [];
    for (const tag of (wb.match(/<sheet\b[^>]*>/g) || [])) {
      const a = attrs(tag);
      let target = relMap[a['r:id']];
      if (!target) continue;
      target = target.startsWith('/') ? target.slice(1) : 'xl/' + target.replace(/^\.\//, '');
      const xml = await text(target);
      if (!xml) continue;
      const rows = [];
      const re = /<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g;
      let m;
      while ((m = re.exec(xml))) {
        const ca = attrs(m[1]);
        const ref = /^([A-Z]+)(\d+)$/.exec(ca.r || '');
        if (!ref) continue;
        const ci = colIndex(ref[1]), ri = parseInt(ref[2], 10) - 1;
        const inner = m[2] || '';
        let val = null;
        if (ca.t === 'inlineStr') {
          let t = ''; inner.replace(/<t\b[^>]*>([\s\S]*?)<\/t>/g, (_, x) => { t += unesc(x); return ''; }); val = t;
        } else {
          const vm = /<v>([\s\S]*?)<\/v>/.exec(inner);
          if (vm) {
            const raw = unesc(vm[1]);
            if (ca.t === 's') val = sst[parseInt(raw, 10)] ?? '';
            else if (ca.t === 'str' || ca.t === 'e') val = raw;
            else if (ca.t === 'b') val = raw === '1';
            else { const n = parseFloat(raw); val = isFinite(n) ? n : raw; }
          }
        }
        if (val === null || val === '') continue;
        (rows[ri] || (rows[ri] = []))[ci] = val;
      }
      out.push({ name: unesc(a.name || 'Planilha'), rows: Array.from(rows, r => r ? Array.from(r, x => x ?? null) : []) });
    }
    return out;
  }

  function parseText(text) {
    const lines = text.replace(/\r/g, '').split('\n').map(l => l.replace(/\s+$/, '')).filter(l => l.trim() !== '');
    if (!lines.length) return [];
    const has = (ch) => lines.some(l => l.includes(ch));
    let split;
    if (has('\t')) split = (l) => l.split('\t');
    else if (has(';')) split = (l) => l.split(';');
    else if (has(',')) {
      const commaOk = lines.every(l => l.split(',').every(x => x.trim() === '' || isFinite(Number(x)) || /[A-Za-zÀ-ÿ%]/.test(x)))
        && new Set(lines.map(l => l.split(',').length)).size === 1 && lines[0].split(',').length >= 2;
      split = commaOk ? (l) => l.split(',') : (l) => l.trim().split(/\s+/);
    } else split = (l) => l.trim().split(/\s+/);
    return lines.map(l => split(l).map(x => { x = x.trim().replace(/^"|"$/g, ''); return x === '' ? null : x; }));
  }

  // converte uma tabela (linhas × colunas) em ensaios
  function rowsToEnsaios(rows, sheetName = 'Ensaio') {
    const R = rows.filter(r => r && r.some(c => c != null && c !== ''));
    if (R.length < 2) return [];
    const isNum = (x) => x != null && isFinite(C.toNum(x));
    // primeira linha cuja 1ª coluna é número
    let start = R.findIndex(r => isNum(r[0]) && r.slice(1).some(isNum));
    if (start < 0) return [];
    let header = null;
    if (start > 0) header = R[start - 1];
    const data = [];
    for (let i = start; i < R.length; i++) if (isNum(R[i][0])) data.push(R[i]);
    const ncol = Math.max(...data.map(r => r.length));

    let dScale = 1;
    if (header && header[0] && /µm|μm|micr[oô]n|\(um\)/i.test(String(header[0]))) dScale = 0.001;

    let series = [];
    for (let j = 1; j < ncol; j++) {
      const vals = data.filter(r => isNum(r[j]));
      if (vals.length < 2) continue;
      const h = header && header[j] != null ? String(header[j]).trim() : '';
      let mode = 'passa';
      if (/massa|\(g\)|peso/i.test(h)) mode = 'massa';
      else if (/retid/i.test(h) && !/passa/i.test(h)) mode = 'retida';
      series.push({ j, h, mode });
    }
    // planilha exportada pelo app: passante + retida → fica só a passante
    if (series.some(s => s.mode === 'passa') && series.some(s => s.mode === 'retida') && series.length === 2)
      series = series.filter(s => s.mode === 'passa');

    const generic = /^(%|porcentagem|massa|peso|passa|retid|diâmetro|diametro)/i;
    const fmt = (n) => String(Number(Number(n).toPrecision(10))).replace('.', ',');
    return series.map((s, k) => {
      let name;
      if (series.length === 1) name = (s.h && !generic.test(s.h)) ? s.h : sheetName;
      else name = (s.h && !generic.test(s.h)) ? s.h : `${sheetName} ${k + 1}`;
      return {
        name, mode: s.mode,
        rows: data.filter(r => isNum(r[s.j])).map(r => ({ d: fmt(C.toNum(r[0]) * dScale), v: fmt(C.toNum(r[s.j])) })),
      };
    });
  }

  async function importFile(file) {
    const lower = file.name.toLowerCase();
    const base = file.name.replace(/\.[^.]+$/, '');
    if (lower.endsWith('.xlsx') || lower.endsWith('.xlsm')) {
      const sheets = await readXlsx(await file.arrayBuffer());
      const all = [];
      for (const sh of sheets) {
        if (/^(resumo|gr[aá]fico)$/i.test(sh.name)) continue;
        all.push(...rowsToEnsaios(sh.rows, sh.name));
      }
      return all;
    }
    if (lower.endsWith('.xls')) throw new Error('Formato .xls antigo: salve como .xlsx ou CSV.');
    const buf = await file.arrayBuffer();
    let txt;
    try { txt = new TextDecoder('utf-8', { fatal: true }).decode(buf); }
    catch { txt = new TextDecoder('windows-1252').decode(buf); }
    return rowsToEnsaios(parseText(txt), base);
  }

  return { buildXlsx, buildReport, readXlsx, parseText, rowsToEnsaios, importFile, zipStore, crc32 };
})();

if (typeof module !== 'undefined' && module.exports) module.exports = GranuloIO;
