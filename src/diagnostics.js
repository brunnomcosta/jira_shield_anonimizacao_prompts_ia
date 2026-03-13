#!/usr/bin/env node
/**
 * diagnostics.js — Diagnóstico automático de qualidade de anonimização LGPD
 *
 * Uso:
 *   node src/diagnostics.js [caminho-para-pdf]
 *   npm run diagnose [-- caminho-para-pdf]
 *
 * Se nenhum PDF for informado, usa o mais recente em ./output/
 *
 * Saída:
 *   - Relatório impresso no terminal
 *   - output/diagnostic_<timestamp>.md
 */

import { fileURLToPath } from 'url';
import { dirname, resolve, join, basename, extname } from 'path';
import dotenv from 'dotenv';
import {
  DIAGNOSTIC_PERSONA,
  DIAGNOSTIC_CORE_CONSTRAINTS,
  DIAGNOSTIC_OUTPUT_INTRO,
  DIAGNOSTIC_OUTPUT_SECTIONS,
} from './diagnosticPromptBase.js';
import {
  buildTechnicalContextPromptSection,
  correlateTechnicalContextWithFiles,
  extractSearchTerms as extractIssueSearchTerms,
  flattenTechnicalReferences,
  scorePath as scoreIssueSearchPath,
  scoreTextLines as scoreIssueSearchTextLines,
} from './issueTechnicalContext.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ENV_FILE_PATH = resolve(__dirname, '..', '.env');
dotenv.config({ path: ENV_FILE_PATH });

import fs from 'fs';
import os from 'os';
import readline from 'readline';
import { spawn } from 'child_process';
import { createRequire } from 'module';
import Anthropic from '@anthropic-ai/sdk';
import { maskSensitiveText, sanitizeStructuredData } from './sensitiveTextSanitizer.js';

const require = createRequire(import.meta.url);
const pdfParse = require('pdf-parse');

// ─── Configuração ────────────────────────────────────────────────────────────

const OUTPUT_DIR = resolve(__dirname, '..', process.env.OUTPUT_DIR || './output');
const SRC_DIR    = resolve(__dirname);
const ENV_ALIASES = {
  WORKSPACE_ERP_BACKEND_DIR: ['WORKSPACE_ERP_BACKEND_DIR', 'WORKSPACE_BACKEND_DIR'],
  WORKSPACE_MOBILE_FRONTEND_DIR: ['WORKSPACE_MOBILE_FRONTEND_DIR', 'WORKSPACE_FRONTEND_DIR'],
  WORKSPACE_ERP_INCLUDE_DIR: ['WORKSPACE_ERP_INCLUDE_DIR', 'WORKSPACE_INCLUDE_DIR'],
  JIRA_TOKEN: ['JIRA_TOKEN'],
};

const RUNTIME_CONFIG_ITEMS = [
  {
    key: 'WORKSPACE_ERP_BACKEND_DIR',
    label: 'Workspace ERP',
    question: 'Deseja informar agora o diretório do workspace ERP / back-end?',
    input: 'Informe o caminho do workspace ERP / back-end: ',
    kind: 'path',
  },
  {
    key: 'WORKSPACE_MOBILE_FRONTEND_DIR',
    label: 'Workspace App mobile',
    question: 'Deseja informar agora o diretório do app mobile / front-end?',
    input: 'Informe o caminho do app mobile / front-end: ',
    kind: 'path',
  },
  {
    key: 'WORKSPACE_ERP_INCLUDE_DIR',
    label: 'Includes do ERP',
    question: 'Deseja informar agora o diretório dos includes do ERP?',
    input: 'Informe o caminho do diretório de includes do ERP: ',
    kind: 'path',
  },
  {
    key: 'JIRA_TOKEN',
    label: 'Token Jira',
    question: 'Deseja informar agora o JIRA_TOKEN?',
    input: 'Cole o JIRA_TOKEN: ',
    kind: 'token',
  },
];

function getEnvValue(name) {
  const aliases = ENV_ALIASES[name] || [name];
  for (const alias of aliases) {
    const value = String(process.env[alias] || '').trim();
    if (value) return value;
  }
  return '';
}

function resolveOptionalEnvPath(name) {
  const raw = getEnvValue(name);
  return raw ? resolve(raw) : null;
}

function getWorkspaceErpBackendDir() {
  return resolveOptionalEnvPath('WORKSPACE_ERP_BACKEND_DIR');
}

function getWorkspaceMobileFrontendDir() {
  return resolveOptionalEnvPath('WORKSPACE_MOBILE_FRONTEND_DIR');
}

function getWorkspaceErpIncludeDir() {
  return resolveOptionalEnvPath('WORKSPACE_ERP_INCLUDE_DIR');
}

function isDirectoryPath(value) {
  try {
    return fs.statSync(value).isDirectory();
  } catch {
    return false;
  }
}

function normalizePersistedEnvValue(key, value) {
  const clean = String(value || '').trim();
  if (!clean) return clean;
  if (key.startsWith('WORKSPACE_')) {
    return resolve(clean).replace(/\\/g, '/');
  }
  return clean;
}

function quoteEnvValue(value) {
  if (!/[\s#"]/u.test(value)) return value;
  return `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}

function setRuntimeEnvValue(key, value) {
  const normalized = normalizePersistedEnvValue(key, value);
  process.env[key] = normalized;
  return normalized;
}

function upsertEnvFileValue(key, value) {
  const normalized = normalizePersistedEnvValue(key, value);
  const aliases = [...new Set([key, ...(ENV_ALIASES[key] || [])])];
  const assignment = `${key}=${quoteEnvValue(normalized)}`;
  const lines = fs.existsSync(ENV_FILE_PATH)
    ? fs.readFileSync(ENV_FILE_PATH, 'utf-8').split(/\r?\n/)
    : [];

  let replaced = false;
  const nextLines = [];
  for (const line of lines) {
    const matchesAlias = aliases.some((alias) => new RegExp(`^\\s*#?\\s*${alias}\\s*=`).test(line));
    if (!matchesAlias) {
      nextLines.push(line);
      continue;
    }
    if (!replaced) {
      nextLines.push(assignment);
      replaced = true;
    }
  }

  if (!replaced) {
    while (nextLines.length > 0 && nextLines[nextLines.length - 1] === '') nextLines.pop();
    if (nextLines.length > 0) nextLines.push('');
    nextLines.push(assignment);
  }

  fs.writeFileSync(ENV_FILE_PATH, `${nextLines.join(os.EOL)}${os.EOL}`, 'utf-8');
  return normalized;
}

function maskValueForDisplay(key, value) {
  if (key === 'JIRA_TOKEN') return '<oculto>';
  return value;
}

function describeCurrentConfigValue(item) {
  if (item.key === 'JIRA_TOKEN') {
    if (hasJiraAuthConfigured()) return 'credenciais Jira já configuradas';
    return 'não configurado';
  }

  const current = getEnvValue(item.key);
  if (!current) return 'não configurado';

  const resolved = resolve(current);
  if (!isDirectoryPath(resolved)) return `${resolved} (inválido ou inexistente)`;
  return resolved;
}

function validateRuntimeConfigValue(item, value) {
  const clean = String(value || '').trim();
  if (!clean) {
    return { ok: false, message: 'Valor vazio.' };
  }

  if (item.kind === 'token') {
    if (!hasValue(clean, ['seu_token_pessoal_aqui', 'seu_token_aqui']) || clean.length < 12) {
      return { ok: false, message: 'Informe um token Jira válido.' };
    }
    return { ok: true, normalized: clean };
  }

  const normalized = normalizePersistedEnvValue(item.key, clean);
  if (!isDirectoryPath(normalized)) {
    return { ok: false, message: 'Diretório não encontrado.' };
  }
  return { ok: true, normalized };
}

function askQuestion(rl, question) {
  return new Promise((resolve) => rl.question(question, (answer) => resolve(answer)));
}

function canRunInteractiveSetup() {
  return !!(process.stdin.isTTY && process.stdout.isTTY);
}

function getRuntimeConfigurationRequests() {
  const requests = [];

  for (const item of RUNTIME_CONFIG_ITEMS) {
    if (item.key === 'JIRA_TOKEN') {
      if (!hasJiraAuthConfigured()) requests.push(item);
      continue;
    }

    const current = getEnvValue(item.key);
    if (!current || !isDirectoryPath(resolve(current))) {
      requests.push(item);
    }
  }

  return requests;
}

async function persistRuntimeConfiguration(item, value) {
  const normalized = upsertEnvFileValue(item.key, value);
  setRuntimeEnvValue(item.key, normalized);

  console.log(`   ${c.gray}-> Atualizando .env: ${item.key}=${maskValueForDisplay(item.key, normalized)}${c.reset}`);

  if (process.platform !== 'win32') {
    console.log(`   ${c.gray}-> Ambiente do usuário não alterado automaticamente fora do Windows${c.reset}`);
    return;
  }

  const displayedValue = maskValueForDisplay(item.key, normalized);
  console.log(`   ${c.gray}-> Comando: setx ${item.key} ${displayedValue}${c.reset}`);

  await new Promise((resolvePromise, reject) => {
    const child = spawn('setx', [item.key, normalized], { windowsHide: true });
    let stdout = '';
    let stderr = '';

    child.stdout.on('data', (chunk) => {
      stdout += String(chunk);
    });
    child.stderr.on('data', (chunk) => {
      stderr += String(chunk);
    });
    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) {
        resolvePromise();
        return;
      }
      reject(new Error((stderr || stdout || `setx finalizou com código ${code}`).trim()));
    });
  });
}

async function maybeCollectRuntimeConfiguration() {
  if (!canRunInteractiveSetup()) return;

  const requests = getRuntimeConfigurationRequests();
  if (requests.length === 0) return;

  console.log(`${c.bold}${c.yellow}┌─────────────────────────────────────────────────────────────┐`);
  console.log(`│  ⚙️  Configuração inicial do diagnostics.js                 │`);
  console.log(`└─────────────────────────────────────────────────────────────┘${c.reset}`);
  console.log();
  console.log('  Itens ausentes ou inválidos podem ser preenchidos agora.');
  console.log(`  ${c.gray}Os valores confirmados são gravados no .env e no ambiente do usuário do Windows.${c.reset}`);
  console.log();

  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

  try {
    for (const item of requests) {
      console.log(`  ${c.yellow}• ${item.label}${c.reset}`);
      console.log(`    Atual: ${c.gray}${describeCurrentConfigValue(item)}${c.reset}`);

      const proceed = (await askQuestion(rl, `    ${item.question} ${c.bold}[s/N]${c.reset} `)).trim().toLowerCase() === 's';
      if (!proceed) {
        console.log(`    ${c.gray}-> Mantido sem alteração${c.reset}`);
        console.log();
        continue;
      }

      while (true) {
        const raw = await askQuestion(rl, `    ${item.input}`);
        if (!String(raw || '').trim()) {
          console.log(`    ${c.gray}-> Preenchimento cancelado para ${item.label}${c.reset}`);
          break;
        }
        const validation = validateRuntimeConfigValue(item, raw);
        if (!validation.ok) {
          console.log(`    ${c.red}${validation.message}${c.reset}`);
          console.log(`    ${c.gray}-> Enter vazio cancela este item${c.reset}`);
          continue;
        }

        try {
          await persistRuntimeConfiguration(item, validation.normalized);
          console.log(`    ${c.green}OK${c.reset} ${item.label} salvo para a execução atual e para os próximos terminais.`);
        } catch (err) {
          console.log(`    ${c.red}Falha ao persistir ${item.label}: ${err.message}${c.reset}`);
        }
        break;
      }
      console.log();
    }
  } finally {
    rl.close();
  }
}

// Extensões de arquivo aceitas para leitura do workspace
const WORKSPACE_EXTENSIONS = (process.env.WORKSPACE_EXTENSIONS || 'js,ts,java,py,cs,go,kt,jsx,tsx,vue,rb,php,prx,prw,tlpp')
  .split(',').map(e => `.${e.trim().toLowerCase()}`);

const INCLUDE_AWARE_EXTENSIONS = new Set(['.prx', '.prw', '.tlpp']);
const WORKSPACE_INCLUDE_EXTENSIONS = ['.ch', '.h', '.hh', '.hpp', '.inc', '.tlpp', '.prw', '.prx'];

// Diretórios ignorados no scan recursivo
const IGNORE_DIRS = new Set([
  'node_modules', '.git', 'target', 'dist', 'build', '.next', '.nuxt',
  '__pycache__', 'vendor', '.gradle', '.mvn', 'coverage', '.cache',
  'out', '.idea', '.vscode', 'bin', 'obj',
]);

const PIPELINE_SOURCE_FILES = [
  { key: 'anonymizer', filename: 'anonymizer.js', ref: 'src/anonymizer.js' },
  { key: 'nerDetector', filename: 'nerDetector.js', ref: 'src/nerDetector.js' },
  { key: 'entityMap', filename: 'entityMap.js', ref: 'src/entityMap.js' },
  { key: 'signatureExtractor', filename: 'signatureExtractor.js', ref: 'src/signatureExtractor.js' },
  { key: 'contextualExtractor', filename: 'contextualExtractor.js', ref: 'src/contextualExtractor.js' },
];

const LLM_PROVIDER_LABELS = {
  claude: 'claude CLI',
  codex: 'codex CLI',
  copilot: 'GitHub Copilot',
  anthropic: 'Anthropic API key',
};

const DEFAULT_LLM_PROVIDER_ORDER = ['claude', 'codex', 'copilot', 'anthropic'];
const LLM_PROVIDER_ORDER = parseLLMProviderOrder(process.env.LLM_PROVIDER_ORDER);

const LLM_PROGRESS_INTERVAL_MS = 15000;
const LLM_PROVIDER_TIMEOUT_MS = 5 * 60 * 1000;
const TARGET_LLM_PROMPT_CHARS = 32000;
const WORKSPACE_PROMPT_LIMITS = {
  backendChars: 9000,
  frontendChars: 4500,
  backendFiles: 6,
  frontendFiles: 4,
};
const WORKSPACE_PROMPT_LIMITS_ULTRA = {
  backendChars: 3000,
  frontendChars: 1500,
  backendFiles: 2,
  frontendFiles: 1,
};

// ─── Cores para o terminal ───────────────────────────────────────────────────

const c = {
  reset:  '\x1b[0m',
  bold:   '\x1b[1m',
  green:  '\x1b[32m',
  yellow: '\x1b[33m',
  red:    '\x1b[31m',
  cyan:   '\x1b[36m',
  gray:   '\x1b[90m',
  blue:   '\x1b[34m',
};

const MOBILE_FRONTEND_HINTS = [
  { rx: /\bminha produ[cç][aã]o\b/i, weight: 4, label: 'Minha Producao' },
  { rx: /\bapp(?:licativo)?\s+mobile\b/i, weight: 4, label: 'app mobile' },
  { rx: /\bmobile\b/i, weight: 3, label: 'mobile' },
  { rx: /\bcelular\b/i, weight: 3, label: 'celular' },
  { rx: /\btablet\b/i, weight: 3, label: 'tablet' },
  { rx: /\bsmartphone\b/i, weight: 3, label: 'smartphone' },
  { rx: /\bandroid\b/i, weight: 3, label: 'Android' },
  { rx: /\bios\b/i, weight: 3, label: 'iOS' },
  { rx: /\bionic\b/i, weight: 2, label: 'Ionic' },
  { rx: /\bapk\b/i, weight: 2, label: 'APK' },
  { rx: /\bplay store\b/i, weight: 2, label: 'Play Store' },
  { rx: /\bapp\b/i, weight: 1, label: 'app' },
];

// ─── Mapeamento de tipos de problema → arquivo:linha ─────────────────────────

const SOURCE_MAP = {
  leaked_email: {
    file: 'src/nerDetector.js',
    lines: '8',
    description: 'Padrão EMAIL — PATTERNS[0] na função anonymizePatterns()',
  },
  leaked_cpf: {
    file: 'src/nerDetector.js',
    lines: '9',
    description: 'Padrão CPF — PATTERNS[1] na função anonymizePatterns()',
  },
  leaked_cnpj: {
    file: 'src/nerDetector.js',
    lines: '10',
    description: 'Padrão CNPJ — PATTERNS[2] na função anonymizePatterns()',
  },
  leaked_phone: {
    file: 'src/nerDetector.js',
    lines: '11',
    description: 'Padrão TELEFONE — PATTERNS[3] na função anonymizePatterns()',
  },
  leaked_cep: {
    file: 'src/nerDetector.js',
    lines: '12',
    description: 'Padrão CEP — PATTERNS[4] na função anonymizePatterns()',
  },
  leaked_password: {
    file: 'src/nerDetector.js',
    lines: '25',
    description: 'Padrão SENHA/CREDENCIAL — senha, password, api_key, token, secret, etc. seguido de valor não anonimizado',
  },
  leaked_url_usuario: {
    file: 'src/nerDetector.js',
    lines: '28',
    description: 'URL com segmento de usuário — /users/, /profile/, /perfil/, /u/ com identificador',
  },
  leaked_name_pessoa: {
    file: 'src/entityMap.js',
    lines: 'registerPessoa() + applyToText()',
    description: 'Nome de pessoa não minerado na Fase 1 ou não aplicado na Fase 2',
  },
  leaked_name_empresa: {
    file: 'src/entityMap.js',
    lines: 'registerEmpresa() + applyToText()',
    description: 'Nome de empresa não minerado na Fase 1 ou não aplicado na Fase 2',
  },
  broken_token: {
    file: 'src/entityMap.js',
    lines: 'registerPessoa() / registerEmpresa()',
    description: 'Token gerado com colchete não fechado ou numeração inválida',
  },
  fallback_token: {
    file: 'src/entityMap.js',
    lines: 'getPessoa() / getEmpresa()',
    description: 'Token de fallback [PESSOA-?] — nome presente no structured field mas não registrado via registerPessoa()',
  },
  missed_signature: {
    file: 'src/signatureExtractor.js',
    lines: 'SIGNATURE_OPENERS + extractSignatureBlock()',
    description: 'Bloco de assinatura não detectado — palavra-chave de abertura ausente em SIGNATURE_OPENERS',
  },
  missed_contextual: {
    file: 'src/contextualExtractor.js',
    lines: 'GATILHOS_PESSOA / GATILHOS_EMPRESA + extractContextualEntities()',
    description: 'Entidade contextual não detectada — palavra-gatilho ausente na lista de gatilhos',
  },
  phase1_gap: {
    file: 'src/anonymizer.js',
    lines: 'Fase 1 — mineração de entidades (~linhas 36-81)',
    description: 'Entidade presente no texto mas não minerada — falha na orquestração da Fase 1',
  },
  phase2_gap: {
    file: 'src/anonymizer.js',
    lines: 'process() — Fase 2 (~linha 85)',
    description: 'Entidade minerada mas não substituída — falha no pipeline process() da Fase 2',
  },
};

