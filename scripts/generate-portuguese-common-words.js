import fs from 'fs';
import path from 'path';
import https from 'https';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');

const SOURCE_URL = 'https://raw.githubusercontent.com/hermitdave/FrequencyWords/master/content/2018/pt/pt_50k.txt';
const TARGET_SIZE = 10000;
const outputFile = path.join(rootDir, 'src', 'portugueseCommonWords.js');

function download(url) {
  return new Promise((resolve, reject) => {
    https
      .get(url, (response) => {
        if (response.statusCode !== 200) {
          reject(new Error(`Falha ao baixar lista de palavras: HTTP ${response.statusCode}`));
          response.resume();
          return;
        }

        let data = '';
        response.setEncoding('utf8');
        response.on('data', (chunk) => {
          data += chunk;
        });
        response.on('end', () => resolve(data));
      })
      .on('error', reject);
  });
}

function normalizeWord(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z]/g, '');
}

function formatArray(values) {
  return values
    .map((value) => `  '${value}'`)
    .join(',\n');
}

const raw = await download(SOURCE_URL);
const words = [];
const seen = new Set();

for (const line of raw.split(/\r?\n/)) {
  const [token] = line.trim().split(/\s+/);
  const normalized = normalizeWord(token);

  if (!/^[a-z]{2,}$/.test(normalized)) continue;
  if (seen.has(normalized)) continue;

  seen.add(normalized);
  words.push(normalized);

  if (words.length >= TARGET_SIZE) break;
}

if (words.length < TARGET_SIZE) {
  throw new Error(`Lista insuficiente: esperadas ${TARGET_SIZE} palavras, obtidas ${words.length}`);
}

const fileContent = [
  '// Gerado automaticamente por scripts/generate-portuguese-common-words.js - nao editar manualmente.',
  `export const PORTUGUESE_COMMON_WORDS_SOURCE = '${SOURCE_URL}';`,
  `export const PORTUGUESE_COMMON_WORDS_VERSION = '${new Date().toISOString()}';`,
  `export const PORTUGUESE_COMMON_WORDS_COUNT = ${words.length};`,
  'export const PORTUGUESE_COMMON_WORDS = [',
  formatArray(words),
  '];',
  '',
].join('\n');

fs.writeFileSync(outputFile, fileContent, 'utf8');
console.log(`Gerado: ${outputFile} (${words.length} palavras)`);
