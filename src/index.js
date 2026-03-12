#!/usr/bin/env node
/**
 * index.js — CLI principal do LGPD Export (Jira Server)
 *
 * Uso:
 *   node src/index.js DMANQUALI-12311
 *   node src/index.js DMANQUALI-12311 DMANQUALI-12312 DMANQUALI-12313
 *
 * O PDF anonimizado é salvo em ./output/<ISSUE_KEY>_LGPD_anonimizado.pdf
 */

import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';
import dotenv from 'dotenv';

const __dirname = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: resolve(__dirname, '..', '.env') });

import fs   from 'fs';
import path from 'path';
import { fetchIssue, testConnection, fetchZendeskViaJira } from './jiraClient.js';
import { anonymizeIssue }                                   from './anonymizer.js';
import { generatePDF }                                      from './pdfGenerator.js';
import { isConfigured, extractTicketId, fetchTicketComments } from './zendeskClient.js';
import { fetchZendeskViaBrowser }                            from './browserExtractor.js';

// ─── Cores para o terminal (sem dependência extra) ───────────────────────────
const c = {
  reset:  '\x1b[0m',
  bold:   '\x1b[1m',
  green:  '\x1b[32m',
  yellow: '\x1b[33m',
  red:    '\x1b[31m',
  cyan:   '\x1b[36m',
  gray:   '\x1b[90m',
};

function log(icon, msg, color = c.reset) {
  console.log(`${color}${icon}  ${msg}${c.reset}`);
}

// ─── Exportar uma issue ───────────────────────────────────────────────────────

/**
 * Modos de exportação:
 *   'jira-only' — apenas descrição + comentários Jira (rápido, sem browser)
 *   'full'      — inclui Zendesk Comments via proxy, API direta e browser SSO (padrão)
 */
