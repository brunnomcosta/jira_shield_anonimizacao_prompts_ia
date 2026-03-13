/**
 * browserExtractor.js
 * Extrai comentários Zendesk via automação de browser (Playwright).
 *
 * O Chrome normalmente já está aberto, então não podemos abrir outro processo
 * com o mesmo perfil. A solução é copiar apenas os arquivos de sessão/cookies
 * para um diretório temporário e usar essa cópia.
 */

import { chromium } from 'playwright';
import os from 'os';
import path from 'path';
import fs from 'fs';

// ─── Localização dos perfis ───────────────────────────────────────────────────

function profilePaths() {
  const home = os.homedir();
  return [
    {
      name:    'Chrome',
      dataDir: path.join(home, 'AppData', 'Local', 'Google', 'Chrome', 'User Data'),
      profile: 'Default',
    },
    {
      name:    'Edge',
      dataDir: path.join(home, 'AppData', 'Local', 'Microsoft', 'Edge', 'User Data'),
      profile: 'Default',
    },
  ];
}

/**
 * Copia os arquivos de sessão/cookies de um perfil para um diretório temporário.
 * Não copia arquivos bloqueados (ex: Lock, SingletonLock) para evitar conflitos.
 *
 * Retorna o caminho do diretório temporário criado, ou null se falhar.
 */
function copyProfileToTemp(dataDir, profileDir) {
  try {
    const tmpBase    = path.join(os.tmpdir(), `lgpd-chrome-${Date.now()}`);
    const tmpProfile = path.join(tmpBase, profileDir);
    fs.mkdirSync(tmpProfile, { recursive: true });

    const src = path.join(dataDir, profileDir);
    if (!fs.existsSync(src)) return null;

    // Arquivos relevantes para autenticação (cookies, local storage, session)
    const filesToCopy = [
      'Cookies',
      'Cookies-journal',
      'Local Storage',
      'Session Storage',
      'Web Data',
      'Preferences',
      'Secure Preferences',
      'Network Persistent State',
    ];

    for (const name of filesToCopy) {
      const srcPath = path.join(src, name);
      const dstPath = path.join(tmpProfile, name);
      try {
        if (!fs.existsSync(srcPath)) continue;
        const stat = fs.statSync(srcPath);
        if (stat.isDirectory()) {
          copyDirRecursive(srcPath, dstPath);
        } else {
          fs.copyFileSync(srcPath, dstPath);
        }
      } catch {
        // Arquivo bloqueado ou inacessível — ignora (ex: Cookies pode estar em uso)
      }
    }

    return tmpBase;
  } catch {
    return null;
  }
}

function copyDirRecursive(src, dst) {
  fs.mkdirSync(dst, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const s = path.join(src, entry.name);
    const d = path.join(dst, entry.name);
    try {
      if (entry.isDirectory()) {
        copyDirRecursive(s, d);
      } else {
        fs.copyFileSync(s, d);
      }
    } catch { /* arquivo bloqueado — ignora */ }
  }
}

function removeDirRecursive(dir) {
  try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* ignora */ }
}

// ─── Detecção de payload Zendesk ─────────────────────────────────────────────

function looksLikeZendeskComments(data) {
  if (!data || typeof data !== 'object') return false;
  const arr = data.comments ?? data.results ?? data.data ?? null;
  if (!Array.isArray(arr) || arr.length === 0) return false;
  const first = arr[0];
  return first && (
    typeof first.body      === 'string' ||
    typeof first.html_body === 'string' ||
    typeof first.plain_body === 'string'
  );
}

