import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');

const extensionDir = path.join(rootDir, 'chrome-extension');
const vendorDir = path.join(extensionDir, 'vendor');
const sourceFile = path.join(rootDir, 'node_modules', 'jspdf', 'dist', 'jspdf.umd.min.js');
const targetFile = path.join(vendorDir, 'jspdf.umd.min.js');

const requiredFiles = [
  'manifest.json',
  'background.js',
  'popup.html',
  'popup.js',
  'prompt-templates.js',
  'prompt-template-diagnostic.js',
  'options.html',
  'options.js',
  'styles.css',
  'shield-core.js',
  'pdf.js',
  'icons/icon16.png',
  'icons/icon48.png',
  'icons/icon128.png',
];

function assertFileExists(filePath, message) {
  if (!fs.existsSync(filePath)) {
    throw new Error(message || `Arquivo obrigatorio nao encontrado: ${filePath}`);
  }
}

assertFileExists(sourceFile, `jsPDF nao encontrado em ${sourceFile}. Rode "npm install" antes.`);

for (const rel of requiredFiles) {
  assertFileExists(path.join(extensionDir, rel), `Arquivo obrigatorio da extensao nao encontrado: chrome-extension/${rel}`);
}

fs.mkdirSync(vendorDir, { recursive: true });
fs.copyFileSync(sourceFile, targetFile);

const manifest = JSON.parse(fs.readFileSync(path.join(extensionDir, 'manifest.json'), 'utf-8'));

console.log(`Chrome extension pronta em ${extensionDir}`);
console.log(`Manifest: ${manifest.name} v${manifest.version}`);
console.log(`Dependencia copiada: ${targetFile}`);
console.log('Para usar no Chrome: chrome://extensions -> Developer mode -> Load unpacked -> chrome-extension');