// ─── Funções ─────────────────────────────────────────────────────────────────

/**
 * Resolve o caminho do PDF a partir de:
 *   - chave de issue (ex: DMANQUALI-12311) → procura <ISSUE_KEY>_LGPD_anonimizado.pdf em OUTPUT_DIR
 *   - caminho de arquivo explícito           → valida existência diretamente
 *   - sem argumento                          → usa o PDF mais recente em OUTPUT_DIR
 *
 * Retorna { pdfPath, issueKey }
 */
function resolvePdf(arg) {
  if (!fs.existsSync(OUTPUT_DIR)) {
    throw new Error(`Diretório de saída não encontrado: ${OUTPUT_DIR}\nGere um PDF primeiro com: node src/index.js <ISSUE_KEY>`);
  }

  // Argumento parece uma chave de issue (ex: PROJ-123, DMANQUALI-12311)
  if (arg && /^[A-Z][A-Z0-9_]+-\d+$/i.test(arg)) {
    const issueKey = arg.toUpperCase();
    const filename = `${issueKey}_LGPD_anonimizado.pdf`;
    const pdfPath  = join(OUTPUT_DIR, filename);
    if (!fs.existsSync(pdfPath)) {
      throw new Error(
        `PDF não encontrado para ${issueKey}: ${pdfPath}\n` +
        `Gere-o primeiro com: node src/index.js ${issueKey}`
      );
    }
    return { pdfPath, issueKey };
  }

  // Argumento é um caminho de arquivo explícito
  if (arg) {
    const pdfPath = resolve(arg);
    if (!fs.existsSync(pdfPath)) {
      throw new Error(`Arquivo não encontrado: ${pdfPath}`);
    }
    // Tenta extrair a issue key do nome do arquivo
    const match = basename(pdfPath).match(/^([A-Z][A-Z0-9_]+-\d+)/i);
    return { pdfPath, issueKey: match ? match[1].toUpperCase() : null };
  }

  // Sem argumento: PDF mais recente em OUTPUT_DIR
  const pdfs = fs.readdirSync(OUTPUT_DIR)
    .filter(f => f.endsWith('.pdf'))
    .map(f => ({ path: join(OUTPUT_DIR, f), mtime: fs.statSync(join(OUTPUT_DIR, f)).mtimeMs }))
    .sort((a, b) => b.mtime - a.mtime);

  if (pdfs.length === 0) {
    throw new Error(`Nenhum PDF encontrado em ${OUTPUT_DIR}\nGere um PDF primeiro com: node src/index.js <ISSUE_KEY>`);
  }

  const pdfPath = pdfs[0].path;
  const match   = basename(pdfPath).match(/^([A-Z][A-Z0-9_]+-\d+)/i);
  return { pdfPath, issueKey: match ? match[1].toUpperCase() : null };
}

function prepareManagedPrompt({ mode, sections, findings, sourceFiles, metadata, pdfPath, numpages, workspace }) {
  if (mode === 'business') {
    const promptPlan = {
      mode: 'Negócio',
      mainLimit: 6000,
      zendeskLimit: 2000,
      sourceFileLimit: null,
      compacted: false,
    };
    const initialPrompt = buildBusinessPrompt(sections, metadata, pdfPath, numpages, workspace);
    if (initialPrompt.length <= TARGET_LLM_PROMPT_CHARS) {
      console.log(`   ${c.gray}↳ Prompt business pronto com ${initialPrompt.length.toLocaleString()} chars${c.reset}`);
      return { prompt: initialPrompt, workspace, ...promptPlan, promptLength: initialPrompt.length };
    }

    const compactWorkspace = compactWorkspaceForLLM(workspace, 'business (modo compacto)', {
      backendChars: 6500,
      frontendChars: 2800,
      backendFiles: 4,
      frontendFiles: 2,
    });
    const compactPrompt = buildBusinessPrompt(
      sections,
      metadata,
      pdfPath,
      numpages,
      compactWorkspace,
      { mainLimit: 3600, zendeskLimit: 1200 }
    );
    console.log(
      `   ${c.gray}↳ Prompt business compactado: ${initialPrompt.length.toLocaleString()} → ` +
      `${compactPrompt.length.toLocaleString()} chars${c.reset}`
    );
    if (compactPrompt.length <= TARGET_LLM_PROMPT_CHARS) {
      return {
        prompt: compactPrompt,
        workspace: compactWorkspace,
        ...promptPlan,
        mainLimit: 3600,
        zendeskLimit: 1200,
        compacted: true,
        promptLength: compactPrompt.length,
      };
    }

    const ultraWorkspace = compactWorkspaceForLLM(workspace, 'business (tier 3 ultra-compacto)', WORKSPACE_PROMPT_LIMITS_ULTRA);
    const ultraPrompt = buildBusinessPrompt(sections, metadata, pdfPath, numpages, ultraWorkspace, { mainLimit: 1800, zendeskLimit: 600 });
    console.warn(
      `   ${c.yellow}⚠ Prompt business ainda excede limite após tier 2 (${compactPrompt.length.toLocaleString()} chars). ` +
      `Tier 3: ${ultraPrompt.length.toLocaleString()} chars${c.reset}`
    );
    return {
      prompt: ultraPrompt,
      workspace: ultraWorkspace,
      ...promptPlan,
      mainLimit: 1800,
      zendeskLimit: 600,
      compacted: true,
      promptLength: ultraPrompt.length,
    };
  }

  const promptPlan = {
    mode: 'LGPD',
    mainLimit: 5000,
    zendeskLimit: 1500,
    sourceFileLimit: null,
    compacted: false,
  };
  const initialPrompt = buildClaudePrompt(sections, findings, sourceFiles, pdfPath, numpages, workspace);
  if (initialPrompt.length <= TARGET_LLM_PROMPT_CHARS) {
    console.log(`   ${c.gray}↳ Prompt LGPD pronto com ${initialPrompt.length.toLocaleString()} chars${c.reset}`);
    return { prompt: initialPrompt, workspace, ...promptPlan, promptLength: initialPrompt.length };
  }

  const compactWorkspace = compactWorkspaceForLLM(workspace, 'LGPD (modo compacto)', {
    backendChars: 6000,
    frontendChars: 2400,
    backendFiles: 4,
    frontendFiles: 2,
  });
  const compactPrompt = buildClaudePrompt(
    sections,
    findings,
    sourceFiles,
    pdfPath,
    numpages,
    compactWorkspace,
    { mainLimit: 3200, zendeskLimit: 1000, sourceFileLimit: 1800 }
  );
  console.log(
    `   ${c.gray}↳ Prompt LGPD compactado: ${initialPrompt.length.toLocaleString()} → ` +
    `${compactPrompt.length.toLocaleString()} chars${c.reset}`
  );
  if (compactPrompt.length <= TARGET_LLM_PROMPT_CHARS) {
    return {
      prompt: compactPrompt,
      workspace: compactWorkspace,
      ...promptPlan,
      mainLimit: 3200,
      zendeskLimit: 1000,
      sourceFileLimit: 1800,
      compacted: true,
      promptLength: compactPrompt.length,
    };
  }

  const ultraWorkspace = compactWorkspaceForLLM(workspace, 'LGPD (tier 3 ultra-compacto)', WORKSPACE_PROMPT_LIMITS_ULTRA);
  const ultraPrompt = buildClaudePrompt(sections, findings, sourceFiles, pdfPath, numpages, ultraWorkspace, { mainLimit: 1600, zendeskLimit: 500, sourceFileLimit: 900 });
  console.warn(
    `   ${c.yellow}⚠ Prompt LGPD ainda excede limite após tier 2 (${compactPrompt.length.toLocaleString()} chars). ` +
    `Tier 3: ${ultraPrompt.length.toLocaleString()} chars${c.reset}`
  );
  return {
    prompt: ultraPrompt,
    workspace: ultraWorkspace,
    ...promptPlan,
    mainLimit: 1600,
    zendeskLimit: 500,
    sourceFileLimit: 900,
    compacted: true,
    promptLength: ultraPrompt.length,
  };
}

/**
 * Extrai o texto de um PDF usando pdf-parse.
 */
async function extractPdfText(pdfPath) {
  const buffer = fs.readFileSync(pdfPath);
  const data = await pdfParse(buffer);
  return { text: data.text || '', numpages: data.numpages || 0 };
}

/**
 * Varredura local de PII — espelha os padrões de nerDetector.js.
 * Retorna findings[] com os problemas detectados no texto do PDF.
 */
function localDetect(text) {
  const findings = [];

  // Padrões PII — espelham nerDetector.js (manter sincronizado)
  const PII_PATTERNS = [
    {
      type: 'leaked_email',
      rx: /[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}/g,
      severity: 'critical',
    },
    {
      type: 'leaked_cpf',
      rx: /\b\d{3}\.?\d{3}\.?\d{3}[-–]?\d{2}\b/g,
      severity: 'critical',
    },
    {
      type: 'leaked_cnpj',
      rx: /\b\d{2}\.?\d{3}\.?\d{3}\/?\.?\d{4}[-–]?\d{2}\b/g,
      severity: 'critical',
    },
    {
      type: 'leaked_phone',
      rx: /\(?\d{2}\)?\s?\d{4,5}[-–\s]?\d{4}\b/g,
      severity: 'warning',
    },
    {
      type: 'leaked_phone',
      rx: /\+\d{1,3}[\s\-]?\(?\d{2}\)?[\s\-]?\d{4,5}[\s\-]?\d{4}\b/g,
      severity: 'warning',
    },
    {
      type: 'leaked_cep',
      rx: /\b\d{5}[-–]\d{3}\b/g,
      severity: 'warning',
    },
    {
      type: 'leaked_password',
      rx: /\b(?:senha|password|passwd|pwd|pass|api[-_]?key|apikey|secret(?:[-_]key)?|client[-_]secret|access[-_]token|auth[-_]token|bearer[-_]token|private[-_]key)(?:[ \t]+[A-Za-zÀ-ÿ0-9_.\/-]{2,}){0,3}[ \t]*[:=][ \t]*\S+/gi,
      severity: 'critical',
    },
    {
      type: 'leaked_url_usuario',
      rx: /https?:\/\/[^\s/]+\/(?:users?|perfil|profile|u|account|conta)\/[\w.%@+\-]{2,}/gi,
      severity: 'warning',
    },
  ];

  for (const { type, rx, severity } of PII_PATTERNS) {
    rx.lastIndex = 0;
    const matches = [...text.matchAll(rx)].map(m => m[0]);
    if (matches.length > 0) {
      const unique = [...new Set(matches)];
      findings.push({
        type,
        severity,
        matches: unique.slice(0, 5),
        count: matches.length,
        sourceRef: SOURCE_MAP[type],
      });
    }
  }

  // Tokens quebrados (colchete aberto sem fechamento)
  const brokenRx = /\[(?:PESSOA|EMPRESA|EMAIL|CPF|CNPJ|TELEFONE|CEP)[^\]]{0,25}(?!\])/g;
  const brokenMatches = [...text.matchAll(brokenRx)].map(m => m[0]);
  if (brokenMatches.length > 0) {
    findings.push({
      type: 'broken_token',
      severity: 'warning',
      matches: [...new Set(brokenMatches)].slice(0, 5),
      count: brokenMatches.length,
      sourceRef: SOURCE_MAP['broken_token'],
    });
  }

  // Tokens de fallback [PESSOA-?] ou [EMPRESA-?]
  const fallbackRx = /\[(?:PESSOA|EMPRESA)-\?\]/g;
  const fallbackMatches = [...text.matchAll(fallbackRx)].map(m => m[0]);
  if (fallbackMatches.length > 0) {
    findings.push({
      type: 'fallback_token',
      severity: 'warning',
      matches: [...new Set(fallbackMatches)].slice(0, 5),
      count: fallbackMatches.length,
      sourceRef: SOURCE_MAP['fallback_token'],
    });
  }

  // Verificação de densidade de tokens (possível super-anonimização)
  const tokenRx = /\[(?:PESSOA|EMPRESA)-\d+\]/g;
  const tokenCount = (text.match(tokenRx) || []).length;
  const wordCount = text.split(/\s+/).filter(Boolean).length;
  if (tokenCount > 0 && wordCount > 0) {
    const density = tokenCount / wordCount;
    if (density > 0.15) {
      findings.push({
        type: 'high_token_density',
        severity: 'info',
        matches: [`${tokenCount} tokens em ${wordCount} palavras (${(density * 100).toFixed(1)}%)`],
        count: tokenCount,
        sourceRef: {
          file: 'src/entityMap.js + src/contextualExtractor.js',
          lines: 'applyToText() + extractContextualEntities()',
          description: 'Alta densidade de tokens pode indicar super-anonimização (falsos positivos)',
        },
      });
    }
  }

  return findings;
}

/**
 * Lê os arquivos-fonte relevantes para contexto no prompt do Claude.
 */
function readSourceFiles() {
  const result = {};
  for (const { key, filename } of PIPELINE_SOURCE_FILES) {
    const filePath = resolve(SRC_DIR, filename);
    try {
      result[key] = fs.readFileSync(filePath, 'utf-8');
    } catch {
      result[key] = `// Arquivo ${filename} não encontrado`;
    }
  }
  return result;
}

function detectMobileFrontendContext(pdfText, metadata = null) {
  const haystacks = [
    pdfText || '',
    metadata?.summary || '',
    (metadata?.labels || []).join(' '),
    (metadata?.components || []).join(' '),
    (metadata?.attachmentNames || []).join(' '),
    ...flattenTechnicalReferences(metadata?.technicalContext, ['modules', 'identifiers', 'sourceFiles'])
      .map((reference) => reference.value),
  ];

  let score = 0;
  const hits = [];

  for (const hint of MOBILE_FRONTEND_HINTS) {
    const matched = haystacks.some((value) => hint.rx.test(value));
    if (matched) {
      score += hint.weight;
      hits.push(hint.label);
    }
  }

  return {
    enabled: score >= 3,
    score,
    hits: [...new Set(hits)],
  };
}

function rankWorkspaceFileForPrompt(file) {
  let priority = file?.score || 0;
  if (file?.lineRanges?.length) priority += 1000;
  if ((file?.content || '').length < 120) priority -= 500;
  return priority;
}

function compactWorkspaceSide(files, { maxChars, maxFiles }) {
  const original = files || [];
  const eligible = original
    .filter((file) => (file?.content || '').trim().length > 0)
    .filter((file) => file.lineRanges?.length || (file.content || '').length >= 120)
    .sort((a, b) => rankWorkspaceFileForPrompt(b) - rankWorkspaceFileForPrompt(a));

  let chars = 0;
  const kept = [];

  for (const file of eligible) {
    const contentLength = file.content.length;
    const hitsLimit = kept.length >= maxFiles;
    const charsLimit = kept.length > 0 && chars + contentLength > maxChars;
    if (hitsLimit || charsLimit) continue;
    kept.push(file);
    chars += contentLength;
  }

  return {
    files: kept,
    stats: {
      original: original.length,
      kept: kept.length,
      dropped: original.length - kept.length,
      chars,
    },
  };
}

function compactWorkspaceForLLM(workspace, promptLabel, limits = WORKSPACE_PROMPT_LIMITS) {
  if (!workspace) return workspace;

  const backend = compactWorkspaceSide(workspace.backend, {
    maxChars: limits.backendChars,
    maxFiles: limits.backendFiles,
  });
  const frontend = compactWorkspaceSide(workspace.frontend, {
    maxChars: limits.frontendChars,
    maxFiles: limits.frontendFiles,
  });

  const changed =
    backend.stats.dropped > 0 ||
    frontend.stats.dropped > 0 ||
    backend.stats.chars + frontend.stats.chars > TARGET_LLM_PROMPT_CHARS;

  if (changed) {
    console.log(
      `   ${c.gray}↳ Janela de contexto ${promptLabel} compactada para o LLM: ` +
      `ERP ${backend.stats.original}→${backend.stats.kept}, ` +
      `mobile ${frontend.stats.original}→${frontend.stats.kept}${c.reset}`
    );
  }

  return {
    ...workspace,
    backend: backend.files,
    frontend: frontend.files,
    compaction: {
      backend: backend.stats,
      frontend: frontend.stats,
      changed,
    },
  };
}

/**
 * Caminha recursivamente em um diretório e retorna todos os arquivos-fonte.
 */
