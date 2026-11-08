# Granulometria

App web (um único `index.html`, sem dependências e sem build obrigatório) para interpretar ensaios de granulometria de solos:
curva granulométrica interativa, D10/D30/D60, Cu, Cc, graduação, frações (ABNT/SUCS), SUCS preliminar, importação/exportação Excel e aba de teoria.

## Usar localmente
Dê duplo clique em `index.html` (funciona offline, no computador e no celular).

## Publicar no GitHub Pages
1. Crie um repositório e envie estes arquivos (na raiz): `index.html`, `manifest.webmanifest`, `sw.js`, `icons/`.
2. No GitHub: **Settings → Pages → Build and deployment → Deploy from a branch → `main` / `(root)`**.
3. Acesse `https://SEU-USUARIO.github.io/NOME-DO-REPO/`. No celular, use "Adicionar à tela inicial" para instalar como app (PWA).

## Editar o código
O código-fonte fica em `src/`. Depois de editar, gere o `index.html` novamente:

```
node build.mjs
```

Testes do núcleo de cálculo e do Excel: `node tests/core.test.js` e `node tests/xlsx.test.js`.

## Formato de importação
Diâmetro (mm) na 1ª coluna; nas demais, % passante, % retida acumulada ou massa retida (g). O cabeçalho indica o tipo
("% Retida…", "Massa retida (g)"); sem cabeçalho, assume % passante. Várias colunas = vários ensaios.