function normalizeZendeskPayload(data) {
  const rawComments = data.comments ?? data.results ?? data.data ?? [];
  const userMap = {};
  (data.users ?? data.included?.users ?? []).forEach((u) => {
    userMap[u.id] = u;
  });
  const comments = rawComments.map((c) => ({
    id:          c.id,
    author_id:   c.author_id ?? c.authorId ?? null,
    body:        c.body ?? c.plain_body ?? '',
    html_body:   c.html_body ?? c.htmlBody ?? null,
    public:      c.public ?? c.isPublic ?? true,
    created_at:  c.created_at ?? c.createdAt ?? null,
    _authorName: c.author?.name ?? c.authorName ?? null,
  }));
  comments.forEach((c) => {
    if (c.author_id && c._authorName && !userMap[c.author_id]) {
      userMap[c.author_id] = { id: c.author_id, name: c._authorName };
    }
  });
  return { comments, userMap };
}

// ─── Scraping DOM (fallback) ──────────────────────────────────────────────────

async function scrapeFromDom(page) {
  try {
    // Aguarda qualquer conteúdo do painel Zendesk aparecer
    await page.waitForSelector(
      '[data-testid="zendesk-comment"], .zendesk-comment, .zd-comment, ' +
      'iframe[src*="zendesk"], #zendesk-tab-panel, .issue-data-block',
      { timeout: 15000 }
    ).catch(() => null);

    // Tenta em iframes
    for (const frame of page.frames()) {
      const u = frame.url();
      if (!u.includes('zendesk') && !u.includes('totvs') && u !== 'about:blank') continue;
      const items = await frame.evaluate(() => {
        const results = [];
        const sels = ['.comment', '.zd-comment', '[class*="comment"]', 'article'];
        for (const sel of sels) {
          const els = document.querySelectorAll(sel);
          if (els.length === 0) continue;
          els.forEach((el, i) => results.push({
            id: i + 1, body: el.innerText?.trim() || '',
            public: true, created_at: null, _authorName: null,
          }));
          break;
        }
        return results;
      }).catch(() => []);
      if (items.length > 0) return { comments: items, userMap: {} };
    }

    // Tenta na página principal
    const items = await page.evaluate(() => {
      const results = [];
      const sels = ['.zendesk-comment', '[data-comment-id]', '#zendesk-tab-panel .comment'];
      for (const sel of sels) {
        const els = document.querySelectorAll(sel);
        if (els.length === 0) continue;
        els.forEach((el, i) => {
          const authorEl = el.querySelector('[class*="author"], .author, .user-name');
          const dateEl   = el.querySelector('time, [class*="date"]');
          results.push({
            id: i + 1,
            body:        el.innerText?.trim() || '',
            public:      true,
            created_at:  dateEl?.getAttribute('datetime') || dateEl?.innerText || null,
            _authorName: authorEl?.innerText?.trim() || null,
          });
        });
        break;
      }
      return results;
    }).catch(() => []);
    if (items.length > 0) return { comments: items, userMap: {} };
  } catch { /* ignora */ }
  return null;
}

// ─── Extração principal ───────────────────────────────────────────────────────

/**
 * Tenta conectar ao Chrome já aberto via CDP (porta 9222).
 * Requer que o Chrome tenha sido iniciado com --remote-debugging-port=9222.
 * Retorna { context, cdpBrowser } ou null se não houver Chrome com debug ativo.
 */
async function tryConnectToExistingChrome() {
  try {
    const cdpBrowser = await chromium.connectOverCDP('http://localhost:9222');
    const contexts = cdpBrowser.contexts();
    const context = contexts.length > 0 ? contexts[0] : await cdpBrowser.newContext();
    return { context, cdpBrowser };
  } catch {
    return null;
  }
}

/**
 * Extrai comentários Zendesk usando automação de browser.
 * Tenta primeiro conectar ao Chrome já aberto (via CDP na porta 9222),
 * abrindo apenas uma nova aba. Se não houver Chrome com debug ativo,
 * copia os cookies para um perfil temporário e abre nova instância.
 */
