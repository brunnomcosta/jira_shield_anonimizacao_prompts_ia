import { chromium } from 'playwright';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');
const iconsDir = path.join(rootDir, 'chrome-extension', 'icons');

// SVG do ícone: fundo teal arredondado + seta de exportação + cadeado badge
const SVG_SOURCE = `
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 128 128" width="128" height="128">
  <!-- Fundo arredondado teal -->
  <rect width="128" height="128" rx="24" ry="24" fill="#0f766e"/>

  <!-- Seta de exportação (caixa aberta com seta para cima-direita) -->
  <!-- Corpo da caixa -->
  <rect x="22" y="62" width="60" height="44" rx="4" ry="4"
        fill="none" stroke="white" stroke-width="8" stroke-linejoin="round"/>
  <!-- Abertura superior (tampa aberta) -->
  <polyline points="22,62 22,44 52,44"
            fill="none" stroke="white" stroke-width="8"
            stroke-linecap="round" stroke-linejoin="round"/>
  <!-- Seta diagonal -->
  <line x1="54" y1="70" x2="100" y2="24"
        stroke="white" stroke-width="8" stroke-linecap="round"/>
  <!-- Ponta da seta -->
  <polyline points="74,22 102,22 102,50"
            fill="none" stroke="white" stroke-width="8"
            stroke-linecap="round" stroke-linejoin="round"/>

  <!-- Cadeado badge (canto inferior direito) -->
  <!-- Fundo do badge -->
  <circle cx="96" cy="96" r="24" fill="#115e59"/>
  <!-- Arco do cadeado -->
  <path d="M87,93 L87,88 a9,9 0 0,1 18,0 L105,93"
        fill="none" stroke="white" stroke-width="5"
        stroke-linecap="round" stroke-linejoin="round"/>
  <!-- Corpo do cadeado -->
  <rect x="83" y="92" width="22" height="16" rx="3" ry="3" fill="white"/>
  <!-- Buraco da fechadura -->
  <circle cx="94" cy="100" r="3" fill="#115e59"/>
</svg>
`;

function buildHtml(size) {
  return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { width: ${size}px; height: ${size}px; background: transparent; }
  svg { width: ${size}px; height: ${size}px; display: block; }
</style>
</head>
<body>${SVG_SOURCE}</body>
</html>`;
}

async function generateIcons() {
  fs.mkdirSync(iconsDir, { recursive: true });

  const browser = await chromium.launch();
  const sizes = [16, 48, 128];

  for (const size of sizes) {
    const page = await browser.newPage();
    await page.setViewportSize({ width: size, height: size });

    const html = buildHtml(size);
    const dataUrl = `data:text/html;charset=utf-8,${encodeURIComponent(html)}`;
    await page.goto(dataUrl);

    const outputPath = path.join(iconsDir, `icon${size}.png`);
    await page.screenshot({
      path: outputPath,
      clip: { x: 0, y: 0, width: size, height: size },
      omitBackground: false,
    });

    await page.close();
    console.log(`Gerado: ${outputPath}`);
  }

  await browser.close();
  console.log('Icones gerados com sucesso em chrome-extension/icons/');
}

generateIcons().catch(err => {
  console.error('Erro ao gerar icones:', err);
  process.exit(1);
});
