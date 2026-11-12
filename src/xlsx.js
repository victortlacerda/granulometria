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
<fills count="4"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill>
<fill><patternFill patternType="solid"><fgColor rgb="FFDCEBFA"/><bgColor indexed="64"/></patternFill></fill>
<fill><patternFill patternType="solid"><fgColor rgb="FFFFF4C7"/><bgColor indexed="64"/></patternFill></fill></fills>
<borders count="3"><border><left/><right/><top/><bottom/><diagonal/></border>
<border><left/><right/><top/><bottom style="thin"><color rgb="FF9DB4CC"/></bottom><diagonal/></border>
<border><left style="thin"><color rgb="FFE0B84A"/></left><right style="thin"><color rgb="FFE0B84A"/></right><top style="thin"><color rgb="FFE0B84A"/></top><bottom style="thin"><color rgb="FFE0B84A"/></bottom><diagonal/></border></borders>
<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
<cellXfs count="10">
<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>
<xf numFmtId="0" fontId="1" fillId="2" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center" wrapText="1"/></xf>
<xf numFmtId="0" fontId="2" fillId="0" borderId="0" xfId="0" applyFont="1"/>
<xf numFmtId="2" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>
<xf numFmtId="164" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>
<xf numFmtId="0" fontId="3" fillId="0" borderId="0" xfId="0" applyFont="1"/>
<xf numFmtId="165" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>
<xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/>
<xf numFmtId="0" fontId="0" fillId="3" borderId="2" xfId="0" applyFill="1" applyBorder="1"/>
<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0" applyAlignment="1"><alignment wrapText="1" vertical="top"/></xf>
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
      { name: 'xl/workbook.xml', data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>${wbSheets.join('')}</sheets><calcPr calcId="191029" fullCalcOnLoad="1"/></workbook>` },
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
        a.cuClass ? `${a.cuClass.label} — ${a.cuClass.note}` : '—',
        a.ccClass ? `${a.ccClass.label} — ${a.ccClass.note}` : '—',
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
      'Cu < 5: mal graduado (muito uniforme) · Cu = 5 a 15: uniformidade média · Cu > 15: solo bem graduado (heterogêneo).',
      '1 ≤ Cc ≤ 3: solo bem graduado · Cc > 3 ou Cc < 1: solo mal graduado (graduação aberta quando a curva tem patamar).',
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

  /* ------------------------------------------ Planilha modelo para preencher */
  // estilos: 8 = célula de entrada (amarela) · 9 = texto com quebra de linha
  function buildTemplate(opts = {}) {
    const sieves = C.SIEVES.map(s => ({ d: s.d, label: s.label }));         // 14 peneiras (76 → 0,075)
    const sed = [0.05, 0.02, 0.01, 0.005, 0.002].map(d => ({ d, label: 'sedimentação' }));
    const n = sieves.length;               // linhas 2..n+1
    const fundoRow = n + 2;                // "Fundo (prato)"
    const last = n + 1;
    const rows = [['Diâmetro (mm)', 'Massa retida (g)', '% Passante', '% Retida acumulada', 'Peneira / ensaio'].map(h => ({ v: h, s: 1 }))];
    sieves.forEach((s, i) => {
      const r = i + 2;
      rows.push([
        { v: s.d, s: 0 },
        { v: '', s: 8 },
        { f: `IF(OR(B${r}="",$G$6<=0),"",100*(1-SUM(B$2:B${r})/$G$6))`, s: 4 },
        { f: `IF(C${r}="","",100-C${r})`, s: 4 },
        s.label,
      ]);
    });
    rows.push([{ v: 'Fundo (prato)', s: 7 }, { v: '', s: 8 }, '', '', { v: 'massa retida no prato', s: 5 }]);
    sed.forEach((s, i) => {
      const r = fundoRow + 1 + i;
      rows.push([{ v: s.d, s: 6 }, { v: '—', s: 5 }, { v: '', s: 8 }, { f: `IF(C${r}="","",100-C${r})`, s: 4 }, { v: 'sedimentação (digite o % passante)', s: 5 }]);
    });
    // total das massas ao lado da tabela (G1 = rótulo, G2 = soma)
    // coluna G: G1/G2 massa inicial seca (opcional) · G4 soma das pesagens · G6 massa usada · G8 diferença
    const put = (r, v) => { while (rows.length <= r) rows.push([]); rows[r][6] = v; };
    put(0, { v: 'Massa inicial seca (g) — opcional', s: 1 });
    put(1, { v: '', s: 8 });
    put(2, { v: 'Soma retidas + fundo (g)', s: 1 });
    put(3, { f: `SUM(B2:B${last})+N(B${fundoRow})`, s: 3 });
    put(4, { v: 'Massa usada nos cálculos (g)', s: 1 });
    put(5, { f: `IF(N(G2)>0,G2,G4)`, s: 3 });
    put(6, { v: 'Diferença (%)', s: 1 });
    put(7, { f: `IF(G6>0,100*(G6-G4)/G6,"")`, s: 3 });

    const help = [
      [{ v: 'Planilha modelo — análise granulométrica', s: 2 }],
      [''],
      [{ v: 'Como preencher', s: 7 }],
      ['1. Na aba "Ensaio 1", preencha as células amarelas.'],
      ['2. Peneiramento: digite a MASSA RETIDA (g) em cada peneira (coluna B) e no fundo/prato. O % passante (coluna C) é calculado sozinho.'],
      ['   Se você pesou a amostra antes do ensaio (ex.: 200 g), digite em "Massa inicial seca" (G2): ela passa a ser a massa total e a planilha mostra a diferença para a soma das pesagens (perdas). Sem ela, o total é a soma das pesagens.'],
      ['   Se você já tem o % passante, digite-o direto na coluna C (pode sobrescrever a fórmula).'],
      ['3. Sedimentação (fração fina, < 0,075 mm): digite o % passante (coluna C) de cada diâmetro obtido no ensaio do densímetro. Deixe em branco o que não tiver.'],
      ['4. Pode apagar ou acrescentar linhas de diâmetro. Deixe em branco as peneiras que não usou.'],
      ['5. Para comparar vários solos, copie a aba "Ensaio 1" (clique direito → Mover ou copiar) e renomeie — cada aba vira um ensaio.'],
      ['6. No app: "Importar arquivo" (abre este .xlsx) ou copie as colunas A e C, e use "Colar do Excel".'],
      [''],
      [{ v: 'Séries de peneiras: 76 mm (3″) · 50 · 38 · 25 · 19 · 9,5 · 4,75 (nº 4) · 2,0 (nº 10) · 1,2 · 0,6 (nº 30) · 0,42 (nº 40) · 0,25 · 0,15 · 0,075 (nº 200).', s: 5 }],
    ];
    const sheets = [
      { name: opts.name || 'Ensaio 1', rows, cols: [16, 16, 13, 19, 34, 3, 24], freeze: 1 },
      { name: 'Instruções', rows: help, cols: [120] },
    ];
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

    // coluna do diâmetro: a que o cabeçalho chama de malha/diâmetro/abertura/(mm); senão a 1ª
    const DIAM = /malha|di[aâ]metro|abertura|\(mm\)|\bmm\b|\(µm\)|\(μm\)/i;
    let dc = 0, hdrRow = -1;
    for (let i = 0; i < Math.min(R.length, 8) && hdrRow < 0; i++) {
      const j = R[i].findIndex(c => c != null && typeof c === 'string' && !isNum(c) && DIAM.test(c));
      if (j >= 0 && R[i + 1]) { dc = j; hdrRow = i; }
    }
    let start = R.findIndex((r, i) => i > hdrRow && isNum(r[dc]) && r.some((c, j) => j !== dc && isNum(c)));
    if (start < 0) return [];
    let header = start > 0 ? R[start - 1] : null;
    if (header && header.some(isNum) && !header.some(c => typeof c === 'string' && !isNum(c))) header = null; // linha anterior é dado, não cabeçalho
    const data = [];
    for (let i = start; i < R.length; i++) if (isNum(R[i][dc])) data.push(R[i]);
    const ncol = Math.max(...data.map(r => r.length));

    let dScale = 1;
    if (header && header[dc] && /µm|μm|micr[oô]n|\(um\)/i.test(String(header[dc]))) dScale = 0.001;

    let series = [];
    for (let j = 0; j < ncol; j++) {
      if (j === dc) continue;
      const h = header && header[j] != null ? String(header[j]).trim() : '';
      if (/^(peneira|n[º°o]\.?|sieve|abertura)/i.test(h) && !/passa|retid|massa/i.test(h)) continue; // nome/nº da peneira
      if (j < dc && !header) continue;
      const vals = data.filter(r => isNum(r[j]));
      if (vals.length < 2) continue;
      let mode = 'passa';
      if (/massa|\(g\)|peso/i.test(h)) mode = /pass/i.test(h) ? 'massap' : 'massa';
      else if (/retid/i.test(h) && !/passa/i.test(h)) mode = 'retida';
      series.push({ j, h, mode });
    }
    // colunas derivadas (planilha do app / modelo / exercício): mantém a % passante; sem ela, a massa
    const has = (m) => series.some(s => s.mode === m);
    if (has('passa') && (has('retida') || has('massa') || has('massap'))) series = series.filter(s => s.mode === 'passa');
    else if ((has('massa') || has('massap')) && has('retida')) series = series.filter(s => s.mode !== 'retida');

    // massa inicial seca (célula abaixo do rótulo "Massa inicial") e massa retida no fundo (linha "Fundo"/"Prato")
    let mtotal = '';
    R.forEach((r, ri) => r.forEach((c, cj) => {
      if (c != null && /massa inicial/i.test(String(c))) {
        const below = (R[ri + 1] || [])[cj];
        if (isNum(below) && C.toNum(below) > 0) mtotal = String(C.toNum(below)).replace('.', ',');
      }
    }));
    let fundo = '';
    for (const r of R) {
      if (r[0] != null && /fundo|prato/i.test(String(r[0]))) {
        const col = series.find(s => s.mode === 'massa');
        if (col && isNum(r[col.j])) fundo = String(C.toNum(r[col.j])).replace('.', ',');
      }
    }

    const generic = /^(%|porcentagem|massa|peso|passa|retid|diâmetro|diametro)/i;
    const fmt = (n) => String(Number(Number(n).toPrecision(10))).replace('.', ',');
    return series.map((s, k) => {
      let name;
      if (series.length === 1) name = (s.h && !generic.test(s.h)) ? s.h : sheetName;
      else name = (s.h && !generic.test(s.h)) ? s.h : `${sheetName} ${k + 1}`;
      return {
        name, mode: s.mode, fundo: s.mode === 'massa' ? fundo : '', mtotal: (s.mode === 'massa' || s.mode === 'massap') ? mtotal : '',
        rows: data.filter(r => isNum(r[s.j])).map(r => ({ d: fmt(C.toNum(r[dc]) * dScale), v: fmt(C.toNum(r[s.j])) })),
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
        if (/^(resumo|gr[aá]fico|instru[cç][oõ]es)$/i.test(sh.name)) continue;
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

  return { buildXlsx, buildReport, buildTemplate, readXlsx, parseText, rowsToEnsaios, importFile, zipStore, crc32 };
})();

if (typeof module !== 'undefined' && module.exports) module.exports = GranuloIO;