export async function fetchZendeskViaBrowser(issueKey, ticketId) {
  const base = process.env.JIRA_BASE_URL?.replace(/\/$/, '');
  if (!base) return null;

  const tabUrl = `${base}/browse/${issueKey}` +
    `?page=com.totvs.jira.plugin.pluginTotvs:issue-zendesk-tab-panel`;

  let tmpDir = null;
  let context = null;
  let cdpBrowser = null;  // conexão CDP (não fecha o browser ao desconectar)
  let ownsContext = false; // true quando lançamos nós mesmos o browser

  try {
    // 1. Tenta reusar o Chrome já aberto via CDP
    const existing = await tryConnectToExistingChrome();
    if (existing) {
      context = existing.context;
      cdpBrowser = existing.cdpBrowser;
      console.log('✅ Conectado ao Chrome já aberto — abrindo nova aba');
    } else {
      // 2. Fallback: lança nova instância com perfil copiado
      ownsContext = true;
      let launched = false;
      for (const { dataDir, profile } of profilePaths()) {
        if (!fs.existsSync(path.join(dataDir, profile))) continue;

        tmpDir = copyProfileToTemp(dataDir, profile);
        if (!tmpDir) continue;

        try {
          context = await chromium.launchPersistentContext(tmpDir, {
            headless: false,
            channel:  'chrome',
            args: [
              '--no-sandbox',
              '--disable-blink-features=AutomationControlled',
              '--disable-infobars',
            ],
          });
          launched = true;
          break;
        } catch {
          removeDirRecursive(tmpDir);
          tmpDir = null;
        }
      }

      // Último recurso: Chromium sem sessão (usuário faz login manualmente)
      if (!launched) {
        const fallbackTmp = path.join(os.tmpdir(), `lgpd-chromium-${Date.now()}`);
        fs.mkdirSync(fallbackTmp, { recursive: true });
        tmpDir = fallbackTmp;
        context = await chromium.launchPersistentContext(tmpDir, {
          headless: false,
          args: ['--no-sandbox', '--disable-infobars'],
        });
      }
    }

    const page = await context.newPage();
    const networkResults = [];

    page.on('response', async (response) => {
      try {
        const ct = response.headers()['content-type'] ?? '';
        if (!ct.includes('json')) return;
        const url = response.url();
        if (!url.includes('comment') && !url.includes('ticket') &&
            !url.includes('zendesk') && !url.includes('totvs')) return;
        const json = await response.json().catch(() => null);
        if (json && looksLikeZendeskComments(json)) {
          networkResults.push(normalizeZendeskPayload(json));
        }
      } catch { /* ignora */ }
    });

    await page.goto(tabUrl, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await page.waitForTimeout(5000);
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight)).catch(() => null);
    await page.waitForTimeout(2000);

    // Verifica redirecionamento SSO
    const currentUrl = page.url();
    if (
      currentUrl.includes('cloudflareaccess.com') ||
      currentUrl.includes('/login') ||
      currentUrl.includes('/sso') ||
      !currentUrl.includes(new URL(base).hostname)
    ) {
      console.log('\n\x1b[33m⚠️  Login necessário — complete o login no browser aberto e aguarde...\x1b[0m\n');
      await page.waitForURL((u) => u.includes(new URL(base).hostname), { timeout: 120000 })
        .catch(() => null);
      await page.waitForTimeout(6000);
    }

    let capturedData = null;

    if (networkResults.length > 0) {
      capturedData = networkResults.reduce(
        (best, cur) => (cur.comments.length > best.comments.length ? cur : best),
        networkResults[0]
      );
    }

    if (!capturedData) {
      capturedData = await scrapeFromDom(page);
    }

    await page.close().catch(() => null);
    return capturedData;

  } finally {
    if (ownsContext) {
      // Fechamos o browser que lançamos nós mesmos
      try { if (context) await context.close(); } catch { /* ignora */ }
      if (tmpDir) removeDirRecursive(tmpDir);
    } else {
      // Apenas desconecta do Chrome existente sem fechá-lo
      try { if (cdpBrowser) await cdpBrowser.close(); } catch { /* ignora */ }
    }
  }
}
