/* ==========================================================================
   core.js — cálculo granulométrico (sem DOM, testável em Node)
   ========================================================================== */
const GranuloCore = (() => {
  'use strict';

  /* ---------- Série de peneiras (conforme material da aula) ---------- */
  const SIEVES = [
    { d: 76,    label: '3″',     name: '76,0 mm (3″)',    prio: 2 },
    { d: 50,    label: '2″',     name: '50,0 mm (2″)',    prio: 1 },
    { d: 38,    label: '1½″',    name: '38,0 mm (1½″)',   prio: 1 },
    { d: 25,    label: '1″',     name: '25,0 mm (1″)',    prio: 1 },
    { d: 19,    label: '¾″',     name: '19,0 mm (¾″)',    prio: 2 },
    { d: 9.5,   label: '⅜″',     name: '9,5 mm (⅜″)',     prio: 1 },
    { d: 4.75,  label: 'nº 4',   name: '4,75 mm (nº 4)',  prio: 3 },
    { d: 2.0,   label: 'nº 10',  name: '2,0 mm (nº 10)',  prio: 3 },
    { d: 1.2,   label: 'nº 16',  name: '1,2 mm (nº 16)',  prio: 1 },
    { d: 0.6,   label: 'nº 30',  name: '0,6 mm (nº 30)',  prio: 2 },
    { d: 0.42,  label: 'nº 40',  name: '0,42 mm (nº 40)', prio: 3 },
    { d: 0.25,  label: 'nº 60',  name: '0,25 mm (nº 60)', prio: 1 },
    { d: 0.15,  label: 'nº 100', name: '0,15 mm (nº 100)',prio: 2 },
    { d: 0.075, label: 'nº 200', name: '0,075 mm (nº 200)',prio: 4 },
  ];

  /* ---------- Sistemas de classificação das frações ---------- */
  const GROUP_COLORS = {
    pedregulho: '#9aa7b8',
    areia: '#f1c24f',
    silte: '#8cc3a0',
    argila: '#c98a63',
  };

  const SYSTEMS = {
    abnt: {
      id: 'abnt',
      name: 'ABNT NBR 6502',
      groups: [
        { key: 'argila', label: 'Argila', subs: [{ key: 'argila', label: 'Argila', lo: 0, hi: 0.002 }] },
        { key: 'silte', label: 'Silte', subs: [{ key: 'silte', label: 'Silte', lo: 0.002, hi: 0.06 }] },
        { key: 'areia', label: 'Areia', subs: [
          { key: 'areia-fina',  label: 'Fina',   lo: 0.06, hi: 0.2 },
          { key: 'areia-media', label: 'Média',  lo: 0.2,  hi: 0.6 },
          { key: 'areia-grossa',label: 'Grossa', lo: 0.6,  hi: 2 } ] },
        { key: 'pedregulho', label: 'Pedregulho', subs: [
          { key: 'ped-fino',  label: 'Fino',   lo: 2,  hi: 6 },
          { key: 'ped-medio', label: 'Médio',  lo: 6,  hi: 20 },
          { key: 'ped-grosso',label: 'Grosso', lo: 20, hi: Infinity } ] },
      ],
      // limites entre frações e a peneira correspondente
      boundaries: [
        { d: 0.002, sed: true, short: 'Sedimentação', sieve: 'Sem peneira — ensaio de sedimentação (densímetro)', between: 'argila | silte' },
        { d: 0.06,  short: '≈ nº 200', sieve: 'nº 230 (0,063 mm); na prática usa-se a nº 200 (0,075 mm)', between: 'silte | areia fina' },
        { d: 0.2,   short: '≈ nº 70',  sieve: 'nº 70 (0,21 mm) — a mais próxima', between: 'areia fina | média' },
        { d: 0.6,   short: 'nº 30',    sieve: 'nº 30 (0,6 mm)', between: 'areia média | grossa' },
        { d: 2,     short: 'nº 10',    sieve: 'nº 10 (2,0 mm)', between: 'areia grossa | pedregulho fino' },
        { d: 6,     short: '≈ ¼″',     sieve: '¼″ (6,3 mm) — a mais próxima', between: 'pedregulho fino | médio' },
        { d: 20,    short: '≈ ¾″',     sieve: '¾″ (19 mm) — a mais próxima', between: 'pedregulho médio | grosso' },
      ],
      fineLimit: 0.06,
    },
    sucs: {
      id: 'sucs',
      name: 'SUCS / ASTM D2487',
      groups: [
        { key: 'argila', label: 'Argila', subs: [{ key: 'argila', label: 'Argila', lo: 0, hi: 0.002 }] },
        { key: 'silte', label: 'Silte', subs: [{ key: 'silte', label: 'Silte', lo: 0.002, hi: 0.075 }] },
        { key: 'areia', label: 'Areia', subs: [
          { key: 'areia-fina',  label: 'Fina',   lo: 0.075, hi: 0.425 },
          { key: 'areia-media', label: 'Média',  lo: 0.425, hi: 2 },
          { key: 'areia-grossa',label: 'Grossa', lo: 2,     hi: 4.75 } ] },
        { key: 'pedregulho', label: 'Pedregulho', subs: [
          { key: 'ped-fino',  label: 'Fino',   lo: 4.75, hi: 19 },
          { key: 'ped-grosso',label: 'Grosso', lo: 19,   hi: Infinity } ] },
      ],
      boundaries: [
        { d: 0.002, sed: true, short: 'Sedimentação', sieve: 'Sem peneira — ensaio de sedimentação (densímetro)', between: 'argila | silte (convencional)' },
        { d: 0.075, short: 'nº 200', sieve: 'nº 200 (0,075 mm) — limite físico do peneiramento', between: 'finos | areia fina' },
        { d: 0.425, short: 'nº 40',  sieve: 'nº 40 (0,425 mm)', between: 'areia fina | média' },
        { d: 2,     short: 'nº 10',  sieve: 'nº 10 (2,0 mm)', between: 'areia média | grossa' },
        { d: 4.75,  short: 'nº 4',   sieve: 'nº 4 (4,75 mm)', between: 'areia | pedregulho fino' },
        { d: 19,    short: '¾″',     sieve: '¾″ (19 mm)', between: 'pedregulho fino | grosso' },
      ],
      fineLimit: 0.075,
    },
  };

  /* ---------- Utilidades numéricas ---------- */
  const log10 = Math.log10;
  const clamp = (v, a, b) => Math.min(b, Math.max(a, v));

  function toNum(x) {
    if (typeof x === 'number') return isFinite(x) ? x : NaN;
    if (x == null) return NaN;
    let s = String(x).trim().replace('%', '').replace(/\s/g, '');
    if (!s) return NaN;
    if (s.includes(',') && s.includes('.')) s = s.replace(/\./g, '').replace(',', '.');
    else s = s.replace(',', '.');
    const n = Number(s);
    return isFinite(n) ? n : NaN;
  }

  const nf = (opts) => new Intl.NumberFormat('pt-BR', opts);
  const NF_AUTO = nf({ maximumFractionDigits: 8 });
  function fmtNum(n, sig = 3) {
    if (n == null || !isFinite(n)) return '—';
    if (n === 0) return '0';
    return NF_AUTO.format(Number(n.toPrecision(sig)));
  }
  function fmtPct(p, dec = 1) {
    if (p == null || !isFinite(p)) return '—';
    return nf({ minimumFractionDigits: dec, maximumFractionDigits: dec }).format(p) + '%';
  }
  function fmtSci(n) { // 3,2×10⁻²
    if (n == null || !isFinite(n) || n === 0) return '—';
    const e = Math.floor(log10(Math.abs(n)));
    const m = n / Math.pow(10, e);
    const sup = String(e).replace(/-/g, '⁻').replace(/\d/g, c => '⁰¹²³⁴⁵⁶⁷⁸⁹'[c]);
    return fmtNum(m, 2) + '×10' + sup;
  }

  function sieveFor(d, tol = 0.025) {
    for (const s of SIEVES) if (Math.abs(s.d - d) / s.d <= tol) return s;
    return null;
  }

  /* ---------- Curva a partir do ensaio ---------- */
  // ensaio: { mode: 'passa' | 'retida' | 'massa', rows:[{d,v}], fundo }
  function buildCurve(e) {
    const warnings = [];
    const rows = e.rows || [];
    let pts = [];
    let total = null;

    if (e.mode === 'massa') {
      const items = [];
      rows.forEach((r, i) => {
        const d = toNum(r.d), m = toNum(r.v);
        if (d > 0 && isFinite(m)) {
          if (m < 0) warnings.push(`Linha ${i + 1}: massa negativa ignorada.`);
          else items.push({ i, d, m });
        }
      });
      items.sort((a, b) => b.d - a.d);
      const fundoN = toNum(e.fundo);
      const fundo = isFinite(fundoN) && fundoN > 0 ? fundoN : 0;
      total = items.reduce((s, r) => s + r.m, 0) + fundo;
      if (total > 0) {
        let cum = 0;
        for (const it of items) {
          cum += it.m;
          pts.push({ d: it.d, p: clamp(100 * (total - cum) / total, 0, 100), row: it.i, m: it.m });
        }
      }
      if (items.length && fundo === 0)
        warnings.push('Informe a massa retida no fundo (prato) para fechar o balanço de massas.');
    } else {
      rows.forEach((r, i) => {
        const d = toNum(r.d), v = toNum(r.v);
        if (!(d > 0) || !isFinite(v)) return;
        let p = e.mode === 'retida' ? 100 - v : v;
        if (p < -1e-9 || p > 100 + 1e-9) {
          warnings.push(`Linha ${i + 1}: valor fora de 0–100% — ajustado.`);
          p = clamp(p, 0, 100);
        }
        pts.push({ d, p, row: i });
      });
    }

    // ordena por diâmetro crescente e remove diâmetros repetidos (mantém o último digitado)
    pts.sort((a, b) => a.d - b.d || a.row - b.row);
    const dedup = [];
    for (const q of pts) {
      if (dedup.length && Math.abs(dedup[dedup.length - 1].d - q.d) < 1e-12) {
        warnings.push(`Diâmetro ${fmtNum(q.d)} mm repetido — usado o último valor.`);
        dedup[dedup.length - 1] = q;
      } else dedup.push(q);
    }
    pts = dedup;

    // monotonicidade: % passante deve crescer com o diâmetro
    const bad = [];
    for (let i = 1; i < pts.length; i++) if (pts[i].p < pts[i - 1].p - 1e-9) bad.push(pts[i].d);
    if (bad.length)
      warnings.push(`% passante decresce com o aumento do diâmetro em ${bad.map(d => fmtNum(d) + ' mm').slice(0, 3).join(', ')}${bad.length > 3 ? '…' : ''} — confira os dados.`);

    return { pts, warnings, total };
  }

  /* ---------- Interpolação (log-linear em D) ---------- */
  function diameterAt(pts, P) {
    if (!pts || pts.length < 2) return { d: null, reason: 'dados' };
    let pmin = Infinity, pmax = -Infinity;
    for (const q of pts) { pmin = Math.min(pmin, q.p); pmax = Math.max(pmax, q.p); }
    if (P < pmin - 1e-9) return { d: null, reason: 'abaixo', pmin };
    if (P > pmax + 1e-9) return { d: null, reason: 'acima', pmax };
    for (let i = 0; i < pts.length - 1; i++) {
      const a = pts[i], b = pts[i + 1];
      const lo = Math.min(a.p, b.p), hi = Math.max(a.p, b.p);
      if (P >= lo - 1e-9 && P <= hi + 1e-9) {
        if (Math.abs(b.p - a.p) < 1e-12) return { d: a.d, p: P, seg: i };
        const t = (P - a.p) / (b.p - a.p);
        const ld = log10(a.d) + t * (log10(b.d) - log10(a.d));
        return { d: Math.pow(10, ld), p: P, seg: i };
      }
    }
    return { d: null, reason: 'dados' };
  }

  // % passante em um diâmetro (null abaixo do menor diâmetro ensaiado)
  function passAt(pts, d) {
    if (!pts || pts.length < 2) return null;
    const first = pts[0], last = pts[pts.length - 1];
    if (d > last.d * (1 + 1e-9)) return 100;
    if (d < first.d * (1 - 1e-9)) return null;
    for (let i = 0; i < pts.length - 1; i++) {
      const a = pts[i], b = pts[i + 1];
      if (d >= a.d * (1 - 1e-9) && d <= b.d * (1 + 1e-9)) {
        const t = (log10(d) - log10(a.d)) / (log10(b.d) - log10(a.d));
        return a.p + t * (b.p - a.p);
      }
    }
    return null;
  }

  /* ---------- Coeficientes e classificação ---------- */
  function coefficients(pts) {
    const D10 = diameterAt(pts, 10), D15 = diameterAt(pts, 15), D30 = diameterAt(pts, 30), D60 = diameterAt(pts, 60), D85 = diameterAt(pts, 85);
    const ok = (x) => x && x.d != null;
    const Cu = ok(D10) && ok(D60) ? D60.d / D10.d : null;
    const Cc = ok(D10) && ok(D30) && ok(D60) ? (D30.d * D30.d) / (D10.d * D60.d) : null;
    return { D10, D15, D30, D60, D85, Cu, Cc };
  }

  function classifyCu(cu) {
    if (cu == null) return null;
    if (cu < 5)   return { key: 'uniforme', tone: 'warn', label: 'Muito uniforme', note: 'Cu < 5 — solo mal graduado' };
    if (cu <= 15) return { key: 'media',    tone: 'info', label: 'Uniformidade média', note: 'Cu entre 5 e 15' };
    return { key: 'hetero', tone: 'ok', label: 'Heterogêneo', note: 'Cu > 15 — solo bem graduado' };
  }
  function classifyCc(cc) {
    if (cc == null) return null;
    if (cc >= 1 && cc <= 3) return { key: 'dentro', tone: 'ok', label: 'Curva harmônica', note: '1 ≤ Cc ≤ 3 — bem graduado' };
    return { key: 'fora', tone: 'warn', label: 'Fora de 1–3', note: 'Cc fora de 1–3 — mal graduado' };
  }

  // Patamar horizontal (graduação aberta / descontínua): ≥ 1 década com inclinação ≤ 5 %/década,
  // em região interior da curva (10% ≤ passante ≤ 95%) — caudas de finos são naturalmente suaves.
  function detectGap(pts) {
    let best = null;
    for (let i = 0; i < pts.length; i++) {
      for (let j = i + 1; j < pts.length; j++) {
        const a = pts[i], b = pts[j];
        const ratio = b.d / a.d;
        if (ratio >= 10 && (b.p - a.p) <= 5 * log10(ratio) && a.p >= 10 && b.p <= 95) {
          if (!best || ratio > best.ratio) best = { dLo: a.d, dHi: b.d, pLo: a.p, pHi: b.p, ratio };
        }
      }
    }
    return best;
  }

  /* ---------- Composição granulométrica ---------- */
  function composition(pts, sysId) {
    const sys = SYSTEMS[sysId] || SYSTEMS.abnt;
    const dmin = pts.length ? pts[0].d : null;
    let approx = false;

    function pEff(d) {
      if (d === 0) return 0;
      if (d === Infinity) return 100;
      let v = passAt(pts, d);
      // 0,06 mm (ABNT) não é uma peneira usual: se o ensaio parar na nº 200, usa-se 0,075 como limite prático
      if (v == null && sysId === 'abnt' && Math.abs(d - 0.06) < 1e-9 && dmin != null && dmin <= 0.0751) {
        approx = true; v = passAt(pts, dmin);
      }
      return v;
    }

    const pDmin = pts.length ? pts[0].p : null;
    const sub = (s) => {
      const ph = pEff(s.hi);
      let pl = pEff(s.lo), partial = false;
      if (pl == null && ph != null && s.hi > dmin) { pl = pDmin; partial = true; } // só a parte medida
      return { ...s, partial, pct: ph != null && pl != null ? Math.max(0, ph - pl) : null };
    };

    const groups = [];
    const fractions = [];
    for (const g of sys.groups) {
      const subs = g.subs.map(s => ({ ...sub(s), group: g.key }));
      fractions.push(...subs);
      const known = subs.filter(x => x.pct != null);
      groups.push({
        key: g.key, label: g.label, color: GROUP_COLORS[g.key],
        pct: known.length ? known.reduce((a, x) => a + x.pct, 0) : null,
        partial: subs.some(x => x.partial),
      });
    }

    // parcela abaixo do menor diâmetro ensaiado (precisa de sedimentação para ser discriminada)
    const lowest = sys.groups[0].subs[0].hi; // 0,002
    const rest = dmin != null && dmin > lowest * (1 + 1e-9) ? { pct: pDmin, below: dmin } : null;

    const finesP = pEff(sys.fineLimit);
    return { system: sys.id, fractions, groups, rest, fines: finesP, siltClayUnknown: !!rest, approx, dmin };
  }

  // grupos SUCS (sempre com limites 4,75 e 0,075)
  function sucsGroups(pts) {
    const p475 = passAt(pts, 4.75), p075 = passAt(pts, 0.075);
    if (p475 == null || p075 == null) return null;
    return { gravel: 100 - p475, sand: Math.max(0, p475 - p075), fines: p075 };
  }

  function sucsPrelim(g, cu, cc) {
    if (!g) return null;
    if (g.fines >= 50)
      return { symbol: 'ML · CL · MH · CH', name: 'Solo fino (≥ 50% passa na nº 200)', note: 'A classificação final exige LL e IP (Carta de Plasticidade).' };
    const isG = g.gravel > g.sand;
    const L = isG ? 'G' : 'S';
    const base = isG ? 'Pedregulho' : 'Areia';
    const grad = (cu != null && cc != null) ? (cc >= 1 && cc <= 3 && cu >= (isG ? 4 : 6)) : null;
    if (g.fines < 5) {
      if (grad == null) return { symbol: `${L}W ou ${L}P`, name: `${base} limpo`, note: 'Não foi possível calcular Cu e Cc (faltam dados de finos).' };
      return grad
        ? { symbol: `${L}W`, name: `${base} bem graduado`, note: `Cu ≥ ${isG ? 4 : 6} e 1 ≤ Cc ≤ 3, com menos de 5% de finos.` }
        : { symbol: `${L}P`, name: `${base} mal graduado`, note: 'Não atende simultaneamente aos critérios de Cu e Cc.' };
    }
    if (g.fines <= 12) {
      const w = grad == null ? 'W/P' : grad ? 'W' : 'P';
      return { symbol: `${L}${w}-${L}M ou ${L}${w}-${L}C`, name: `${base} com 5–12% de finos (símbolo duplo)`, note: 'M ou C depende da plasticidade dos finos (LL e IP).' };
    }
    return { symbol: `${L}M ou ${L}C`, name: `${base} ${isG ? 'siltoso ou argiloso' : 'siltosa ou argilosa'}`, note: 'Mais de 12% de finos — M ou C depende de LL e IP.' };
  }

  // Hazen: k = C·D10² (D10 em cm → k em cm/s)
  function hazen(D10mm, cu, C = 100) {
    if (D10mm == null) return null;
    const applicable = D10mm >= 0.1 && D10mm <= 3 && (cu == null || cu < 5);
    const k = C * Math.pow(D10mm / 10, 2);
    return { k, applicable, C };
  }

  /* ---------- Análise completa ---------- */
  function analyze(e, sysId = 'abnt') {
    const { pts, warnings, total } = buildCurve(e);
    const valid = pts.length >= 2;
    const out = { pts, warnings, total, valid, system: sysId };
    if (!valid) return out;

    const co = coefficients(pts);
    out.coef = co;
    out.cuClass = classifyCu(co.Cu);
    out.ccClass = classifyCc(co.Cc);
    out.gap = detectGap(pts);
    out.comp = composition(pts, sysId);
    out.sg = sucsGroups(pts);
    out.sucs = sucsPrelim(out.sg, co.Cu, co.Cc);

    // graduação (critério SUCS) + padrão de curva
    let g;
    const thr = out.sg && out.sg.gravel > out.sg.sand ? 4 : 6;
    if (co.Cu == null || co.Cc == null) {
      g = { key: 'indef', tone: 'muted', label: 'Indeterminado', behavior: 'D10 (ou D30/D60) fora da curva — complete a curva com dados de finos (sedimentação) para calcular Cu e Cc.' };
    } else if (out.gap) {
      g = { key: 'aberta', tone: 'bad', label: 'Graduação aberta (descontínua)', behavior: 'Patamar horizontal: ausência de frações intermediárias. Estrutura instável e difícil de compactar.' };
    } else if (co.Cc >= 1 && co.Cc <= 3 && co.Cu >= thr) {
      g = { key: 'bem', tone: 'ok', label: 'Bem graduado', behavior: 'Distribuição ampla e contínua de grãos. Alta compactação, resistência e estabilidade.' };
    } else if (co.Cu < 5) {
      g = { key: 'uniforme', tone: 'warn', label: 'Uniforme (mal graduado)', behavior: 'Grãos de tamanhos muito parecidos. Baixa compactação e alta permeabilidade (bom para filtros).' };
    } else {
      g = { key: 'mal', tone: 'warn', label: 'Mal graduado', behavior: 'Distribuição não harmônica (Cc fora de 1–3 ou Cu insuficiente): compactação inferior à de um solo bem graduado.' };
    }
    out.grading = g;
    out.hazen = hazen(co.D10.d, co.Cu);
    return out;
  }

  /* ---------- Exemplos (3 curvas-padrão + exemplo resolvido da aula) ---------- */
  const mk = (arr) => arr.map(([d, v]) => ({ d: String(d).replace('.', ','), v: String(v).replace('.', ',') }));

  const EXAMPLES = [
    {
      id: 'ex-bem', name: 'Solo bem graduado', color: '#16a34a', mode: 'passa',
      desc: 'Pedregulho arenoso com finos — curva diagonal suave e contínua.',
      rows: mk([[38, 100], [25, 92], [19, 84], [9.5, 66], [4.75, 48], [2, 40], [1.2, 36], [0.6, 28], [0.42, 24], [0.25, 19], [0.15, 14], [0.075, 11.5], [0.05, 10], [0.02, 8], [0.005, 5], [0.002, 3]]),
    },
    {
      id: 'ex-uniforme', name: 'Solo uniforme', color: '#2563eb', mode: 'passa',
      desc: 'Areia fina de duna — curva quase vertical, grãos de tamanho muito similar.',
      rows: mk([[2, 100], [1.2, 100], [0.6, 99], [0.42, 88], [0.25, 40], [0.15, 6], [0.075, 1.5], [0.05, 1], [0.02, 0.5]]),
    },
    {
      id: 'ex-aberta', name: 'Solo de graduação aberta', color: '#dc2626', mode: 'passa',
      desc: 'Pedregulho + finos, sem areia — curva com patamar horizontal.',
      rows: mk([[38, 100], [25, 93], [19, 82], [9.5, 58], [4.75, 43], [2, 40], [1.2, 39], [0.6, 38.5], [0.42, 38], [0.25, 37.5], [0.15, 36], [0.075, 33], [0.05, 29], [0.02, 21], [0.005, 13], [0.002, 8]]),
    },
  ];
  const LESSON_EXAMPLE = {
    id: 'ex-aula', name: 'Exemplo da aula (D10≈0,2 · D30≈0,6 · D60≈1,8)', color: '#d97706', mode: 'passa',
    rows: mk([[25, 100], [19, 100], [9.5, 96], [4.75, 82], [2, 64], [1.2, 47], [0.6, 30], [0.42, 21], [0.25, 13], [0.15, 6], [0.075, 2]]),
  };

  const STD_ROWS = () => SIEVES.map(s => ({ d: String(s.d).replace('.', ','), v: '' }));

  return {
    SIEVES, SYSTEMS, GROUP_COLORS, EXAMPLES, LESSON_EXAMPLE, STD_ROWS,
    toNum, fmtNum, fmtPct, fmtSci, sieveFor, clamp,
    buildCurve, diameterAt, passAt, coefficients, classifyCu, classifyCc, detectGap,
    composition, sucsGroups, sucsPrelim, hazen, analyze,
  };
})();

if (typeof module !== 'undefined' && module.exports) module.exports = GranuloCore;
