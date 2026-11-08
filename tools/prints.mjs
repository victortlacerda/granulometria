// Gera os prints do README em docs/screenshots/ a partir de index.html.
// Uso: node tools/prints.mjs
// Precisa do Playwright (uma vez): npm i --no-save playwright && npx playwright install chromium
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const URL = 'file://' + path.join(RAIZ, 'index.html');
const OUT = path.join(RAIZ, 'docs', 'screenshots');

const { chromium, devices } = await import('playwright').catch(() => {
  console.error('Playwright não encontrado. Rode: npm i --no-save playwright && npx playwright install chromium');
  process.exit(1);
});
fs.mkdirSync(OUT, { recursive: true });

const b = await chromium.launch();
const erros = [];
const print = async (alvo, nome, opc = {}) => {
  await alvo.screenshot({ path: path.join(OUT, nome + '.jpg'), type: 'jpeg', quality: 82, ...opc });
  console.log('ok', nome);
};
// rola até o elemento deixando-o logo abaixo do cabeçalho fixo
const rolar = (pg, sel) => pg.evaluate((sel) => {
  const h = document.querySelector('.top').offsetHeight;
  window.scrollTo(0, document.querySelector(sel).getBoundingClientRect().top + window.scrollY - h - 8);
}, sel);
const botao = (pg, texto) => pg.locator('#chartCard button', { hasText: texto }).first().click();

// computador
const ctx = await b.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 });
const pg = await ctx.newPage();
pg.on('pageerror', (e) => erros.push(e.message));
await pg.goto(URL); await pg.waitForTimeout(1200);
for (const t of ['D10', 'D30', 'D60']) await botao(pg, t);
await pg.waitForTimeout(500);
await print(pg, '01-analise');

// nos recortes de um bloco, o cabeçalho fixo não pode ficar por cima
const semCabecalho = await pg.addStyleTag({ content: '.top{position:static!important}' });
await print(pg.locator('#results'), '02-resultados');

await pg.selectOption('#sys', { index: 1 });
await botao(pg, 'Peneiras');
await pg.locator('#fracDetails summary').click();
await pg.waitForTimeout(400);
await print(pg.locator('#chartCard'), '03-curva-sucs');
await semCabecalho.evaluate((el) => el.remove());
await pg.evaluate(() => window.scrollTo(0, 0));

await pg.click('#btnPaste');
await pg.fill('#pasteText', 'Diâmetro (mm)\t% Passante\n4,75\t100\n2\t85\n0,6\t52\n0,25\t30\n0,075\t12');
await pg.waitForTimeout(400);
await print(pg, '04-colar-excel');
await pg.click('#pasteCancel');

await pg.click('#tab-theory'); await pg.waitForTimeout(600);
await print(pg, '05-teoria');
await ctx.close();

// celular
const cel = await b.newContext({ ...devices['iPhone 13'] });
const pc = await cel.newPage();
pc.on('pageerror', (e) => erros.push(e.message));
await pc.goto(URL); await pc.waitForTimeout(1200);
await rolar(pc, '#legend');
await pc.waitForTimeout(400);
await print(pc, '06-celular-curva');
await rolar(pc, '#results');
await pc.waitForTimeout(400);
await print(pc, '07-celular-resultados');
await cel.close();

await b.close();
if (erros.length) { console.error('Erros na página:\n' + erros.join('\n')); process.exit(1); }
