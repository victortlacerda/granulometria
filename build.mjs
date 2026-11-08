// Gera ./index.html (arquivo único, sem dependências) a partir de src/.
// Uso: node build.mjs
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = dirname(fileURLToPath(import.meta.url));
const read = (f) => readFileSync(join(root, 'src', f), 'utf8');

const js = ['core.js', 'xlsx.js', 'chart.js', 'app.js']
  .map(f => `/* ── ${f} ── */\n` + read(f).replace(/\nif \(typeof module[\s\S]*?module\.exports = \w+;\n?/g, '\n'))
  .join('\n');

if (js.includes('</script')) throw new Error('"</script" encontrado no JS');

const html = read('index.template.html')
  .replace('{{CSS}}', () => read('style.css'))
  .replace('{{THEORY}}', () => read('theory.html'))
  .replace('{{JS}}', () => js);

writeFileSync(join(root, 'index.html'), html);
console.log('index.html gerado —', (html.length / 1024).toFixed(0), 'KB');
