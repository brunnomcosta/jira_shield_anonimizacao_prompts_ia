import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import {
  DIAGNOSTIC_PERSONA,
  DIAGNOSTIC_CORE_CONSTRAINTS,
  DIAGNOSTIC_OUTPUT_INTRO,
  DIAGNOSTIC_OUTPUT_SECTIONS,
} from '../src/diagnosticPromptBase.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');

const extensionDir = path.join(rootDir, 'chrome-extension');
const vendorDir = path.join(extensionDir, 'vendor');
const sourceFile = path.join(rootDir, 'node_modules', 'jspdf', 'dist', 'jspdf.umd.min.js');
const targetFile = path.join(vendorDir, 'jspdf.umd.min.js');
const envFile = path.join(rootDir, '.env');
const envExampleFile = path.join(rootDir, '.env.example');
const generatedProjectEnvFile = path.join(extensionDir, 'generated-project-env.js');
const technicalContextSourceFile = path.join(rootDir, 'src', 'issueTechnicalContext.js');
const technicalContextBrowserFile = path.join(extensionDir, 'issue-technical-context.js');
const portugueseCommonWordsSourceFile = path.join(rootDir, 'src', 'portugueseCommonWords.js');
const portugueseCommonWordsBrowserFile = path.join(extensionDir, 'portuguese-common-words.js');

const promptSharedFile = path.join(extensionDir, 'prompt-shared.js');

