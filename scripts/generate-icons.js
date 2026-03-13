import { chromium } from 'playwright';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');
const iconsDir = path.join(rootDir, 'chrome-extension', 'icons');
const svgPath = path.join(iconsDir, 'icon-source.svg');
const SVG_SOURCE = fs.readFileSync(svgPath, 'utf8');

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