function walkDir(dir, results = [], allowedExtensions = WORKSPACE_EXTENSIONS) {
  let entries;
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return results; }

  for (const entry of entries) {
    if (entry.isDirectory()) {
      if (!IGNORE_DIRS.has(entry.name)) walkDir(join(dir, entry.name), results, allowedExtensions);
    } else if (entry.isFile()) {
      const entryExt = extname(entry.name).toLowerCase();
      if (!allowedExtensions || allowedExtensions.includes(entryExt)) {
        results.push(join(dir, entry.name));
      }
    }
  }
  return results;
}

function normalizeLookupPath(value) {
  return value.replace(/\\/g, '/').replace(/^\//, '').toLowerCase();
}

function buildIncludeIndex(dir) {
  if (!dir || !fs.existsSync(dir)) return null;

  const files = walkDir(dir, [], WORKSPACE_INCLUDE_EXTENSIONS);
  const byRelative = new Map();
  const byBasename = new Map();

  for (const filePath of files) {
    const rel = normalizeLookupPath(filePath.replace(dir, ''));
    const base = basename(filePath).toLowerCase();
    byRelative.set(rel, filePath);
    if (!byBasename.has(base)) byBasename.set(base, []);
    byBasename.get(base).push(filePath);
  }

  return {
    rootDir: dir,
    indexedFiles: files.length,
    byRelative,
    byBasename,
    contentCache: new Map(),
  };
}

function extractIncludeNames(content, maxLines = 80) {
  const includes = [];
  for (const line of content.split('\n').slice(0, maxLines)) {
    const match = line.match(/^\s*#include\s*[<"]([^">]+)[">]/i);
    if (match) includes.push(match[1].trim());
  }
  return [...new Set(includes)];
}

function resolveIncludeFile(includeName, includeIndex) {
  if (!includeIndex || !includeName) return null;

  const normalized = normalizeLookupPath(includeName);
  const directMatch = includeIndex.byRelative.get(normalized);
  if (directMatch) return directMatch;

  const suffix = `/${normalized}`;
  for (const [rel, filePath] of includeIndex.byRelative.entries()) {
    if (rel.endsWith(suffix)) return filePath;
  }

  const byName = includeIndex.byBasename.get(basename(includeName).toLowerCase()) || [];
  return byName[0] || null;
}

function getIncludeEntriesForFile(filePath, content, includeIndex, maxIncludes = 20, maxChars = 12000) {
  if (!includeIndex || !INCLUDE_AWARE_EXTENSIONS.has(extname(filePath).toLowerCase())) {
    return [];
  }

  const includeNames = extractIncludeNames(content).slice(0, maxIncludes);
  const entries = [];
  let consumedChars = 0;

  for (const includeName of includeNames) {
    const resolved = resolveIncludeFile(includeName, includeIndex);
    if (!resolved) continue;

    let includeContent = includeIndex.contentCache.get(resolved);
    if (includeContent === undefined) {
      try {
        includeContent = fs.readFileSync(resolved, 'utf-8');
      } catch {
        includeContent = null;
      }
      includeIndex.contentCache.set(resolved, includeContent);
    }
    if (!includeContent) continue;

    const remaining = maxChars - consumedChars;
    if (remaining <= 0) break;

    const rel = normalizeLookupPath(resolved.replace(includeIndex.rootDir, ''));
    const clippedContent = includeContent.length > remaining
      ? includeContent.slice(0, remaining)
      : includeContent;

    entries.push({ name: includeName, rel, content: clippedContent });
    consumedChars += clippedContent.length;
  }

  return entries;
}

/**
 * Escapa caracteres especiais de regex em uma string literal.
 */
function escapeRegex(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

const UPPERCASE_IDENTIFIER_STOP_WORDS = new Set([
  'API', 'APIS', 'APP', 'CLI', 'DB', 'ERP', 'HTTP', 'HTTPS', 'HTML', 'JSON',
  'JIRA', 'LGPD', 'LLM', 'PDF', 'PII', 'SQL', 'TXT', 'UI', 'URL', 'XML',
]);

const TECHNICAL_NAME_HINT_RX = /\b(?:user\s+function|static\s+function|function|method|class|fonte|source|programa|routine|rotina)\s+([A-Za-z_][A-Za-z0-9_.:-]{2,})/gi;

function normalizeTechnicalToken(value) {
  let normalized = String(value || '').trim();
  if (!normalized) return '';

  normalized = normalized
    .replace(/^[`'"]+|[`'"]+$/g, '')
    .replace(/[),;:]+$/g, '');

  const parenIndex = normalized.indexOf('(');
  if (parenIndex > 0) normalized = normalized.slice(0, parenIndex);

  return normalized.trim();
}

function addTechnicalToken(target, value, allowedExtensions = new Set()) {
  const normalized = normalizeTechnicalToken(value);
  if (!normalized || normalized.length < 3) return;

  target.add(normalized);

  const dotIndex = normalized.lastIndexOf('.');
  if (dotIndex <= 0) return;

  const ext = `.${normalized.slice(dotIndex + 1).toLowerCase()}`;
  if (allowedExtensions.size > 0 && !allowedExtensions.has(ext)) return;

  const stem = normalized.slice(0, dotIndex);
  if (stem.length >= 3) target.add(stem);
}

function isTechnicalArtifactToken(value, allowedExtensions = new Set()) {
  const normalized = normalizeTechnicalToken(value);
  if (!normalized || normalized.length < 3) return false;

  const dotIndex = normalized.lastIndexOf('.');
  if (dotIndex > 0) {
    const ext = `.${normalized.slice(dotIndex + 1).toLowerCase()}`;
    if (allowedExtensions.has(ext)) return true;
  }

  return (
    /[0-9]/.test(normalized) ||
    /[_.-]/.test(normalized) ||
    /[a-z][A-Z]/.test(normalized) ||
    /[A-Z]{2,}/.test(normalized) ||
    /^[A-Z]{3}$/i.test(normalized)
  );
}

function isHighSignalIdentifier(identifier) {
  const value = String(identifier || '').trim();
  if (!value) return false;

  return (
    /[0-9]/.test(value) ||
    /^[A-Z][A-Z0-9]{2,}$/.test(value) ||
    /^[A-Z][a-zA-Z0-9]{4,}[A-Z0-9][a-zA-Z0-9]*$/.test(value)
  );
}

function getIdentifierWeight(identifier) {
  return isHighSignalIdentifier(identifier) ? 8 : 5;
}

/**
 * Extrai termos de busca categorizados do texto do ticket.
 * Captura identificadores técnicos (camelCase, PascalCase, snake_case),
 * rotas de API, mensagens de erro e palavras-chave gerais.
 */
function extractSearchTerms(text) {
  const clean = text.replace(/\[[\w-]+\]/g, ''); // remove tokens LGPD
  const knownFileExtensions = new Set([
    ...WORKSPACE_EXTENSIONS,
    ...WORKSPACE_INCLUDE_EXTENSIONS,
  ]);

  const stopWords = new Set([
    'https', 'lgpd', 'issue', 'campo', 'email', 'texto', 'valor', 'false',
    'true', 'null', 'undefined', 'return', 'function', 'const', 'class',
    'import', 'export', 'public', 'private', 'static', 'void', 'string',
    'number', 'boolean', 'object', 'array', 'promise', 'async', 'await',
    'throw', 'catch', 'error', 'where', 'which', 'there', 'their', 'about',
  ]);

  // Identificadores camelCase (métodos/variáveis): recalcularParcelas, fetchTicket
  const camel = (clean.match(/\b[a-z][a-zA-Z0-9]{3,}\b/g) || [])
    .filter(w => /[A-Z]/.test(w)); // exige ao menos uma maiúscula interna

  // Identificadores PascalCase (classes/interfaces): ContractService, IssueKey
  const pascal = (clean.match(/\b[A-Z][a-zA-Z0-9]{3,}\b/g) || [])
    .filter((w) => /[A-Z0-9]/.test(w.slice(1)));

  // snake_case (colunas, campos, variáveis Python/Ruby): desconto_condicional
  const snake = (clean.match(/\b[a-z]{3,}(?:_[a-z]{2,}){1,}\b/g) || []);

  // SCREAMING_CASE (constantes, enums): MAX_RETRIES, STATUS_OPEN
  const screaming = (clean.match(/\b[A-Z]{2,}(?:_[A-Z0-9]{2,})+\b/g) || []);

  const upperAlnum = (clean.match(/\b[A-Z][A-Z0-9]{2,}\b/g) || [])
    .filter((w) => /\D/.test(w))
    .filter((w) => !UPPERCASE_IDENTIFIER_STOP_WORDS.has(w));

  // Rotas de API: /api/v1/contracts, /users/profile
  const routes = (clean.match(/\/[a-zA-Z0-9_\-]{2,}(?:\/[a-zA-Z0-9_\-]{2,})+/g) || []);

  // Palavras técnicas longas (sem ser identificadores compostos)
  const words = [...new Set(
    (clean.match(/\b[a-zA-Z]{6,}\b/g) || []).map(w => w.toLowerCase())
  )].filter(w => !stopWords.has(w));

  // Frases literais de mensagens do sistema — buscadas como substring nos fontes.
  // Captura strings entre aspas (simples ou duplas) com 10+ chars.
  const phraseSet = new Set();
  const qRx = /["']([^"'\n\r]{10,100})["']/g;
  let qm;
  while ((qm = qRx.exec(clean)) !== null) phraseSet.add(qm[1].trim());

  // Captura texto após palavras-chave de mensagens do sistema (PT e EN).
  const kwRx = /\b(?:erro|error|aviso|alerta|alert|mensagem|message|warning|warn|help|ajuda|exception|falha|fault|informa[cç][aã]o|instru[cç][aã]o)\s*[:\-–]\s*([^\n\r.]{10,100})/gi;
  let km;
  while ((km = kwRx.exec(clean)) !== null) phraseSet.add(km[1].trim());

  const phrases = [...phraseSet].filter(p => p.length >= 10).slice(0, 10);

  const namedArtifacts = new Set();
  let nm;
  while ((nm = TECHNICAL_NAME_HINT_RX.exec(clean)) !== null) {
    addTechnicalToken(namedArtifacts, nm[1], knownFileExtensions);
  }

  for (const rawToken of (clean.match(/\b[A-Za-z0-9_][A-Za-z0-9_.-]{2,}\b/g) || [])) {
    if (!isTechnicalArtifactToken(rawToken, knownFileExtensions)) continue;
    addTechnicalToken(namedArtifacts, rawToken, knownFileExtensions);
  }

  // Termos individuais extraídos de dentro das mensagens do sistema.
  // Palavras de 4+ chars dentro de erros/alertas/help recebem peso maior que palavras gerais.
  const msgTermSet = new Set();
  for (const phrase of phraseSet) {
    for (const w of (phrase.match(/\b[a-zA-Z]{4,}\b/g) || [])) {
      const wl = w.toLowerCase();
      if (!stopWords.has(wl)) msgTermSet.add(wl);
    }
  }
  const messageTerms = [...msgTermSet].slice(0, 30);

  return {
    // Peso 5 — identificadores exatos (maior precisão)
    identifiers: [...new Set([
      ...camel,
      ...pascal,
      ...snake,
      ...screaming,
      ...upperAlnum,
      ...namedArtifacts,
    ])]
      .filter((w) => {
        const lower = w.toLowerCase();
        return (
          !stopWords.has(lower) &&
          !UPPERCASE_IDENTIFIER_STOP_WORDS.has(String(w).toUpperCase())
        );
      })
      .slice(0, 30),
    // Peso 3 — rotas/caminhos de API
    routes: [...new Set(routes)].slice(0, 10),
    // Peso 1 — palavras gerais (maior recall, menor precisão)
    words: words.slice(0, 30),
    // Peso 4 — frases literais de mensagens do sistema (erro, alerta, help, aviso)
    phrases,
    // Peso 3 — termos individuais extraídos de dentro das mensagens do sistema
    messageTerms,
  };
}

/**
 * Pontua a relevância de um arquivo pelo conteúdo usando regex nos termos extraídos.
 * Retorna { score, matchedLines } onde matchedLines é array de índices de linha com hit.
 */
function scoreTextLines(lines, terms, keepMatchedLines = true) {
  const matchedLines = [];
  let score = 0;

  for (const id of terms.identifiers) {
    const rx = new RegExp(`\\b${escapeRegex(id)}\\b`, 'gi');
    const weight = getIdentifierWeight(id);
    for (let i = 0; i < lines.length; i++) {
      const hits = (lines[i].match(rx) || []).length;
      if (hits > 0) { score += hits * weight; matchedLines.push(i); }
    }
  }

  for (const route of terms.routes) {
    for (let i = 0; i < lines.length; i++) {
      if (lines[i].includes(route)) { score += 3; matchedLines.push(i); }
    }
  }

  for (const word of terms.words) {
    const rx = new RegExp(`\\b${escapeRegex(word)}\\b`, 'gi');
    for (let i = 0; i < lines.length; i++) {
      const hits = (lines[i].match(rx) || []).length;
      if (hits > 0) { score += hits * 1; matchedLines.push(i); }
    }
  }

  for (const phrase of (terms.phrases || [])) {
    for (let i = 0; i < lines.length; i++) {
      if (lines[i].includes(phrase)) { score += 4; matchedLines.push(i); }
    }
  }

  for (const term of (terms.messageTerms || [])) {
    const rx = new RegExp(`\\b${escapeRegex(term)}\\b`, 'gi');
    for (let i = 0; i < lines.length; i++) {
      const hits = (lines[i].match(rx) || []).length;
      if (hits > 0) { score += hits * 3; matchedLines.push(i); }
    }
  }

  return {
    score,
    matchedLines: keepMatchedLines
      ? [...new Set(matchedLines)].sort((a, b) => a - b)
      : [],
  };
}

function scorePath(filePath, terms) {
  const normalized = String(filePath || '').replace(/\\/g, '/').toLowerCase();
  const base = basename(normalized);
  const dotIndex = base.lastIndexOf('.');
  const stem = dotIndex > 0 ? base.slice(0, dotIndex) : base;
  let score = 0;

  for (const identifier of terms.identifiers) {
    const token = String(identifier || '').toLowerCase();
    if (!token) continue;

    if (stem === token) {
      score += isHighSignalIdentifier(identifier) ? 18 : 10;
      continue;
    }
    if (base.includes(token)) {
      score += isHighSignalIdentifier(identifier) ? 8 : 4;
      continue;
    }
    if (normalized.includes(token)) {
      score += isHighSignalIdentifier(identifier) ? 3 : 2;
    }
  }

  for (const word of terms.words) {
    const token = String(word || '').toLowerCase();
    if (!token) continue;

    if (stem === token) {
      score += 4;
    } else if (normalized.includes(token)) {
      score += 1;
    }
  }

  return score;
}

function scoreFileContent(content, terms, includeEntries = []) {
  const baseScore = scoreIssueSearchTextLines(content.split('\n'), terms, true);
  const includeHits = [];
  let includeScore = 0;

  for (const entry of includeEntries) {
    const includeResult = scoreIssueSearchTextLines(entry.content.split('\n'), terms, false);
    includeScore += includeResult.score;
    if (includeResult.score > 0) {
      includeHits.push({ ref: entry.rel, score: includeResult.score });
    }
  }

  return {
    score: baseScore.score + includeScore,
    matchedLines: baseScore.matchedLines,
    includeScore,
    includeHits,
  };
}

/**
 * Extrai trechos de código ao redor das linhas com match — igual ao "grep -C N".
 * Une ranges sobrepostos e respeita um limite máximo de chars por arquivo.
 *
 * @param {string}   content      - Conteúdo completo do arquivo
 * @param {number[]} matchedLines - Índices das linhas com hit (já ordenados)
 * @param {number}   ctx          - Linhas de contexto antes/depois de cada hit
 * @param {number}   maxSnippets  - Máximo de blocos distintos
 * @param {number}   maxChars     - Limite de chars na saída
 */
function extractSnippets(content, matchedLines, ctx = 10, maxSnippets = 5, maxChars = 3000) {
  const lines = content.split('\n');

  if (matchedLines.length === 0) {
    // Sem match de conteúdo — envia cabeçalho (imports, declarações iniciais)
    const end = Math.min(35, lines.length);
    return {
      text: lines.slice(0, end).join('\n')
        + '\n// [cabeçalho — sem ocorrências diretas dos termos da issue]',
      lineRanges: end > 0 ? [{ start: 1, end }] : [],
      totalLines: lines.length,
    };
  }

  // Expande cada linha com hit para ±ctx linhas
  const expanded = new Set();
  for (const idx of matchedLines) {
    for (let i = Math.max(0, idx - ctx); i <= Math.min(lines.length - 1, idx + ctx); i++) {
      expanded.add(i);
    }
  }

  // Agrupa índices contíguos em spans [start, end]
  const sorted = [...expanded].sort((a, b) => a - b);
  const spans = [];
  let start = sorted[0], end = sorted[0];
  for (let i = 1; i < sorted.length; i++) {
    if (sorted[i] <= end + 4) { end = sorted[i]; }
    else { spans.push([start, end]); start = end = sorted[i]; }
  }
  spans.push([start, end]);

  // Monta saída respeitando maxChars
  let out = '';
  let chars = 0;
  const includedRanges = [];
  for (let si = 0; si < Math.min(spans.length, maxSnippets); si++) {
    const [s, e] = spans[si];
    const block = `// ── L${s + 1}–${e + 1} ──────────────────────\n` +
                  lines.slice(s, e + 1).join('\n') + '\n';
    if (chars + block.length > maxChars) {
      const remaining = maxChars - chars;
      if (remaining > 180) {
        let consumed = 0;
        let endLine = s - 1;
        const compactedLines = [];

        for (let lineIndex = s; lineIndex <= e; lineIndex++) {
          const line = lines[lineIndex];
          const projected = consumed + line.length + 1;
          if (projected > Math.max(remaining - 96, 80)) break;
          compactedLines.push(line);
          consumed = projected;
          endLine = lineIndex;
        }

        if (compactedLines.length > 0) {
          out += (out ? '\n// ...\n\n' : '') +
            `// trecho compactado L${s + 1}-${endLine + 1}\n` +
            compactedLines.join('\n') +
            `\n// [... linhas adicionais ${endLine + 2}-${e + 1} omitidas por limite de tamanho]\n`;
          includedRanges.push({ start: s + 1, end: endLine + 1 });
        }
      }
      out += `\n// [... ${spans.length - si} bloco(s) adicional(is) omitido(s) por limite de tamanho]`;
      break;
    }
    out += (out ? '\n// ...\n\n' : '') + block;
    chars += block.length;
    includedRanges.push({ start: s + 1, end: e + 1 });
  }

  return {
    text: out.trim(),
    lineRanges: includedRanges,
    totalLines: lines.length,
  };
}

/**
 * Lê arquivos do workspace em 3 passes — igual à estratégia do Claude Code / Codex:
 *   Passe 1 — pré-filtro por nome de caminho (sem I/O, descarta irrelevantes rapidamente)
 *   Passe 2 — score por conteúdo com regex dos termos extraídos do ticket
 *   Passe 3 — extrai trechos ao redor dos hits (grep -C), não o arquivo inteiro
 *
 * Retorna { backend, frontend, configured, terms } onde terms são os termos usados.
 */
function readWorkspaceFiles(pdfText, metadata = null) {
  const searchText = [
    pdfText || '',
    metadata?.summary || '',
    (metadata?.labels || []).join(' '),
    (metadata?.components || []).join(' '),
    (metadata?.attachmentNames || []).join(' '),
  ].filter(Boolean).join('\n');
  const technicalContext = metadata?.technicalContext || null;
  const terms  = extractIssueSearchTerms(searchText, technicalContext);
  const frontendContext = detectMobileFrontendContext(pdfText, metadata);
  const backendDir = getWorkspaceErpBackendDir();
  const frontendDir = getWorkspaceMobileFrontendDir();
  const includeDir = getWorkspaceErpIncludeDir();
  const result = {
    backend: [],
    frontend: [],
    configured: false,
    terms,
    frontendContext,
  };
  const includeIndex = buildIncludeIndex(includeDir);

  const MAX_CANDIDATES  = 80;   // candidatos lidos no passe 2 (pré-filtro por path)
  const MAX_FILES       = 15;   // arquivos incluídos no contexto final
  const MAX_TOTAL_CHARS = 22000; // limite total de chars por workspace

  if (includeIndex) {
    console.log(
      `   ${c.gray}-> Includes ERP: ${includeIndex.indexedFiles} arquivo(s) indexados em ${includeDir}${c.reset}`
    );
  }

  function loadDir(dir, label) {
    if (!dir || !fs.existsSync(dir)) return [];
    result.configured = true;
    const allFiles = walkDir(dir);

    // ── Passe 1: score por path (sem I/O) ──────────────────────────────────
    const byPath = allFiles.map(f => (
      { path: f, pathScore: scoreIssueSearchPath(f, terms) }
    )).sort((a, b) => b.pathScore - a.pathScore);

    const candidates = byPath.slice(0, MAX_CANDIDATES);

    // ── Passe 2: score por conteúdo com regex ──────────────────────────────
    const scored = [];
    for (const { path: fp, pathScore } of candidates) {
      try {
        const content = fs.readFileSync(fp, 'utf-8');
        const includeEntries = getIncludeEntriesForFile(fp, content, includeIndex);
        const { score: contentScore, matchedLines, includeScore, includeHits } = scoreFileContent(
          content,
          terms,
          includeEntries
        );
        scored.push({
          path: fp,
          content,
          pathScore,
          contentScore,
          matchedLines,
          includeScore,
          includeHits,
          total: pathScore * 2 + contentScore,
        });
      } catch { /* ignora arquivos ilegíveis */ }
    }
    scored.sort((a, b) => b.total - a.total);

    // ── Passe 3: extrai snippets ao redor dos matches ──────────────────────
    const picked = scored.slice(0, MAX_FILES);
    let totalChars = 0;
    const loaded = [];

    for (const { path: fp, content, pathScore, contentScore, matchedLines, includeScore, includeHits, total } of picked) {
      if (totalChars >= MAX_TOTAL_CHARS) break;
      const snippet = extractSnippets(content, matchedLines);
      totalChars += snippet.text.length;
      const rel = fp.replace(dir, '').replace(/\\/g, '/').replace(/^\//, '');
      loaded.push({
        absPath: fp,
        rel,
        content: snippet.text,
        lineRanges: snippet.lineRanges,
        totalLines: snippet.totalLines,
        score: total,
        pathScore,
        contentScore,
        includeScore,
        includeHits: includeHits.map((hit) => hit.ref),
      });
    }

    const withHits = loaded.filter(f => f.contentScore > 0).length;
    console.log(
      `   ${c.gray}→ ${label}: ${allFiles.length} arq. encontrados, ` +
      `${candidates.length} candidatos analisados, ${loaded.length} incluídos ` +
      `(${withHits} com match de conteúdo)${c.reset}`
    );
    loaded.filter(f => f.contentScore > 0).slice(0, 5).forEach(f =>
      console.log(`     ${c.gray}↳ ${f.rel}  [path:${f.pathScore} + conteúdo:${f.contentScore}]${c.reset}`)
    );
    return loaded;
  }

  result.backend = loadDir(backendDir, 'ERP Back-end');

  if (frontendDir && !frontendContext.enabled) {
    result.configured = true;
    console.log(
      `   ${c.gray}↳ Front-end mobile ignorado: ticket sem sinais de Minha Producao/app mobile/celular/tablet${c.reset}`
    );
  } else if (frontendDir) {
    console.log(
      `   ${c.gray}↳ Front-end mobile habilitado por contexto: ${frontendContext.hits.join(', ')}${c.reset}`
    );
    result.frontend = loadDir(frontendDir, 'Front-end mobile');
  }

  result.technicalContext = technicalContext;
  result.technicalCorrelation = correlateTechnicalContextWithFiles(
    technicalContext,
    [
      ...result.backend.map((file) => ({ ...file, scopeLabel: 'Backend' })),
      ...result.frontend.map((file) => ({ ...file, scopeLabel: 'Frontend' })),
    ]
  );

  return result;
}

/**
 * Separa o texto do PDF em conteúdo principal (descrição + comentários Jira)
 * e conteúdo Zendesk (auxiliar). Usa marcadores conhecidos gerados pelo pdfGenerator.js.
 */
function splitPdfSections(text) {
  const markers = ['Comentário Zendesk', 'Comentários Zendesk', 'Zendesk #', 'ZENDESK'];
  let zendeskIdx = -1;

  for (const marker of markers) {
    const idx = text.indexOf(marker);
    if (idx !== -1 && (zendeskIdx === -1 || idx < zendeskIdx)) {
      zendeskIdx = idx;
    }
  }

  if (zendeskIdx === -1) {
    return { mainContent: text, zendeskContent: null };
  }

  return {
    mainContent: text.slice(0, zendeskIdx).trim(),
    zendeskContent: text.slice(zendeskIdx).trim(),
  };
}

/**
 * Carrega os metadados estruturais salvos pelo Módulo 1 (index.js).
 * Retorna null se o arquivo não existir (retrocompatibilidade).
 */
function loadMetadata(issueKey) {
  if (!issueKey) return null;
  const metaPath = join(OUTPUT_DIR, `${issueKey}_metadata.json`);
  try {
    return JSON.parse(fs.readFileSync(metaPath, 'utf-8'));
  } catch {
    return null;
  }
}

/**
 * Constrói o prompt de análise de problema de negócio para o Claude.
 * Diferente do buildClaudePrompt (foco em LGPD QA), este foca no problema
 * reportado pelo cliente e na causa raiz no produto.
 */
function buildBusinessPrompt(sections, metadata, pdfPath, numpages, workspace, options = {}) {
  const pdfName = basename(pdfPath);

  const cap = (str, limit) => str.length > limit
    ? str.slice(0, limit) + `\n[... truncado — total: ${str.length} chars ...]`
    : str;

  const mainLimit = options.mainLimit || 6000;
  const zendeskLimit = options.zendeskLimit || 2000;
  const mainSample    = cap(sanitizeForLLM(sections.mainContent), mainLimit);
  const zendeskSample = sections.zendeskContent
    ? cap(sanitizeForLLM(sections.zendeskContent), zendeskLimit)
    : null;

  const safeMetadata = metadata ? sanitizeStructuredData(metadata) : null;
  const backendBlock  = buildWorkspaceBlock(workspace?.backend,  'Backend');
  const frontendBlock = buildWorkspaceBlock(workspace?.frontend, 'Frontend');
  const hasWorkspace  = workspace?.configured;
  const technicalContextBlock = buildTechnicalContextPromptSection(
    safeMetadata?.technicalContext || workspace?.technicalContext || null,
    workspace?.technicalCorrelation || null
  );
  const metaBlock = safeMetadata
    ? `## Metadados estruturais do ticket\n\`\`\`json\n${JSON.stringify(safeMetadata, null, 2)}\n\`\`\`\n\n`
    : '';

  const zendeskBlock = zendeskSample
    ? `## Comunicação via Zendesk (canal do cliente)\n\`\`\`\n${zendeskSample}\n\`\`\``
    : '';

  const workspaceInstruction = hasWorkspace
    ? `- Há fontes de workspace fornecidos. Tente identificar os fontes relacionados e os trechos que validam se o problema descrito realmente pode ocorrer e qual é a causa mais provável em fonte. Cite arquivo:linha exatos quando identificar o ponto de falha ou o ponto de decisão relevante.`
    : `- Nenhum workspace de aplicação configurado — a análise se baseará apenas no conteúdo do ticket.`;

  const localConstraints = [
    '- Os metadados estruturais (labels, versões, links) fornecem contexto adicional sobre o escopo do bug.',
    '- Quando esta execução disponibilizar arquivos locais espelhados do workspace, você pode usá-los como evidência adicional além dos trechos mostrados no prompt.',
    '- Se não houver acesso aos arquivos locais espelhados, não cite arquivo:linha fora dos trechos de workspace fornecidos.',
    '- Quando trabalhar apenas com snippets parciais do workspace, limite suas conclusões às linhas exibidas no snippet.',
  ];

  const outputSections = DIAGNOSTIC_OUTPUT_SECTIONS
    .map(s => s.replace('{{workspaceInstruction}}', workspaceInstruction))
    .join('\n\n');

  return `${DIAGNOSTIC_PERSONA}

**IMPORTANTE:**
${[...DIAGNOSTIC_CORE_CONSTRAINTS, ...localConstraints].join('\n')}

---

## Ticket: ${pdfName}
Páginas: ${numpages}

${metaBlock}## Descrição da issue e comentários Jira
\`\`\`
${mainSample}
\`\`\`

${zendeskBlock}

${technicalContextBlock}

${backendBlock}${frontendBlock}---

## Instrução de saída

${DIAGNOSTIC_OUTPUT_INTRO}

${outputSections}`;
}

/**
 * Monta o bloco markdown de um conjunto de arquivos do workspace.
 */
function buildWorkspaceBlock(files, label) {
  if (!files || files.length === 0) return '';
  const header = `## Arquivos do ${label} (contexto da aplicação)`;
  const body = files.map(f =>
    `### ${label}/${f.rel}\n` +
    `Linhas enviadas: ${formatLineRanges(f.lineRanges, f.totalLines)}\n` +
    `\`\`\`\n${f.content}\n\`\`\``
  ).join('\n\n');
  return `${header}\n\n${body}\n\n`;
}

function sanitizeSourceForAgent(content) {
  return maskSensitiveText(String(content || ''), { fallbackTag: '[REDACTED]' });
}

function writeAgentMirrorFile(rootDir, relPath, content) {
  const filePath = join(rootDir, ...String(relPath || '').split('/').filter(Boolean));
  fs.mkdirSync(dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, sanitizeSourceForAgent(content), 'utf-8');
  return filePath;
}

function createDiagnosticAgentWorkspace({ workspace, sourceFiles, includePipeline = false }) {
  const mirroredFiles = [];
  const selectedWorkspaceFiles = [
    ...((workspace?.backend || []).map((file) => ({ scope: 'Backend', file }))),
    ...((workspace?.frontend || []).map((file) => ({ scope: 'Frontend', file }))),
  ].filter(({ file }) => file?.absPath && file?.rel);

  const selectedPipelineFiles = includePipeline && sourceFiles
    ? PIPELINE_SOURCE_FILES
      .filter(({ key }) => typeof sourceFiles[key] === 'string')
      .filter(({ key }) => !sourceFiles[key].startsWith('// Arquivo '))
    : [];

  if (selectedWorkspaceFiles.length === 0 && selectedPipelineFiles.length === 0) {
    return null;
  }

  const rootDir = fs.mkdtempSync(join(os.tmpdir(), 'lgpd-agent-workspace-'));

  for (const { scope, file } of selectedWorkspaceFiles) {
    try {
      const fullContent = fs.readFileSync(file.absPath, 'utf-8');
      const ref = `${scope}/${file.rel}`;
      writeAgentMirrorFile(rootDir, ref, fullContent);
      mirroredFiles.push({
        ref,
        kind: 'workspace',
        totalLines: file.totalLines || fullContent.split('\n').length,
      });
    } catch {
      // ignora arquivos removidos ou ilegíveis entre o scan e a execução do LLM
    }
  }

  for (const { key, ref } of selectedPipelineFiles) {
    const content = String(sourceFiles[key] || '');
    writeAgentMirrorFile(rootDir, ref, content);
    mirroredFiles.push({
      ref,
      kind: 'pipeline',
      totalLines: content.split('\n').length,
    });
  }

  if (mirroredFiles.length === 0) {
    try { fs.rmSync(rootDir, { recursive: true, force: true }); } catch {}
    return null;
  }

  const manifestLines = [
    '# Workspace de diagnostico',
    '',
    'Arquivos locais espelhados disponiveis para inspecao nesta execucao:',
    ...mirroredFiles.map((file) => `- ${file.ref}`),
    '',
    'Esses arquivos sao espelhos sanitizados dos fontes selecionados para a analise.',
  ];
  writeAgentMirrorFile(rootDir, 'DIAGNOSTIC_WORKSPACE.md', manifestLines.join('\n'));

  return {
    rootDir,
    mirroredFiles,
    workspaceFileCount: mirroredFiles.filter((file) => file.kind === 'workspace').length,
    cleanup() {
      try { fs.rmSync(rootDir, { recursive: true, force: true }); } catch {}
    },
  };
}

function buildCLIWorkspaceGuidance(agentWorkspace) {
  if (!agentWorkspace || agentWorkspace.mirroredFiles.length === 0) {
    return [
      'Use exclusivamente o contexto fornecido nesta entrada.',
      'Nao execute comandos que alterem arquivos, nao instale dependencias e nao use rede.',
      'Se a evidencia nao for suficiente, responda "Inconclusivo com os dados fornecidos".',
    ].join('\n');
  }

  const workspaceRefs = agentWorkspace.mirroredFiles
    .filter((file) => file.kind === 'workspace')
    .map((file) => `- ${file.ref}`);
  const pipelineRefs = agentWorkspace.mirroredFiles
    .filter((file) => file.kind === 'pipeline')
    .map((file) => `- ${file.ref}`);

  const lines = [
    'Use o ticket, os achados locais e os arquivos locais espelhados nesta workspace de diagnostico como evidencias permitidas para a analise.',
    'Voce pode usar comandos ou ferramentas somente leitura para abrir e ler os arquivos locais desta workspace espelhada.',
    'Nao acesse caminhos fora desta workspace espelhada, nao edite arquivos, nao instale dependencias e nao use rede.',
    'Quando precisar localizar a linha exata ou confirmar a hipotese principal, prefira os arquivos locais espelhados em vez das versoes compactadas do prompt.',
  ];

  if (workspaceRefs.length > 0) {
    lines.push('', 'Arquivos de workspace disponiveis para inspecao local:', ...workspaceRefs);
  }

  if (pipelineRefs.length > 0) {
    lines.push('', 'Arquivos locais adicionais da pipeline:', ...pipelineRefs);
  }

  lines.push(
    '',
    'Se a evidencia nao for suficiente, responda "Inconclusivo com os dados fornecidos".'
  );

  return lines.join('\n');
}

function buildGuidedCLIPrompt(prompt, agentWorkspace) {
  return [
    buildCLIWorkspaceGuidance(agentWorkspace),
    '',
    prompt,
  ].join('\n');
}

/**
 * Remove PII residual de um texto antes de enviá-lo ao LLM externo.
 * Reutiliza os mesmos padrões de localDetect para não expor dados sensíveis.
 */
function sanitizeForLLM(text) {
  return maskSensitiveText(text);
  const PII_PATTERNS = [
    /[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}/g,
    /\b\d{3}\.?\d{3}\.?\d{3}[-–]?\d{2}\b/g,
    /\b\d{2}\.?\d{3}\.?\d{3}\/?\.?\d{4}[-–]?\d{2}\b/g,
    /\(?\d{2}\)?\s?\d{4,5}[-–\s]?\d{4}\b/g,
    /\+\d{1,3}[\s\-]?\(?\d{2}\)?[\s\-]?\d{4,5}[\s\-]?\d{4}\b/g,
    /\b\d{5}[-–]\d{3}\b/g,
    /\b\d{2}\.?\d{3}\.?\d{3}[-–]?[0-9Xx]\b/g,
    /\b\d{3}\.?\d{5}\.?\d{2}[-–]?\d\b/g,
    /\b[A-Z]{3}[-\s]?\d{4}\b/g,
    /\b[A-Z]{3}\d[A-Z]\d{2}\b/g,
    /\b(?:senha|password|passwd|pwd|pass|api[-_]?key|apikey|secret(?:[-_]key)?|client[-_]secret|access[-_]token|auth[-_]token|bearer[-_]token|private[-_]key)(?:[ \t]+[A-Za-zÀ-ÿ0-9_.\/-]{2,}){0,3}[ \t]*[:=][ \t]*\S+/gi,
    /https?:\/\/[^\s/]+\/(?:users?|perfil|profile|u|account|conta)\/[\w.%@+\-]{2,}/gi,
  ];
  return PII_PATTERNS.reduce((acc, rx) => {
    rx.lastIndex = 0;
    return acc.replace(rx, '[REDACTED]');
  }, text);
}

/**
 * Remove os valores reais dos matches de PII dos findings antes de enviar ao LLM.
 * Mantém tipo, severidade e contagem — apenas oculta os exemplos.
 */
function sanitizeFindings(findings) {
  return findings.map(f => ({
    ...f,
    matches: f.matches.map(match => maskSensitiveText(match, { fallbackTag: '[REDACTED]' })),
  }));
  return findings.map(f => ({
    ...f,
    matches: f.matches.map(() => '[REDACTED]'),
  }));
}

/**
 * Constrói o prompt para o Claude API.
 * @param {object} sections  - { mainContent, zendeskContent }
 * @param {object} workspace - { backend, frontend, configured }
 */
function buildClaudePrompt(sections, findings, sourceFiles, pdfPath, numpages, workspace, options = {}) {
  const pdfName = basename(pdfPath);
  const mainLimit = options.mainLimit || 5000;
  const zendeskLimit = options.zendeskLimit || 1500;
  const sourceFileLimit = options.sourceFileLimit || null;

  const cap = (str, limit) => str.length > limit
    ? str.slice(0, limit) + `\n[... truncado — total: ${str.length} chars ...]`
    : str;

  // Sanitiza o conteúdo do PDF antes de enviar ao LLM — remove PII residual
  const mainSample    = cap(sanitizeForLLM(sections.mainContent), mainLimit);
  const zendeskSample = sections.zendeskContent
    ? cap(sanitizeForLLM(sections.zendeskContent), zendeskLimit)
    : null;

  // Sanitiza os findings — preserva tipo/severidade/contagem, oculta os exemplos reais
  const safeFindings = sanitizeFindings(findings);
  const findingsJson = safeFindings.length > 0
    ? JSON.stringify(safeFindings, null, 2)
    : 'Nenhum achado detectado pela varredura regex local.';

  const zendeskBlock = zendeskSample
    ? `## Comentários Zendesk (contexto auxiliar — não detalhar no documento técnico)
\`\`\`
${zendeskSample}
\`\`\``
    : '## Comentários Zendesk\nNenhum comentário Zendesk encontrado no PDF.';

  const backendBlock  = buildWorkspaceBlock(workspace?.backend,  'Backend');
  const frontendBlock = buildWorkspaceBlock(workspace?.frontend, 'Frontend');
  const hasWorkspace  = workspace?.configured;

  const workspaceInstruction = hasWorkspace
    ? `- Quando identificar a causa raiz de um problema, verifique também os arquivos do Back-end e Front-end fornecidos para rastrear a origem real do dado (ex: onde o campo é preenchido, validado ou exibido) e inclua essas referências nos "Trechos de fonte relacionados".`
    : `- Nenhum workspace de aplicação foi configurado. A análise de causa raiz se limitará à pipeline de anonimização.`;

  return `Você é um engenheiro de qualidade especializado em conformidade LGPD (Lei 13.709/2018) e análise de código Node.js.

Analise o PDF exportado por uma pipeline de anonimização e produza um relatório diagnóstico completo em Markdown.

**IMPORTANTE:** A fonte primária de análise é a **descrição da issue** (seção principal abaixo).
Os comentários Zendesk são fornecidos apenas como contexto auxiliar para entendimento do problema funcional — eles NÃO devem ser detalhados nas seções técnicas do relatório.
- Não invente fatos, problemas, arquivos, linhas ou causas raízes fora do contexto fornecido.
- Use somente a descrição da issue, os achados locais, os trechos de código recebidos e, quando esta execução disponibilizar arquivos locais espelhados, apenas esses arquivos como evidência adicional.
- Se a evidência não for suficiente, escreva explicitamente "Inconclusivo com os dados fornecidos".
- Se não houver acesso aos arquivos locais espelhados, não cite arquivo:linha fora das referências presentes no prompt.
- Quando trabalhar apenas com snippet parcial do workspace, limite suas conclusões às linhas exibidas no snippet.
- Apresente uma hipótese principal usando o rótulo obrigatório \`Causa raiz mais provável:\`.

---

## PDF Analisado
Arquivo: ${pdfName}
Páginas: ${numpages}

## Descrição da issue e comentários Jira (fonte principal de análise)
\`\`\`
${mainSample}
\`\`\`

${zendeskBlock}

## Achados da varredura local (regex pré-processada)
\`\`\`json
${findingsJson}
\`\`\`

## Código-fonte da pipeline de anonimização

### src/anonymizer.js
\`\`\`js
${sourceFileLimit ? cap(sourceFiles.anonymizer, sourceFileLimit) : sourceFiles.anonymizer}
\`\`\`

### src/nerDetector.js
\`\`\`js
${sourceFileLimit ? cap(sourceFiles.nerDetector, sourceFileLimit) : sourceFiles.nerDetector}
\`\`\`

### src/entityMap.js
\`\`\`js
${sourceFileLimit ? cap(sourceFiles.entityMap, sourceFileLimit) : sourceFiles.entityMap}
\`\`\`

### src/signatureExtractor.js
\`\`\`js
${sourceFileLimit ? cap(sourceFiles.signatureExtractor, sourceFileLimit) : sourceFiles.signatureExtractor}
\`\`\`

### src/contextualExtractor.js
\`\`\`js
${sourceFileLimit ? cap(sourceFiles.contextualExtractor, sourceFileLimit) : sourceFiles.contextualExtractor}
\`\`\`

${backendBlock}${frontendBlock}
---

## Instrução de saída

Produza um relatório diagnóstico em Markdown com EXATAMENTE estas 9 seções, nesta ordem, usando subtítulos \`###\`:

### Sugestão de título para o documento técnico
Uma linha. Título objetivo e descritivo do problema técnico encontrado no PDF, adequado para uso como título de documento de entrega. Não use jargões internos nem dados pessoais.

### Descrição funcional do problema
2 a 4 frases em linguagem de negócio, sem termos técnicos de código. Descreva o que ocorre de errado do ponto de vista do usuário ou do processo de anonimização. Base-se na descrição da issue como fonte primária.

### Descrição funcional da solução
2 a 4 frases em linguagem de negócio, sem termos técnicos de código. Descreva o que deve ser corrigido ou ajustado para resolver o problema. Foco no resultado esperado, não na implementação.

### Problemas reportados
Liste cada problema de anonimização encontrado. Para cada item, especifique:
- **Tipo:** (vazamento de PII, token incompleto, falso positivo, entidade não anonimizada etc.)
- **Evidência:** trecho ou exemplo do texto onde o problema ocorre (mascare parcialmente dados reais se houver)
- **Severidade:** 🔴 Crítico / 🟡 Atenção / 🔵 Informativo

Se não houver problemas técnicos, escreva que o PDF passou na análise, mas liste melhorias preventivas como informativos.

### Análise de causa raiz
Para cada problema listado, explique:
- \`Causa raiz mais provável:\` descreva uma única hipótese principal para o problema mais relevante
- Qual etapa da pipeline falhou: **Fase 1** (mineração — entityMap, signatureExtractor, contextualExtractor) ou **Fase 2** (substituição — anonymizer.process(), anonymizePatterns())
- Se é falha de **cobertura** (entidade não detectada) ou de **aplicação** (detectada mas não substituída)
- O mecanismo técnico exato da falha com base no código-fonte fornecido

### Trechos de fonte relacionados
O primeiro item desta seção deve sustentar a \`Causa raiz mais provável\`. Para cada causa raiz, cite o arquivo e linha exatos. Use o formato \`src/arquivo.js:linha\`, \`Backend/arquivo.ext:linha\` ou \`Frontend/arquivo.ext:linha\` e inclua o trecho de código em bloco \`\`\`js\`\`\`. Em cada item, explique em uma frase qual efeito observado o trecho ajuda a explicar. Use somente referências presentes no contexto recebido. Se não houver evidência suficiente para localizar o ponto exato no código, escreva exatamente: \`Não foi possível localizar o ponto exato no código com o contexto atual.\`
${workspaceInstruction}

### Sugestão de ajuste relacionada
Para cada problema, forneça uma correção concreta usando blocos \`\`\`diff\`\`\` com o código ANTES e DEPOIS. Foque em ajustes mínimos e cirúrgicos, sem refatorações.

### Critérios de aceite para entrega
Para cada problema, liste as condições que devem ser verdadeiras para considerá-lo resolvido:
- [ ] Critério específico e verificável
- [ ] Critério de teste ou validação

### Sugestões de cenários de testes
Para cada correção sugerida, proponha 2-3 cenários de teste concretos com:
- **Entrada:** texto de exemplo contendo o caso problemático
- **Saída esperada:** resultado correto após a correção
Use tabelas Markdown quando aplicável.`;
}

/**
 * Normaliza a ordem dos provedores LLM configurada no .env.
 */
function parseLLMProviderOrder(raw) {
  const aliasMap = new Map([
    ['claude', 'claude'],
    ['claude_cli', 'claude'],
    ['codex', 'codex'],
    ['codex_cli', 'codex'],
    ['copilot', 'copilot'],
    ['github_copilot', 'copilot'],
    ['github', 'copilot'],
    ['anthropic', 'anthropic'],
    ['api', 'anthropic'],
    ['api_key', 'anthropic'],
    ['anthropic_api', 'anthropic'],
  ]);

  const selected = (raw || '')
    .split(',')
    .map(item => item.trim().toLowerCase())
    .filter(Boolean)
    .map(item => aliasMap.get(item))
    .filter(Boolean);

  return [...new Set(selected)].length > 0
    ? [...new Set(selected)]
    : [...DEFAULT_LLM_PROVIDER_ORDER];
}

function describeLLMProviderOrder() {
  return LLM_PROVIDER_ORDER
    .map(key => LLM_PROVIDER_LABELS[key] || key)
    .join(' -> ');
}

function summarizeProviderError(providerLabel, err) {
  const raw = String(err?.message || err || 'falha sem detalhes');
  const withoutPrefix = raw.replace(
    new RegExp(`^${escapeRegex(providerLabel)}:?\\s*`, 'i'),
    ''
  );
  return withoutPrefix.replace(/\s+/g, ' ').trim().slice(0, 220) || 'falha sem detalhes';
}

function formatDuration(ms) {
  if (ms < 1000) return `${ms}ms`;
  const seconds = Math.round(ms / 100) / 10;
  if (seconds < 60) return `${seconds.toFixed(1)}s`;
  const minutes = Math.floor(seconds / 60);
  const remaining = (seconds % 60).toFixed(1);
  return `${minutes}m${remaining}s`;
}

function formatCommandPreview(command, args) {
  return [command, ...(args || [])].join(' ').replace(/\s+/g, ' ').trim();
}

function simplifyAgentCommand(command) {
  const raw = String(command || '').trim();
  const powershellMatch = raw.match(/powershell(?:\.exe)?\"\s+-Command\s+(.+)$/i);
  if (powershellMatch?.[1]) {
    return powershellMatch[1].replace(/^"|"$/g, '');
  }
  return raw.replace(/\s+/g, ' ').trim();
}

function killProcessTree(pid) {
  if (!pid) return;

  if (process.platform === 'win32') {
    spawn('taskkill', ['/PID', String(pid), '/T', '/F'], {
      stdio: 'ignore',
      shell: false,
      windowsHide: true,
    });
    return;
  }

  try {
    process.kill(pid, 'SIGKILL');
  } catch {
    // ignora falhas de limpeza
  }
}

function withProviderProgress({ providerLabel, activity, fn, timeoutMs = LLM_PROVIDER_TIMEOUT_MS }) {
  const startedAt = Date.now();
  console.log(`\n   ${c.gray}↳ ${providerLabel}: ${activity}${c.reset}`);

  return new Promise((resolve, reject) => {
    let settled = false;
    const heartbeat = setInterval(() => {
      const elapsed = formatDuration(Date.now() - startedAt);
      console.log(`\n   ${c.gray}↳ ${providerLabel}: ${elapsed} em processamento; ${activity}${c.reset}`);
    }, LLM_PROGRESS_INTERVAL_MS);

    const timeoutHandle = setTimeout(() => {
      if (settled) return;
      settled = true;
      clearInterval(heartbeat);
      reject(new Error(`${providerLabel}: timeout após ${formatDuration(Date.now() - startedAt)} (${activity})`));
    }, timeoutMs);

    Promise.resolve()
      .then(fn)
      .then((value) => {
        if (settled) return;
        settled = true;
        clearInterval(heartbeat);
        clearTimeout(timeoutHandle);
        console.log(`\n   ${c.gray}↳ ${providerLabel}: concluido em ${formatDuration(Date.now() - startedAt)}${c.reset}`);
        resolve(value);
      })
      .catch((error) => {
        if (settled) return;
        settled = true;
        clearInterval(heartbeat);
        clearTimeout(timeoutHandle);
        reject(error);
      });
  });
}

function handleProviderEvent(providerLabel, event) {
  if (!event || typeof event !== 'object') return;
  const item = event.item || null;
  if (!item || item.type !== 'command_execution') return;

  const summary = simplifyAgentCommand(item.command).slice(0, 220);
  if (event.type === 'item.started') {
    console.log(`\n   ${c.gray}↳ ${providerLabel}: agente executando ${summary}${c.reset}`);
    return;
  }

  if (event.type === 'item.completed') {
    const exitCode = Number.isInteger(item.exit_code) ? item.exit_code : '?';
    console.log(`\n   ${c.gray}↳ ${providerLabel}: comando finalizado (exit ${exitCode}) ${summary}${c.reset}`);
  }
}

function runCLIWithPrompt({ command, args, prompt, providerLabel, outputFile, jsonEvents = false, cwd = process.cwd() }) {
  return new Promise((resolve, reject) => {
    let stdout = '';
    let stderr = '';
    let settled = false;
    let heartbeat = null;
    let timeoutHandle = null;
    let stdoutBuffer = '';
    const startedAt = Date.now();
    const commandPreview = formatCommandPreview(command, args);

    const cleanupOutput = () => {
      if (!outputFile) return '';
      try {
        return fs.existsSync(outputFile) ? fs.readFileSync(outputFile, 'utf-8').trim() : '';
      } finally {
        try { fs.unlinkSync(outputFile); } catch {}
      }
    };

    const settle = (fn, value) => {
      if (settled) return;
      settled = true;
      if (heartbeat) clearInterval(heartbeat);
      if (timeoutHandle) clearTimeout(timeoutHandle);
      fn(value);
    };

    console.log(`\n   ${c.gray}↳ ${providerLabel}: executando ${commandPreview}${c.reset}`);
    const proc = spawn(command, args, {
      stdio: ['pipe', 'pipe', 'pipe'],
      shell: process.platform === 'win32',
      windowsHide: true,
      cwd,
    });

    heartbeat = setInterval(() => {
      const elapsed = formatDuration(Date.now() - startedAt);
      console.log(
        `\n   ${c.gray}↳ ${providerLabel}: ${elapsed} em processamento; aguardando retorno do modelo...${c.reset}`
      );
    }, LLM_PROGRESS_INTERVAL_MS);

    timeoutHandle = setTimeout(() => {
      const elapsed = formatDuration(Date.now() - startedAt);
      killProcessTree(proc.pid);
      cleanupOutput();
      settle(
        reject,
        new Error(`${providerLabel}: timeout apÃ³s ${elapsed} executando ${commandPreview}`)
      );
    }, LLM_PROVIDER_TIMEOUT_MS);

    proc.stdout.on('data', d => {
      const chunk = d.toString();
      if (!jsonEvents) {
        stdout += chunk;
        return;
      }

      stdoutBuffer += chunk;
      const lines = stdoutBuffer.split(/\r?\n/);
      stdoutBuffer = lines.pop() || '';

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        try {
          handleProviderEvent(providerLabel, JSON.parse(trimmed));
        } catch {
          stdout += `${trimmed}\n`;
        }
      }
    });
    proc.stderr.on('data', d => stderr += d.toString());

    proc.on('error', e => {
      cleanupOutput();
      settle(reject, new Error(`${providerLabel} não encontrado: ${e.message}`));
    });

    proc.on('close', code => {
      if (jsonEvents && stdoutBuffer.trim()) {
        try {
          handleProviderEvent(providerLabel, JSON.parse(stdoutBuffer.trim()));
        } catch {
          stdout += stdoutBuffer.trim();
        }
      }

      const fileOutput = cleanupOutput();
      const response = fileOutput || stdout.trim();
      const details = stderr.trim().slice(0, 300) || stdout.trim().slice(0, 300) || 'sem detalhes';
      const elapsed = formatDuration(Date.now() - startedAt);

      if (code === 0 && response) {
        console.log(`\n   ${c.gray}↳ ${providerLabel}: concluido em ${elapsed}${c.reset}`);
        settle(resolve, response);
      } else {
        settle(reject, new Error(`${providerLabel}: exit ${code} — ${details}`));
      }
    });

    proc.stdin.end(prompt, 'utf-8');
  });
}

/**
 * Chama o claude CLI (Claude Code / VS Code) usando stdin.
 * Reaproveita a sessão autenticada do Claude Code / VS Code.
 */
function callClaudeCLI(prompt, agentWorkspace = null) {
  return runCLIWithPrompt({
    command: 'claude',
    args: ['-p', '--output-format', 'text'],
    prompt: buildGuidedCLIPrompt(prompt, agentWorkspace),
    providerLabel: LLM_PROVIDER_LABELS.claude,
    cwd: agentWorkspace?.rootDir || process.cwd(),
  });
}

/**
 * Chama o Codex CLI (OpenAI Codex CLI integrado ao VS Code) em modo exec.
 * Reaproveita o login do Codex CLI / ChatGPT sem depender de API key.
 */
function callCodexCLI(prompt, agentWorkspace = null) {
  const tmpFile = join(os.tmpdir(), `lgpd_codex_${Date.now()}.txt`);
  const executionDir = agentWorkspace?.rootDir || join(os.tmpdir(), 'lgpd-codex-llm');
  const guidedPrompt = buildGuidedCLIPrompt(prompt, agentWorkspace);

  fs.mkdirSync(executionDir, { recursive: true });
  return runCLIWithPrompt({
    command: 'codex',
    args: ['exec', '-C', executionDir, '--skip-git-repo-check', '--ephemeral', '--color', 'never', '--json', '--output-last-message', tmpFile, '-'],
    prompt: guidedPrompt,
    providerLabel: LLM_PROVIDER_LABELS.codex,
    outputFile: tmpFile,
    jsonEvents: true,
    cwd: executionDir,
  });
}

function providerSupportsLocalInspection(providerKey) {
  return providerKey === 'claude' || providerKey === 'codex';
}

/**
 * Obtém o token GitHub via gh CLI (GitHub CLI).
 */
function getGithubToken() {
  return new Promise((resolve, reject) => {
    const proc = spawn('gh', ['auth', 'token'], {
      stdio: ['ignore', 'pipe', 'pipe'],
      shell: process.platform === 'win32',
    });
    let out = '', err = '';
    proc.stdout.on('data', d => out += d.toString());
    proc.stderr.on('data', d => err += d.toString());
    proc.on('error', e => reject(new Error(`gh CLI não encontrado: ${e.message}`)));
    proc.on('close', code => {
      if (code === 0 && out.trim()) resolve(out.trim());
      else reject(new Error(`gh auth token: exit ${code} — ${err.trim().slice(0, 200)}`));
    });
  });
}

/**
 * Troca o token GitHub por um token de sessão do Copilot.
 */
async function getCopilotToken(githubToken) {
  const res = await fetch('https://api.github.com/copilot_internal/v2/token', {
    headers: {
      'Authorization': `token ${githubToken}`,
      'Accept': 'application/json',
      'User-Agent': 'lgpd-diagnostic/1.0',
    },
  });
  if (!res.ok) throw new Error(`Copilot token: ${res.status} ${res.statusText}`);
  const data = await res.json();
  if (!data.token) throw new Error('GitHub Copilot não disponível para esta conta');
  return data.token;
}

/**
 * Chama o GitHub Copilot via API (reusa sessão do gh CLI / VS Code).
 * Não requer créditos extras — usa o plano Copilot já ativo.
 */
async function callCopilot(prompt) {
  return withProviderProgress({
    providerLabel: LLM_PROVIDER_LABELS.copilot,
    activity: 'obtendo token do GitHub e chamando a API',
    fn: async () => {
      const githubToken  = await getGithubToken();
      const copilotToken = await getCopilotToken(githubToken);

      const res = await fetch('https://api.githubcopilot.com/chat/completions', {
        method: 'POST',
        headers: {
          'Authorization':           `Bearer ${copilotToken}`,
          'Content-Type':            'application/json',
          'Copilot-Integration-Id':  'vscode-chat',
          'Editor-Version':          'vscode/1.85.0',
          'Editor-Plugin-Version':   'copilot-chat/0.12.0',
          'OpenAI-Intent':           'conversation-panel',
        },
        body: JSON.stringify({
          model:      'gpt-4o',
          messages:   [{ role: 'user', content: prompt }],
          max_tokens: 8000,
          stream:     false,
        }),
      });

      if (!res.ok) {
        const errText = await res.text().catch(() => '');
        throw new Error(`Copilot API: ${res.status} â€” ${errText.slice(0, 200)}`);
      }

      const data = await res.json();
      const text = data.choices?.[0]?.message?.content;
      if (!text) throw new Error('GitHub Copilot retornou resposta vazia');
      return text;
    },
  });

  /*
  const githubToken  = await getGithubToken();
  const copilotToken = await getCopilotToken(githubToken);

  const res = await fetch('https://api.githubcopilot.com/chat/completions', {
    method: 'POST',
    headers: {
      'Authorization':           `Bearer ${copilotToken}`,
      'Content-Type':            'application/json',
      'Copilot-Integration-Id':  'vscode-chat',
      'Editor-Version':          'vscode/1.85.0',
      'Editor-Plugin-Version':   'copilot-chat/0.12.0',
      'OpenAI-Intent':           'conversation-panel',
    },
    body: JSON.stringify({
      model:      'gpt-4o',
      messages:   [{ role: 'user', content: prompt }],
      max_tokens: 8000,
      stream:     false,
    }),
  });

  if (!res.ok) {
    const errText = await res.text().catch(() => '');
    throw new Error(`Copilot API: ${res.status} — ${errText.slice(0, 200)}`);
  }

  const data = await res.json();
  const text = data.choices?.[0]?.message?.content;
  if (!text) throw new Error('GitHub Copilot retornou resposta vazia');
  return text;
  */
}

/**
 * Chama a Anthropic API diretamente usando ANTHROPIC_API_KEY do .env.
 */
async function callClaudeAPI(prompt) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey || apiKey === 'sk-ant-api03-...') {
    throw new Error('ANTHROPIC_API_KEY não configurada ou inválida no .env');
  }

  const client = new Anthropic({ apiKey });
  const message = await client.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 8000,
    messages: [{ role: 'user', content: prompt }],
  });

  return message.content[0].text;
}

/**
 * Orquestra a chamada ao modelo de linguagem com fallback automático:
 *   - Reaproveita sessões já autenticadas no Claude Code / VS Code e Codex CLI
 *   - Faz fallback também em erros de crédito, quota, autenticação ou indisponibilidade
 *   - A ordem pode ser sobrescrita por LLM_PROVIDER_ORDER no .env
 */
async function callClaude(prompt, options = {}) {
  const label = (tag) => process.stdout.write(` \x1b[90m(via ${tag})\x1b[0m`);
  const agentWorkspace = createDiagnosticAgentWorkspace({
    workspace: options.workspace,
    sourceFiles: options.sourceFiles,
    includePipeline: options.includePipeline,
  });
  const providers = {
    claude: {
      label: LLM_PROVIDER_LABELS.claude,
      run: () => callClaudeCLI(prompt, agentWorkspace),
    },
    codex: {
      label: LLM_PROVIDER_LABELS.codex,
      run: () => callCodexCLI(prompt, agentWorkspace),
    },
    copilot: {
      label: LLM_PROVIDER_LABELS.copilot,
      run: () => callCopilot(prompt),
    },
    anthropic: {
      label: LLM_PROVIDER_LABELS.anthropic,
      run: () => callClaudeAPI(prompt),
    },
  };

  const attempts = [];

  try {
    for (const providerKey of LLM_PROVIDER_ORDER) {
      const provider = providers[providerKey];
      if (!provider) continue;

      try {
        console.log(`   ${c.gray}↳ Tentando ${provider.label}...${c.reset}`);
        const result = await provider.run();
        label(provider.label);
        return {
          text: result,
          providerKey,
          providerLabel: provider.label,
          allowFullWorkspaceFiles:
            Boolean(agentWorkspace?.workspaceFileCount) &&
            providerSupportsLocalInspection(providerKey),
        };
      } catch (err) {
        const summary = summarizeProviderError(provider.label, err);
        attempts.push(`  - ${provider.label}: ${summary}`);
        console.log(`\n   ${c.gray}↳ ${provider.label} indisponível: ${summary}${c.reset}`);
      }
    }
  } finally {
    agentWorkspace?.cleanup();
  }

  throw new Error(
    'Nenhuma forma de acesso ao modelo de linguagem disponível.\n\n' +
    `Ordem atual: ${describeLLMProviderOrder()}\n\n` +
    (attempts.length > 0 ? `Tentativas:\n${attempts.join('\n')}\n\n` : '') +
    'Sugestões:\n' +
    '  1. Claude Code → verifique: claude auth status\n' +
    '  2. Codex CLI   → verifique: codex login status\n' +
    '  3. Copilot     → verifique: gh auth status\n' +
    '  4. API key     → configure ANTHROPIC_API_KEY no .env\n' +
    '  5. Prioridade  → ajuste LLM_PROVIDER_ORDER=codex,claude,copilot,anthropic'
  );
}

/**
 * Constrói o cabeçalho markdown do relatório (antes da análise Claude).
 */
function buildReportHeader(pdfPath, findings, numpages) {
  const pdfName = basename(pdfPath);
  const now = new Date().toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' });

  const severityIcon = { critical: '🔴', warning: '🟡', info: '🔵' };
  const severityLabel = { critical: 'Crítico', warning: 'Atenção', info: 'Informativo' };

  let tableRows = '';
  if (findings.length > 0) {
    tableRows = findings.map(f =>
      `| \`${f.type}\` | ${severityIcon[f.severity] || '⚪'} ${severityLabel[f.severity] || f.severity} | ${f.count} |`
    ).join('\n');
  } else {
    tableRows = '| — | 🟢 Nenhum | 0 |';
  }

  return `# Relatório de Diagnóstico LGPD

**Arquivo analisado:** \`${pdfName}\`
**Gerado em:** ${now}
**Páginas no PDF:** ${numpages}
**Achados locais (regex):** ${findings.length} problema(s)

---

## Resumo da varredura local

| Tipo de problema | Severidade | Ocorrências |
|---|---|---|
${tableRows}

---

`;
}

/**
 * Salva o relatório em output/diagnostic_<mode>_<ISSUE_KEY>_<timestamp>.md
 * @param {string} content   - Conteúdo Markdown do relatório
 * @param {string} issueKey  - Chave da issue (ex: DMANQUALI-12311) ou null
 * @param {string} mode      - 'lgpd' | 'business' | '' (sem prefixo)
 */
function saveReport(content, issueKey, mode = '') {
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  const ts        = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const modePart  = mode ? `${mode}_` : '';
  const keyPart   = issueKey ? `${issueKey}_` : '';
  const filename  = `diagnostic_${modePart}${keyPart}${ts}.md`;
  const outPath   = join(OUTPUT_DIR, filename);
  fs.writeFileSync(outPath, content, 'utf-8');
  return outPath;
}

function hasValue(value, placeholders = []) {
  const clean = String(value ?? '').trim();
  return !!clean && !placeholders.includes(clean);
}

function hasJiraAuthConfigured() {
  const token = getEnvValue('JIRA_TOKEN');
  const user  = process.env.JIRA_USER;
  const pass  = process.env.JIRA_PASSWORD;

  if (hasValue(token, ['seu_token_pessoal_aqui', 'seu_token_aqui'])) return true;
  return hasValue(user, ['seu.usuario@empresa.com']) && hasValue(pass, ['sua_senha']);
}

function getConfigurationGaps() {
  const gaps = [];
  const backendDir = getWorkspaceErpBackendDir();
  const frontendDir = getWorkspaceMobileFrontendDir();
  const includeDir = getWorkspaceErpIncludeDir();

  if (!hasJiraAuthConfigured()) {
    gaps.push({
      label: 'Credenciais Jira',
      env: 'JIRA_TOKEN (ou JIRA_USER/JIRA_PASSWORD)',
      impact: 'Sem credenciais Jira válidas você perde a capacidade de reexportar a issue e regenerar metadata.json para enriquecer o diagnóstico.',
    });
  }

  if (!backendDir) {
    gaps.push({
      label: 'Workspace ERP',
      env: 'WORKSPACE_ERP_BACKEND_DIR',
      impact: 'A análise de negócio não consegue correlacionar o efeito reportado com fontes locais do back-end.',
    });
  } else if (!fs.existsSync(backendDir)) {
    gaps.push({
      label: 'Workspace ERP',
      env: `WORKSPACE_ERP_BACKEND_DIR=${backendDir}`,
      impact: 'O diretório configurado não existe. Nenhum fonte local de back-end será considerado na análise.',
    });
  }

  if (!frontendDir) {
    gaps.push({
      label: 'Workspace App mobile',
      env: 'WORKSPACE_MOBILE_FRONTEND_DIR',
      impact: 'A análise de negócio não consegue correlacionar o efeito reportado com fontes locais do front-end.',
    });
  } else if (!fs.existsSync(frontendDir)) {
    gaps.push({
      label: 'Workspace App mobile',
      env: `WORKSPACE_MOBILE_FRONTEND_DIR=${frontendDir}`,
      impact: 'O diretório configurado não existe. Nenhum fonte local de front-end será considerado na análise.',
    });
  }

  if (!includeDir) {
    gaps.push({
      label: 'Includes do ERP',
      env: 'WORKSPACE_ERP_INCLUDE_DIR',
      impact: 'Sem os includes do ERP, fontes .prw/.prx/.tlpp perdem correlaÃ§Ã£o com STR, mensagens de help e textos de UI definidos em .ch.',
    });
  } else if (!fs.existsSync(includeDir)) {
    gaps.push({
      label: 'Includes do ERP',
      env: `WORKSPACE_ERP_INCLUDE_DIR=${includeDir}`,
      impact: 'O diretorio de includes configurado nao existe. Fontes .prw/.prx/.tlpp nao serao enriquecidos com STR e mensagens vindas de .ch.',
    });
  }

  return gaps;
}

async function confirmConfigurationGaps(gaps) {
  if (!gaps || gaps.length === 0) return true;

  console.log(`${c.bold}${c.yellow}┌─────────────────────────────────────────────────────────────┐`);
  console.log(`│  ⚠️  Configuração incompleta para melhor diagnóstico        │`);
  console.log(`└─────────────────────────────────────────────────────────────┘${c.reset}`);
  console.log();
  console.log('  Preencha os itens abaixo no .env para melhorar a qualidade do resultado:');
  console.log();

  gaps.forEach((gap) => {
    console.log(`  ${c.yellow}• ${gap.label}${c.reset}`);
    console.log(`    ${c.gray}${gap.env}${c.reset}`);
    console.log(`    ${gap.impact}`);
  });

  console.log();
  console.log(`  ${c.gray}Sem esses dados, o LLM pode ficar restrito ao ticket/PDF e perder rastreabilidade até o código-fonte.${c.reset}`);
  console.log();

  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    rl.question(`  Deseja continuar assim mesmo? ${c.bold}[s/N]${c.reset} `, (answer) => {
      rl.close();
      const yes = answer.trim().toLowerCase() === 's';
      if (!yes) {
        console.log();
        console.log(`${c.yellow}⚠️  Execução interrompida para preenchimento do .env.${c.reset}`);
        console.log(`  ${c.gray}Preencha as variáveis indicadas e execute novamente.${c.reset}`);
        console.log();
      }
      resolve(yes);
    });
  });
}

