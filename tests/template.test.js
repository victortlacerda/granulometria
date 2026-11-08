// Gera o modelo, preenche com openpyxl+LibreOffice (recalcula) e confere a importação.
const fs = require('fs'), path = require('path'), assert = require('node:assert/strict');
const C = require('../src/core.js'), IO = require('../src/xlsx.js');
const out = process.argv[2];
(async () => {
  if (process.argv[3] === 'gen') { fs.writeFileSync(path.join(out, 'modelo.xlsx'), IO.buildTemplate()); console.log('modelo gerado'); return; }
  const sheets = await IO.readXlsx(fs.readFileSync(path.join(out, 'preenchido.xlsx')));
  console.log(sheets.map(s => s.name));
  const all = [];
  for (const sh of sheets) if (!/instru/i.test(sh.name)) all.push(...IO.rowsToEnsaios(sh.rows, sh.name));
  console.log(JSON.stringify(all.map(e => ({ name: e.name, mode: e.mode, n: e.rows.length, fundo: e.fundo, first: e.rows.slice(0, 3), last: e.rows.slice(-3) }))));
  assert.equal(all.length, 1);
  const a = C.analyze(all[0], 'abnt');
  console.log('D10', a.coef.D10.d, 'D60', a.coef.D60.d, 'Cu', a.coef.Cu, a.grading.label);
  assert.ok(a.valid && a.coef.Cu > 1);
  console.log('OK');
})();
