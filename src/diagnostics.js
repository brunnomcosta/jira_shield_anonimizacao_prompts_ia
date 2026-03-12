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
import { dirname, resolve, join, basename } from 'path';
import dotenv from 'dotenv';

const __dirname = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: resolve(__dirname, '..', '.env') });

import fs from 'fs';
import os from 'os';
import readline from 'readline';
import { spawn } from 'child_process';
import { createRequire } from 'module';
import Anthropic from '@anthropic-ai/sdk';

const require = createRequire(import.meta.url);
const pdfParse = require('pdf-parse');

// ─── Configuração ────────────────────────────────────────────────────────────

const OUTPUT_DIR = resolve(__dirname, '..', process.env.OUTPUT_DIR || './output');
const SRC_DIR    = resolve(__dirname);

// Diretórios de workspace externos (back-end / front-end da aplicação)
const WORKSPACE_BACKEND_DIR  = process.env.WORKSPACE_BACKEND_DIR  ? resolve(process.env.WORKSPACE_BACKEND_DIR)  : null;
const WORKSPACE_FRONTEND_DIR = process.env.WORKSPACE_FRONTEND_DIR ? resolve(process.env.WORKSPACE_FRONTEND_DIR) : null;

// Extensões de arquivo aceitas para leitura do workspace
const WORKSPACE_EXTENSIONS = (process.env.WORKSPACE_EXTENSIONS || 'js,ts,java,py,cs,go,kt,jsx,tsx,vue,rb,php,prx,prw,tlpp')
  .split(',').map(e => `.${e.trim().toLowerCase()}`);

// Diretórios ignorados no scan recursivo
const IGNORE_DIRS = new Set([
  'node_modules', '.git', 'target', 'dist', 'build', '.next', '.nuxt',
  '__pycache__', 'vendor', '.gradle', '.mvn', 'coverage', '.cache',
  'out', '.idea', '.vscode', 'bin', 'obj',
]);

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
      rx: /\b(?:senha|password|passwd|pwd|pass|api[-_]?key|apikey|secret(?:[-_]key)?|client[-_]secret|access[-_]token|auth[-_]token|bearer[-_]token|private[-_]key)\s*[:=]\s*\S+/gi,
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
  const files = [
    'anonymizer.js',
    'nerDetector.js',
    'entityMap.js',
    'signatureExtractor.js',
    'contextualExtractor.js',
  ];

  const result = {};
  for (const filename of files) {
    const key = filename.replace('.js', '');
    const filePath = resolve(SRC_DIR, filename);
    try {
      result[key] = fs.readFileSync(filePath, 'utf-8');
    } catch {
      result[key] = `// Arquivo ${filename} não encontrado`;
    }
  }
  return result;
}

/**
 * Caminha recursivamente em um diretório e retorna todos os arquivos-fonte.
 */
function walkDir(dir, results = []) {
  let entries;
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return results; }

  for (const entry of entries) {
    if (entry.isDirectory()) {
      if (!IGNORE_DIRS.has(entry.name)) walkDir(join(dir, entry.name), results);
    } else if (entry.isFile() && WORKSPACE_EXTENSIONS.includes(
      entry.name.slice(entry.name.lastIndexOf('.')).toLowerCase()
    )) {
      results.push(join(dir, entry.name));
    }
  }
  return results;
}

/**
 * Escapa caracteres especiais de regex em uma string literal.
 */