async function exportIssue(issueKey, mode = 'full') {
  const outputDir = process.env.OUTPUT_DIR || './output';
  fs.mkdirSync(outputDir, { recursive: true });

  log('⏳', `Buscando ${c.bold}${issueKey}${c.reset}...`, c.cyan);

  // 1. Buscar issue via API REST
  const issue = await fetchIssue(issueKey);
  log('✅', `Issue encontrada: ${issue.fields?.summary?.substring(0, 60)}`, c.green);

  // 1b. Buscar Zendesk Comments (apenas no modo 'full')
  let zendeskData = null;

  if (mode === 'jira-only') {
    log('ℹ️', `Modo jira-only — Zendesk ignorado`, c.gray);
  } else {
    const zdField    = process.env.ZENDESK_JIRA_FIELD || 'customfield_11086';
    const zdFieldVal = issue.fields?.[zdField];
    const ticketId   = extractTicketId(zdFieldVal);

    if (ticketId) {
      log('🎫', `Buscando Zendesk Comments (ticket #${ticketId})...`, c.cyan);

      // Estratégia 1: proxy via plugin Zendesk no próprio Jira (sem credenciais extras)
      try {
        zendeskData = await fetchZendeskViaJira(ticketId, issueKey);
        if (zendeskData) {
          log('✅', `${zendeskData.comments.length} Zendesk comment(s) via proxy Jira`, c.green);
        }
      } catch { /* silencioso — tenta próxima estratégia */ }

      // Estratégia 2: API direta do Zendesk (se credenciais configuradas)
      if (!zendeskData && isConfigured()) {
        try {
          zendeskData = await fetchTicketComments(ticketId);
          log('✅', `${zendeskData.comments.length} Zendesk comment(s) via API Zendesk`, c.green);
        } catch (err) {
          log('⚠️', `Zendesk via API: ${err.message}`, c.yellow);
        }
      }

      // Estratégia 3: automação de browser (reusa sessão SSO do Chrome/Edge)
      if (!zendeskData) {
        log('🌐', `Abrindo browser para extrair Zendesk Comments (ticket #${ticketId})...`, c.cyan);
        try {
          zendeskData = await fetchZendeskViaBrowser(issueKey, ticketId);
          if (zendeskData && zendeskData.comments.length > 0) {
            log('✅', `${zendeskData.comments.length} Zendesk comment(s) via browser`, c.green);
          } else {
            zendeskData = null;
            log('⚠️', `Browser aberto mas nenhum comentário Zendesk encontrado no DOM`, c.yellow);
          }
        } catch (err) {
          log('⚠️', `Browser extraction: ${err.message}`, c.yellow);
        }
      }

      if (!zendeskData) {
        log('⚠️', `Zendesk Comments indisponíveis — todas as estratégias falharam`, c.yellow);
      }
    } else {
      log('ℹ️', `Campo ${zdField} sem ticket Zendesk vinculado`, c.gray);
    }
  }

  // 2. Anonimizar
  log('🔒', 'Aplicando anonimização LGPD...', c.yellow);
  const { anonIssue, summary } = anonymizeIssue(issue, zendeskData);

  log(
    '📊',
    `Entidades detectadas: ${c.bold}${summary.totalPessoas} pessoa(s)${c.reset}, ` +
    `${c.bold}${summary.totalEmpresas} empresa(s)${c.reset}`,
    c.gray
  );

  // 3. Gerar PDF
  log('📄', 'Gerando PDF...', c.yellow);
  const pdfBuffer = generatePDF(anonIssue);

  // 4. Salvar
  const filename = `${issueKey}_LGPD_anonimizado.pdf`;
  const filepath = path.join(outputDir, filename);
  fs.writeFileSync(filepath, pdfBuffer);

  // 5. Log de auditoria local
  const auditPath = path.join(outputDir, 'audit.log');
  const auditLine = JSON.stringify({
    timestamp:   new Date().toISOString(),
    issueKey,
    filename,
    entidades:   summary,
  }) + '\n';
  fs.appendFileSync(auditPath, auditLine);

  log('✅', `PDF salvo em: ${c.bold}${filepath}${c.reset}`, c.green);
  return filepath;
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  console.log();
  console.log(`${c.bold}${c.cyan}╔══════════════════════════════════════════╗`);
  console.log(`║   SHIELD — LGPD Export (Jira Server)     ║`);
  console.log(`╚══════════════════════════════════════════╝${c.reset}`);
  console.log();

  const rawArgs  = process.argv.slice(2);
  const flags    = rawArgs.filter((a) => a.startsWith('--'));
  const args     = rawArgs.filter((a) => !a.startsWith('--'));
  const jiraOnly = flags.includes('--jira-only');
  const mode     = jiraOnly ? 'jira-only' : 'full';

  if (args.length === 0) {
    console.log(`${c.yellow}Uso:${c.reset}  node src/index.js [--jira-only] <ISSUE_KEY> [ISSUE_KEY2 ...]`);
    console.log();
    console.log(`${c.bold}Modos disponíveis:${c.reset}`);
    console.log(`  ${c.green}(padrão)${c.reset}       Exportação completa — Jira + Zendesk Comments (proxy → API → browser SSO)`);
    console.log(`  ${c.green}--jira-only${c.reset}    Apenas Jira — ignora Zendesk, sem abertura de browser`);
    console.log();
    console.log(`${c.gray}Exemplos:${c.reset}`);
    console.log(`  node src/index.js DMANQUALI-12311`);
    console.log(`  node src/index.js --jira-only DMANQUALI-12311`);
    console.log(`  node src/index.js DMANQUALI-12311 DMANQUALI-12312`);
    console.log();
    process.exit(1);
  }

  if (jiraOnly) {
    log('ℹ️', `Modo: ${c.bold}jira-only${c.reset} — Zendesk desabilitado`, c.gray);
  } else {
    log('ℹ️', `Modo: ${c.bold}completo${c.reset} — Jira + Zendesk (proxy → API → browser)`, c.gray);
  }
  console.log();

  // Testar conexão antes de tudo
  log('🔌', `Conectando em ${process.env.JIRA_BASE_URL}...`, c.cyan);
  try {
    const info = await testConnection();
    log('✅', `Jira Server ${info.version} — conexão OK`, c.green);
  } catch (err) {
    log('❌', `Falha na conexão: ${err.message}`, c.red);
    console.log();
    console.log(`${c.yellow}Verifique o arquivo .env:${c.reset}`);
    console.log('  JIRA_BASE_URL=https://jiraproducao.totvs.com.br');
    console.log('  JIRA_TOKEN=seu_token_aqui');
    console.log();
    process.exit(1);
  }

  console.log();

  // Exportar cada issue
  const results = { ok: [], fail: [] };

  for (const issueKey of args) {
    try {
      const filepath = await exportIssue(issueKey, mode);
      results.ok.push({ issueKey, filepath });
    } catch (err) {
      log('❌', `${issueKey}: ${err.message}`, c.red);
      results.fail.push({ issueKey, error: err.message });
    }
    console.log();
  }

  // Resumo final
  console.log(`${c.bold}─── Resumo ───────────────────────────${c.reset}`);
  console.log(`${c.green}✅ Exportados: ${results.ok.length}${c.reset}`);
  if (results.fail.length > 0) {
    console.log(`${c.red}❌ Com falha:  ${results.fail.length}${c.reset}`);
    results.fail.forEach(({ issueKey, error }) =>
      console.log(`   ${c.gray}${issueKey}: ${error}${c.reset}`)
    );
  }
  console.log();
}

main().catch((err) => {
  console.error(`\n${c.red}Erro fatal: ${err.message}${c.reset}\n`);
  process.exit(1);
});
