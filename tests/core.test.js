const assert = require('node:assert/strict');
const C = require('../src/core.js');

let n = 0;
const ok = (name, fn) => { fn(); n++; console.log('✓', name); };
const near = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg || ''} esperado ${b}±${tol}, obtido ${a}`);

ok('interpolação log-linear (D60 entre 1,2/47 e 2,0/63)', () => {
  const r = C.analyze(C.LESSON_EXAMPLE);
  near(r.coef.D60.d, 1.8, 0.05, 'D60');
  near(r.coef.D30.d, 0.6, 1e-9, 'D30');
  near(r.coef.D10.d, 0.2, 0.01, 'D10');
  near(r.coef.Cu, 9, 0.5, 'Cu');
  near(r.coef.Cc, 1.0, 0.1, 'Cc');
  assert.equal(r.cuClass.key, 'media');
  assert.equal(r.ccClass.key, 'dentro');
});

ok('3 exemplos padrão classificam como esperado', () => {
  const [bem, uni, aberta] = C.EXAMPLES.map(e => C.analyze(e, 'sucs'));
  console.log('   bem   ', C.fmtNum(bem.coef.D10.d), C.fmtNum(bem.coef.D30.d), C.fmtNum(bem.coef.D60.d), 'Cu', C.fmtNum(bem.coef.Cu), 'Cc', C.fmtNum(bem.coef.Cc), bem.grading.label, '|', bem.sucs.symbol);
  console.log('   uni   ', C.fmtNum(uni.coef.D10.d), C.fmtNum(uni.coef.D30.d), C.fmtNum(uni.coef.D60.d), 'Cu', C.fmtNum(uni.coef.Cu), 'Cc', C.fmtNum(uni.coef.Cc), uni.grading.label, '|', uni.sucs.symbol, uni.hazen);
  console.log('   aberta', C.fmtNum(aberta.coef.D10.d), C.fmtNum(aberta.coef.D30.d), C.fmtNum(aberta.coef.D60.d), 'Cu', C.fmtNum(aberta.coef.Cu), 'Cc', C.fmtNum(aberta.coef.Cc), aberta.grading.label, '|', aberta.sucs.symbol, aberta.gap);
  assert.equal(bem.grading.key, 'bem');
  assert.equal(uni.grading.key, 'uniforme');
  assert.equal(aberta.grading.key, 'aberta');
  assert.ok(bem.coef.Cu > 15 && bem.coef.Cc >= 1 && bem.coef.Cc <= 3);
  assert.ok(uni.coef.Cu < 5);
  assert.ok(!bem.gap && !uni.gap);
});

ok('modo % retida acumulada equivale a % passante', () => {
  const ex = C.EXAMPLES[0];
  const ret = { ...ex, mode: 'retida', rows: ex.rows.map(r => ({ d: r.d, v: String(100 - C.toNum(r.v)).replace('.', ',') })) };
  const a = C.analyze(ex), b = C.analyze(ret);
  near(a.coef.D60.d, b.coef.D60.d, 1e-9);
  near(a.coef.Cu, b.coef.Cu, 1e-6);
});

ok('modo massa retida: balanço de massas e % passante', () => {
  const e = { mode: 'massa', fundo: '50', rows: [
    { d: '4,75', v: '100' }, { d: '2', v: '150' }, { d: '0,6', v: '300' }, { d: '0,075', v: '400' } ] };
  const { pts, total } = C.buildCurve(e);
  assert.equal(total, 1000);
  const by = Object.fromEntries(pts.map(p => [p.d, p.p]));
  near(by[4.75], 90, 1e-9); near(by[2], 75, 1e-9); near(by[0.6], 45, 1e-9); near(by[0.075], 5, 1e-9);
});

ok('D10 indeterminado quando a curva não chega a 10% (sem sedimentação)', () => {
  const e = { mode: 'passa', rows: [{ d: '4,75', v: '100' }, { d: '0,6', v: '60' }, { d: '0,075', v: '25' }] };
  const r = C.analyze(e);
  assert.equal(r.coef.D10.d, null);
  assert.equal(r.coef.D10.reason, 'abaixo');
  assert.equal(r.grading.key, 'indef');
});

ok('vírgula decimal, %, espaços', () => {
  assert.equal(C.toNum('0,075'), 0.075);
  assert.equal(C.toNum(' 98,5 % '), 98.5);
  assert.equal(C.toNum('1.234,5'), 1234.5);
  assert.ok(Number.isNaN(C.toNum('abc')));
});

ok('composição ABNT e SUCS somam 100%', () => {
  for (const sys of ['abnt', 'sucs']) {
    for (const ex of C.EXAMPLES) {
      const r = C.analyze(ex, sys);
      const g = r.comp.groups.reduce((s, x) => s + (x.pct || 0), 0) + (r.comp.rest ? r.comp.rest.pct : 0);
      near(g, 100, 1e-6, `${ex.id}/${sys}`);
    }
  }
});

ok('ABNT com ensaio só até a nº 200 usa 0,075 como limite prático', () => {
  const e = { mode: 'passa', rows: [{ d: '4,75', v: '100' }, { d: '0,6', v: '60' }, { d: '0,075', v: '25' }] };
  const r = C.analyze(e, 'abnt');
  assert.ok(r.comp.approx);
  assert.ok(r.comp.siltClayUnknown);
  near(r.comp.fines, 25, 1e-9);
});

ok('SUCS preliminar', () => {
  const [bem, uni, ab] = C.EXAMPLES.map(e => C.analyze(e, 'sucs'));
  assert.match(bem.sucs.symbol, /GW/); // ~11% de finos
  assert.match(uni.sucs.symbol, /SP/);
  assert.match(ab.sucs.symbol, /G/);
});

ok('avisos: valores decrescentes e diâmetros repetidos', () => {
  const e = { mode: 'passa', rows: [{ d: '2', v: '90' }, { d: '1', v: '95' }, { d: '1', v: '50' }, { d: '0,5', v: '40' }] };
  const { warnings } = C.buildCurve(e);
  assert.ok(warnings.some(w => /repetido/.test(w)));
  const e2 = { mode: 'passa', rows: [{ d: '2', v: '50' }, { d: '1', v: '60' }, { d: '0,5', v: '40' }] };
  assert.ok(C.buildCurve(e2).warnings.some(w => /decresce/.test(w)));
});

ok('formatação pt-BR', () => {
  assert.equal(C.fmtNum(0.0756), '0,0756');
  assert.equal(C.fmtNum(126.34), '126');
  assert.equal(C.fmtPct(14.04), '14,0%');
  assert.equal(C.fmtSci(0.032), '3,2×10⁻²');
});

console.log(`\n${n} testes OK`);
