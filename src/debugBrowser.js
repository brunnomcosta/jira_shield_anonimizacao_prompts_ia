#!/usr/bin/env node
/**
 * debugBrowser.js — Diagnóstico do browser para a aba Zendesk
 *
 * Uso:
 *   node src/debugBrowser.js DMANQUALI-12311
 *
 * Salva em ./output/debug/:
 *   - screenshot.png     → printscreen da página após carregamento
 *   - page.html          → HTML completo da página
 *   - network.json       → todas as respostas JSON interceptadas
 */

import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';
import dotenv from 'dotenv';
const __dirname = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: resolve(__dirname, '..', '.env') });

import { chromium } from 'playwright';
import os from 'os';
import path from 'path';
import fs from 'fs';

function profilePaths() {
  const home = os.homedir();
  return [
    { dataDir: path.join(home, 'AppData', 'Local', 'Google', 'Chrome', 'User Data'), profile: 'Default' },
    { dataDir: path.join(home, 'AppData', 'Local', 'Microsoft', 'Edge',   'User Data'), profile: 'Default' },
  ];
}

function copyProfileToTemp(dataDir, profileDir) {
  try {
    const tmpBase    = path.join(os.tmpdir(), `lgpd-debug-${Date.now()}`);
    const tmpProfile = path.join(tmpBase, profileDir);
    fs.mkdirSync(tmpProfile, { recursive: true });

    const src = path.join(dataDir, profileDir);
    if (!fs.existsSync(src)) return null;

    const filesToCopy = [
      'Cookies', 'Cookies-journal', 'Local Storage',
      'Session Storage', 'Web Data', 'Preferences',
      'Secure Preferences', 'Network Persistent State',
    ];

    for (const name of filesToCopy) {
      const s = path.join(src, name);
      const d = path.join(tmpProfile, name);
      try {
        if (!fs.existsSync(s)) continue;
        if (fs.statSync(s).isDirectory()) {
          fs.cpSync(s, d, { recursive: true, errorOnExist: false });
        } else {
          fs.copyFileSync(s, d);
        }
      } catch { /* arquivo bloqueado */ }
    }
    return tmpBase;
  } catch { return null; }
}

function removeDirRecursive(dir) {
  try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* ignora */ }
}