function escapeRegex(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Extrai termos de busca categorizados do texto do ticket.
 * Captura identificadores técnicos (camelCase, PascalCase, snake_case),
 * rotas de API, mensagens de erro e palavras-chave gerais.
 */
function extractSearchTerms(text) {
  const clean = text.replace(/\[[\w-]+\]/g, ''); // remove tokens LGPD

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
  const pascal = (clean.match(/\b[A-Z][a-z][a-zA-Z0-9]{2,}\b/g) || []);

  // snake_case (colunas, campos, variáveis Python/Ruby): desconto_condicional
  const snake = (clean.match(/\b[a-z]{3,}(?:_[a-z]{2,}){1,}\b/g) || []);

  // SCREAMING_CASE (constantes, enums): MAX_RETRIES, STATUS_OPEN
  const screaming = (clean.match(/\b[A-Z]{2,}(?:_[A-Z0-9]{2,})+\b/g) || []);

  // Rotas de API: /api/v1/contracts, /users/profile
  const routes = (clean.match(/\/[a-zA-Z0-9_\-]{2,}(?:\/[a-zA-Z0-9_\-]{2,})+/g) || []);

  // Palavras técnicas longas (sem ser identificadores compostos)
  const words = [...new Set(
    (clean.match(/\b[a-zA-Z]{6,}\b/g) || []).map(w => w.toLowerCase())
  )].filter(w => !stopWords.has(w));

  return {
    // Peso 5 — identificadores exatos (maior precisão)
    identifiers: [...new Set([...camel, ...pascal, ...snake, ...screaming])]
      .filter(w => !stopWords.has(w.toLowerCase()))
      .slice(0, 30),
    // Peso 3 — rotas/caminhos de API
    routes: [...new Set(routes)].slice(0, 10),
    // Peso 1 — palavras gerais (maior recall, menor precisão)
    words: words.slice(0, 30),
  };
}

/**
 * Pontua a relevância de um arquivo pelo conteúdo usando regex nos termos extraídos.
 * Retorna { score, matchedLines } onde matchedLines é array de índices de linha com hit.
 */
function scoreFileContent(content, terms) {
  const lines = content.split('\n');
  const matchedLines = [];
  let score = 0;

  for (const id of terms.identifiers) {
    const rx = new RegExp(`\\b${escapeRegex(id)}\\b`, 'gi');
    for (let i = 0; i < lines.length; i++) {
      const hits = (lines[i].match(rx) || []).length;
      if (hits > 0) { score += hits * 5; matchedLines.push(i); }
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

  return { score, matchedLines: [...new Set(matchedLines)].sort((a, b) => a - b) };
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
function readWorkspaceFiles(pdfText) {
  const terms  = extractSearchTerms(pdfText);
  const result = { backend: [], frontend: [], configured: false, terms };

  const MAX_CANDIDATES  = 80;   // candidatos lidos no passe 2 (pré-filtro por path)
  const MAX_FILES       = 15;   // arquivos incluídos no contexto final
  const MAX_TOTAL_CHARS = 22000; // limite total de chars por workspace

  const allTermsFlat = [...terms.identifiers, ...terms.words];

  function loadDir(dir, label) {
    if (!dir || !fs.existsSync(dir)) return [];
    result.configured = true;
    const allFiles = walkDir(dir);

    // ── Passe 1: score por path (sem I/O) ──────────────────────────────────
    const byPath = allFiles.map(f => {
      const lower = f.toLowerCase().replace(/\\/g, '/');
      const ps = allTermsFlat.reduce((s, t) => s + (lower.includes(t.toLowerCase()) ? 2 : 0), 0);
      return { path: f, pathScore: ps };
    }).sort((a, b) => b.pathScore - a.pathScore);

    const candidates = byPath.slice(0, MAX_CANDIDATES);

    // ── Passe 2: score por conteúdo com regex ──────────────────────────────
    const scored = [];
    for (const { path: fp, pathScore } of candidates) {
      try {
        const content = fs.readFileSync(fp, 'utf-8');
        const { score: contentScore, matchedLines } = scoreFileContent(content, terms);
        scored.push({ path: fp, content, pathScore, contentScore, matchedLines,
                      total: pathScore * 2 + contentScore });
      } catch { /* ignora arquivos ilegíveis */ }
    }
    scored.sort((a, b) => b.total - a.total);

    // ── Passe 3: extrai snippets ao redor dos matches ──────────────────────
    const picked = scored.slice(0, MAX_FILES);
    let totalChars = 0;
    const loaded = [];

    for (const { path: fp, content, pathScore, contentScore, matchedLines, total } of picked) {
      if (totalChars >= MAX_TOTAL_CHARS) break;
      const snippet = extractSnippets(content, matchedLines);
      totalChars += snippet.text.length;
      const rel = fp.replace(dir, '').replace(/\\/g, '/').replace(/^\//, '');
      loaded.push({
        rel,
        content: snippet.text,
        lineRanges: snippet.lineRanges,
        totalLines: snippet.totalLines,
        score: total,
        pathScore,
        contentScore,
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

  result.backend  = loadDir(WORKSPACE_BACKEND_DIR,  'Backend');
  result.frontend = loadDir(WORKSPACE_FRONTEND_DIR, 'Frontend');
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
function buildBusinessPrompt(sections, metadata, pdfPath, numpages, workspace) {
  const pdfName = basename(pdfPath);

  const cap = (str, limit) => str.length > limit
    ? str.slice(0, limit) + `\n[... truncado — total: ${str.length} chars ...]`
    : str;

  const mainSample    = cap(sanitizeForLLM(sections.mainContent), 6000);
  const zendeskSample = sections.zendeskContent
    ? cap(sanitizeForLLM(sections.zendeskContent), 2000)
    : null;

  const backendBlock  = buildWorkspaceBlock(workspace?.backend,  'Backend');
  const frontendBlock = buildWorkspaceBlock(workspace?.frontend, 'Frontend');
  const hasWorkspace  = workspace?.configured;

  const metaBlock = metadata
    ? `## Metadados estruturais do ticket\n\`\`\`json\n${JSON.stringify(metadata, null, 2)}\n\`\`\`\n\n`
    : '';

  const zendeskBlock = zendeskSample
    ? `## Comunicação via Zendesk (canal do cliente)\n\`\`\`\n${zendeskSample}\n\`\`\``
    : '';

  const workspaceInstruction = hasWorkspace
    ? `- Rastreie o problema até o código-fonte nos arquivos de workspace fornecidos. Cite arquivo:linha exatos quando identificar o ponto de falha.`
    : `- Nenhum workspace de aplicação configurado — a análise se baseará apenas no conteúdo do ticket.`;

  return `Você é um engenheiro de produto sênior analisando um bug reportado por cliente.

Seu objetivo é entender o problema de negócio, reconstruir a sequência de eventos que gerou o problema e identificar a provável causa raiz no produto.

**IMPORTANTE:**
- Foque no problema descrito pelo cliente — não em questões de anonimização ou LGPD.
- A descrição da issue e os comentários Jira são a fonte primária de análise.
- Dados pessoais foram substituídos por tokens como [PESSOA-1], [EMPRESA-1] — isso é intencional e não faz parte do problema.
- Os metadados estruturais (labels, versões, links) fornecem contexto adicional sobre o escopo do bug.
- Não invente fatos, datas, componentes, endpoints, tabelas, arquivos ou linhas.
- Use somente evidências presentes no ticket, nos metadados e nos snippets de código fornecidos.
- Se a evidência não for suficiente, escreva explicitamente "Inconclusivo com os dados fornecidos".
- Não cite arquivo:linha fora dos trechos de workspace fornecidos.
- Quando um arquivo do workspace aparecer parcialmente, limite suas conclusões às linhas exibidas no snippet.
- Apresente exatamente uma hipótese principal usando o rótulo obrigatório \`Causa mais provável:\`.

---

## Ticket: ${pdfName}
Páginas: ${numpages}

${metaBlock}## Descrição da issue e comentários Jira
\`\`\`
${mainSample}
\`\`\`

${zendeskBlock}

${backendBlock}${frontendBlock}---

## Instrução de saída

Produza um relatório de análise de negócio em Markdown com EXATAMENTE estas 12 seções, nesta ordem, usando subtítulos \`###\`:

### Título do documento de análise
Uma linha. Título objetivo que descreve o problema de negócio. Ex: "Falha no cálculo de juros para contratos renovados após migração 2.4.1".

### Resumo da situação reportada
2 a 3 frases curtas e diretas. O que o cliente reportou, em qual contexto, e qual o impacto percebido por ele. Escreva como se fosse o parágrafo de abertura de um e-mail para um gerente — sem termos técnicos, sem hipóteses, apenas o fato relatado.

### Resumo da análise
2 a 3 frases. O que a análise do ticket revelou: qual é a hipótese mais provável de causa raiz, em qual parte do sistema o problema provavelmente está localizado e o grau de confiança na hipótese (alta/média/baixa). Inclua obrigatoriamente uma linha no formato \`Causa mais provável: ...\`. Se houver mais de uma hipótese relevante, mencione a segunda brevemente.

### Resumo da solução proposta
2 a 3 frases. O que precisa ser feito para resolver o problema — sem detalhes de implementação. Descreva o resultado esperado após a correção do ponto de vista do cliente. Inclua se há necessidade de comunicação ao cliente, rollback ou ação de dados.

### Timeline de eventos
Liste em ordem cronológica os eventos relevantes extraídos dos comentários e metadados:
- Data/hora (se disponível) — evento

Inclua: quando o problema começou, quando foi reportado, escalações, tentativas de reprodução, status atual.

### Sintomas vs. causa raiz hipotética
**Sintomas reportados (o que o cliente vê):**
- Liste os sintomas descritos

**Hipótese de causa raiz (o que provavelmente está errado no sistema):**
- \`Causa mais provável:\` descreva uma única hipótese principal
- \`Evidências principais:\` liste as evidências do ticket/metadados/código que sustentam a hipótese principal
- Liste hipóteses ordenadas por probabilidade (mais provável primeiro)
- Para cada hipótese, indique qual componente/módulo do sistema está envolvido

### Trechos de código relacionados
${workspaceInstruction}
O primeiro item desta seção deve sustentar a \`Causa mais provável\`. Para cada hipótese relevante, cite arquivo:linha e inclua o trecho em bloco de código. Em cada item, explique em uma frase qual efeito observado no ticket esse trecho ajuda a explicar. Use somente referências presentes no contexto recebido. Se não houver evidência suficiente para localizar o ponto exato no código, escreva exatamente: \`Não foi possível localizar o ponto exato no código com o contexto atual.\`

### Passos para reproduzir e investigar
Liste os passos concretos para:
1. Reproduzir o problema em ambiente de desenvolvimento/homologação
2. Confirmar a hipótese de causa raiz (ex: logs a verificar, queries a executar, endpoints a testar)

### Critérios de aceite para resolução
Para cada hipótese de causa raiz, liste as condições verificáveis que indicam resolução:
- [ ] Critério específico e mensurável
- [ ] Critério de validação com o cliente

### Cenários de teste regressivo
Para cada correção provável, proponha 2-3 cenários de teste com:
- **Cenário:** descrição do caso
- **Entrada:** dados de teste (sem PII real)
- **Resultado esperado:** comportamento correto

Use tabelas Markdown quando aplicável.

### Contexto adicional relevante
Liste informações do ticket que podem ser úteis para a investigação:
- Issues relacionadas (blockers, duplicatas) — com chaves e summaries
- Versões afetadas e fix versions
- Componentes e labels
- Sprint/Epic de contexto
- Attachments mencionados (nomes de arquivos)`;
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

/**
 * Remove PII residual de um texto antes de enviá-lo ao LLM externo.
 * Reutiliza os mesmos padrões de localDetect para não expor dados sensíveis.
 */
function sanitizeForLLM(text) {
  if (!text) return text;
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
    /\b(?:senha|password|passwd|pwd|pass|api[-_]?key|apikey|secret(?:[-_]key)?|client[-_]secret|access[-_]token|auth[-_]token|bearer[-_]token|private[-_]key)\s*[:=]\s*\S+/gi,
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
    matches: f.matches.map(() => '[REDACTED]'),
  }));
}

/**
 * Constrói o prompt para o Claude API.
 * @param {object} sections  - { mainContent, zendeskContent }
 * @param {object} workspace - { backend, frontend, configured }
 */
function buildClaudePrompt(sections, findings, sourceFiles, pdfPath, numpages, workspace) {
  const pdfName = basename(pdfPath);

  const cap = (str, limit) => str.length > limit
    ? str.slice(0, limit) + `\n[... truncado — total: ${str.length} chars ...]`
    : str;

  // Sanitiza o conteúdo do PDF antes de enviar ao LLM — remove PII residual
  const mainSample    = cap(sanitizeForLLM(sections.mainContent), 5000);
  const zendeskSample = sections.zendeskContent
    ? cap(sanitizeForLLM(sections.zendeskContent), 1500)
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
- Use somente a descrição da issue, os achados locais e os trechos de código recebidos.
- Se a evidência não for suficiente, escreva explicitamente "Inconclusivo com os dados fornecidos".
- Não cite arquivo:linha fora das referências presentes no prompt.
- Quando um arquivo do workspace aparecer parcialmente, limite suas conclusões às linhas exibidas no snippet.
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
${sourceFiles.anonymizer}
\`\`\`

### src/nerDetector.js
\`\`\`js
${sourceFiles.nerDetector}
\`\`\`

### src/entityMap.js
\`\`\`js
${sourceFiles.entityMap}
\`\`\`

### src/signatureExtractor.js
\`\`\`js
${sourceFiles.signatureExtractor}
\`\`\`

### src/contextualExtractor.js
\`\`\`js
${sourceFiles.contextualExtractor}
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
 * Chama o claude CLI (Claude Code / VS Code) passando o prompt via stdin.
 * Usa a sessão autenticada do Claude Code — sem créditos de API separados.
 */
function callClaudeCLI(prompt) {
  return new Promise((resolve, reject) => {
    // Escreve o prompt num arquivo temporário para evitar limites de tamanho de argumento
    const tmpFile = join(os.tmpdir(), `lgpd_prompt_${Date.now()}.txt`);
    fs.writeFileSync(tmpFile, prompt, 'utf-8');

    const args = ['-p', `$(cat "${tmpFile.replace(/\\/g, '/')}")`];
    const proc = spawn('claude', args, {
      stdio: ['ignore', 'pipe', 'pipe'],
      shell: true,  // necessário para expandir $() no argumento
    });

    let out = '', errOut = '';
    proc.stdout.on('data', d => out += d.toString());
    proc.stderr.on('data', d => errOut += d.toString());

    proc.on('error', e => {
      try { fs.unlinkSync(tmpFile); } catch {}
      reject(new Error(`claude CLI não encontrado: ${e.message}`));
    });

    proc.on('close', code => {
      try { fs.unlinkSync(tmpFile); } catch {}
      if (code === 0 && out.trim()) {
        resolve(out.trim());
      } else {
        reject(new Error(`claude CLI: exit ${code} — ${errOut.trim().slice(0, 300) || out.trim().slice(0, 300)}`));
      }
    });
  });
}

/**
 * Chama o Codex CLI (OpenAI Codex CLI integrado ao VS Code).
 * Usa: codex -q "prompt" — reusa a sessão autenticada no VS Code.
 */
function callCodexCLI(prompt) {
  return new Promise((resolve, reject) => {
    const tmpFile = join(os.tmpdir(), `lgpd_codex_${Date.now()}.txt`);
    fs.writeFileSync(tmpFile, prompt, 'utf-8');

    // codex -q lê o prompt do argumento em modo não-interativo (quiet)
    const args = ['-q', `$(cat "${tmpFile.replace(/\\/g, '/')}")`];
    const proc = spawn('codex', args, {
      stdio: ['ignore', 'pipe', 'pipe'],
      shell: true,
    });

    let out = '', errOut = '';
    proc.stdout.on('data', d => out += d.toString());
    proc.stderr.on('data', d => errOut += d.toString());

    proc.on('error', e => {
      try { fs.unlinkSync(tmpFile); } catch {}
      reject(new Error(`codex CLI não encontrado: ${e.message}`));
    });

    proc.on('close', code => {
      try { fs.unlinkSync(tmpFile); } catch {}
      if (code === 0 && out.trim()) {
        resolve(out.trim());
      } else {
        reject(new Error(`codex CLI: exit ${code} — ${errOut.trim().slice(0, 300) || out.trim().slice(0, 300)}`));
      }
    });
  });
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
 * Detecta se um erro indica que o CLI simplesmente não está instalado.
 */
function isCLINotFound(msg) {
  return msg.includes('não encontrado') || msg.includes('ENOENT') ||
         msg.includes('not found')      || msg.includes('not recognized') ||
         msg.includes('cannot find')    || msg.includes('No such file');
}

/**
 * Orquestra a chamada ao modelo de linguagem com fallback automático:
 *   1. claude CLI       — sessão Claude Code / VS Code
 *   2. codex CLI        — sessão OpenAI Codex / VS Code
 *   3. GitHub Copilot   — sessão Copilot via gh CLI / VS Code
 *   4. API key direta   — ANTHROPIC_API_KEY no .env
 */
async function callClaude(prompt) {
  const label = (tag) => process.stdout.write(` \x1b[90m(via ${tag})\x1b[0m`);

  // ── 1. claude CLI ─────────────────────────────────────────────────────────
  try {
    const r = await callClaudeCLI(prompt);
    label('claude CLI');
    return r;
  } catch (e) {
    if (!isCLINotFound(e.message)) throw new Error(`claude CLI: ${e.message}`);
  }

  // ── 2. codex CLI ──────────────────────────────────────────────────────────
  try {
    const r = await callCodexCLI(prompt);
    label('codex CLI');
    return r;
  } catch (e) {
    if (!isCLINotFound(e.message)) throw new Error(`codex CLI: ${e.message}`);
  }

  // ── 3. GitHub Copilot (gh CLI + Copilot API) ──────────────────────────────
  try {
    const r = await callCopilot(prompt);
    label('GitHub Copilot');
    return r;
  } catch (e) {
    // Só ignora se gh não estiver instalado ou Copilot não disponível
    const isUnavailable = isCLINotFound(e.message) ||
      e.message.includes('não disponível') ||
      e.message.includes('401') ||
      e.message.includes('403');
    if (!isUnavailable) throw new Error(`GitHub Copilot: ${e.message}`);
  }

  // ── 4. Anthropic API key ──────────────────────────────────────────────────
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (apiKey && apiKey !== 'sk-ant-api03-...') {
    const r = await callClaudeAPI(prompt);
    label('Anthropic API key');
    return r;
  }

  throw new Error(
    'Nenhuma forma de acesso ao modelo de linguagem disponível.\n\n' +
    '  1. claude CLI  → verifique: claude --version\n' +
    '  2. codex CLI   → instale: npm install -g @openai/codex\n' +
    '  3. Copilot     → verifique: gh auth status\n' +
    '  4. API key     → configure ANTHROPIC_API_KEY no .env'
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
  const token = process.env.JIRA_TOKEN;
  const user  = process.env.JIRA_USER;
  const pass  = process.env.JIRA_PASSWORD;

  if (hasValue(token, ['seu_token_pessoal_aqui', 'seu_token_aqui'])) return true;
  return hasValue(user, ['seu.usuario@empresa.com']) && hasValue(pass, ['sua_senha']);
}

function getConfigurationGaps() {
  const gaps = [];

  if (!hasJiraAuthConfigured()) {
    gaps.push({
      label: 'Credenciais Jira',
      env: 'JIRA_TOKEN (ou JIRA_USER/JIRA_PASSWORD)',
      impact: 'Sem credenciais Jira válidas você perde a capacidade de reexportar a issue e regenerar metadata.json para enriquecer o diagnóstico.',
    });
  }

  if (!WORKSPACE_BACKEND_DIR) {
    gaps.push({
      label: 'Workspace Back-end',
      env: 'WORKSPACE_BACKEND_DIR',
      impact: 'A análise de negócio não consegue correlacionar o efeito reportado com fontes locais do back-end.',
    });
  } else if (!fs.existsSync(WORKSPACE_BACKEND_DIR)) {
    gaps.push({
      label: 'Workspace Back-end',
      env: `WORKSPACE_BACKEND_DIR=${WORKSPACE_BACKEND_DIR}`,
      impact: 'O diretório configurado não existe. Nenhum fonte local de back-end será considerado na análise.',
    });
  }

  if (!WORKSPACE_FRONTEND_DIR) {
    gaps.push({
      label: 'Workspace Front-end',
      env: 'WORKSPACE_FRONTEND_DIR',
      impact: 'A análise de negócio não consegue correlacionar o efeito reportado com fontes locais do front-end.',
    });
  } else if (!fs.existsSync(WORKSPACE_FRONTEND_DIR)) {
    gaps.push({
      label: 'Workspace Front-end',
      env: `WORKSPACE_FRONTEND_DIR=${WORKSPACE_FRONTEND_DIR}`,
      impact: 'O diretório configurado não existe. Nenhum fonte local de front-end será considerado na análise.',
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

function collectAllowedEvidencePaths(workspace, includePipeline = false) {
  const allowed = new Map();

  (workspace?.backend || []).forEach((f) => {
    allowed.set(`Backend/${f.rel}`, {
      lineRanges: f.lineRanges || [],
      totalLines: f.totalLines || null,
      kind: 'workspace',
    });
  });
  (workspace?.frontend || []).forEach((f) => {
    allowed.set(`Frontend/${f.rel}`, {
      lineRanges: f.lineRanges || [],
      totalLines: f.totalLines || null,
      kind: 'workspace',
    });
  });

  if (includePipeline) {
    [
      ['src/anonymizer.js', 'anonymizer'],
      ['src/nerDetector.js', 'nerDetector'],
      ['src/entityMap.js', 'entityMap'],
      ['src/signatureExtractor.js', 'signatureExtractor'],
      ['src/contextualExtractor.js', 'contextualExtractor'],
    ].forEach(([ref, key]) => {
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
    return totalLines ? `1-${totalLines}` : 'n/d';
  }
  return ranges.map((r) => `${r.start}-${r.end}`).join(', ');
}

function isLineAllowed(lineNumber, meta) {
  if (!meta || !meta.lineRanges || meta.lineRanges.length === 0) return false;
  return meta.lineRanges.some((range) => lineNumber >= range.start && lineNumber <= range.end);
}

function validateLLMReport(report, { mode, workspace, includePipeline = false }) {
  const issues = [];
  const allowedRefs = collectAllowedEvidencePaths(workspace, includePipeline);
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
- Use apenas o contexto do prompt original abaixo.
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

async function ensureEvidenceBasedReport({ mode, report, basePrompt, workspace, includePipeline = false }) {
  const firstValidation = validateLLMReport(report, { mode, workspace, includePipeline });
  if (firstValidation.ok) return report;

  console.log(`   ${c.yellow}↳ Ajustando resposta do LLM para regras de evidência...${c.reset}`);
  const repaired = await callClaude(
    buildEvidenceRepairPrompt({ mode, basePrompt, report, validation: firstValidation })
  );

  const secondValidation = validateLLMReport(repaired, { mode, workspace, includePipeline });
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
 * @param {object[]|null} opts.sourceFiles  - arquivos da pipeline (modo LGPD)
 * @param {string}        opts.pdfPath      - caminho do PDF
 */
async function confirmLLMSend({ modes, sections, metadata, workspace, sourceFiles, pdfPath }) {
  const pdfName    = basename(pdfPath);
  const mainChars  = sanitizeForLLM(sections.mainContent || '').length;
  const zdChars    = sections.zendeskContent
    ? sanitizeForLLM(sections.zendeskContent).length : 0;

  const bkFiles  = workspace?.backend?.length  || 0;
  const ftFiles  = workspace?.frontend?.length || 0;
  const srcFiles = sourceFiles?.length         || 0;

  const line = (label, value) =>
    console.log(`  ${c.gray}${label.padEnd(32)}${c.reset}${value}`);

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
  console.log(`  ${c.gray}O destino é determinado pelo fallback: claude CLI → codex CLI → Copilot → API key.${c.reset}`);
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
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  console.log();
  console.log(`${c.bold}${c.cyan}╔══════════════════════════════════════════╗`);
  console.log(`║   SHIELD — Diagnóstico LGPD & Negócio    ║`);
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

  // 3. Extrair texto do PDF
  process.stdout.write(`${c.yellow}⏳ Extraindo texto do PDF...${c.reset}`);
  let text, numpages;
  try {
    ({ text, numpages } = await extractPdfText(pdfPath));
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
  const findings = localDetect(text);
  console.log(` ${c.green}OK${c.reset}`);

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
    sourceFiles = readSourceFiles();
    console.log(` ${c.green}OK${c.reset}`);
  }

  process.stdout.write(`${c.yellow}🗂️  Escaneando workspace...${c.reset}`);
  workspace = readWorkspaceFiles(text);
  if (!workspace.configured) {
    console.log(` ${c.gray}não configurado (WORKSPACE_BACKEND_DIR / WORKSPACE_FRONTEND_DIR)${c.reset}`);
  } else {
    console.log(` ${c.green}OK${c.reset}`);
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
  const confirmed = await confirmLLMSend({
    modes,
    sections,
    metadata,
    workspace,
    sourceFiles: runLGPD ? sourceFiles : null,
    pdfPath,
  });
  if (!confirmed) process.exit(0);

  console.log();

  // ── Análise LGPD (qualidade de anonimização) ─────────────────────────────
  if (runLGPD) {
    process.stdout.write(`${c.yellow}🔒 Análise LGPD — enviando para Claude...${c.reset}`);
    let lgpdReport;
    try {
      const prompt = buildClaudePrompt(sections, findings, sourceFiles, pdfPath, numpages, workspace);
      lgpdReport = await callClaude(prompt);
      lgpdReport = await ensureEvidenceBasedReport({
        mode: 'lgpd',
        report: lgpdReport,
        basePrompt: prompt,
        workspace,
        includePipeline: true,
      });
      console.log(` ${c.green}OK${c.reset}`);
    } catch (err) {
      console.log();
      console.error(`${c.red}❌ ${err.message}${c.reset}\n`);
      process.exit(1);
    }

    const header     = buildReportHeader(pdfPath, findings, numpages);
    const fullReport = header + '## Análise Claude\n\n' + lgpdReport;

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
    process.stdout.write(`${c.yellow}💼 Análise de negócio — enviando para Claude...${c.reset}`);
    let businessReport;
    try {
      const prompt = buildBusinessPrompt(sections, metadata, pdfPath, numpages, workspace);
      businessReport = await callClaude(prompt);
      businessReport = await ensureEvidenceBasedReport({
        mode: 'business',
        report: businessReport,
        basePrompt: prompt,
        workspace,
        includePipeline: false,
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