function collectAllowedEvidencePaths(workspace, includePipeline = false, allowFullWorkspaceFiles = false) {
  const allowed = new Map();

  (workspace?.backend || []).forEach((f) => {
    const totalLines = f.totalLines || null;
    allowed.set(`Backend/${f.rel}`, {
      lineRanges: allowFullWorkspaceFiles && totalLines
        ? [{ start: 1, end: totalLines }]
        : (f.lineRanges || []),
      totalLines,
      kind: 'workspace',
    });
  });
  (workspace?.frontend || []).forEach((f) => {
    const totalLines = f.totalLines || null;
    allowed.set(`Frontend/${f.rel}`, {
      lineRanges: allowFullWorkspaceFiles && totalLines
        ? [{ start: 1, end: totalLines }]
        : (f.lineRanges || []),
      totalLines,
      kind: 'workspace',
    });
  });

  if (includePipeline) {
    PIPELINE_SOURCE_FILES.forEach(({ ref, key }) => {
      const content = readSourceFiles()[key] || '';
      const totalLines = content.split('\n').length;
      allowed.set(ref, {
        lineRanges: totalLines > 0 ? [{ start: 1, end: totalLines }] : [],
        totalLines,
        kind: 'pipeline',
      });
    });
  }

  return allowed;
}