const requiredFiles = [
  'manifest.json',
  'background.js',
  'issue-technical-context.js',
  'portuguese-common-words.js',
  'popup.html',
  'popup.js',
  'prompt-shared.js',
  'prompt-templates.js',
  'prompt-template-diagnostic.js',
  'generated-project-env.js',
  'local-workspace.js',
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

function normalizeEnvPath(value) {
  return String(value || '').trim().replace(/\\/g, '/');
}

function readWorkspaceEnvSnapshot() {
  if (!fs.existsSync(envFile)) {
    return {
      WORKSPACE_ERP_BACKEND_DIR: '',
      WORKSPACE_MOBILE_FRONTEND_DIR: '',
      WORKSPACE_ERP_INCLUDE_DIR: '',
    };
  }

  const parsed = dotenv.parse(fs.readFileSync(envFile, 'utf-8'));
  return {
    WORKSPACE_ERP_BACKEND_DIR: normalizeEnvPath(parsed.WORKSPACE_ERP_BACKEND_DIR || parsed.WORKSPACE_BACKEND_DIR || ''),
    WORKSPACE_MOBILE_FRONTEND_DIR: normalizeEnvPath(parsed.WORKSPACE_MOBILE_FRONTEND_DIR || parsed.WORKSPACE_FRONTEND_DIR || ''),
    WORKSPACE_ERP_INCLUDE_DIR: normalizeEnvPath(parsed.WORKSPACE_ERP_INCLUDE_DIR || parsed.WORKSPACE_INCLUDE_DIR || ''),
  };
}

function writeGeneratedProjectEnv(values) {
  const snapshot = {
    source: '.env (snapshot gerado no build da extensao)',
    generatedAt: new Date().toISOString(),
    projectRootDir: normalizeEnvPath(rootDir),
    values,
  };

  const fileContent = [
    '(function initShieldGeneratedProjectEnv(globalScope) {',
    '  const scope = globalScope || globalThis;',
    '  const root = scope.SHIELD || (scope.SHIELD = {});',
    '',
    `  root.generatedProjectEnv = ${JSON.stringify(snapshot, null, 2)};`,
    '}(typeof globalThis !== \'undefined\' ? globalThis : this));',
    '',
  ].join('\n');

  fs.writeFileSync(generatedProjectEnvFile, fileContent, 'utf-8');
}

function writeGeneratedIssueTechnicalContext() {
  const source = fs.readFileSync(technicalContextSourceFile, 'utf-8');
  const browserSource = [
    '// Gerado automaticamente por scripts/build-extension.js - nao editar manualmente.',
    '// Fonte: src/issueTechnicalContext.js',
    '(function initShieldIssueTechnicalContext(globalScope) {',
    '  const scope = globalScope || globalThis;',
    '  const root = scope.SHIELD || (scope.SHIELD = {});',
    '',
    source.replace(/^export\s+/gmu, ''),
    '',
    '  root.issueTechnicalContext = {',
    '    TECHNICAL_CONTEXT_VERSION,',
    '    extractIssueTechnicalContext,',
    '    flattenTechnicalReferences,',
    '    formatLineRanges,',
    '    extractSearchTerms,',
    '    scoreTextLines,',
    '    scorePath,',
    '    correlateTechnicalContextWithFiles,',
    '    buildTechnicalContextTextSection,',
    '    buildTechnicalContextPromptSection,',
    '  };',
    '}(typeof globalThis !== \'undefined\' ? globalThis : this));',
    '',
  ].join('\n');

  fs.writeFileSync(technicalContextBrowserFile, browserSource, 'utf-8');
}

function writeGeneratedPortugueseCommonWords() {
  const source = fs.readFileSync(portugueseCommonWordsSourceFile, 'utf-8');
  const browserSource = [
    '// Gerado automaticamente por scripts/build-extension.js - nao editar manualmente.',
    '// Fonte: src/portugueseCommonWords.js',
    '(function initShieldPortugueseCommonWords(globalScope) {',
    '  const scope = globalScope || globalThis;',
    '  const root = scope.SHIELD || (scope.SHIELD = {});',
    '',
    source.replace(/^export\s+/gmu, ''),
    '',
    '  root.portugueseCommonWords = {',
    '    PORTUGUESE_COMMON_WORDS_SOURCE,',
    '    PORTUGUESE_COMMON_WORDS_VERSION,',
    '    PORTUGUESE_COMMON_WORDS_COUNT,',
    '    PORTUGUESE_COMMON_WORDS,',
    '  };',
    '}(typeof globalThis !== \'undefined\' ? globalThis : this));',
    '',
  ].join('\n');

  fs.writeFileSync(portugueseCommonWordsBrowserFile, browserSource, 'utf-8');
}

assertFileExists(sourceFile, `jsPDF nao encontrado em ${sourceFile}. Rode "npm install" antes.`);
assertFileExists(technicalContextSourceFile, `Modulo compartilhado nao encontrado: ${technicalContextSourceFile}`);
assertFileExists(portugueseCommonWordsSourceFile, `Modulo compartilhado nao encontrado: ${portugueseCommonWordsSourceFile}`);

if (!fs.existsSync(envFile)) {
  if (fs.existsSync(envExampleFile)) {
    fs.copyFileSync(envExampleFile, envFile);
    console.log('.env criado automaticamente a partir do .env.example — edite os valores antes de usar.');
  } else {
    console.log('.env nao encontrado e .env.example tambem nao existe — prosseguindo sem snapshot de workspace.');
  }
}

writeGeneratedProjectEnv(readWorkspaceEnvSnapshot());
writeGeneratedIssueTechnicalContext();
writeGeneratedPortugueseCommonWords();

fs.writeFileSync(
  promptSharedFile,
  [
    '// Gerado automaticamente por scripts/build-extension.js — nao editar manualmente.',
    '// Fonte: src/diagnosticPromptBase.js',
    '(function initShieldPromptShared(globalScope) {',
    '  var root = (globalScope || globalThis).SHIELD || ((globalScope || globalThis).SHIELD = {});',
    `  root.promptShared = ${JSON.stringify({
      PERSONA: DIAGNOSTIC_PERSONA,
      CORE_CONSTRAINTS: DIAGNOSTIC_CORE_CONSTRAINTS,
      OUTPUT_INTRO: DIAGNOSTIC_OUTPUT_INTRO,
      OUTPUT_SECTIONS: DIAGNOSTIC_OUTPUT_SECTIONS,
    }, null, 2)};`,
    '}(typeof globalThis !== \'undefined\' ? globalThis : this));',
    '',
  ].join('\n'),
  'utf-8',
);
console.log(`Gerado: ${promptSharedFile}`);
console.log(`Gerado: ${technicalContextBrowserFile}`);
console.log(`Gerado: ${portugueseCommonWordsBrowserFile}`);

for (const rel of requiredFiles) {
  assertFileExists(path.join(extensionDir, rel), `Arquivo obrigatorio da extensao nao encontrado: chrome-extension/${rel}`);
}

fs.mkdirSync(vendorDir, { recursive: true });
fs.copyFileSync(sourceFile, targetFile);

const manifest = JSON.parse(fs.readFileSync(path.join(extensionDir, 'manifest.json'), 'utf-8'));

console.log(`Chrome extension pronta em ${extensionDir}`);
console.log(`Manifest: ${manifest.name} v${manifest.version}`);
console.log(`Dependencia copiada: ${targetFile}`);
console.log(`Snapshot do .env gerado em: ${generatedProjectEnvFile}`);
console.log('Para usar no Chrome: chrome://extensions -> Developer mode -> Load unpacked -> chrome-extension');