async function main() {
  const issueKey = process.argv[2];
  if (!issueKey) {
    console.error('\nUso: node src/debugBrowser.js DMANQUALI-12311\n');
    process.exit(1);
  }

  const base = process.env.JIRA_BASE_URL?.replace(/\/$/, '');
  if (!base) { console.error('JIRA_BASE_URL não configurada'); process.exit(1); }

  const tabUrl = `${base}/browse/${issueKey}?page=com.totvs.jira.plugin.pluginTotvs:issue-zendesk-tab-panel`;

  const debugDir = path.resolve('output', 'debug');
  fs.mkdirSync(debugDir, { recursive: true });

  console.log(`\n🔍 Diagnóstico do browser para ${issueKey}`);
  console.log(`   URL: ${tabUrl}`);
  console.log(`   Output: ${debugDir}\n`);

  let tmpDir = null;
  let context = null;
  let cdpBrowser = null;
  let ownsContext = false;

  try {
    // 1. Tenta conectar ao Chrome já aberto via CDP (porta 9222)
    try {
      cdpBrowser = await chromium.connectOverCDP('http://localhost:9222');
      const contexts = cdpBrowser.contexts();
      context = contexts.length > 0 ? contexts[0] : await cdpBrowser.newContext();
      console.log('✅ Conectado ao Chrome já aberto — abrindo nova aba');
    } catch {
      cdpBrowser = null;
    }

    // 2. Fallback: lança nova instância com perfil copiado
    if (!context) {
      ownsContext = true;
      for (const { dataDir, profile } of profilePaths()) {
        if (!fs.existsSync(path.join(dataDir, profile))) continue;
        tmpDir = copyProfileToTemp(dataDir, profile);
        if (!tmpDir) continue;
        try {
          context = await chromium.launchPersistentContext(tmpDir, {
            headless: false,
            channel:  'chrome',
            args: ['--no-sandbox', '--disable-infobars', '--disable-blink-features=AutomationControlled'],
          });
          console.log('✅ Browser lançado com perfil do Chrome');
          break;
        } catch (e) {
          removeDirRecursive(tmpDir); tmpDir = null;
          console.log(`⚠️  Chrome falhou (${e.message.split('\n')[0]}), tentando Edge...`);
        }
      }
    }

    if (!context) {
      ownsContext = true;
      const tmp = path.join(os.tmpdir(), `lgpd-debug-clean-${Date.now()}`);
      fs.mkdirSync(tmp, { recursive: true });
      tmpDir = tmp;
      context = await chromium.launchPersistentContext(tmp, {
        headless: false,
        args: ['--no-sandbox'],
      });
      console.log('⚠️  Browser limpo (sem sessão SSO — faça login se necessário)');
    }

    const page = await context.newPage();

    // Captura TODAS as respostas JSON (sem filtro de URL)
    const allNetworkResponses = [];
    page.on('response', async (response) => {
      const url = response.url();
      const ct  = response.headers()['content-type'] ?? '';
      if (!ct.includes('json') && !ct.includes('javascript')) return;
      try {
        const json = await response.json();
        allNetworkResponses.push({
          url,
          status: response.status(),
          ct,
          body: json,
        });
      } catch { /* não era JSON válido */ }
    });

    console.log('🌐 Navegando para a aba Zendesk...');
    await page.goto(tabUrl, { waitUntil: 'domcontentloaded', timeout: 60000 });

    // Aguarda SSO se necessário
    const afterNav = page.url();
    if (!afterNav.includes(new URL(base).hostname)) {
      console.log('⚠️  Redirecionado para SSO — complete o login no browser e pressione Enter aqui...');
      await new Promise((r) => process.stdin.once('data', r));
      await page.waitForTimeout(5000);
    }

    console.log('⏳ Aguardando carregamento do plugin (10s)...');
    await page.waitForTimeout(10000);
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight)).catch(() => null);
    await page.waitForTimeout(3000);

    // Screenshot
    const ssPath = path.join(debugDir, 'screenshot.png');
    await page.screenshot({ path: ssPath, fullPage: true });
    console.log(`📸 Screenshot salvo: ${ssPath}`);

    // HTML completo da página
    const html = await page.content();
    fs.writeFileSync(path.join(debugDir, 'page.html'), html, 'utf8');
    console.log(`📄 HTML salvo: ${path.join(debugDir, 'page.html')}`);

    // HTML de cada iframe
    for (const [i, frame] of page.frames().entries()) {
      if (frame === page.mainFrame()) continue;
      try {
        const fHtml = await frame.content();
        const fPath = path.join(debugDir, `frame_${i}.html`);
        fs.writeFileSync(fPath, fHtml, 'utf8');
        console.log(`🖼️  Frame ${i} (${frame.url().substring(0, 80)}) salvo: ${fPath}`);
      } catch { /* frame sem acesso */ }
    }

    // Respostas de rede
    const netPath = path.join(debugDir, 'network.json');
    fs.writeFileSync(netPath, JSON.stringify(allNetworkResponses, null, 2), 'utf8');
    console.log(`🌐 ${allNetworkResponses.length} resposta(s) JSON salvas: ${netPath}`);

    // Resumo das URLs interceptadas
    if (allNetworkResponses.length > 0) {
      console.log('\n── URLs interceptadas ──────────────────────');
      allNetworkResponses.forEach((r) => console.log(`  [${r.status}] ${r.url}`));
    }

    await page.close().catch(() => null);

    console.log('\n✅ Diagnóstico completo. Verifique os arquivos em output/debug/');
    console.log('   Envie screenshot.png e network.json para análise.\n');

  } finally {
    if (ownsContext) {
      try { if (context) await context.close(); } catch { /* ignora */ }
      if (tmpDir) removeDirRecursive(tmpDir);
    } else {
      try { if (cdpBrowser) await cdpBrowser.close(); } catch { /* ignora */ }
    }
  }
}

main().catch((e) => { console.error('Erro:', e.message); process.exit(1); });
