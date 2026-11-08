/* ==========================================================================
   chart.js — gráfico granulométrico em SVG (eixo X logarítmico)
   - eixo Y esquerdo: % passante · direito: % retida acumulada
   - peneiras no topo, escala de frações + sedimentação embaixo
   - linhas guia D10/D30/D60, limites das frações, hover em todos os pontos
   ========================================================================== */
const GranuloChart = (() => {
  'use strict';
  const C = GranuloCore;
  const FONT = 'system-ui,-apple-system,"Segoe UI",Roboto,"Helvetica Neue",Arial,sans-serif';
  const INK = '#1f2a3d', MUTED = '#5b6b82', SOFT = '#8794a8';
  const GRID_MAJOR = '#c5cfdd', GRID_MINOR = '#e8edf4', FRAME = '#8fa1b8';
  const SED_BLUE = '#2f80c9', LIM_AMBER = '#d9822b';
  const CELL_FILL = { argila: '#f3dfd2', silte: '#dcefe3', areia: '#fbefc9', pedregulho: '#e3e8ef' };
  const SED_LIMIT = 0.075; // limite físico do peneiramento (nº 200)

  const aw = (t, fs) => String(t).length * fs * 0.57;
  const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  const r1 = (n) => Math.round(n * 10) / 10;
  const log = Math.log10;

  function T(x, y, txt, o = {}) {
    const { size = 11, fill = MUTED, anchor = 'middle', weight = 400, rot = 0, ls, base, opacity } = o;
    const tr = rot ? ` transform="rotate(${rot} ${r1(x)} ${r1(y)})"` : '';
    return `<text x="${r1(x)}" y="${r1(y)}" font-size="${size}" fill="${fill}" text-anchor="${anchor}" font-weight="${weight}"${ls ? ` letter-spacing="${ls}"` : ''}${base ? ` dominant-baseline="${base}"` : ''}${opacity ? ` opacity="${opacity}"` : ''}${tr}>${esc(txt)}</text>`;
  }
  const L = (x1, y1, x2, y2, stroke, w = 1, dash, extra = '') =>
    `<line x1="${r1(x1)}" y1="${r1(y1)}" x2="${r1(x2)}" y2="${r1(y2)}" stroke="${stroke}" stroke-width="${w}"${dash ? ` stroke-dasharray="${dash}"` : ''}${extra}/>`;

  function fractionAt(d, sysId) {
    const sys = C.SYSTEMS[sysId] || C.SYSTEMS.abnt;
    for (const g of sys.groups) for (const s of g.subs) {
      if (d > s.lo && d <= s.hi) return g.subs.length > 1 ? `${g.label} ${s.label.toLowerCase()}` : g.label;
    }
    return '';
  }

  function render(opts) {
    const { width: W, height: H, series = [], show = {}, system = 'abnt', forExport = false, title = 'Curva granulométrica' } = opts;
    const sys = C.SYSTEMS[system] || C.SYSTEMS.abnt;
    const vis = series.filter(s => s.a && s.a.valid);
    const narrow = W < 560;

    /* ----- geometria ----- */
    const ml = narrow ? 42 : 58, mr = narrow ? 42 : 58;
    const titleH = forExport ? 38 : 0;
    const sieveH = narrow ? 46 : 58;
    const tickH = 18, axisTitleH = 20, bracketH = 24, stripH = narrow ? 42 : 48;
    const limH = show.limits ? 112 : 0;
    // legenda (apenas exportação)
    let legendRows = [];
    if (forExport && vis.length) {
      let row = [], w = 0;
      for (const s of vis) {
        const co = s.a.coef;
        const txt = `${s.name}  (Cu ${C.fmtNum(co.Cu)} · Cc ${C.fmtNum(co.Cc)})`;
        const iw = 22 + aw(txt, 12) + 18;
        if (w + iw > W - 40 && row.length) { legendRows.push(row); row = []; w = 0; }
        row.push({ s, txt, iw, x: w }); w += iw;
      }
      if (row.length) legendRows.push(row);
    }
    const legendH = forExport ? legendRows.length * 22 + 14 : 0;

    const y0 = titleH + sieveH + 4;
    const bottomBlock = tickH + axisTitleH + bracketH + 6 + stripH + limH + 12 + legendH;
    const x0 = ml, x1 = W - mr;
    const y1 = opts.plotH ? y0 + opts.plotH : Math.max(y0 + 160, H - bottomBlock);
    const totalH = y1 + bottomBlock;
    const pw = x1 - x0, ph = y1 - y0;

    /* ----- escala X (log) ----- */
    let dmin = Infinity, dmax = -Infinity;
    for (const s of vis) { dmin = Math.min(dmin, s.a.pts[0].d); dmax = Math.max(dmax, s.a.pts[s.a.pts.length - 1].d); }
    const lmin = Math.floor(log(Math.min(0.001, isFinite(dmin) ? dmin : 0.001)) + 1e-9);
    const lmax = Math.ceil(log(Math.max(100, isFinite(dmax) ? dmax : 100)) - 1e-9);
    const X = (d) => x0 + (log(d) - lmin) / (lmax - lmin) * pw;
    const invX = (px) => Math.pow(10, lmin + (px - x0) / pw * (lmax - lmin));
    const Y = (p) => y1 - p / 100 * ph;
    const XC = (d) => X(Math.min(Math.max(d, Math.pow(10, lmin)), Math.pow(10, lmax)));
    const dec = pw / (lmax - lmin);

    const o = [];
    o.push(`<rect x="0" y="0" width="${W}" height="${totalH}" fill="#ffffff"/>`);
    if (forExport) {
      o.push(T(x0, 24, title, { size: 17, fill: INK, anchor: 'start', weight: 700 }));
      o.push(T(x1, 24, `${sys.name} · ${new Date().toLocaleDateString('pt-BR')}`, { size: 11, fill: SOFT, anchor: 'end' }));
    }

    /* ----- plano de fundo da fração fina (sedimentação) ----- */
    if (show.limits) {
      const xs = XC(SED_LIMIT);
      o.push(`<rect x="${r1(x0)}" y="${r1(y0)}" width="${r1(xs - x0)}" height="${r1(ph)}" fill="#e9f2fb" opacity="0.75"/>`);
      if (xs - x0 > 120) o.push(T(x0 + 8, y0 + 15, 'FRAÇÃO FINA · SEDIMENTAÇÃO', { size: 10, fill: SED_BLUE, anchor: 'start', weight: 600, ls: '.05em' }));
    }

    /* ----- grade ----- */
    for (let p = 0; p <= 100; p += 5) {
      const major = p % 10 === 0;
      o.push(L(x0, Y(p), x1, Y(p), major ? GRID_MAJOR : GRID_MINOR, major ? 0.9 : 0.7));
    }
    for (let k = lmin; k <= lmax; k++) {
      for (let m = 1; m <= 9; m++) {
        const d = m * Math.pow(10, k);
        if (log(d) > lmax + 1e-9) break;
        const x = X(d);
        o.push(L(x, y0, x, y1, m === 1 ? GRID_MAJOR : GRID_MINOR, m === 1 ? 0.9 : 0.7));
      }
    }

    /* ----- peneiras (topo) ----- */
    const sieves = C.SIEVES.filter(s => s.d >= Math.pow(10, lmin) && s.d <= Math.pow(10, lmax));
    const placed = [];
    [...sieves].sort((a, b) => b.prio - a.prio).forEach(s => {
      const x = X(s.d);
      if (placed.every(px => Math.abs(px - x) >= 12.5)) placed.push(x); else s._skip = true;
    });
    for (const s of sieves) {
      const x = X(s.d);
      if (show.sieves) o.push(L(x, y0, x, y1, '#b6c3d4', 0.9, '4 4'));
      if (s._skip) { delete s._skip; o.push(L(x, y0 - 3, x, y0, SOFT, 1)); continue; }
      o.push(L(x, y0 - 5, x, y0, SOFT, 1));
      o.push(T(x + 4, y0 - 8, s.label, { size: 10.5, fill: MUTED, anchor: 'start', rot: -90 }));
    }
    o.push(T(x0 - 6, y0 - 10, narrow ? '' : 'Peneiras', { size: 10, fill: SOFT, anchor: 'end', weight: 600 }));

    /* ----- moldura ----- */
    o.push(`<rect x="${r1(x0)}" y="${r1(y0)}" width="${r1(pw)}" height="${r1(ph)}" fill="none" stroke="${FRAME}" stroke-width="1.2"/>`);

    /* ----- limites das frações ----- */
    const stripTop = y1 + tickH + axisTitleH + bracketH + 6;
    const stripBot = stripTop + stripH;
    const bounds = sys.boundaries.filter(b => b.d > Math.pow(10, lmin) * 1.0001 && b.d < Math.pow(10, lmax));
    if (show.limits) {
      for (const b of bounds) {
        const x = X(b.d), col = b.sed ? SED_BLUE : LIM_AMBER;
        o.push(L(x, y0, x, y1, col, 1.5, '6 4'));
        o.push(L(x, stripTop - 2, x, stripBot + 6, col, 1.5, '6 4'));
        const lab = b.sed ? `Sedim. · ${C.fmtNum(b.d)} mm` : `${b.short} · ${C.fmtNum(b.d)} mm`;
        o.push(T(x - 3.5, stripBot + 12, lab, { size: 10.5, fill: col, anchor: 'start', weight: 600, rot: 90 }));
      }
    }

    /* ----- curvas ----- */
    const curves = [];
    for (const s of vis) {
      const pts = s.a.pts;
      const path = pts.map((q, i) => `${i ? 'L' : 'M'}${r1(X(q.d))},${r1(Y(q.p))}`).join('');
      curves.push(`<path d="${path}" fill="none" stroke="${s.color}" stroke-width="2.6" stroke-linejoin="round" stroke-linecap="round"/>`);
    }
    o.push(...curves);
    for (const s of vis) for (const q of s.a.pts)
      o.push(`<circle cx="${r1(X(q.d))}" cy="${r1(Y(q.p))}" r="3.6" fill="#fff" stroke="${s.color}" stroke-width="1.8"/>`);

    /* ----- linhas guia D10 / D30 / D60 ----- */
    const chips = [];
    for (const s of vis) {
      for (const [key, P] of [['D10', 10], ['D15', 15], ['D30', 30], ['D60', 60], ['D85', 85]]) {
        if (!show[key.toLowerCase()]) continue;
        const r = s.a.coef[key];
        if (!r || r.d == null) continue;
        const x = X(r.d), y = Y(P);
        o.push(L(x0, y, x, y, s.color, 1.5, '6 4', ' opacity="0.9"'));
        o.push(L(x, y, x, y1, s.color, 1.5, '6 4', ' opacity="0.9"'));
        o.push(`<circle cx="${r1(x)}" cy="${r1(y)}" r="6" fill="#fff" fill-opacity="0.65" stroke="${s.color}" stroke-width="2.2"/>`);
        o.push(`<circle cx="${r1(x)}" cy="${r1(y)}" r="1.8" fill="${s.color}"/>`);
        chips.push({ x, txt: narrow ? `${key} ${C.fmtNum(r.d)}` : `${key} = ${C.fmtNum(r.d)} mm`, color: s.color });
      }
    }
    chips.sort((a, b) => a.x - b.x);
    const rowsEnd = [];
    for (const c of chips) {
      const cs = narrow ? 10 : 11;
      const w = aw(c.txt, cs) + 12;
      let left = c.x - w / 2;
      left = Math.max(x0 + 2, Math.min(left, x1 - w - 2));
      let row = 0;
      while (rowsEnd[row] !== undefined && left < rowsEnd[row] + 3) row++;
      rowsEnd[row] = left + w;
      const cy = y1 - 10 - row * (narrow ? 17 : 19);
      o.push(`<rect x="${r1(left)}" y="${r1(cy - 8)}" width="${r1(w)}" height="${narrow ? 15 : 16}" rx="8" fill="#fff" fill-opacity="0.94" stroke="${c.color}" stroke-width="1.2"/>`);
      o.push(T(left + w / 2, cy + 3.6, c.txt, { size: cs, fill: c.color, weight: 700 }));
    }

    /* ----- eixos: Y ----- */
    for (let p = 0; p <= 100; p += 10) {
      const y = Y(p);
      o.push(T(x0 - 7, y + 3.8, narrow ? String(p) : `${p}%`, { size: 10.5, anchor: 'end' }));
      o.push(T(x1 + 7, y + 3.8, narrow ? String(100 - p) : `${100 - p}%`, { size: 10.5, anchor: 'start' }));
    }
    const cy = (y0 + y1) / 2;
    o.push(T(narrow ? 11 : 14, cy, narrow ? 'PASSANTE (%)' : 'PORCENTAGEM QUE PASSA', { size: 10.5, fill: INK, weight: 600, rot: -90, ls: '.07em' }));
    o.push(T(W - (narrow ? 11 : 14), cy, narrow ? 'RETIDA ACUM. (%)' : 'PORCENTAGEM RETIDA ACUMULADA', { size: 10.5, fill: INK, weight: 600, rot: 90, ls: '.07em' }));

    /* ----- eixo X ----- */
    for (let k = lmin; k <= lmax; k++) {
      const dd = Math.pow(10, k);
      o.push(T(X(dd), y1 + 14, C.fmtNum(dd, 1), { size: 11, fill: INK, weight: 600 }));
      if (k < lmax) {
        const digits = dec >= 150 ? [2, 3, 4, 5, 6, 7, 8, 9] : dec >= 85 ? [2, 5] : [];
        for (const m of digits) o.push(T(X(m * dd), y1 + 13, String(m), { size: 9, fill: SOFT }));
      }
    }
    o.push(T((x0 + x1) / 2, y1 + tickH + 13, 'DIÂMETRO DOS GRÃOS (mm) — escala logarítmica', { size: 10.5, fill: INK, weight: 600, ls: '.06em' }));

    /* ----- colchete: sedimentação × peneiramento ----- */
    const by = y1 + tickH + axisTitleH + 6;
    const xs = XC(SED_LIMIT);
    const bracket = (xa, xb, color, label, short) => {
      if (xb - xa < 8) return;
      o.push(`<path d="M${r1(xa + 1)},${by + 5}V${by}H${r1(xb - 1)}V${by + 5}" fill="none" stroke="${color}" stroke-width="1.4"/>`);
      const txt = [label, short].find(t => t && aw(t, 10.5) + 10 < xb - xa);
      if (txt) o.push(T((xa + xb) / 2, by + 17, txt, { size: 10.5, fill: color, weight: 700, ls: '.04em' }));
    };
    bracket(x0, xs, SED_BLUE, 'SEDIMENTAÇÃO · densímetro (Lei de Stokes)', 'SEDIMENTAÇÃO');
    bracket(xs, x1, '#475569', `PENEIRAMENTO · peneiras (nº 200 = ${C.fmtNum(SED_LIMIT)} mm)`, 'PENEIRAMENTO');

    /* ----- faixa das frações (estilo papel semi-log da ABNT) ----- */
    const rx = 14;
    o.push(`<defs><clipPath id="gclip"><rect x="${r1(x0)}" y="${stripTop}" width="${r1(pw)}" height="${stripH}" rx="${rx}"/></clipPath></defs>`);
    o.push('<g clip-path="url(#gclip)">');
    const half = stripH / 2;
    const fit = (txt, w, alts, fs) => [txt, ...alts].find(t => aw(t, fs) + 6 <= w) || '';
    const SHORT = { Fina: ['F'], Fino: ['F'], Média: ['M'], Médio: ['M'], Grossa: ['G'], Grosso: ['G'], Pedregulho: ['Ped.', 'P'], Areia: ['Ar.'], Silte: ['Si.'], Argila: ['Ar.'] };
    for (const g of sys.groups) {
      const gx0 = XC(g.subs[0].lo === 0 ? 0 : g.subs[0].lo), gx1 = XC(g.subs[g.subs.length - 1].hi === Infinity ? Infinity : g.subs[g.subs.length - 1].hi);
      const fill = CELL_FILL[g.key];
      o.push(`<rect x="${r1(gx0)}" y="${stripTop}" width="${r1(gx1 - gx0)}" height="${stripH}" fill="${fill}"/>`);
      if (g.subs.length === 1) {
        const lab = fit(g.label, gx1 - gx0, SHORT[g.label] || [], 12);
        if (lab) o.push(T((gx0 + gx1) / 2, stripTop + half + 4.5, lab, { size: 12, fill: INK, weight: 600 }));
      } else {
        o.push(L(gx0, stripTop + half, gx1, stripTop + half, '#fff', 1.3));
        const lab = fit(g.label, gx1 - gx0, SHORT[g.label] || [], 12);
        if (lab) o.push(T((gx0 + gx1) / 2, stripTop + half + half / 2 + 4.5, lab, { size: 12, fill: INK, weight: 600 }));
        g.subs.forEach(s => {
          const a = XC(s.lo), b = XC(s.hi);
          const l2 = fit(s.label, b - a, SHORT[s.label] || [], 10.5);
          if (l2) o.push(T((a + b) / 2, stripTop + half / 2 + 4, l2, { size: 10.5, fill: MUTED }));
          if (s.lo !== g.subs[0].lo) o.push(L(a, stripTop, a, stripTop + half, '#fff', 1.3));
        });
      }
      if (g.subs[0].lo !== 0) o.push(L(gx0, stripTop, gx0, stripBot, '#fff', 2));
    }
    o.push('</g>');
    o.push(`<rect x="${r1(x0)}" y="${stripTop}" width="${r1(pw)}" height="${stripH}" rx="${rx}" fill="none" stroke="${FRAME}" stroke-width="1.2"/>`);
    // marcas dos limites na faixa
    if (show.limits) for (const b of bounds) o.push(L(X(b.d), stripTop, X(b.d), stripBot, b.sed ? SED_BLUE : LIM_AMBER, 1.6));

    /* ----- legenda (exportação) ----- */
    if (forExport) {
      let ly = stripBot + limH + 26;
      for (const row of legendRows) {
        for (const it of row) {
          const x = x0 + it.x;
          o.push(`<rect x="${r1(x)}" y="${ly - 9}" width="16" height="4" rx="2" fill="${it.s.color}"/>`);
          o.push(T(x + 22, ly - 1, it.txt, { size: 12, fill: INK, anchor: 'start' }));
        }
        ly += 22;
      }
    }

    if (!vis.length && !forExport) {
      o.push(`<rect x="${r1(x0 + pw / 2 - 170)}" y="${r1((y0 + y1) / 2 - 22)}" width="340" height="44" rx="12" fill="#fff" stroke="${GRID_MAJOR}"/>`);
      o.push(T((x0 + x1) / 2, (y0 + y1) / 2 + 4.5, 'Preencha ao menos 2 pontos para traçar a curva', { size: 13, fill: MUTED }));
    }

    const summary = vis.length
      ? `Curva granulométrica com ${vis.length} ensaio(s): ${vis.map(s => s.name).join(', ')}.`
      : 'Curva granulométrica vazia.';
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${r1(totalH)}" viewBox="0 0 ${W} ${r1(totalH)}" font-family='${FONT}' role="img" aria-label="${esc(summary)}" style="display:block;max-width:100%;touch-action:pan-y;-webkit-user-select:none;user-select:none">${o.join('')}</svg>`;

    return {
      svg,
      geom: { W, H: totalH, x0, x1, y0, y1, lmin, lmax, X, Y, invX, system, plotW: pw, plotH: ph },
      series: vis,
    };
  }

  // altura ocupada fora da área de plotagem (para dimensionar o gráfico em tela cheia)
  function chrome(width, show) {
    const narrow = width < 560;
    return (narrow ? 46 : 58) + 4 + 18 + 20 + 24 + 6 + (narrow ? 42 : 48) + (show && show.limits ? 112 : 0) + 12;
  }

  /* ------------------------------------------------------------ Hover */
  function attachHover(container, tipEl) {
    let model = null;
    const NS = 'http://www.w3.org/2000/svg';
    let hoverG = null, line = null;

    function ensure(svg) {
      hoverG = document.createElementNS(NS, 'g');
      hoverG.setAttribute('pointer-events', 'none');
      line = document.createElementNS(NS, 'line');
      line.setAttribute('stroke', '#334155'); line.setAttribute('stroke-width', '1'); line.setAttribute('stroke-dasharray', '3 3');
      line.setAttribute('opacity', '0.7');
      hoverG.appendChild(line);
      svg.appendChild(hoverG);
      const hit = document.createElementNS(NS, 'rect');
      hit.setAttribute('x', model.geom.x0); hit.setAttribute('y', model.geom.y0 - 6);
      hit.setAttribute('width', model.geom.plotW); hit.setAttribute('height', model.geom.plotH + 6);
      hit.setAttribute('fill', 'transparent'); hit.style.cursor = 'crosshair';
      hit.dataset.hit = '1';
      svg.appendChild(hit);
    }

    function hide() {
      if (hoverG) while (hoverG.childNodes.length > 1) hoverG.removeChild(hoverG.lastChild);
      if (line) line.setAttribute('visibility', 'hidden');
      tipEl.hidden = true;
    }

    function at(ev) {
      if (!model) return;
      const svg = container.querySelector('svg');
      if (!svg || !hoverG) return;
      const g = model.geom;
      const rect = svg.getBoundingClientRect();
      const sc = rect.width / g.W;
      const px = (ev.clientX - rect.left) / sc, py = (ev.clientY - rect.top) / sc;
      if (px < g.x0 - 4 || px > g.x1 + 4 || py < g.y0 - 8 || py > g.y1 + 4) return hide();

      // encaixe no ponto medido mais próximo (em px horizontais)
      let snap = null, best = 11;
      for (const s of model.series) for (const q of s.a.pts) {
        const dx = Math.abs(g.X(q.d) - px);
        if (dx < best) { best = dx; snap = q; }
      }
      const d = snap ? snap.d : g.invX(Math.min(g.x1, Math.max(g.x0, px)));
      const x = g.X(d);

      while (hoverG.childNodes.length > 1) hoverG.removeChild(hoverG.lastChild);
      line.setAttribute('visibility', 'visible');
      line.setAttribute('x1', x); line.setAttribute('x2', x); line.setAttribute('y1', g.y0); line.setAttribute('y2', g.y1);

      const rowsHtml = [];
      for (const s of model.series) {
        const pts = s.a.pts;
        if (d < pts[0].d * (1 - 1e-9) || d > pts[pts.length - 1].d * (1 + 1e-9)) continue;
        const p = C.passAt(pts, d);
        if (p == null) continue;
        const measured = pts.some(q => Math.abs(q.d - d) / d < 1e-9);
        const dot = document.createElementNS(NS, 'circle');
        dot.setAttribute('cx', x); dot.setAttribute('cy', g.Y(p));
        dot.setAttribute('r', measured ? 6.5 : 4.5);
        dot.setAttribute('fill', measured ? s.color : '#fff');
        dot.setAttribute('stroke', measured ? '#fff' : s.color); dot.setAttribute('stroke-width', measured ? 2.5 : 2);
        hoverG.appendChild(dot);
        rowsHtml.push(`<div class="tt-row"><i style="background:${s.color}"></i><b>${esc(s.name)}</b><span>passa <strong>${C.fmtPct(p)}</strong> · retida <strong>${C.fmtPct(100 - p)}</strong>${measured ? ' <em>ponto medido</em>' : ''}</span></div>`);
      }
      const sv = C.sieveFor(d, 0.012);
      const frac = fractionAt(d, g.system);
      tipEl.innerHTML = `<div class="tt-h">Ø ${C.fmtNum(d, 3)} mm${sv ? ` <span class="tt-chip">peneira ${esc(sv.label)}</span>` : (d < SED_LIMIT ? ' <span class="tt-chip sed">sedimentação</span>' : '')}${frac ? `<small>${esc(frac)}</small>` : ''}</div>${rowsHtml.join('') || '<div class="tt-row muted">Fora do intervalo ensaiado</div>'}`;
      tipEl.hidden = false;
      const cr = container.getBoundingClientRect();
      const tw = tipEl.offsetWidth, th = tipEl.offsetHeight;
      let tx = x * sc + 14, ty = (py * sc) - th - 12;
      if (tx + tw > cr.width - 4) tx = x * sc - tw - 14;
      if (tx < 4) tx = 4;
      if (ty < 4) ty = py * sc + 16;
      tipEl.style.transform = `translate(${Math.round(tx)}px,${Math.round(ty)}px)`;
    }

    container.addEventListener('pointermove', at);
    container.addEventListener('pointerdown', at);
    container.addEventListener('pointerleave', (e) => { if (e.pointerType === 'mouse') hide(); });

    return {
      setModel(m) { model = m; const svg = container.querySelector('svg'); hoverG = null; line = null; if (svg) ensure(svg); tipEl.hidden = true; },
      hide,
    };
  }

  /* --------------------------------------------------------- Exportação */
  async function toPNGBlob(svgString, w, h, scale = 2) {
    const img = new Image();
    img.decoding = 'async';
    const src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svgString);
    await new Promise((res, rej) => { img.onload = res; img.onerror = () => rej(new Error('Falha ao rasterizar o gráfico')); img.src = src; });
    const cv = document.createElement('canvas');
    cv.width = Math.round(w * scale); cv.height = Math.round(h * scale);
    const ctx = cv.getContext('2d');
    ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, cv.width, cv.height);
    ctx.drawImage(img, 0, 0, cv.width, cv.height);
    return new Promise((res, rej) => cv.toBlob(b => b ? res(b) : rej(new Error('Falha ao gerar PNG')), 'image/png'));
  }

  return { render, attachHover, toPNGBlob, fractionAt, chrome };
})();

if (typeof module !== 'undefined' && module.exports) module.exports = GranuloChart;
