const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const C = require('../src/core.js');
const IO = require('../src/xlsx.js');

const OUT = process.argv[2] || path.join(__dirname, 'out');
fs.mkdirSync(OUT, { recursive: true });

(async () => {
  // PNG mínimo 1x1 (para testar o desenho embutido)
  const png = Uint8Array.from(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==', 'base64'));
  const items = C.EXAMPLES.map(e => ({ name: e.name, ensaio: e, a: C.analyze(e, 'abnt') }));
  const bytes = IO.buildReport(items, { system: 'abnt', png: { png, w: 600, h: 400 } });
  fs.writeFileSync(path.join(OUT, 'teste.xlsx'), bytes);
  console.log('✓ xlsx gerado', bytes.length, 'bytes');

  // ida e volta
  const sheets = await IO.readXlsx(bytes);
  assert.deepEqual(sheets.map(s => s.name), ['Resumo', 'Gráfico', ...C.EXAMPLES.map(e => e.name)]);
  let all = [];
  for (const sh of sheets) if (!/^(resumo|gr)/i.test(sh.name)) all.push(...IO.rowsToEnsaios(sh.rows, sh.name));
  assert.equal(all.length, 3);
  for (let i = 0; i < 3; i++) {
    const back = C.analyze({ ...all[i] }, 'abnt');
    const orig = items[i].a;
    assert.ok(Math.abs(back.coef.D60.d - orig.coef.D60.d) < 1e-6, 'D60 ' + i);
    assert.ok(Math.abs(back.coef.Cu - orig.coef.Cu) < 1e-3, 'Cu ' + i);
    assert.equal(all[i].mode, 'passa');
  }
  console.log('✓ ida e volta (.xlsx → ensaios) preserva D60 e Cu');

  // texto colado do Excel (tab, vírgula decimal)
  const t1 = 'Diâmetro (mm)\t% Passante\n4,75\t100\n2\t80,5\n0,6\t45\n0,075\t12\n';
  const e1 = IO.rowsToEnsaios(IO.parseText(t1), 'Colado');
  assert.equal(e1.length, 1); assert.equal(e1[0].rows.length, 4); assert.equal(e1[0].rows[1].v, '80,5');
  // CSV ; com várias amostras
  const t2 = 'Diâmetro;Areia A;Areia B\n2;100;100\n0,6;60;90\n0,075;5;30\n';
  const e2 = IO.rowsToEnsaios(IO.parseText(t2), 'x');
  assert.deepEqual(e2.map(e => e.name), ['Areia A', 'Areia B']);
  // CSV com vírgula decimal e espaço
  const t3 = '4,75 100\n2 80,5\n0,6 45\n';
  const e3 = IO.rowsToEnsaios(IO.parseText(t3), 'z');
  assert.equal(e3[0].rows[0].d, '4,75');
  // colunas "% Retida"
  const t4 = 'Diâmetro;% Retida acumulada\n4,75;0\n2;20\n0,6;55\n';
  assert.equal(IO.rowsToEnsaios(IO.parseText(t4), 'r')[0].mode, 'retida');
  // massa retida
  const t5 = 'Peneira (mm);Massa retida (g)\n4,75;100\n2;200\n0,6;300\n';
  assert.equal(IO.rowsToEnsaios(IO.parseText(t5), 'm')[0].mode, 'massa');
  // CSV simples com ponto decimal e vírgula separadora
  const t6 = 'd,passa\n4.75,100\n2,80.5\n0.6,45\n';
  assert.equal(IO.rowsToEnsaios(IO.parseText(t6), 'c')[0].rows[1].v, '80,5');
  // tabela do exercício: 1ª coluna = nome da peneira, malha na 2ª, massa e % passante
  const t7 = 'Peneira\tMalha (mm)\tMassa (g)\t% Passante\n3/8"\t9,5\t200\t100%\n4\t4,8\t180\t90%\n8\t2,35\t160\t80%\n16\t1,19\t130\t65%\n30\t0,6\t100\t50%\n50\t0,3\t80\t40%\n100\t0,15\t60\t30%\n200\t0,074\t16\t8%\n';
  const e7 = IO.rowsToEnsaios(IO.parseText(t7), 'Exercício');
  assert.equal(e7.length, 1); assert.equal(e7[0].mode, 'passa');
  assert.deepEqual(e7[0].rows.map(r => r.d), ['9,5', '4,8', '2,35', '1,19', '0,6', '0,3', '0,15', '0,074']);
  assert.deepEqual(e7[0].rows.map(r => r.v), ['100', '90', '80', '65', '50', '40', '30', '8']);
  // só massa passante (sem coluna de %)
  const t8 = 'Peneira\tMalha (mm)\tMassa passante (g)\n4\t4,8\t180\n8\t2,35\t160\n16\t1,19\t130\n';
  const e8 = IO.rowsToEnsaios(IO.parseText(t8), 'x'); assert.equal(e8[0].mode, 'massap'); assert.equal(e8[0].rows[0].d, '4,8');
  console.log('✓ importação de texto/CSV (tab, ;, vírgula, espaço, retida, massa)');
})().catch(e => { console.error(e); process.exit(1); });
