/* ==========================================================================
   app.js — interface
   ========================================================================== */
(() => {
  'use strict';
  const C = GranuloCore, IO = GranuloIO, CH = GranuloChart;
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
  const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  const PALETTE = ['#2563eb', '#16a34a', '#dc2626', '#d97706', '#7c3aed', '#0891b2', '#db2777', '#65a30d', '#475569'];
  const KEY = 'granulometria.v1';
  const clone = (x) => JSON.parse(JSON.stringify(x));
  const uid = () => 'e' + Math.random().toString(36).slice(2, 9);

  /* ------------------------------------------------------------ estado */
  function fresh() {
    return {
      ensaios: C.EXAMPLES.map(e => ({ id: e.id, name: e.name, color: e.color, mode: e.mode, rows: clone(e.rows), fundo: '', visible: true })),
      sel: C.EXAMPLES[0].id,
      show: { d10: false, d15: false, d30: false, d60: false, d85: false, limits: false, sieves: false },
      system: 'abnt',
    };
  }
  function load() {
    try {
      const s = JSON.parse(localStorage.getItem(KEY));
      if (s && Array.isArray(s.ensaios) && s.ensaios.length) {
        const f = fresh();
        return { ...f, ...s, show: { ...f.show, ...(s.show || {}) } };
      }
    } catch (e) { /* sem storage */ }
    return null;
  }
  let state = load() || fresh();
  let saveT = 0;
  const save = () => { clearTimeout(saveT); saveT = setTimeout(() => { try { localStorage.setItem(KEY, JSON.stringify(state)); } catch (e) { /* ignora */ } }, 250); };
  const cur = () => state.ensaios.find(e => e.id === state.sel) || state.ensaios[0];

  /* ------------------------------------------------------------ toast + desfazer */
  let undoSnap = null;
  function toast(msg, opt = {}) {
    const el = document.createElement('div');
    el.className = 'toast' + (opt.err ? ' err' : '');
    el.innerHTML = `<span>${esc(msg)}</span>`;
    if (opt.undo) {
      const b = document.createElement('button'); b.textContent = 'Desfazer';
      b.onclick = () => { if (undoSnap) { state.ensaios = undoSnap.ensaios; state.sel = undoSnap.sel; undoSnap = null; renderAll(); save(); } el.remove(); };
      el.appendChild(b);
    }
    $('#toast').appendChild(el);
    setTimeout(() => el.remove(), opt.undo ? 7000 : 3800);
  }
  const snapshot = () => { undoSnap = { ensaios: clone(state.ensaios), sel: state.sel }; };

  /* ------------------------------------------------------------ análise */
  let A = new Map();
  function analyzeAll() {
    A = new Map();
    for (const e of state.ensaios) A.set(e.id, C.analyze(e, state.system));
  }
  const visibleSeries = () => state.ensaios.filter(e => e.visible).map(e => ({ id: e.id, name: e.name || 'Sem nome', color: e.color, a: A.get(e.id) }));

  /* ------------------------------------------------------------ lista */
  function renderList() {
    $('#elist').innerHTML = state.ensaios.map(e => {
      const a = A.get(e.id);
      let meta = 'Sem dados suficientes';
      if (a && a.valid) {
        const co = a.coef;
        meta = `Cu ${C.fmtNum(co.Cu)} · Cc ${C.fmtNum(co.Cc)} · <span class="tone-${a.grading.tone}">${esc(a.grading.label)}</span>`;
      }
      return `<li class="en ${e.id === state.sel ? 'sel' : ''} ${e.visible ? '' : 'off'}" data-id="${e.id}" style="--c:${e.color}">
        <button class="dot" data-act="vis" aria-label="${e.visible ? 'Ocultar' : 'Mostrar'} curva de ${esc(e.name)}" aria-pressed="${e.visible}" title="${e.visible ? 'Ocultar' : 'Mostrar'} no gráfico"></button>
        <div class="meta"><b>${esc(e.name || 'Sem nome')}</b><small>${meta}</small></div></li>`;
    }).join('');
  }
  $('#elist').addEventListener('click', (ev) => {
    const li = ev.target.closest('.en'); if (!li) return;
    const id = li.dataset.id;
    if (ev.target.closest('[data-act=vis]')) {
      const e = state.ensaios.find(x => x.id === id); e.visible = !e.visible;
      refresh(); save(); return;
    }
    if (state.sel !== id) { state.sel = id; renderList(); renderEditor(); save(); }
  });

  /* ------------------------------------------------------------ editor */
  const MODE_HINT = {
    passa: 'Digite o % de material que passa em cada peneira (100 na maior, decrescendo).',
    retida: 'Digite o % retido acumulado (0 na maior peneira, crescendo). O app converte para % passante.',
    massa: 'Digite a massa retida (g) em cada peneira e no fundo. O % passante é calculado.',
  };
  function rowHtml(r, i, mode) {
    const d = C.toNum(r.d), sv = d > 0 ? C.sieveFor(d) : null;
    const tag = sv ? `<span class="tag">${esc(sv.label)}</span>` : (d > 0 && d < 0.075 ? '<span class="tag sed">sedim.</span>' : '');
    return `<div class="r" data-i="${i}">
      <div class="cell"><input class="in d ${tag ? 'hastag' : ''}" inputmode="decimal" autocomplete="off" aria-label="Diâmetro ${i + 1} (mm)" placeholder="mm" value="${esc(r.d)}">${tag}</div>
      <input class="in v" inputmode="decimal" autocomplete="off" aria-label="${mode === 'massa' ? 'Massa retida (g)' : mode === 'retida' ? '% retida acumulada' : '% passante'} ${i + 1}" placeholder="${mode === 'massa' ? 'g' : '%'}" value="${esc(r.v)}">
      ${mode === 'massa' ? '<div class="calc" data-calc>—</div>' : ''}
      <button class="xbtn" data-act="del" aria-label="Remover linha ${i + 1}" title="Remover linha">×</button></div>`;
  }
  function renderEditor() {
    const e = cur();
    if (!e) { $('#editor').innerHTML = '<div class="empty">Crie um ensaio para começar.</div>'; return; }
    const modeLabel = { passa: '% Passante', retida: '% Retida acum.', massa: 'Massa retida (g)' };
    $('#editor').innerHTML = `
      <div class="card-h"><h2 id="h-ed">Dados do ensaio</h2>
        <button class="btn sm icon" data-act="dup" title="Duplicar ensaio" aria-label="Duplicar ensaio"><svg class="i"><use href="#i-copy"/></svg></button>
        <button class="btn sm icon danger" data-act="rm" title="Excluir ensaio" aria-label="Excluir ensaio"><svg class="i"><use href="#i-trash"/></svg></button></div>
      <label class="field"><span>Nome</span><input class="in" id="inName" value="${esc(e.name)}" maxlength="60" autocomplete="off"></label>
      <div class="swatches" role="group" aria-label="Cor da curva">${PALETTE.map(c => `<button style="--c:${c}" data-color="${c}" aria-pressed="${c.toLowerCase() === e.color.toLowerCase()}" aria-label="Cor ${c}"></button>`).join('')}</div>
      <div class="seg" role="group" aria-label="Tipo de dado">${Object.keys(modeLabel).map(m => `<button data-mode="${m}" aria-pressed="${e.mode === m}">${modeLabel[m]}</button>`).join('')}</div>
      <p class="hint">${MODE_HINT[e.mode]}</p>
      <div class="rows ${e.mode === 'massa' ? 'massa' : ''}" id="rows">
        <div class="r rh"><span>Ø (mm)</span><span>${e.mode === 'massa' ? 'Massa (g)' : e.mode === 'retida' ? '% retida' : '% passa'}</span>${e.mode === 'massa' ? '<span style="text-align:right">% passa</span>' : ''}<span></span></div>
        <div class="rows-scroll" id="rowsScroll">${e.rows.map((r, i) => rowHtml(r, i, e.mode)).join('')}</div>
      </div>
      ${e.mode === 'massa' ? `<label class="field" style="margin-top:6px"><span>Massa retida no fundo / prato (g)</span><input class="in" id="inFundo" inputmode="decimal" placeholder="g" value="${esc(e.fundo || '')}"></label>` : ''}
      <div class="btnrow" style="margin-top:6px">
        <button class="btn sm" data-act="addrow"><svg class="i"><use href="#i-plus"/></svg>Linha</button>
        <button class="btn sm" data-act="sieves" title="Preencher a coluna de diâmetros com as peneiras padrão">Peneiras padrão</button>
        <button class="btn sm" data-act="sed" title="Adicionar diâmetros típicos da sedimentação">+ Sedimentação</button>
        <button class="btn sm" data-act="clearv">Limpar valores</button>
      </div>
      <ul class="warns" id="warns"></ul>`;
    updateDerivedEditor();
  }

  function updateDerivedEditor() {
    const e = cur(); if (!e) return;
    const a = A.get(e.id);
    const w = $('#warns');
    if (w) w.innerHTML = (a ? a.warnings : []).map(t => `<li>${esc(t)}</li>`).join('');
    if (e.mode === 'massa' && a) {
      const byRow = new Map(a.pts.map(p => [p.row, p.p]));
      $$('#rows .r[data-i]').forEach(r => {
        const c = $('[data-calc]', r); if (!c) return;
        const p = byRow.get(+r.dataset.i);
        c.textContent = p == null ? '—' : C.fmtNum(p, 3);
      });
    }
  }

  function updateRowTag(rowEl, r) {
    const cell = $('.cell', rowEl), inp = $('.d', cell);
    const old = $('.tag', cell); if (old) old.remove();
    const d = C.toNum(r.d), sv = d > 0 ? C.sieveFor(d) : null;
    let html = '';
    if (sv) html = `<span class="tag">${esc(sv.label)}</span>`;
    else if (d > 0 && d < 0.075) html = '<span class="tag sed">sedim.</span>';
    if (html) cell.insertAdjacentHTML('beforeend', html);
    inp.classList.toggle('hastag', !!html);
  }

  const ed = $('#editor');
  ed.addEventListener('input', (ev) => {
    const e = cur(), t = ev.target;
    if (t.id === 'inName') { e.name = t.value; renderList(); refresh(true); save(); return; }
    if (t.id === 'inFundo') { e.fundo = t.value; refresh(); save(); return; }
    const row = t.closest('.r[data-i]'); if (!row) return;
    const r = e.rows[+row.dataset.i];
    if (t.classList.contains('d')) { r.d = t.value; updateRowTag(row, r); } else if (t.classList.contains('v')) r.v = t.value;
    const bad = t.value.trim() !== '' && !isFinite(C.toNum(t.value));
    t.classList.toggle('warn', bad);
    refresh(); save();
  });
  ed.addEventListener('keydown', (ev) => {
    const t = ev.target;
    if (ev.key !== 'Enter' || !t.classList.contains('in')) return;
    const row = t.closest('.r[data-i]'); if (!row) return;
    ev.preventDefault();
    const cls = t.classList.contains('d') ? '.d' : '.v';
    let next = row.nextElementSibling;
    if (!next) { addRow(); next = $('#rowsScroll').lastElementChild; }
    if (next) $(cls, next).focus();
  });
  ed.addEventListener('paste', (ev) => {
    const t = ev.target; if (!t.classList || !t.classList.contains('in') || !t.closest('.r[data-i]')) return;
    const txt = (ev.clipboardData || window.clipboardData).getData('text');
    if (!/[\n\t]/.test(txt.trim())) return; // colagem simples
    const res = IO.rowsToEnsaios(IO.parseText(txt), cur().name);
    if (!res.length) return;
    ev.preventDefault();
    snapshot();
    applyToCurrent(res[0]);
    toast('Dados colados — ' + res[0].rows.length + ' pontos.', { undo: true });
  });
  ed.addEventListener('click', (ev) => {
    const e = cur();
    const b = ev.target.closest('button'); if (!b) return;
    if (b.dataset.color) { e.color = b.dataset.color; renderList(); renderEditor(); refresh(true); save(); return; }
    if (b.dataset.mode) { setMode(e, b.dataset.mode); return; }
    switch (b.dataset.act) {
      case 'del': {
        const i = +b.closest('.r').dataset.i; e.rows.splice(i, 1); renderEditor(); refresh(); save(); break;
      }
      case 'addrow': addRow(); $('#rowsScroll').lastElementChild.querySelector('.d').focus(); break;
      case 'sieves': {
        const have = new Set(e.rows.map(r => C.toNum(r.d)));
        const add = C.STD_ROWS().filter(r => !have.has(C.toNum(r.d)));
        e.rows = [...e.rows.filter(r => r.d !== '' || r.v !== ''), ...add];
        e.rows.sort((a, b2) => (C.toNum(b2.d) || 0) - (C.toNum(a.d) || 0));
        renderEditor(); refresh(); save(); break;
      }
      case 'sed': {
        const have = new Set(e.rows.map(r => C.toNum(r.d)));
        const add = [0.05, 0.02, 0.01, 0.005, 0.002].filter(d => !have.has(d)).map(d => ({ d: String(d).replace('.', ','), v: '' }));
        e.rows = [...e.rows, ...add];
        e.rows.sort((a, b2) => (C.toNum(b2.d) || 0) - (C.toNum(a.d) || 0));
        renderEditor(); refresh(); save(); break;
      }
      case 'clearv': snapshot(); e.rows.forEach(r => { r.v = ''; }); e.fundo = ''; renderEditor(); refresh(); save(); toast('Valores apagados.', { undo: true }); break;
      case 'dup': {
        const c = clone(e); c.id = uid(); c.name = e.name + ' (cópia)'; c.color = nextColor();
        state.ensaios.splice(state.ensaios.indexOf(e) + 1, 0, c); state.sel = c.id; renderAll(); save(); break;
      }
      case 'rm': {
        snapshot();
        const i = state.ensaios.indexOf(e); state.ensaios.splice(i, 1);
        state.sel = (state.ensaios[Math.min(i, state.ensaios.length - 1)] || {}).id;
        renderAll(); save(); toast(`“${e.name}” excluído.`, { undo: true }); break;
      }
    }
  });

  function addRow() { const e = cur(); e.rows.push({ d: '', v: '' }); const rs = $('#rowsScroll'); rs.insertAdjacentHTML('beforeend', rowHtml(e.rows[e.rows.length - 1], e.rows.length - 1, e.mode)); rs.scrollTop = rs.scrollHeight; save(); }

  function setMode(e, m) {
    if (m === e.mode) return;
    snapshot();
    const from = e.mode;
    if ((from === 'passa' && m === 'retida') || (from === 'retida' && m === 'passa')) {
      e.rows.forEach(r => { const v = C.toNum(r.v); if (isFinite(v)) r.v = String(Number((100 - v).toPrecision(10))).replace('.', ','); });
      e.mode = m; toast('Valores convertidos (100 − valor).', { undo: true });
    } else {
      e.rows.forEach(r => { r.v = ''; }); e.fundo = ''; e.mode = m;
      toast('Modo alterado — valores limpos.', { undo: true });
    }
    renderEditor(); refresh(); save();
  }
  function nextColor() { const used = new Set(state.ensaios.map(e => e.color.toLowerCase())); return PALETTE.find(c => !used.has(c)) || PALETTE[state.ensaios.length % PALETTE.length]; }

  function applyToCurrent(src) {
    const e = cur();
    e.mode = src.mode; e.rows = clone(src.rows); e.fundo = src.fundo || '';
    renderEditor(); renderList(); refresh(); save();
  }
  function addEnsaios(list) {
    let first = null;
    for (const s of list) {
      const e = { id: uid(), name: s.name || `Ensaio ${state.ensaios.length + 1}`, color: nextColor(), mode: s.mode || 'passa', rows: clone(s.rows), fundo: s.fundo || '', visible: true };
      state.ensaios.push(e); first = first || e;
    }
    if (first) state.sel = first.id;
    renderAll(); save();
  }

  $('#btnNew').onclick = () => {
    const e = { id: uid(), name: `Ensaio ${state.ensaios.length + 1}`, color: nextColor(), mode: 'passa', rows: C.STD_ROWS(), fundo: '', visible: true };
    state.ensaios.push(e); state.sel = e.id; renderAll(); save();
    const first = $('#rowsScroll .v'); if (first) first.focus();
  };
  $('#btnExamples').onclick = () => {
    const have = new Set(state.ensaios.map(e => e.id));
    const add = C.EXAMPLES.filter(x => !have.has(x.id));
    if (!add.length) { toast('Os 3 exemplos já estão na lista.'); return; }
    add.forEach(x => state.ensaios.push({ id: x.id, name: x.name, color: x.color, mode: x.mode, rows: clone(x.rows), fundo: '', visible: true }));
    state.sel = add[0].id; renderAll(); save(); toast(`${add.length} exemplo(s) adicionado(s).`);
  };

  /* ------------------------------------------------------------ importação */
  $('#btnImport').onclick = () => $('#fileIn').click();
  $('#fileIn').onchange = async (ev) => { const f = ev.target.files[0]; ev.target.value = ''; if (f) await importFile(f); };
  async function importFile(f) {
    try {
      const res = await IO.importFile(f);
      if (!res.length) throw new Error('Não encontrei dados. Use diâmetro (mm) na 1ª coluna e % passante, % retida ou massa nas seguintes.');
      addEnsaios(res);
      toast(`${res.length} ensaio(s) importado(s) de ${f.name}.`);
    } catch (e) { toast(e.message || 'Falha ao importar', { err: true }); }
  }
  ['dragenter', 'dragover'].forEach(n => document.addEventListener(n, (e) => { if (e.dataTransfer && [...e.dataTransfer.types].includes('Files')) { e.preventDefault(); document.body.classList.add('drop'); } }));
  ['dragleave', 'drop'].forEach(n => document.addEventListener(n, (e) => { if (n === 'dragleave' && e.relatedTarget) return; document.body.classList.remove('drop'); }));
  document.addEventListener('drop', (e) => { if (e.dataTransfer && e.dataTransfer.files.length) { e.preventDefault(); setTab('app'); importFile(e.dataTransfer.files[0]); } });

  const dlg = $('#dlgPaste');
  $('#btnPaste').onclick = () => { $('#pasteMsg').textContent = ''; $('#pasteText').value = ''; dlg.showModal ? dlg.showModal() : dlg.setAttribute('open', ''); setTimeout(() => $('#pasteText').focus(), 30); };
  $('#pasteCancel').onclick = () => dlg.close();
  $('#btnTemplate').onclick = () => {
    saveBlob(new Blob([IO.buildTemplate()], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }), 'modelo-granulometria.xlsx');
    toast('Modelo baixado — preencha no Excel e volte aqui para importar ou colar.');
  };
  function parsePasted() {
    const res = IO.rowsToEnsaios(IO.parseText($('#pasteText').value), 'Ensaio colado');
    if (!res.length) { $('#pasteMsg').textContent = 'Não encontrei dados numéricos. Use diâmetro na 1ª coluna e os valores nas seguintes.'; return null; }
    return res;
  }
  $('#pasteNew').onclick = () => { const r = parsePasted(); if (!r) return; r.forEach((x, i) => { if (/^Ensaio colado/.test(x.name)) x.name = `Ensaio ${state.ensaios.length + 1 + i}`; }); addEnsaios(r); dlg.close(); toast(`${r.length} ensaio(s) criado(s).`); };
  $('#pasteReplace').onclick = () => { const r = parsePasted(); if (!r) return; snapshot(); applyToCurrent(r[0]); dlg.close(); toast('Dados substituídos.', { undo: true }); };

  /* ------------------------------------------------------------ gráfico */
  const chartEl = $('#chart'), wrapEl = $('#chartWrap'), card = $('#chartCard');
  const hover = CH.attachHover(wrapEl, $('#gtip'));
  let fs = false, lastKey = '';

  function chartDims() {
    const width = Math.max(300, Math.floor(wrapEl.clientWidth || card.clientWidth - 28));
    const narrow = width < 560;
    let plotH;
    if (fs) plotH = Math.max(220, Math.floor(wrapEl.clientHeight - CH.chrome(width, state.show)));
    else plotH = narrow ? 330 : Math.round(Math.min(480, Math.max(360, width * 0.44)));
    return { width, plotH };
  }
  function drawChart() {
    const { width, plotH } = chartDims();
    const m = CH.render({ width, height: 0, plotH, series: visibleSeries(), show: state.show, system: state.system });
    chartEl.innerHTML = m.svg;
    hover.setModel(m);
    lastKey = width + '|' + plotH;
    // legenda
    $('#legend').innerHTML = m.series.map(s => `<span style="--c:${s.color}"><i></i>${esc(s.name)}</span>`).join('');
  }
  let rafId = 0;
  function redraw() { cancelAnimationFrame(rafId); rafId = requestAnimationFrame(drawChart); }
  new ResizeObserver(() => { const { width, plotH } = chartDims(); if (width + '|' + plotH !== lastKey) redraw(); }).observe(wrapEl);

  $$('.chip[data-show]').forEach(b => {
    b.setAttribute('aria-pressed', !!state.show[b.dataset.show]);
    b.onclick = () => { const k = b.dataset.show; state.show[k] = !state.show[k]; b.setAttribute('aria-pressed', state.show[k]); redraw(); save(); };
  });
  $('#sys').value = state.system;
  $('#sys').onchange = (e) => { state.system = e.target.value; refresh(); renderFracTable(); save(); };

  /* tela cheia */
  async function setFs(on) {
    fs = on;
    card.classList.toggle('fs', on);
    document.body.classList.toggle('noscroll', on);
    const b = $('#btnFs');
    b.querySelector('.lbl').textContent = on ? 'Fechar' : 'Ampliar';
    b.querySelector('use').setAttribute('href', on ? '#i-x' : '#i-max');
    if (on) { try { await card.requestFullscreen?.(); await screen.orientation?.lock?.('landscape'); } catch (e) { /* opcional */ } }
    else { try { screen.orientation?.unlock?.(); if (document.fullscreenElement) await document.exitFullscreen(); } catch (e) { /* ok */ } }
    redraw(); setTimeout(redraw, 120);
  }
  $('#btnFs').onclick = () => setFs(!fs);
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && fs && !document.fullscreenElement) setFs(false); });
  document.addEventListener('fullscreenchange', () => { if (!document.fullscreenElement && fs) setFs(false); });
  window.addEventListener('orientationchange', () => setTimeout(redraw, 250));

  /* exportação */
  function saveBlob(blob, name) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 4000);
  }
  async function chartPNG(scale = 2, w = 1200, plotH = 520) {
    const m = CH.render({ width: w, height: 0, plotH, series: visibleSeries(), show: state.show, system: state.system, forExport: true });
    const blob = await CH.toPNGBlob(m.svg, w, m.geom.H, scale);
    return { blob, w, h: Math.round(m.geom.H) };
  }
  $('#btnPng').onclick = async () => {
    if (!visibleSeries().some(s => s.a && s.a.valid)) { toast('Nada para exportar — preencha ao menos 2 pontos.', { err: true }); return; }
    try { const { blob } = await chartPNG(2); saveBlob(blob, 'curva-granulometrica.png'); toast('PNG salvo.'); }
    catch (e) { toast(e.message, { err: true }); }
  };
  $('#btnXls').onclick = async () => {
    const items = state.ensaios.filter(e => e.visible).map(e => ({ name: e.name || 'Ensaio', ensaio: e, a: A.get(e.id) })).filter(it => it.a && it.a.valid);
    if (!items.length) { toast('Nada para exportar — preencha ao menos 2 pontos.', { err: true }); return; }
    let png = null;
    try {
      const r = await chartPNG(1.25, 1000, 440);
      png = { png: new Uint8Array(await r.blob.arrayBuffer()), w: 1000, h: r.h };
    } catch (e) { /* segue sem imagem */ }
    const bytes = IO.buildReport(items, { system: state.system, png });
    saveBlob(new Blob([bytes], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }), 'granulometria.xlsx');
    toast('Planilha Excel salva.');
  };

  /* quadro das frações */
  function renderFracTable(targetId = '#fracTable') {
    const sys = C.SYSTEMS[state.system];
    const fmtR = (lo, hi) => `${lo === 0 ? '< ' + C.fmtNum(hi) : hi === Infinity ? '> ' + C.fmtNum(lo) : C.fmtNum(lo) + ' – ' + C.fmtNum(hi)} mm`;
    const rows = [...sys.groups].reverse().flatMap(g => [...g.subs].reverse().map(s => {
      const b = sys.boundaries.find(x => x.d === s.lo);
      return `<tr><td><span class="sw" style="--c:${C.GROUP_COLORS[g.key]}"></span>${g.subs.length > 1 ? g.label + ' ' + s.label.toLowerCase() : g.label}</td><td>${fmtR(s.lo, s.hi)}</td><td>${b ? esc(b.sieve) : '—'}</td><td>${s.hi <= 0.075 + 1e-9 ? '<span class="tt-chip sed">Sedimentação</span>' : '<span class="tt-chip">Peneiramento</span>'}</td></tr>`;
    })).join('');
    $(targetId).innerHTML = `<div class="tscroll" style="margin:0"><table class="tbl" style="min-width:560px"><tr><th>Fração (${esc(sys.name)})</th><th>Intervalo</th><th>Peneira no limite inferior</th><th>Ensaio</th></tr>${rows}</table></div>`;
  }

  /* ------------------------------------------------------------ resultados */
  const M = (label, val, sub, cls = '') => `<div class="m ${cls}"><span>${label}</span><b>${val}</b><small>${sub || '&nbsp;'}</small></div>`;
  function dCell(r) { return r && r.d != null ? C.fmtNum(r.d) : '—'; }
  function dNote(key, r) {
    if (r && r.d != null) return 'mm';
    if (r && r.reason === 'abaixo') return `curva não chega a ${key.slice(1)}%`;
    return 'indisponível';
  }
  function resultCard(e, a) {
    const co = a.coef, g = a.grading, cuc = a.cuClass, ccc = a.ccClass;
    const groups = a.comp.groups.filter(x => x.pct != null && x.pct > 0.05);
    const segs = [...groups.map(x => ({ label: x.label + (x.partial ? ' (≥ ' + C.fmtNum(a.comp.dmin) + ' mm)' : ''), pct: x.pct, color: x.color })),
      ...(a.comp.rest ? [{ label: `Finos < ${C.fmtNum(a.comp.rest.below)} mm (sem sedimentação)`, pct: a.comp.rest.pct, color: '#cfd8e3' }] : [])];
    const order = ['Pedregulho', 'Areia', 'Silte', 'Argila'];
    segs.sort((x, y) => { const ix = order.findIndex(o => x.label.startsWith(o)), iy = order.findIndex(o => y.label.startsWith(o)); return (ix < 0 ? 9 : ix) - (iy < 0 ? 9 : iy); });
    const frTbl = a.comp.fractions.slice().reverse().map(f => `<tr><td>${f.group === 'pedregulho' || f.group === 'areia' ? (f.group === 'areia' ? 'Areia ' : 'Pedregulho ') + f.label.toLowerCase() : f.label}</td><td>${C.fmtNum(f.lo)}–${f.hi === Infinity ? '∞' : C.fmtNum(f.hi)} mm</td><td class="n">${f.pct == null ? 'n/d' : C.fmtPct(f.pct) + (f.partial ? '*' : '')}</td></tr>`).join('');
    const h = a.hazen && a.hazen.applicable;
    return `<article class="card res" style="--c:${e.color}">
      <header><h3>${esc(e.name || 'Sem nome')}</h3><span class="pill ${g.tone}">${esc(g.label)}</span></header>
      <div class="metrics">
        ${M('D<sub>10</sub>', dCell(co.D10), dNote('D10', co.D10))}
        ${M('D<sub>30</sub>', dCell(co.D30), dNote('D30', co.D30))}
        ${M('D<sub>60</sub>', dCell(co.D60), dNote('D60', co.D60))}
        ${M('D<sub>15</sub>', dCell(co.D15), dNote('D15', co.D15), 'half')}
        ${M('D<sub>85</sub>', dCell(co.D85), dNote('D85', co.D85), 'half')}
        <div class="m big"><span>C<sub>u</sub></span><b>${C.fmtNum(co.Cu)}</b><small>${co.Cu != null ? `D60/D10 = ${C.fmtNum(co.D60.d)}/${C.fmtNum(co.D10.d)} · <span class="tone-${cuc.tone}">${cuc.label}</span>` : 'precisa de D10 e D60'}</small></div>
        <div class="m big"><span>C<sub>c</sub></span><b>${C.fmtNum(co.Cc)}</b><small>${co.Cc != null ? `D30²/(D10·D60) · <span class="tone-${ccc.tone}">${ccc.label}</span>` : 'precisa de D10, D30 e D60'}</small></div>
      </div>
      <p class="verdict">${esc(g.behavior)}${a.gap ? ` <b>Patamar entre ${C.fmtNum(a.gap.dLo)} e ${C.fmtNum(a.gap.dHi)} mm</b> (só ${C.fmtNum(a.gap.pHi - a.gap.pLo, 2)}% nessa faixa).` : ''}</p>
      <div class="bar" role="img" aria-label="Composição granulométrica">${segs.map(s => `<i style="width:${s.pct}%;background:${s.color}" title="${esc(s.label)} ${C.fmtPct(s.pct)}"></i>`).join('')}</div>
      <div class="barleg">${segs.map(s => `<span><i style="background:${s.color}"></i>${esc(s.label)} <b>${C.fmtPct(s.pct)}</b></span>`).join('')}</div>
      <dl class="kv">
        ${a.sucs ? `<dt>SUCS prelim.</dt><dd>${esc(a.sucs.symbol)}<small>${esc(a.sucs.name)}. ${esc(a.sucs.note)}</small></dd>` : ''}
        ${h ? `<dt>k (Hazen)</dt><dd>≈ ${C.fmtSci(a.hazen.k)} cm/s<small>k = C·D10², C = 100 — estimativa para areias limpas</small></dd>` : ''}
      </dl>
      <details><summary>Frações (${esc(C.SYSTEMS[state.system].name)})</summary>
        <table class="tbl" style="margin-top:6px"><tr><th>Fração</th><th>Intervalo</th><th class="n">%</th></tr>${frTbl}</table>
        ${a.comp.approx ? '<p class="hint" style="margin-top:6px">Limite silte/areia de 0,06 mm aproximado pela peneira nº 200 (0,075 mm).</p>' : ''}
        ${a.comp.fractions.some(f => f.partial) ? '<p class="hint">* só a parte medida; falta sedimentação para completar.</p>' : ''}
      </details>
    </article>`;
  }
  function renderResults() {
    const list = state.ensaios.filter(e => e.visible);
    const ok = list.filter(e => A.get(e.id).valid);
    let html = '<h2>Resultados</h2>';
    if (!ok.length) {
      html += '<div class="card empty">Preencha ao menos 2 pontos (diâmetro e valor) de um ensaio visível para ver D10, D30, D60, Cu e Cc.</div>';
    } else {
      if (ok.length > 1) {
        const f = (x) => x == null ? '—' : C.fmtNum(x);
        html += `<div class="tscroll"><table class="tbl"><tr><th>Ensaio</th><th class="n">D10</th><th class="n">D30</th><th class="n">D60</th><th class="n">Cu</th><th class="n">Cc</th><th>Graduação</th><th>SUCS</th><th class="n">% ped.</th><th class="n">% areia</th><th class="n">% finos</th></tr>` +
          ok.map(e => { const a = A.get(e.id), co = a.coef, sg = a.sg; return `<tr><td><span class="sw" style="--c:${e.color}"></span>${esc(e.name)}</td><td class="n">${f(co.D10.d)}</td><td class="n">${f(co.D30.d)}</td><td class="n">${f(co.D60.d)}</td><td class="n">${f(co.Cu)}</td><td class="n">${f(co.Cc)}</td><td><span class="tone-${a.grading.tone}"><b>${esc(a.grading.label)}</b></span></td><td>${a.sucs ? esc(a.sucs.symbol) : '—'}</td><td class="n">${sg ? C.fmtPct(sg.gravel, 0) : '—'}</td><td class="n">${sg ? C.fmtPct(sg.sand, 0) : '—'}</td><td class="n">${sg ? C.fmtPct(sg.fines, 0) : '—'}</td></tr>`; }).join('') +
          '</table></div><p class="hint" style="margin-top:-6px">Diâmetros em mm. % pedregulho/areia/finos pelos limites SUCS (4,75 e 0,075 mm).</p>';
      }
      html += `<div class="res-grid">${ok.map(e => resultCard(e, A.get(e.id))).join('')}</div>`;
    }
    const pending = list.filter(e => !A.get(e.id).valid);
    if (pending.length && ok.length) html += `<p class="hint" style="margin-top:10px">Sem dados suficientes: ${pending.map(e => esc(e.name)).join(', ')}.</p>`;
    $('#results').innerHTML = html;
  }

  /* ------------------------------------------------------------ orquestração */
  function refresh(skipList) {
    analyzeAll();
    if (!skipList) renderList();
    updateDerivedEditor();
    drawChart();
    renderResults();
  }
  function renderAll() { analyzeAll(); renderList(); renderEditor(); drawChart(); renderResults(); renderFracTable(); }

  /* ------------------------------------------------------------ abas */
  // history.replaceState pode falhar em pré-visualizações isoladas (iframe/srcdoc)
  const setHash = (h) => { try { history.replaceState(null, '', h); } catch (e) { /* ignora */ } };
  function setTab(t) {
    const isApp = t !== 'theory';
    $('#view-app').hidden = !isApp; $('#view-theory').hidden = isApp;
    $('#tab-app').setAttribute('aria-selected', isApp); $('#tab-theory').setAttribute('aria-selected', !isApp);
    if (isApp) { redraw(); if (location.hash === '#teoria' || location.hash.startsWith('#t-')) setHash(location.pathname + location.search); }
    else { buildTheory(); if (!location.hash.startsWith('#t-')) setHash('#teoria'); }
    window.scrollTo(0, 0);
  }
  $('#tab-app').onclick = () => setTab('app');
  $('#tab-theory').onclick = () => setTab('theory');
  window.addEventListener('hashchange', () => { if (location.hash === '#teoria' || location.hash.startsWith('#t-')) { setTab('theory'); const el = document.getElementById(location.hash.slice(1)); if (el) el.scrollIntoView(); } });

  /* ------------------------------------------------------------ teoria */
  let theoryBuilt = false;
  function miniChart(svg, ex) {
    const a = C.analyze(ex, 'sucs');
    const W = 260, H = 130, l = 26, r = 8, t = 8, b = 20;
    const X = (d) => l + (Math.log10(d) - (-3)) / 5 * (W - l - r), Y = (p) => H - b - p / 100 * (H - t - b);
    let s = `<rect x="${l}" y="${t}" width="${W - l - r}" height="${H - t - b}" fill="#fff" stroke="#9db0c6"/>`;
    for (let k = -3; k <= 2; k++) { s += `<line x1="${X(Math.pow(10, k))}" x2="${X(Math.pow(10, k))}" y1="${t}" y2="${H - b}" stroke="#dbe4ee"/><text x="${X(Math.pow(10, k))}" y="${H - 7}" font-size="9" fill="#6b7b91" text-anchor="middle">${C.fmtNum(Math.pow(10, k), 1)}</text>`; }
    for (let p = 0; p <= 100; p += 25) { s += `<line x1="${l}" x2="${W - r}" y1="${Y(p)}" y2="${Y(p)}" stroke="#eaf0f6"/><text x="${l - 4}" y="${Y(p) + 3}" font-size="9" fill="#6b7b91" text-anchor="end">${p}</text>`; }
    s += `<path d="${a.pts.map((q, i) => (i ? 'L' : 'M') + X(q.d).toFixed(1) + ',' + Y(q.p).toFixed(1)).join('')}" fill="none" stroke="${ex.color}" stroke-width="2.4" stroke-linejoin="round"/>`;
    svg.innerHTML = s;
  }
  function stokes() {
    const Gs = C.toNum($('#stG').value), T = C.toNum($('#stT').value), H = C.toNum($('#stH').value);
    const tb = $('#stTable');
    if (!(Gs > 1) || !isFinite(T) || !(H > 0)) { tb.innerHTML = '<tr><td>Informe valores válidos.</td></tr>'; return; }
    // densidade da água (Tanaka et al., 2001) e viscosidade (poise) em função da temperatura
    const rw = 0.99997495 * (1 - ((T - 3.983035) ** 2 * (T + 301.797)) / (522528.9 * (T + 69.34881)));
    const eta = 0.01002 * Math.pow(10, (1.3272 * (20 - T) - 0.001053 * (T - 20) ** 2) / (T + 105));
    const rows = [0.075, 0.05, 0.02, 0.01, 0.005, 0.002, 0.001].map(D => {
      const Dcm = D / 10, v = (Gs - rw) * 981 * Dcm * Dcm / (18 * eta); // cm/s
      const t = H / v; // s
      const tt = t < 90 ? C.fmtNum(t, 3) + ' s' : t < 5400 ? C.fmtNum(t / 60, 3) + ' min' : C.fmtNum(t / 3600, 3) + ' h';
      return `<tr><td>${C.fmtNum(D)} mm</td><td class="n">${C.fmtSci(v)} cm/s</td><td class="n"><b>${tt}</b></td></tr>`;
    }).join('');
    tb.innerHTML = `<tr><th>Diâmetro D</th><th class="n">Velocidade v</th><th class="n">Tempo para cair ${C.fmtNum(H)} cm</th></tr>${rows}`;
    $('#stNote').innerHTML = `Água a ${C.fmtNum(T)} °C: ρ<sub>w</sub> ≈ ${C.fmtNum(rw, 4)} g/cm³ · μ ≈ ${C.fmtNum(eta * 100, 4)} mPa·s. Cálculo: v = (ρ<sub>s</sub> − ρ<sub>w</sub>)·g·D² / (18·μ), com g = 981 cm/s².`;
  }
  function buildTheory() {
    if (theoryBuilt) return; theoryBuilt = true;
    const half = Math.ceil(C.SIEVES.length / 2);
    const li = (s) => `<tr><td>${esc(s.name)}</td></tr>`;
    $('#sieveTable').innerHTML = `<div class="two"><div class="tscroll" style="margin:0"><table class="tbl">${C.SIEVES.slice(0, half).map(li).join('')}</table></div><div class="tscroll" style="margin:0"><table class="tbl">${C.SIEVES.slice(half).map(s => li(s).replace(esc(s.name), esc(s.name) + (s.d === 0.075 ? ' <span class="tt-chip">limite físico do peneiramento</span>' : ''))).join('')}</table></div></div>`;
    const save0 = state.system;
    let html = '';
    for (const id of ['abnt', 'sucs']) {
      state.system = id;
      const holder = document.createElement('div'); holder.id = 'tmpFrac'; document.body.appendChild(holder);
      renderFracTable('#tmpFrac'); html += `<h3>${C.SYSTEMS[id].name}</h3>` + holder.innerHTML; holder.remove();
    }
    state.system = save0;
    $('#fracTables').innerHTML = html;
    $$('svg[data-mini]').forEach(svg => miniChart(svg, C.EXAMPLES.find(e => e.id === svg.dataset.mini)));
    ['#stG', '#stT', '#stH'].forEach(id => $(id).addEventListener('input', stokes)); stokes();
    $('#btnLesson').onclick = () => {
      const x = C.LESSON_EXAMPLE;
      if (!state.ensaios.some(e => e.id === x.id)) state.ensaios.push({ id: x.id, name: x.name, color: x.color, mode: x.mode, rows: clone(x.rows), fundo: '', visible: true });
      state.sel = x.id; state.show.d10 = state.show.d30 = state.show.d60 = true;
      $$('.chip[data-show]').forEach(b => b.setAttribute('aria-pressed', !!state.show[b.dataset.show]));
      setTab('app'); renderAll(); save(); toast('Exemplo da aula carregado — D10, D30 e D60 ativados.');
    };
    // índice ativo ao rolar
    const links = $$('#tnav a'), secs = links.map(a => document.getElementById(a.getAttribute('href').slice(1)));
    const io = new IntersectionObserver((en) => { en.forEach(x => { if (x.isIntersecting) links.forEach(a => a.classList.toggle('on', a.getAttribute('href') === '#' + x.target.id)); }); }, { rootMargin: '-20% 0px -70% 0px' });
    secs.forEach(s => s && io.observe(s));
  }

  /* ------------------------------------------------------------ PWA */
  if ('serviceWorker' in navigator && /^https?:$/.test(location.protocol)) {
    window.addEventListener('load', () => navigator.serviceWorker.register('sw.js').catch(() => { }));
  }

  /* ------------------------------------------------------------ início */
  renderAll();
  if (location.hash === '#teoria' || location.hash.startsWith('#t-')) { setTab('theory'); const el = document.getElementById(location.hash.slice(1)); if (el) setTimeout(() => el.scrollIntoView(), 50); }
  window.__granulo = { state: () => state, A: () => A, setTab };
})();