function formatLineRanges(ranges, totalLines = null) {
  if (!ranges || ranges.length === 0) {
    return totalLines ? `compactado (total original: ${totalLines} linhas)` : 'compactado';
  }
  return ranges.map((r) => `${r.start}-${r.end}`).join(', ');
}

function isLineAllowed(lineNumber, meta) {
  if (!meta || !meta.lineRanges) return false;
  // lineRanges vazio = arquivo incluído por conteúdo completo (sem recorte), todas as linhas são válidas
  if (meta.lineRanges.length === 0) return true;
  return meta.lineRanges.some((range) => lineNumber >= range.start && lineNumber <= range.end);
}

function validateLLMReport(report, { mode, workspace, includePipeline = false, allowFullWorkspaceFiles = false }) {
  const issues = [];
  const allowedRefs = collectAllowedEvidencePaths(workspace, includePipeline, allowFullWorkspaceFiles);
  const refRx = /\b((?:Backend|Frontend|src)\/[^\s:`]+?\.[A-Za-z0-9]+):(\d+)\b/g;
  const refs = [...report.matchAll(refRx)].map((m) => ({
    ref: m[1],
    line: Number.parseInt(m[2], 10),
  }));
  const invalidRefs = refs.filter(({ ref }) => !allowedRefs.has(ref)).map(({ ref, line }) => `${ref}:${line}`);
  const invalidLines = refs
    .filter(({ ref, line }) => allowedRefs.has(ref) && !isLineAllowed(line, allowedRefs.get(ref)))
    .map(({ ref, line }) => `${ref}:${line}`);

  if (mode === 'business' && !/Causa mais provável:/i.test(report)) {
    issues.push('missing_primary_cause');
  }
  if (mode === 'lgpd' && !/Causa raiz mais provável:/i.test(report)) {
    issues.push('missing_primary_cause');
  }

  const workspaceRefsCount = (workspace?.backend?.length || 0) + (workspace?.frontend?.length || 0);
  const requiresCodeEvidence = includePipeline || workspaceRefsCount > 0;
  if (requiresCodeEvidence && allowedRefs.size > 0 && refs.length === 0) {
    issues.push('missing_code_evidence');
  }

  if (invalidRefs.length > 0) {
    issues.push('unsupported_file_refs');
  }
  if (invalidLines.length > 0) {
    issues.push('out_of_range_line_refs');
  }

  return {
    ok: issues.length === 0,
    issues,
    refs,
    invalidRefs,
    invalidLines,
    allowedRefs: [...allowedRefs.entries()].map(([ref, meta]) => ({
      ref,
      lineRanges: meta.lineRanges,
      totalLines: meta.totalLines,
      kind: meta.kind,
    })),
  };
}

function buildEvidenceRepairPrompt({ mode, basePrompt, report, validation }) {
  const issueText = validation.issues.map((issue) => {
    if (issue === 'missing_primary_cause') {
      return mode === 'business'
        ? '- O relatório não apresentou a linha obrigatória "Causa mais provável:".'
        : '- O relatório não apresentou a linha obrigatória "Causa raiz mais provável:".';
    }
    if (issue === 'missing_code_evidence') {
      return '- O relatório não vinculou a hipótese principal a referências arquivo:linha válidas.';
    }
    if (issue === 'unsupported_file_refs') {
      return `- O relatório citou referências fora do contexto permitido: ${validation.invalidRefs.join(', ')}.`;
    }
    if (issue === 'out_of_range_line_refs') {
      return `- O relatório citou linhas que não estão dentro das faixas enviadas ao LLM: ${validation.invalidLines.join(', ')}.`;
    }
    return `- ${issue}`;
  }).join('\n');

  const allowedRefs = validation.allowedRefs.length > 0
    ? validation.allowedRefs.map((item) =>
        `- ${item.ref} (linhas permitidas: ${formatLineRanges(item.lineRanges, item.totalLines)})`
      ).join('\n')
    : '- Nenhuma referência de código disponível neste contexto';

  const primaryLabel = mode === 'business' ? 'Causa mais provável:' : 'Causa raiz mais provável:';
  const insufficiencyRule = validation.allowedRefs.length > 0
    ? '- Mesmo quando a conclusão principal for inconclusiva, ancore a análise em pelo menos uma referência arquivo:linha válida do contexto recebido.'
    : '- Se não houver evidência suficiente para localizar o ponto exato no código, escreva exatamente: "Não foi possível localizar o ponto exato no código com o contexto atual."';

  return `Reescreva o relatório abaixo corrigindo estritamente as violações de evidência.

REGRAS OBRIGATÓRIAS:
- Não invente fatos, datas, arquivos, linhas, endpoints, tabelas, classes ou componentes.
- Use apenas o contexto do prompt original abaixo e, quando esta execução disponibilizar arquivos locais espelhados desta mesma análise, somente esses arquivos locais como evidência adicional.
- Mantenha a mesma estrutura/seções pedidas no prompt original.
- Inclua obrigatoriamente uma linha iniciando com "${primaryLabel}".
- Use somente referências arquivo:linha desta lista permitida:
${allowedRefs}
- Para arquivos de workspace, cite apenas linhas dentro das faixas permitidas acima.
- Não extrapole comportamento fora das linhas enviadas; se precisar extrapolar, escreva que está inconclusivo.
- ${insufficiencyRule.slice(2)}
- Quando a evidência não sustentar uma causa principal específica, escreva "${primaryLabel} Inconclusivo com os dados fornecidos."

VIOLAÇÕES IDENTIFICADAS:
${issueText}

PROMPT ORIGINAL:
${basePrompt}

RELATÓRIO A CORRIGIR:
${report}`;
}

async function ensureEvidenceBasedReport({
  mode,
  report,
  basePrompt,
  workspace,
  sourceFiles = null,
  includePipeline = false,
  allowFullWorkspaceFiles = false,
}) {
  const firstValidation = validateLLMReport(report, {
    mode,
    workspace,
    includePipeline,
    allowFullWorkspaceFiles,
  });
  if (firstValidation.ok) return report;

  console.log(`   ${c.yellow}↳ Ajustando resposta do LLM para regras de evidência...${c.reset}`);
  const repairedResult = await callClaude(
    buildEvidenceRepairPrompt({ mode, basePrompt, report, validation: firstValidation }),
    {
      workspace,
      sourceFiles,
      includePipeline,
    }
  );

  const repaired = repairedResult.text;
  const secondValidation = validateLLMReport(repaired, {
    mode,
    workspace,
    includePipeline,
    allowFullWorkspaceFiles: repairedResult.allowFullWorkspaceFiles,
  });
  if (!secondValidation.ok) {
    throw new Error(
      'A resposta do LLM não atendeu às regras de evidência e foi bloqueada para evitar conteúdo especulativo.\n' +
      `Problemas restantes: ${secondValidation.issues.join(', ')}`
    );
  }

  return repaired;
}

// ─── Confirmação antes do envio ao LLM ───────────────────────────────────────

/**
 * Exibe um resumo dos artefatos que serão enviados ao LLM e pede confirmação
 * interativa ao usuário. Retorna true se confirmado, false se cancelado.
 *
 * @param {object} opts
 * @param {string[]}      opts.modes        - Ex: ['Negócio'], ['LGPD'], ['LGPD', 'Negócio']
 * @param {object}        opts.sections     - { mainContent, zendeskContent }
 * @param {object|null}   opts.metadata     - metadata.json ou null
 * @param {object}        opts.workspace    - { configured, backend, frontend }
 * @param {object|null}   opts.sourceFiles  - arquivos da pipeline (modo LGPD)
 * @param {string}        opts.pdfPath      - caminho do PDF
 */
async function confirmLLMSend({ modes, sections, metadata, workspace, sourceFiles, pdfPath, promptPlans = [] }) {
  const pdfName = basename(pdfPath);
  const mainChars = sanitizeForLLM(sections.mainContent || '').length;
  const zdChars = sections.zendeskContent
    ? sanitizeForLLM(sections.zendeskContent).length
    : 0;
  {
    const plans = promptPlans.length > 0
      ? promptPlans
      : modes.map((mode) => ({
          mode,
          mainLimit: mode === 'LGPD' ? 5000 : 6000,
          zendeskLimit: mode === 'LGPD' ? 1500 : 2000,
          sourceFileLimit: mode === 'LGPD' ? null : null,
          promptLength: 0,
          compacted: false,
          workspace,
        }));
    const labelWidth = 32;
    const printLine = (label, value) =>
      console.log(`  ${c.gray}${label.padEnd(labelWidth)}${c.reset}${value}`);
    const printDetail = (value) =>
      console.log(`  ${' '.repeat(labelWidth + 2)}${c.gray}-> ${c.reset}${value}`);
    const describeTextSend = (charCount, limits, fullLabel, partialLabel) => {
      if (limits.length === 0) return `${charCount.toLocaleString()} chars`;

      const fullModes = limits.filter(({ limit }) => charCount <= limit).map(({ mode }) => mode);
      const partialModes = limits.filter(({ limit }) => charCount > limit).map(({ mode }) => mode);

      if (partialModes.length === 0) return `${charCount.toLocaleString()} chars - ${fullLabel}`;
      if (fullModes.length === 0) return `${charCount.toLocaleString()} chars - ${partialLabel}`;
      return `${charCount.toLocaleString()} chars - completo em ${fullModes.join(', ')}; trecho em ${partialModes.join(', ')}`;
    };
    const mergeWorkspaceFiles = (side, prefix) => {
      const merged = new Map();
      for (const plan of plans) {
        for (const file of plan.workspace?.[side] || []) {
          const key = `${prefix}/${file.rel}`;
          if (!merged.has(key)) {
            merged.set(key, {
              rel: file.rel,
              lineRanges: file.lineRanges,
              totalLines: file.totalLines,
              modes: [],
            });
          }
          const entry = merged.get(key);
          if (!entry.modes.includes(plan.mode)) entry.modes.push(plan.mode);
        }
      }
      return [...merged.values()];
    };

    const mainLimits = [...new Map(plans.map((plan) => [plan.mode, { mode: plan.mode, limit: plan.mainLimit }])).values()];
    const zendeskLimits = [...new Map(plans.map((plan) => [plan.mode, { mode: plan.mode, limit: plan.zendeskLimit }])).values()];
    const backendFiles = mergeWorkspaceFiles('backend', 'Backend');
    const frontendFiles = mergeWorkspaceFiles('frontend', 'Frontend');
    const lgpdPlans = plans.filter((plan) => plan.mode === 'LGPD');
    const pipelineLimit = lgpdPlans.length > 0
      ? Math.min(...lgpdPlans.map((plan) => plan.sourceFileLimit || Number.MAX_SAFE_INTEGER))
      : null;
    const pipelineFiles = sourceFiles && lgpdPlans.length > 0
      ? PIPELINE_SOURCE_FILES
        .filter(({ key }) => Object.prototype.hasOwnProperty.call(sourceFiles, key))
        .map(({ key, ref }) => {
          const content = String(sourceFiles[key] || '');
          const placeholder = content.startsWith('// Arquivo ');
          const partial = !placeholder && Number.isFinite(pipelineLimit) && content.length > pipelineLimit;
          return {
            ref,
            sentAs: placeholder
              ? 'placeholder (arquivo nao encontrado localmente)'
              : partial
                ? 'trecho compactado'
                : 'arquivo completo',
            modes: lgpdPlans.map((plan) => plan.mode),
          };
        })
      : [];
    const compactionDetails = plans
      .filter((plan) => plan.compacted || plan.workspace?.compaction?.changed)
      .map((plan) => {
        const backendStats = plan.workspace?.compaction?.backend;
        const frontendStats = plan.workspace?.compaction?.frontend;
        const pieces = [`prompt final ${plan.promptLength.toLocaleString()} chars`];
        if (backendStats) pieces.push(`ERP ${backendStats.original}->${backendStats.kept}`);
        if (frontendStats) pieces.push(`mobile ${frontendStats.original}->${frontendStats.kept}`);
        return `${plan.mode}: ${pieces.join('; ')}`;
      });

    console.log(`${c.bold}${c.yellow}â”Œâ”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”`);
    console.log(`â”‚  âš ï¸  ConfirmaÃ§Ã£o de envio ao modelo de linguagem (LLM)        â”‚`);
    console.log(`â””â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”˜${c.reset}`);
    console.log();
    console.log('  Os seguintes artefatos serÃ£o enviados ao LLM:');
    console.log();

    printLine('Arquivo PDF (texto extraÃ­do):', `${pdfName}  (${describeTextSend(mainChars, mainLimits, 'texto sanitizado completo', 'trecho sanitizado')})`);
    if (zdChars > 0) {
      printLine('ComentÃ¡rios Zendesk:', describeTextSend(zdChars, zendeskLimits, 'texto sanitizado completo', 'trecho sanitizado'));
    }
    if (metadata) {
      printLine('Metadados do ticket (JSON):', 'labels, versÃµes, sprint, links â€” sem dados pessoais');
    }
    if (pipelineFiles.length > 0) {
      printLine('CÃ³digo-fonte da pipeline:', `${pipelineFiles.length} arquivo(s) de src/`);
      pipelineFiles.forEach((file) => printDetail(`${file.ref}  (${file.sentAs}; modos: ${file.modes.join(', ')})`));
    }
    if (backendFiles.length > 0) {
      printLine('Arquivos Backend:', `${backendFiles.length} arquivo(s) do workspace - trechos no prompt`);
      backendFiles.forEach((file) =>
        printDetail(`Backend/${file.rel}  (linhas ${formatLineRanges(file.lineRanges, file.totalLines)} - trecho enviado no prompt; modos: ${file.modes.join(', ')})`)
      );
    }
    if (frontendFiles.length > 0) {
      printLine('Arquivos Frontend:', `${frontendFiles.length} arquivo(s) do workspace - trechos no prompt`);
      frontendFiles.forEach((file) =>
        printDetail(`Frontend/${file.rel}  (linhas ${formatLineRanges(file.lineRanges, file.totalLines)} - trecho enviado no prompt; modos: ${file.modes.join(', ')})`)
      );
    } else if (workspace?.frontendContext && !workspace.frontendContext.enabled && getWorkspaceMobileFrontendDir()) {
      printLine('Arquivos Frontend:', 'nenhum enviado neste ticket');
      printDetail('Front-end mobile ignorado por falta de sinais de app mobile, Minha ProduÃ§Ã£o, celular ou tablet no contexto');
    }
    if (backendFiles.length === 0 && frontendFiles.length === 0) {
      printLine('Workspaces locais:', 'nenhum trecho de cÃ³digo local serÃ¡ enviado');
    }
    if (compactionDetails.length > 0) {
      printLine('Janela de contexto:', 'compactada para caber no provedor');
      compactionDetails.forEach(printDetail);
    }

    console.log();
    console.log(`  ${c.bold}Finalidade:${c.reset}`);
    plans.forEach((plan) => {
      if (plan.mode === 'Negócio') {
        console.log(`    ${c.cyan}â€¢ AnÃ¡lise de NegÃ³cio${c.reset} â€” identificar causa raiz do bug e propor soluÃ§Ã£o`);
      } else if (plan.mode === 'LGPD') {
        console.log(`    ${c.cyan}â€¢ AnÃ¡lise LGPD${c.reset}       â€” avaliar qualidade da anonimizaÃ§Ã£o e detectar vazamentos`);
      }
    });
    console.log();
    console.log(`  ${c.gray}Dados pessoais (PII) sÃ£o removidos antes do envio (substituÃ­dos por [REDACTED]).${c.reset}`);
    console.log(`  ${c.gray}O destino Ã© determinado pela ordem configurada: ${describeLLMProviderOrder()}.${c.reset}`);
    console.log(`  ${c.gray}SaÃ­das sem causa principal ou sem evidÃªncia vÃ¡lida sÃ£o rejeitadas automaticamente.${c.reset}`);
    console.log();

    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    return new Promise((resolve) => {
      rl.question(`  Deseja prosseguir? ${c.bold}[s/N]${c.reset} `, (answer) => {
        rl.close();
        const yes = answer.trim().toLowerCase() === 's';
        if (!yes) {
          console.log();
          console.log(`${c.yellow}âš ï¸  Envio cancelado pelo usuÃ¡rio.${c.reset}`);
          console.log(`  ${c.gray}Use --no-llm para gerar apenas a varredura local sem anÃ¡lise de IA.${c.reset}`);
          console.log();
        }
        resolve(yes);
      });
    });
  }
  /*
  const hasBusinessMode = modes.some((mode) => mode.startsWith('Neg'));
  const hasLGPDMode = modes.includes('LGPD');

  const backendFiles = workspace?.backend || [];
  const frontendFiles = workspace?.frontend || [];
  const pipelineFiles = sourceFiles
    ? PIPELINE_SOURCE_FILES
      .filter(({ key }) => Object.prototype.hasOwnProperty.call(sourceFiles, key))
      .map(({ key, ref }) => ({
        ref,
        sentAs: typeof sourceFiles[key] === 'string' && sourceFiles[key].startsWith('// Arquivo ')
          ? 'placeholder (arquivo nao encontrado localmente)'
          : 'arquivo completo',
      }))
    : [];

  const bkFiles = backendFiles.length;
  const ftFiles = frontendFiles.length;
  const srcFiles = pipelineFiles.length;
  const labelWidth = 32;
  const detail = (value) =>
    console.log(`  ${' '.repeat(labelWidth + 2)}${c.gray}-> ${c.reset}${value}`);
  const line = (label, value) => {
    let resolvedValue = value;
    let details = [];
    const asciiLabel = label.normalize('NFKD').replace(/[^\x00-\x7F]/g, '');

    if (asciiLabel.startsWith('Arquivo PDF')) {
      resolvedValue = `${pdfName}  (${describeTextSend(mainChars, mainLimits, 'texto sanitizado completo', 'trecho sanitizado')})`;
    } else if (asciiLabel.startsWith('Coment')) {
      resolvedValue = describeTextSend(zdChars, zendeskLimits, 'texto sanitizado completo', 'trecho sanitizado');
    } else if (asciiLabel.includes('pipeline')) {
      resolvedValue = `${srcFiles} arquivo(s) de src/ - enviados por completo`;
      details = pipelineFiles.map((file) => `${file.ref}  (${file.sentAs})`);
    } else if (asciiLabel === 'Arquivos Backend:') {
      resolvedValue = `${bkFiles} arquivo(s) do workspace - somente trechos`;
      details = backendFiles.map((file) =>
        `Backend/${file.rel}  (linhas ${formatLineRanges(file.lineRanges, file.totalLines)} - trecho)`
      );
    } else if (asciiLabel === 'Arquivos Frontend:') {
      resolvedValue = `${ftFiles} arquivo(s) do workspace - somente trechos`;
      details = frontendFiles.map((file) =>
        `Frontend/${file.rel}  (linhas ${formatLineRanges(file.lineRanges, file.totalLines)} - trecho)`
      );
    }

    if (
      asciiLabel.startsWith('Arquivo PDF') ||
      asciiLabel.startsWith('Coment') ||
      asciiLabel.includes('pipeline') ||
      asciiLabel === 'Arquivos Backend:' ||
      asciiLabel === 'Arquivos Frontend:'
    ) {
      console.log(`  ${c.gray}${label.padEnd(labelWidth)}${c.reset}${resolvedValue}`);
      details.forEach(detail);
      return;
    }

    if (label === 'Arquivo PDF (texto extraÃ­do):') {
      resolvedValue = `${pdfName}  (${describeTextSend(mainChars, mainLimits, 'texto sanitizado completo', 'trecho sanitizado')})`;
    } else if (label === 'ComentÃ¡rios Zendesk:') {
      resolvedValue = describeTextSend(zdChars, zendeskLimits, 'texto sanitizado completo', 'trecho sanitizado');
    } else if (label === 'CÃ³digo-fonte da pipeline:') {
      resolvedValue = `${srcFiles} arquivo(s) de src/ - enviados por completo`;
      details = pipelineFiles.map((file) => `${file.ref}  (${file.sentAs})`);
    } else if (label === 'Arquivos Backend:') {
      resolvedValue = `${bkFiles} arquivo(s) do workspace - somente trechos`;
      details = backendFiles.map((file) =>
        `Backend/${file.rel}  (linhas ${formatLineRanges(file.lineRanges, file.totalLines)} - trecho)`
      );
    } else if (label === 'Arquivos Frontend:') {
      resolvedValue = `${ftFiles} arquivo(s) do workspace - somente trechos`;
      details = frontendFiles.map((file) =>
        `Frontend/${file.rel}  (linhas ${formatLineRanges(file.lineRanges, file.totalLines)} - trecho)`
      );
    }

    console.log(`  ${c.gray}${label.padEnd(labelWidth)}${c.reset}${resolvedValue}`);
    details.forEach(detail);
  };
  const describeTextSend = (charCount, limits, fullLabel, partialLabel) => {
    if (limits.length === 0) return `${charCount.toLocaleString()} chars`;

    const fullModes = limits.filter(({ limit }) => charCount <= limit);
    const partialModes = limits.filter(({ limit }) => charCount > limit);

    if (partialModes.length === 0) {
      return `${charCount.toLocaleString()} chars - ${fullLabel}`;
    }
    if (fullModes.length === 0) {
      return `${charCount.toLocaleString()} chars - ${partialLabel}`;
    }
    return `${charCount.toLocaleString()} chars - completo em ${fullModes.map(({ mode }) => mode).join(', ')}; trecho em ${partialModes.map(({ mode }) => mode).join(', ')}`;
  };

  const mainLimits = [];
  const zendeskLimits = [];
  if (hasLGPDMode) {
    mainLimits.push({ mode: 'LGPD', limit: 5000 });
    zendeskLimits.push({ mode: 'LGPD', limit: 1500 });
  }
  if (hasBusinessMode) {
    mainLimits.push({ mode: 'Negocio', limit: 6000 });
    zendeskLimits.push({ mode: 'Negocio', limit: 2000 });
  }

  console.log(`${c.bold}${c.yellow}┌─────────────────────────────────────────────────────────────┐`);
  console.log(`│  ⚠️  Confirmação de envio ao modelo de linguagem (LLM)        │`);
  console.log(`└─────────────────────────────────────────────────────────────┘${c.reset}`);
  console.log();
  console.log(`  Os seguintes artefatos serão enviados ao LLM:`);
  console.log();

  line('Arquivo PDF (texto extraído):', `${pdfName}  (${mainChars.toLocaleString()} chars — texto sanitizado)`);

  if (zdChars > 0)
    line('Comentários Zendesk:', `${zdChars.toLocaleString()} chars (sanitizados)`);

  if (metadata)
    line('Metadados do ticket (JSON):', `labels, versões, sprint, links — sem dados pessoais`);

  if (srcFiles > 0)
    line('Código-fonte da pipeline:', `${srcFiles} arquivo(s) de src/ (nerDetector, anonymizer…)`);

  if (bkFiles > 0)
    line('Arquivos Backend:', `${bkFiles} arquivo(s) do workspace`);

  if (ftFiles > 0)
    line('Arquivos Frontend:', `${ftFiles} arquivo(s) do workspace`);
  if (bkFiles === 0 && ftFiles === 0)
    line('Workspaces locais:', 'nenhum trecho de código local será enviado');

  console.log();
  console.log(`  ${c.bold}Finalidade:${c.reset}`);
  if (modes.includes('Negócio'))
    console.log(`    ${c.cyan}• Análise de Negócio${c.reset} — identificar causa raiz do bug e propor solução`);
  if (modes.includes('LGPD'))
    console.log(`    ${c.cyan}• Análise LGPD${c.reset}       — avaliar qualidade da anonimização e detectar vazamentos`);
    console.log();
    console.log(`  ${c.gray}Dados pessoais (PII) são removidos antes do envio (substituídos por [REDACTED]).${c.reset}`);
    console.log(`  ${c.gray}O destino é determinado pela ordem configurada: ${describeLLMProviderOrder()}.${c.reset}`);
    if (backendFiles.length > 0 || frontendFiles.length > 0 || pipelineFiles.length > 0) {
      console.log(`  ${c.gray}Claude CLI e Codex CLI podem inspecionar um espelho local sanitizado desses arquivos; Copilot/API continuam limitados ao prompt final.${c.reset}`);
    }
    console.log(`  ${c.gray}Saídas sem causa principal ou sem evidência válida são rejeitadas automaticamente.${c.reset}`);
  console.log();

  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

  return new Promise((resolve) => {
    rl.question(`  Deseja prosseguir? ${c.bold}[s/N]${c.reset} `, (answer) => {
      rl.close();
      const yes = answer.trim().toLowerCase() === 's';
      if (!yes) {
        console.log();
        console.log(`${c.yellow}⚠️  Envio cancelado pelo usuário.${c.reset}`);
        console.log(`  ${c.gray}Use --no-llm para gerar apenas a varredura local sem análise de IA.${c.reset}`);
        console.log();
      }
      resolve(yes);
    });
  });
  */
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  console.log();
  console.log(`${c.bold}${c.cyan}╔══════════════════════════════════════════╗`);
  console.log(`║   JIRA SHIELD — Diagnóstico LGPD         ║`);
  console.log(`╚══════════════════════════════════════════╝${c.reset}`);
  console.log();

  const rawArgs = process.argv.slice(2);
  const flags   = rawArgs.filter(a => a.startsWith('--'));
  const args    = rawArgs.filter(a => !a.startsWith('--'));
  const arg     = args[0];

  // Modo de operação:
  //   padrão (sem flags) = negócio apenas
  //   --lgpd             = só LGPD
  //   --business         = só negócio (explícito)
  //   --lgpd --business  = ambos
  //   --no-llm           = só varredura local regex, sem envio ao LLM
  const noLLM       = flags.includes('--no-llm');
  const runLGPD     = flags.includes('--lgpd');
  const runBusiness = flags.includes('--business') || !flags.includes('--lgpd');

  if (!arg) {
    console.log(`${c.yellow}Uso:${c.reset}  node src/diagnostics.js [--lgpd] [--business] [--no-llm] <ISSUE_KEY>`);
    console.log();
    console.log(`${c.bold}Modos disponíveis:${c.reset}`);
    console.log(`  ${c.green}(padrão)${c.reset}           Análise de problema de negócio / bug do cliente`);
    console.log(`  ${c.green}--lgpd${c.reset}             Análise de qualidade de anonimização LGPD`);
    console.log(`  ${c.green}--business${c.reset}         Análise de problema de negócio (igual ao padrão)`);
    console.log(`  ${c.green}--lgpd --business${c.reset}  Ambas as análises`);
    console.log(`  ${c.green}--no-llm${c.reset}           Apenas varredura local regex — não envia dados ao LLM`);
    console.log();
    console.log(`${c.gray}Sem argumento, usa o PDF mais recente em ${OUTPUT_DIR}${c.reset}`);
    console.log();
  }

  const modeLabel = noLLM
    ? 'Varredura local apenas (--no-llm)'
    : (runLGPD && runBusiness) ? 'LGPD + Negócio' : runLGPD ? 'LGPD' : 'Negócio';
  console.log(`${c.gray}Modo: ${c.bold}${modeLabel}${c.reset}`);
  console.log();

  // 1. Resolver PDF
  let pdfPath, issueKey;
  try {
    ({ pdfPath, issueKey } = resolvePdf(arg));
  } catch (err) {
    console.error(`${c.red}❌ ${err.message}${c.reset}\n`);
    process.exit(1);
  }

  if (issueKey) {
    console.log(`${c.cyan}🔑 Issue:${c.reset}     ${c.bold}${issueKey}${c.reset}`);
  }
  console.log(`${c.cyan}📄 Analisando:${c.reset} ${basename(pdfPath)}`);

  // 2. Carregar metadados estruturais (gerados pelo Módulo 1, se existirem)
  const metadata = loadMetadata(issueKey);
  if (metadata) {
    console.log(`   ${c.gray}→ Metadados carregados (labels: [${(metadata.labels || []).join(', ')}], links: ${(metadata.issueLinks || []).length})${c.reset}`);
  } else {
    console.log(`   ${c.gray}→ Metadados não encontrados — exporte com index.js para habilitar análise de negócio enriquecida${c.reset}`);
  }

  await maybeCollectRuntimeConfiguration();

  // 3. Extrair texto do PDF
  process.stdout.write(`${c.yellow}⏳ Extraindo texto do PDF...${c.reset}`);
  let text, numpages;
  const pdfStartedAt = Date.now();
  try {
    ({ text, numpages } = await extractPdfText(pdfPath));
    console.log(`   ${c.gray}↳ PDF processado em ${formatDuration(Date.now() - pdfStartedAt)}${c.reset}`);
    console.log(` ${c.green}OK${c.reset} (${numpages} página(s), ${text.length} chars)`);
  } catch (err) {
    console.log();
    console.error(`${c.red}❌ Falha ao ler PDF: ${err.message}${c.reset}\n`);
    process.exit(1);
  }

  // 4. Separar seções do PDF e varredura local
  const sections = splitPdfSections(text);
  if (sections.zendeskContent) {
    console.log(`   ${c.gray}→ Seção Zendesk detectada${c.reset}`);
  }

  process.stdout.write(`${c.yellow}🔍 Varredura local de PII...${c.reset}`);
  const localScanStartedAt = Date.now();
  const findings = localDetect(text);
  console.log(` ${c.green}OK${c.reset}`);
  console.log(`   ${c.gray}↳ Varredura local concluida em ${formatDuration(Date.now() - localScanStartedAt)}${c.reset}`);

  if (findings.length === 0) {
    console.log(`   ${c.green}✅ Nenhum problema detectado pela varredura regex${c.reset}`);
  } else {
    const severityIcon = { critical: `${c.red}🔴`, warning: `${c.yellow}🟡`, info: `${c.blue}🔵` };
    findings.forEach(f =>
      console.log(`   ${severityIcon[f.severity] || '⚪'}${c.reset} ${f.type}: ${f.count} ocorrência(s)`)
    );
  }
  console.log();

  // 5. Carregar arquivos-fonte da pipeline + workspace da aplicação
  let sourceFiles, workspace;
  if (runLGPD) {
    process.stdout.write(`${c.yellow}📂 Carregando código-fonte da pipeline...${c.reset}`);
    const pipelineStartedAt = Date.now();
    sourceFiles = readSourceFiles();
    console.log(` ${c.green}OK${c.reset}`);
    console.log(`   ${c.gray}↳ Fontes da pipeline carregadas em ${formatDuration(Date.now() - pipelineStartedAt)}${c.reset}`);
  }

  process.stdout.write(`${c.yellow}🗂️  Escaneando workspace...${c.reset}`);
  const workspaceStartedAt = Date.now();
  workspace = readWorkspaceFiles(text, metadata);
  workspace = compactWorkspaceForLLM(workspace, 'do ticket');
  const workspaceScanElapsed = formatDuration(Date.now() - workspaceStartedAt);
  if (!workspace.configured) {
    console.log(` ${c.gray}não configurado (WORKSPACE_ERP_BACKEND_DIR / WORKSPACE_MOBILE_FRONTEND_DIR)${c.reset}`);
  } else {
    console.log(` ${c.green}OK${c.reset}`);
  }

  if (workspace.configured) {
    console.log(`   ${c.gray}↳ Workspace analisado em ${workspaceScanElapsed}${c.reset}`);
  }

  const configGaps = getConfigurationGaps();
  if (!noLLM) {
    const ready = await confirmConfigurationGaps(configGaps);
    if (!ready) process.exit(0);
  }

  // 6. Confirmar envio ao LLM (ou curto-circuitar se --no-llm)
  if (noLLM) {
    const header  = buildReportHeader(pdfPath, findings, numpages);
    const noLLMNote = `> **Nota:** análise de IA não executada (flag \`--no-llm\`).\n\n`;
    const savedPath = saveReport(header + noLLMNote, issueKey, 'lgpd');
    console.log(`${c.green}✅ Relatório de varredura local salvo em: ${c.bold}${savedPath}${c.reset}`);
    console.log();
    return;
  }

  const modes = [
    ...(runBusiness ? ['Negócio'] : []),
    ...(runLGPD     ? ['LGPD']    : []),
  ];
  const promptPlans = [];
  let lgpdPromptData = null;
  let businessPromptData = null;

  if (runLGPD) {
    lgpdPromptData = prepareManagedPrompt({
      mode: 'lgpd',
      sections,
      findings,
      sourceFiles,
      metadata,
      pdfPath,
      numpages,
      workspace,
    });
    promptPlans.push(lgpdPromptData);
  }

  if (runBusiness) {
    businessPromptData = prepareManagedPrompt({
      mode: 'business',
      sections,
      findings,
      sourceFiles,
      metadata,
      pdfPath,
      numpages,
      workspace,
    });
    promptPlans.push(businessPromptData);
  }

  const confirmed = await confirmLLMSend({
    modes,
    sections,
    metadata,
    workspace,
    sourceFiles: runLGPD ? sourceFiles : null,
    pdfPath,
    promptPlans,
  });
  if (!confirmed) process.exit(0);

  console.log();

  // ── Análise LGPD (qualidade de anonimização) ─────────────────────────────
  if (runLGPD) {
    process.stdout.write(`${c.yellow}🔒 Análise LGPD — enviando para LLM...${c.reset}`);
    let lgpdReport;
    try {
      const promptData = lgpdPromptData;
      const prompt = promptData.prompt;
      const llmResult = await callClaude(prompt, {
        workspace: promptData.workspace,
        sourceFiles,
        includePipeline: true,
      });
      lgpdReport = llmResult.text;
      lgpdReport = await ensureEvidenceBasedReport({
        mode: 'lgpd',
        report: lgpdReport,
        basePrompt: prompt,
        workspace: promptData.workspace,
        sourceFiles,
        includePipeline: true,
        allowFullWorkspaceFiles: llmResult.allowFullWorkspaceFiles,
      });
      console.log(` ${c.green}OK${c.reset}`);
    } catch (err) {
      console.log();
      console.error(`${c.red}❌ ${err.message}${c.reset}\n`);
      process.exit(1);
    }

    const header     = buildReportHeader(pdfPath, findings, numpages);
    const fullReport = header + '## Análise LLM\n\n' + lgpdReport;

    console.log();
    console.log(`${c.bold}${'─'.repeat(60)}${c.reset}`);
    console.log(fullReport);

    const savedPath = saveReport(fullReport, issueKey, 'lgpd');
    console.log(`${c.bold}${'─'.repeat(60)}${c.reset}`);
    console.log(`${c.green}✅ Relatório LGPD salvo em: ${c.bold}${savedPath}${c.reset}`);
    console.log();
  }

  // ── Análise de Negócio (problema do cliente) ──────────────────────────────
  if (runBusiness) {
    process.stdout.write(`${c.yellow}💼 Análise de negócio — enviando para LLM...${c.reset}`);
    let businessReport;
    try {
      const promptData = businessPromptData;
      const prompt = promptData.prompt;
      const llmResult = await callClaude(prompt, {
        workspace: promptData.workspace,
        sourceFiles: null,
        includePipeline: false,
      });
      businessReport = llmResult.text;
      businessReport = await ensureEvidenceBasedReport({
        mode: 'business',
        report: businessReport,
        basePrompt: prompt,
        workspace: promptData.workspace,
        sourceFiles: null,
        includePipeline: false,
        allowFullWorkspaceFiles: llmResult.allowFullWorkspaceFiles,
      });
      console.log(` ${c.green}OK${c.reset}`);
    } catch (err) {
      console.log();
      console.error(`${c.red}❌ ${err.message}${c.reset}\n`);
      process.exit(1);
    }

    const now = new Date().toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' });
    const businessHeader = `# Análise de Problema de Negócio\n\n` +
      `**Arquivo analisado:** \`${basename(pdfPath)}\`\n` +
      `**Gerado em:** ${now}\n` +
      (metadata ? `**Sprint:** ${metadata.sprint || '—'}  |  **Versões afetadas:** ${(metadata.affectedVersions || []).join(', ') || '—'}\n` : '') +
      `\n---\n\n`;

    const fullReport = businessHeader + businessReport;

    console.log();
    console.log(`${c.bold}${'─'.repeat(60)}${c.reset}`);
    console.log(fullReport);

    const savedPath = saveReport(fullReport, issueKey, 'business');
    console.log(`${c.bold}${'─'.repeat(60)}${c.reset}`);
    console.log(`${c.green}✅ Relatório de negócio salvo em: ${c.bold}${savedPath}${c.reset}`);
    console.log();
  }
}

main().catch((err) => {
  console.error(`\n${c.red}Erro fatal: ${err.message}${c.reset}\n`);
  process.exit(1);
});
