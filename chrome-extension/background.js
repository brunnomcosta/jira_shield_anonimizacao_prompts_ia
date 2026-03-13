importScripts(
  'vendor/jspdf.umd.min.js',
  'portuguese-common-words.js',
  'shield-core.js',
  'pdf.js',
  'prompt-shared.js',
  'prompt-templates.js',
  'prompt-template-diagnostic.js',
  'generated-project-env.js',
  'issue-technical-context.js',
  'local-workspace.js'
);

const DEFAULTS = {
  jiraBaseUrl: '',
  jiraToken: '',
  jiraUser: '',
  jiraPassword: '',
  zendeskBaseUrl: '',
  zendeskUser: '',
  zendeskToken: '',
  zendeskJiraField: 'customfield_11086',
  downloadFolder: 'shield',
  aiProvider: 'gemini',
  aiAction: 'copy-and-open',
  projectRootDirLabel: '',
  workspaceErpBackendDirLabel: '',
  workspaceMobileFrontendDirLabel: '',
  workspaceErpIncludeDirLabel: '',
  activePromptTemplateId: 'documentation',
  promptTemplateOverrides: {},
  promptTemplateAdditions: {},
};

const GENERATED_PROJECT_ENV_META = (globalThis.SHIELD && SHIELD.generatedProjectEnv) || {};
const GENERATED_PROJECT_ENV = GENERATED_PROJECT_ENV_META.values || {};
Object.assign(DEFAULTS, {
  projectRootDirLabel: GENERATED_PROJECT_ENV_META.projectRootDir || DEFAULTS.projectRootDirLabel,
  workspaceErpBackendDirLabel: GENERATED_PROJECT_ENV.WORKSPACE_ERP_BACKEND_DIR || DEFAULTS.workspaceErpBackendDirLabel,
  workspaceMobileFrontendDirLabel: GENERATED_PROJECT_ENV.WORKSPACE_MOBILE_FRONTEND_DIR || DEFAULTS.workspaceMobileFrontendDirLabel,
  workspaceErpIncludeDirLabel: GENERATED_PROJECT_ENV.WORKSPACE_ERP_INCLUDE_DIR || DEFAULTS.workspaceErpIncludeDirLabel,
});

function applyGeneratedProjectEnvFallback(settings) {
  return {
    ...settings,
    projectRootDirLabel: settings.projectRootDirLabel || GENERATED_PROJECT_ENV_META.projectRootDir || '',
    workspaceErpBackendDirLabel: settings.workspaceErpBackendDirLabel || GENERATED_PROJECT_ENV.WORKSPACE_ERP_BACKEND_DIR || '',
    workspaceMobileFrontendDirLabel: settings.workspaceMobileFrontendDirLabel || GENERATED_PROJECT_ENV.WORKSPACE_MOBILE_FRONTEND_DIR || '',
    workspaceErpIncludeDirLabel: settings.workspaceErpIncludeDirLabel || GENERATED_PROJECT_ENV.WORKSPACE_ERP_INCLUDE_DIR || '',
  };
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function storageGet(keys) {
  return new Promise((resolve) => {
    chrome.storage.local.get(keys, resolve);
  });
}

function storageSet(payload) {
  return new Promise((resolve, reject) => {
    chrome.storage.local.set(payload, () => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
        return;
      }
      resolve();
    });
  });
}

function downloadsDownload(options) {
  return new Promise((resolve, reject) => {
    chrome.downloads.download(options, (downloadId) => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
        return;
      }
      resolve(downloadId);
    });
  });
}

function tabsCreate(options) {
  return new Promise((resolve, reject) => {
    chrome.tabs.create(options, (tab) => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
        return;
      }
      resolve(tab);
    });
  });
}

function tabsRemove(tabId) {
  return new Promise((resolve) => {
    chrome.tabs.remove(tabId, () => resolve());
  });
}

function executeScript(options) {
  return new Promise((resolve, reject) => {
    chrome.scripting.executeScript(options, (result) => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
        return;
      }
      resolve(result);
    });
  });
}

async function getSettings() {
  const stored = await storageGet(DEFAULTS);
  return applyGeneratedProjectEnvFallback({ ...DEFAULTS, ...stored });
}

function sanitizeBaseUrl(url) {
  return String(url || '').trim().replace(/\/$/, '');
}

function normalizeDownloadFolder(folder) {
  return String(folder || 'shield').trim().replace(/^\/+|\/+$/g, '') || 'shield';
}

function buildJiraHeaders(settings) {
  const headers = {
    Accept: 'application/json',
    'Content-Type': 'application/json',
    'X-Atlassian-Token': 'no-check',
    'User-Agent': 'SHIELD-Chrome-Extension',
  };

  if (settings.jiraToken) {
    headers.Authorization = `Bearer ${settings.jiraToken}`;
  } else if (settings.jiraUser && settings.jiraPassword) {
    headers.Authorization = `Basic ${btoa(`${settings.jiraUser}:${settings.jiraPassword}`)}`;
  }

  return headers;
}

function buildZendeskHeaders(settings) {
  const headers = {
    Accept: 'application/json',
    'Content-Type': 'application/json',
  };

  if (settings.zendeskUser && settings.zendeskToken) {
    headers.Authorization = `Basic ${btoa(`${settings.zendeskUser}/token:${settings.zendeskToken}`)}`;
  }

  return headers;
}

function getAuthMode(settings) {
  if (settings.jiraToken) return 'token';
  if (settings.jiraUser && settings.jiraPassword) return 'basic';
  return 'browser-session';
}

function getZendeskMode(settings) {
  if (settings.zendeskBaseUrl && settings.zendeskUser && settings.zendeskToken) {
    return 'proxy-api-tab';
  }
  return 'proxy-tab';
}

function getAIProviderLabel(provider) {
  const labels = {
    claude: 'Claude.ai',
    chatgpt: 'ChatGPT',
    gemini: 'Gemini',
    copilot: 'Copilot',
  };
  return labels[provider] || 'Claude.ai';
}

function getAIActionLabel(action) {
  return action === 'copy-only' ? 'Somente copiar prompt' : 'Copiar prompt e abrir IA';
}

function buildCapabilities(settings) {
  const capabilities = [
    'PDF anonimizado da issue',
    'metadata JSON para o diagnostics.js',
    'fila de multiplas issue keys',
    'historico local das exportacoes',
    'templates editaveis de prompt para LLM',
    'prompt de documentacao, prompt diagnostico e prompt diagnostico + contexto fontes',
    'sincronizacao opcional com .env do projeto local',
    settings.aiAction === 'copy-only'
      ? 'prompt de IA copiado para a area de transferencia'
      : 'prompt de IA copiado com abertura automatica da IA favorita',
  ];

  if (settings.zendeskBaseUrl && settings.zendeskUser && settings.zendeskToken) {
    capabilities.push('fallback Zendesk por API direta');
  } else {
    capabilities.push('fallback Zendesk por proxy Jira e aba da issue');
  }

  return capabilities;
}

async function fetchText(url, options) {
  const response = await fetch(url, options);
  const body = await response.text().catch(() => '');
  return { response, body };
}

async function fetchIssue(issueKey, settings) {
  const base = sanitizeBaseUrl(settings.jiraBaseUrl);
  if (!base) {
    throw new Error('Defina JIRA_BASE_URL nas opcoes da extensao.');
  }

  const zdField = settings.zendeskJiraField || 'customfield_11086';
  const url = `${base}/rest/api/2/issue/${issueKey}` +
    `?expand=renderedFields,names,transitions` +
    `&fields=summary,status,priority,assignee,reporter,description,` +
    `comment,created,updated,issuetype,project,${zdField},` +
    `customfield_29200,customfield_29201,customfield_29202,` +
    `labels,components,fixVersions,versions,issuelinks,subtasks,parent,attachment,` +
    `customfield_10014,customfield_10008,` +
    `customfield_11078,customfield_11069,` +
    `customfield_11071,customfield_11085,customfield_11053,customfield_11038`;

  const { response, body } = await fetchText(url, {
    method: 'GET',
    headers: buildJiraHeaders(settings),
    credentials: 'include',
  });

  if (!response.ok) {
    if (response.status === 401) {
      throw new Error(`Jira ${issueKey}: autenticacao falhou (401). Use token/API ou abra a sessao no navegador.`);
    }
    if (response.status === 403) {
      throw new Error(`Jira ${issueKey}: sem permissao para acessar a issue (403).`);
    }
    if (response.status === 404) {
      throw new Error(`Jira ${issueKey}: issue nao encontrada (404).`);
    }
    throw new Error(`Jira ${issueKey}: erro HTTP ${response.status}. ${body || 'Sem detalhes.'}`);
  }

  return JSON.parse(body);
}

async function fetchZendeskViaJira(ticketId, issueKey, settings) {
  const base = sanitizeBaseUrl(settings.jiraBaseUrl);
  if (!base) return null;

  const candidates = [
    `${base}/rest/zndzjira/1.0/api/tickets/${ticketId}/comments?include=users`,
    `${base}/rest/zndzjira/1.0/tickets/${ticketId}/comments`,
    `${base}/rest/zis/1.0/tickets/${ticketId}/comments`,
    `${base}/rest/zndzjira/1.0/api/issues/${issueKey}/zendesk-comments`,
    `${base}/plugins/servlet/ac/com.zendesk.jira-app/zendesk-comments?issueKey=${issueKey}`,
  ];

  for (const url of candidates) {
    try {
      const { response, body } = await fetchText(url, {
        method: 'GET',
        headers: buildJiraHeaders(settings),
        credentials: 'include',
      });

      if (!response.ok) continue;

      const data = JSON.parse(body);
      if (!SHIELD.core.looksLikeZendeskComments(data)) continue;

      const normalized = SHIELD.core.normalizeZendeskPayload(data);
      normalized._source = 'jira-proxy';
      normalized._sourceUrl = url;
      return normalized;
    } catch (error) {
      void error;
    }
  }

  return null;
}

async function fetchZendeskViaApi(ticketId, settings) {
  const base = sanitizeBaseUrl(settings.zendeskBaseUrl);
  if (!base || !settings.zendeskUser || !settings.zendeskToken) return null;

  const url = `${base}/api/v2/tickets/${ticketId}/comments?include=users&per_page=100`;
  const { response, body } = await fetchText(url, {
    method: 'GET',
    headers: buildZendeskHeaders(settings),
  });

  if (!response.ok) {
    return null;
  }

  const data = JSON.parse(body);
  const normalized = SHIELD.core.normalizeZendeskPayload(data);
  normalized._source = 'zendesk-api';
  return normalized;
}

function scrapeZendeskDom() {
  function normalizeText(value) {
    return value ? value.replace(/\s+/g, ' ').trim() : '';
  }

  function collectFromRoot(root) {
    const results = [];
    if (!root || !root.querySelectorAll) return results;

    const selectors = [
      '[data-testid="zendesk-comment"]',
      '.zendesk-comment',
      '.zd-comment',
      '#zendesk-tab-panel .comment',
      '[data-comment-id]',
      'article[data-comment-id]',
    ];

    for (const selector of selectors) {
      const nodes = root.querySelectorAll(selector);
      if (!nodes.length) continue;

      nodes.forEach((node, index) => {
        const authorNode = node.querySelector('[class*="author"], .author, .user-name, strong');
        const dateNode = node.querySelector('time, [class*="date"]');
        const body = normalizeText(node.innerText || node.textContent || '');
        if (!body) return;

        results.push({
          id: node.getAttribute('data-comment-id') || index + 1,
          author_id: null,
          body,
          public: !/privado/i.test(body),
          created_at: dateNode ? (dateNode.getAttribute('datetime') || normalizeText(dateNode.textContent)) : null,
          _authorName: authorNode ? normalizeText(authorNode.textContent) : null,
        });
      });

      if (results.length) return results;
    }

    return results;
  }

  const collected = collectFromRoot(document);
  if (collected.length) {
    return { comments: collected, userMap: {} };
  }

  const frames = Array.from(document.querySelectorAll('iframe'));
  for (const frame of frames) {
    try {
      const frameDoc = frame.contentDocument || (frame.contentWindow && frame.contentWindow.document);
      const frameResults = collectFromRoot(frameDoc);
      if (frameResults.length) {
        return { comments: frameResults, userMap: {} };
      }
    } catch (error) {
      void error;
    }
  }

  return null;
}

function waitForTabComplete(tabId, timeoutMs) {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      chrome.tabs.onUpdated.removeListener(listener);
      reject(new Error('Tempo excedido ao abrir a aba Jira/Zendesk.'));
    }, timeoutMs || 60000);

    function cleanup() {
      clearTimeout(timeout);
      chrome.tabs.onUpdated.removeListener(listener);
    }

    function listener(updatedTabId, info) {
      if (updatedTabId === tabId && info.status === 'complete') {
        cleanup();
        resolve();
      }
    }

    chrome.tabs.onUpdated.addListener(listener);
  });
}

async function fetchZendeskViaTab(issueKey, settings) {
  const base = sanitizeBaseUrl(settings.jiraBaseUrl);
  if (!base) return null;

  const tabUrl = `${base}/browse/${issueKey}?page=com.totvs.jira.plugin.pluginTotvs:issue-zendesk-tab-panel`;
  const tab = await tabsCreate({ url: tabUrl, active: false });

  try {
    await waitForTabComplete(tab.id, 60000);

    for (let attempt = 0; attempt < 3; attempt += 1) {
      await delay(2500);
      const results = await executeScript({
        target: { tabId: tab.id },
        func: scrapeZendeskDom,
      });

      const payload = results && results[0] ? results[0].result : null;
      if (payload && payload.comments && payload.comments.length) {
        payload._source = 'jira-tab-scrape';
        return payload;
      }
    }
  } finally {
    await tabsRemove(tab.id);
  }

  return null;
}

function buildMetadata(issueKey, issue, zendeskData, settings, technicalContextOverride = null) {
  const fields = issue.fields || {};
  const zdField = settings.zendeskJiraField || 'customfield_11086';
  const technicalContext = technicalContextOverride || (SHIELD.issueTechnicalContext
    ? SHIELD.issueTechnicalContext.extractIssueTechnicalContext(issue, zendeskData)
    : null);

  let sprint = null;
  const sprintRaw = fields.customfield_10014;
  if (Array.isArray(sprintRaw) && sprintRaw.length > 0) {
    const last = sprintRaw[sprintRaw.length - 1];
    if (last && typeof last === 'object' && last.name) {
      sprint = last.name;
    } else if (typeof last === 'string') {
      const match = last.match(/name=([^,\]]+)/);
      sprint = match ? match[1].trim() : last;
    }
  } else if (typeof sprintRaw === 'string') {
    sprint = sprintRaw;
  }

  let zendeskTicketId = null;
  const zdFieldVal = fields[zdField];
  if (Array.isArray(zdFieldVal) && zdFieldVal.length > 0) {
    zendeskTicketId = String((zdFieldVal[0] && zdFieldVal[0].id) || zdFieldVal[0] || '').trim() || null;
  } else if (zdFieldVal) {
    const match = String(zdFieldVal).match(/\d+/);
    zendeskTicketId = match ? match[0] : null;
  }

  return SHIELD.core.sanitizeStructuredData({
    issueKey,
    summary: fields.summary || '',
    status: fields.status && fields.status.name ? fields.status.name : '',
    issueType: fields.issuetype && fields.issuetype.name ? fields.issuetype.name : '',
    priority: fields.priority && fields.priority.name ? fields.priority.name : '',
    project: fields.project && fields.project.name ? fields.project.name : '',
    projectKey: fields.project && fields.project.key ? fields.project.key : '',
    created: fields.created || null,
    updated: fields.updated || null,
    labels: fields.labels || [],
    components: (fields.components || []).map((item) => item.name),
    fixVersions: (fields.fixVersions || []).map((item) => item.name),
    affectedVersions: (fields.versions || []).map((item) => item.name),
    issueLinks: (fields.issuelinks || []).map((link) => ({
      type: link.type && link.type.name ? link.type.name : '',
      direction: link.inwardIssue ? 'inward' : 'outward',
      key: ((link.inwardIssue || link.outwardIssue) || {}).key || '',
      summary: (((link.inwardIssue || link.outwardIssue) || {}).fields || {}).summary || '',
      status: ((((link.inwardIssue || link.outwardIssue) || {}).fields || {}).status || {}).name || '',
    })),
    subtasks: (fields.subtasks || []).map((item) => ({
      key: item.key,
      summary: item.fields && item.fields.summary ? item.fields.summary : '',
      status: item.fields && item.fields.status ? item.fields.status.name : '',
    })),
    parent: fields.parent ? {
      key: fields.parent.key,
      summary: fields.parent.fields && fields.parent.fields.summary ? fields.parent.fields.summary : '',
    } : null,
    sprint,
    epicKey: fields.customfield_10008 || null,
    rotina:  fields.customfield_11078 && fields.customfield_11078.value ? fields.customfield_11078.value : null,
    modulo:  fields.customfield_11069 && fields.customfield_11069.value ? fields.customfield_11069.value : null,
    attachmentNames: (fields.attachment || []).map((item) => item.filename),
    commentCount: fields.comment
      ? (typeof fields.comment.total === 'number' ? fields.comment.total : ((fields.comment.comments || []).length))
      : 0,
    zendeskTicketId,
    technicalContext,
  });
}

async function storeAuditEntry(entry) {
  const storage = await storageGet({ auditHistory: [] });
  const next = [entry, ...(storage.auditHistory || [])].slice(0, 100);
  await storageSet({ auditHistory: next });
}

async function blobToDataUrl(blob) {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  const chunkSize = 0x8000;
  let binary = '';

  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    const chunk = bytes.subarray(offset, offset + chunkSize);
    binary += String.fromCharCode(...chunk);
  }

  const mimeType = blob.type || 'application/octet-stream';
  return `data:${mimeType};base64,${btoa(binary)}`;
}

async function downloadBlob(blob, filename) {
  const url = await blobToDataUrl(blob);
  return downloadsDownload({
    url,
    filename,
    saveAs: false,
    conflictAction: 'overwrite',
  });
}

function describeZendeskStatus(mode, ticketId, zendeskData) {
  if (mode === 'jira-only') return 'jira-only';
  if (zendeskData && zendeskData._source) return zendeskData._source;
  if (ticketId) return 'ticket-sem-retorno';
  return 'sem-ticket-zendesk';
}

function buildAnonymizedText(anonIssue) {
  const f = anonIssue.fields || {};
  const lines = [];
  const technicalContextText = SHIELD.issueTechnicalContext
    ? SHIELD.issueTechnicalContext.buildTechnicalContextTextSection(
      anonIssue.technicalContext || f.technicalContext || null,
      { includeHeading: true, includeNote: true }
    )
    : '';
  if (f.summary) lines.push(`RESUMO: ${f.summary}`);
  if (f.status && f.status.name) lines.push(`STATUS: ${f.status.name}`);
  if (f.priority && f.priority.name) lines.push(`PRIORIDADE: ${f.priority.name}`);
  if (f.issuetype && f.issuetype.name) lines.push(`TIPO: ${f.issuetype.name}`);
  if (f.description) {
    lines.push('');
    lines.push('DESCRIÇÃO:');
    lines.push(f.description);
  }
  const comments = (f.comment && f.comment.comments) || [];
  if (comments.length) {
    lines.push('');
    lines.push(`COMENTÁRIOS (${comments.length}):`);
    comments.forEach((c, i) => {
      const author = (c.author && c.author.displayName) || '[PESSOA]';
      const date = c.created ? new Date(c.created).toLocaleString('pt-BR') : '';
      lines.push(`--- Comentário ${i + 1} | ${author} | ${date} ---`);
      lines.push(c.body || '');
    });
  }
  if (technicalContextText) {
    lines.push('');
    lines.push(technicalContextText);
  }
  return lines.join('\n');
}

function buildAnonymizedPromptText(anonIssue) {
  const f = anonIssue.fields || {};
  const jiraComments = (f.comment && f.comment.comments) || [];
  const zendeskComments = f.zdComments || [];
  const lines = [];
  const history = [];
  const technicalContextText = SHIELD.issueTechnicalContext
    ? SHIELD.issueTechnicalContext.buildTechnicalContextTextSection(
      anonIssue.technicalContext || f.technicalContext || null,
      { includeHeading: true, includeNote: true }
    )
    : '';

  function formatDate(value) {
    if (!value) return '';
    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) {
      return String(value);
    }
    return parsed.toLocaleString('pt-BR');
  }

  function pushHistoryItem(source, comment, index) {
    const body = String((comment && comment.body) || '').trim();
    if (!body) return;

    const rawDate = source === 'Zendesk' ? comment.created_at : comment.created;
    const parsed = rawDate ? Date.parse(rawDate) : Number.NaN;

    history.push({
      order: index,
      sortValue: Number.isNaN(parsed) ? Number.POSITIVE_INFINITY : parsed,
      source,
      author: (comment && comment.author && comment.author.displayName) || '[PESSOA]',
      date: formatDate(rawDate),
      visibility: source === 'Zendesk'
        ? (comment.public === false ? 'Interno' : 'Publico')
        : null,
      body,
    });
  }

  if (f.summary) lines.push(`RESUMO: ${f.summary}`);
  if (f.status && f.status.name) lines.push(`STATUS: ${f.status.name}`);
  if (f.priority && f.priority.name) lines.push(`PRIORIDADE: ${f.priority.name}`);
  if (f.issuetype && f.issuetype.name) lines.push(`TIPO: ${f.issuetype.name}`);

  if (f.description) {
    lines.push('');
    lines.push('DESCRICAO:');
    lines.push(f.description);
  }

  if (f.zdContact) {
    lines.push('');
    lines.push('CONTATO ZENDESK ANONIMIZADO:');
    if (f.zdContact.nome) lines.push(`Nome: ${f.zdContact.nome}`);
    if (f.zdContact.email) lines.push(`Email: ${f.zdContact.email}`);
    if (f.zdContact.fone) lines.push(`Telefone: ${f.zdContact.fone}`);
  }

  jiraComments.forEach((comment, index) => pushHistoryItem('Jira', comment, index));
  zendeskComments.forEach((comment, index) => pushHistoryItem('Zendesk', comment, jiraComments.length + index));

  if (history.length) {
    history.sort((a, b) => {
      if (a.sortValue !== b.sortValue) return a.sortValue - b.sortValue;
      return a.order - b.order;
    });

    lines.push('');
    lines.push(`HISTORICO COMPLETO DA ISSUE (${history.length} itens):`);
    history.forEach((item, index) => {
      const header = [`Item ${index + 1}`, item.source, item.author];
      if (item.visibility) header.push(item.visibility);
      if (item.date) header.push(item.date);
      lines.push(`--- ${header.join(' | ')} ---`);
      lines.push(item.body);
    });
  }

  if (technicalContextText) {
    lines.push('');
    lines.push(technicalContextText);
  }

  return lines.join('\n');
}

function buildWorkspacePromptPayload(workspace) {
  return workspace && workspace.promptContext
    ? workspace.promptContext
    : '## Fontes locais do plugin\n- Nenhum contexto local disponivel.\n';
}

function countWorkspaceSnippetFiles(workspace) {
  return (workspace && workspace.backend ? workspace.backend.length : 0)
    + (workspace && workspace.frontend ? workspace.frontend.length : 0);
}

function buildRenderedPrompt(templateId, issueKey, anonymizedText, workspace, settings) {
  if (!SHIELD.prompts || typeof SHIELD.prompts.renderPrompt !== 'function') {
    throw new Error('Os templates de prompt do SHIELD nao foram carregados no service worker.');
  }

  return SHIELD.prompts.renderPrompt(templateId, {
    issueKey,
    anonymizedText: anonymizedText || '(conteudo nao disponivel)',
    workspaceContext: buildWorkspacePromptPayload(workspace),
  }, settings || {}).prompt;
}

function buildWorkspaceSourcesRequiredError(workspace, settings) {
  const messages = [
    'O Prompt Diagnostico + Contexto Fontes exige pelo menos um trecho real de codigo anexado ao prompt.',
  ];

  const hasBackendEnv = !!(settings && settings.workspaceErpBackendDirLabel);
  const hasFrontendEnv = !!(settings && settings.workspaceMobileFrontendDirLabel);
  const backendConfigured = !!(workspace && workspace.backendStatus && workspace.backendStatus.configured);
  const frontendConfigured = !!(workspace && workspace.frontendStatus && workspace.frontendStatus.configured);
  const backendStatus = workspace && workspace.backendStatus ? workspace.backendStatus.status : 'missing';
  const frontendStatus = workspace && workspace.frontendStatus ? workspace.frontendStatus.status : 'missing';
  const frontendEnabled = !!(workspace && workspace.frontendContext && workspace.frontendContext.enabled);

  if (!hasBackendEnv && !hasFrontendEnv) {
    messages.push('Preencha WORKSPACE_ERP_BACKEND_DIR e, se aplicavel, WORKSPACE_MOBILE_FRONTEND_DIR nas opcoes do plugin ou no .env do projeto.');
  }

  if (hasBackendEnv && !backendConfigured) {
    messages.push('O .env ja informa WORKSPACE_ERP_BACKEND_DIR, mas o navegador ainda nao recebeu a permissao de leitura do diretorio ERP. Use "Vincular permissao de leitura" nas opcoes.');
  } else if (backendStatus === 'prompt') {
    messages.push('A permissao de leitura do diretorio ERP precisa ser confirmada novamente no navegador.');
  } else if (backendStatus === 'denied') {
    messages.push('O navegador negou a leitura do diretorio ERP configurado para o prompt com fontes.');
  }

  if (frontendEnabled) {
    if (hasFrontendEnv && !frontendConfigured) {
      messages.push('O .env ja informa WORKSPACE_MOBILE_FRONTEND_DIR, mas o navegador ainda nao recebeu a permissao de leitura do diretorio mobile.');
    } else if (frontendStatus === 'prompt') {
      messages.push('A permissao de leitura do diretorio mobile precisa ser confirmada novamente no navegador.');
    } else if (frontendStatus === 'denied') {
      messages.push('O navegador negou a leitura do diretorio mobile configurado para o prompt com fontes.');
    }
  } else if (hasFrontendEnv) {
    messages.push('O front-end mobile foi ignorado porque a issue nao trouxe sinais de app mobile, Minha Producao, celular ou tablet.');
  }

  if (workspace && Array.isArray(workspace.warnings) && workspace.warnings.length) {
    workspace.warnings.forEach((warning) => messages.push(warning));
  }

  messages.push('Sem snippets reais, o plugin nao envia este prompt para evitar a falsa impressao de que houve correlacao com os fontes.');
  return messages.join(' ');
}

async function exportSingleIssue(issueKey, mode, settings) {
  const issue = await fetchIssue(issueKey, settings);
  const zdField = settings.zendeskJiraField || 'customfield_11086';
  const ticketId = SHIELD.core.extractTicketId(issue.fields ? issue.fields[zdField] : null);

  let zendeskData = null;
  if (mode !== 'jira-only' && ticketId) {
    zendeskData = await fetchZendeskViaJira(ticketId, issueKey, settings);
    if (!zendeskData) zendeskData = await fetchZendeskViaApi(ticketId, settings);
    if (!zendeskData) zendeskData = await fetchZendeskViaTab(issueKey, settings);
  }

  const technicalContext = SHIELD.issueTechnicalContext
    ? SHIELD.issueTechnicalContext.extractIssueTechnicalContext(issue, zendeskData)
    : null;
  const safeTechnicalContext = SHIELD.core.sanitizeStructuredData(technicalContext);
  const { anonIssue, summary } = SHIELD.core.anonymizeIssue(issue, zendeskData);
  anonIssue.technicalContext = safeTechnicalContext;
  anonIssue.fields = { ...(anonIssue.fields || {}), technicalContext: safeTechnicalContext };
  const metadata = buildMetadata(issueKey, issue, zendeskData, settings, technicalContext);
  const pdfBuffer = SHIELD.pdf.generatePDF(anonIssue);
  const anonymizedText = buildAnonymizedPromptText(anonIssue);
  const safeMetadataTechnicalContext = metadata.technicalContext || null;
  const issueSummary = (anonIssue.fields && anonIssue.fields.summary) || '';
  const folder = normalizeDownloadFolder(settings.downloadFolder);
  const pdfFilename = `${issueKey}_LGPD_anonimizado.pdf`;
  const metadataFilename = `${issueKey}_metadata.json`;

  const pdfDownloadId = await downloadBlob(
    new Blob([pdfBuffer], { type: 'application/pdf' }),
    `${folder}/${pdfFilename}`
  );

  const metadataDownloadId = await downloadBlob(
    new Blob([JSON.stringify(metadata, null, 2)], { type: 'application/json' }),
    `${folder}/${metadataFilename}`
  );

  const zendeskStatus = describeZendeskStatus(mode, ticketId, zendeskData);

  await storeAuditEntry({
    timestamp: new Date().toISOString(),
    issueKey,
    issueSummary,
    filename: pdfFilename,
    metadataFilename,
    mode,
    downloadFolder: folder,
    entidades: summary,
    commentCount: metadata.commentCount,
    attachmentCount: metadata.attachmentNames.length,
    zendeskTicketId: ticketId,
    zendeskSource: zendeskData ? zendeskData._source : null,
    zendeskStatus,
  });

  return {
    issueKey,
    issueSummary,
    mode,
    ticketId,
    summary,
    commentCount: metadata.commentCount,
    attachmentCount: metadata.attachmentNames.length,
    zendeskSource: zendeskData ? zendeskData._source : null,
    zendeskStatus,
    downloadFolder: folder,
    pdfFilename,
    metadataFilename,
    pdfDownloadId,
    metadataDownloadId,
    anonymizedText,
    technicalContext: safeMetadataTechnicalContext,
  };
}

function summarizeResults(results) {
  const summary = {
    success: 0,
    failed: 0,
    withZendesk: 0,
    jiraOnly: 0,
  };

  for (const item of results) {
    if (!item.ok) {
      summary.failed += 1;
      continue;
    }

    summary.success += 1;
    if (item.mode === 'jira-only') {
      summary.jiraOnly += 1;
    } else if (item.zendeskSource) {
      summary.withZendesk += 1;
    }
  }

  return summary;
}

async function handleGenerateAIDoc(message) {
  const settings = await getSettings();
  if (!sanitizeBaseUrl(settings.jiraBaseUrl)) {
    throw new Error('Configure JIRA_BASE_URL em Extensions > SHIELD > Options.');
  }

  const issueKeys = [...new Set((message.issueKeys || [])
    .map((value) => String(value || '').trim().toUpperCase())
    .filter(Boolean))];

  if (!issueKeys.length) {
    throw new Error('Informe ao menos uma issue key.');
  }

  const mode = message.mode === 'jira-only' ? 'jira-only' : 'full';
  const templateId = message.templateId || 'documentation';
  const results = [];

  for (const issueKey of issueKeys) {
    try {
      const issue = await fetchIssue(issueKey, settings);
      const zdField = settings.zendeskJiraField || 'customfield_11086';
      const ticketId = SHIELD.core.extractTicketId(issue.fields ? issue.fields[zdField] : null);

      let zendeskData = null;
      if (mode !== 'jira-only' && ticketId) {
        zendeskData = await fetchZendeskViaJira(ticketId, issueKey, settings);
        if (!zendeskData) zendeskData = await fetchZendeskViaApi(ticketId, settings);
        // Prompt de diagnóstico sem fontes não abre aba — evita abrir Chrome desnecessariamente
        if (!zendeskData && templateId !== 'diagnostic') {
          zendeskData = await fetchZendeskViaTab(issueKey, settings);
        }
      }

      const technicalContext = SHIELD.issueTechnicalContext
        ? SHIELD.issueTechnicalContext.extractIssueTechnicalContext(issue, zendeskData)
        : null;
      const safeTechnicalContext = SHIELD.core.sanitizeStructuredData(technicalContext);
      const { anonIssue } = SHIELD.core.anonymizeIssue(issue, zendeskData);
      anonIssue.technicalContext = safeTechnicalContext;
      anonIssue.fields = { ...(anonIssue.fields || {}), technicalContext: safeTechnicalContext };
      const anonymizedText = buildAnonymizedPromptText(anonIssue);
      const issueSummary = (anonIssue.fields && anonIssue.fields.summary) || '';
      const workspace = templateId === 'diagnostic_with_sources'
        ? await SHIELD.localWorkspace.collectDiagnosticWorkspaceContext(anonymizedText, technicalContext).catch((error) => ({
          backend: [],
          frontend: [],
          configured: false,
          technicalContext,
          technicalCorrelation: null,
          frontendContext: { enabled: false, hits: [] },
          warnings: [error.message],
          promptContext: [
            SHIELD.issueTechnicalContext
              ? SHIELD.issueTechnicalContext.buildTechnicalContextPromptSection(
                SHIELD.core.sanitizeStructuredData(technicalContext),
                null
              ).trim()
              : '## Contexto tecnico extraido da issue\n- Contexto tecnico indisponivel.\n',
            `## Fontes locais do plugin\n- Falha ao preparar contexto local: ${error.message}\n`,
          ].join('\n\n'),
        }))
        : null;
      const sourceFiles = countWorkspaceSnippetFiles(workspace);

      if (templateId === 'diagnostic_with_sources' && sourceFiles === 0) {
        results.push({
          ok: false,
          issueKey,
          issueSummary,
          mode,
          ticketId,
          workspace,
          error: buildWorkspaceSourcesRequiredError(workspace, settings),
        });
        continue;
      }

      const renderedPrompt = buildRenderedPrompt(templateId, issueKey, anonymizedText, workspace, settings);

      results.push({
        ok: true,
        issueKey,
        issueSummary,
        mode,
        ticketId,
        anonymizedText,
        technicalContext,
        zendeskSource: zendeskData ? zendeskData._source : null,
        workspace,
        renderedPrompt,
      });
    } catch (error) {
      results.push({ ok: false, issueKey, mode, error: error.message });
    }
  }

  return {
    ok: results.some((item) => item.ok),
    results,
    summary: summarizeResults(results),
  };
}

async function handlePreparePromptPayload(message) {
  return handleGenerateAIDoc(message);
}

async function handleExportIssues(message) {
  const settings = await getSettings();
  if (!sanitizeBaseUrl(settings.jiraBaseUrl)) {
    throw new Error('Configure JIRA_BASE_URL em Extensions > SHIELD > Options.');
  }

  const issueKeys = [...new Set((message.issueKeys || [])
    .map((value) => String(value || '').trim().toUpperCase())
    .filter(Boolean))];

  if (!issueKeys.length) {
    throw new Error('Informe ao menos uma issue key.');
  }

  const mode = message.mode === 'jira-only' ? 'jira-only' : 'full';
  const results = [];

  for (const issueKey of issueKeys) {
    try {
      const result = await exportSingleIssue(issueKey, mode, settings);
      results.push({ ok: true, ...result });
    } catch (error) {
      results.push({ ok: false, issueKey, mode, error: error.message });
    }
  }

  return {
    ok: results.some((item) => item.ok),
    mode,
    downloadFolder: normalizeDownloadFolder(settings.downloadFolder),
    results,
    summary: summarizeResults(results),
  };
}

async function getSettingsSummary() {
  const settings = await getSettings();
  const workspaceStatuses = await SHIELD.localWorkspace.getDirectoryStatuses().catch(() => ({
    erpBackend: null,
    mobileFrontend: null,
  }));
  const projectRootStatus = await SHIELD.localWorkspace.getProjectRootStatus().catch(() => null);
  const jiraBaseUrl = sanitizeBaseUrl(settings.jiraBaseUrl);
  const authMode = getAuthMode(settings);
  const zendeskMode = getZendeskMode(settings);
  const hasZendeskApi = !!(settings.zendeskBaseUrl && settings.zendeskUser && settings.zendeskToken);

  return {
    jiraBaseUrl,
    ready: !!jiraBaseUrl,
    authMode,
    authModeLabel: authMode === 'token'
      ? 'Token Jira'
      : authMode === 'basic'
        ? 'Usuario/senha'
        : 'Sessao do navegador',
    hasJiraToken: !!settings.jiraToken,
    hasJiraBasic: !!(settings.jiraUser && settings.jiraPassword),
    hasZendeskApi,
    zendeskMode,
    zendeskModeLabel: hasZendeskApi
      ? 'Proxy Jira + API Zendesk + aba da issue'
      : 'Proxy Jira + aba da issue',
    zendeskJiraField: settings.zendeskJiraField || 'customfield_11086',
    downloadFolder: normalizeDownloadFolder(settings.downloadFolder),
    capabilities: buildCapabilities(settings),
    aiProvider: settings.aiProvider || 'claude',
    aiProviderLabel: getAIProviderLabel(settings.aiProvider),
    aiAction: settings.aiAction || 'copy-and-open',
    aiActionLabel: getAIActionLabel(settings.aiAction),
    projectRootDirLabel: settings.projectRootDirLabel || '',
    workspaceErpBackendDirLabel: settings.workspaceErpBackendDirLabel || '',
    workspaceMobileFrontendDirLabel: settings.workspaceMobileFrontendDirLabel || '',
    workspaceErpIncludeDirLabel: settings.workspaceErpIncludeDirLabel || '',
    projectRootPermission: projectRootStatus ? projectRootStatus.permission : 'missing',
    workspaceStatuses,
    activePromptTemplateId: settings.activePromptTemplateId || 'documentation',
    promptTemplateOverrides: settings.promptTemplateOverrides || {},
    promptTemplateAdditions: settings.promptTemplateAdditions || {},
  };
}

async function getAuditHistory(limit = 8) {
  const storage = await storageGet({ auditHistory: [] });
  return (storage.auditHistory || []).slice(0, limit);
}

async function clearAuditHistory() {
  await storageSet({ auditHistory: [] });
  return { cleared: true };
}

async function getDashboardData() {
  const [settings, history] = await Promise.all([
    getSettingsSummary(),
    getAuditHistory(8),
  ]);

  return { settings, history };
}

chrome.runtime.onInstalled.addListener(() => {
  chrome.storage.local.get(DEFAULTS, (current) => {
    chrome.storage.local.set({ ...DEFAULTS, ...current });
  });
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!message || !message.type) return false;

  if (message.type === 'preparePromptPayload' || message.type === 'generateAIDoc') {
    handlePreparePromptPayload(message)
      .then((payload) => sendResponse(payload))
      .catch((error) => sendResponse({ ok: false, error: error.message, results: [] }));
    return true;
  }

  if (message.type === 'exportIssues') {
    handleExportIssues(message)
      .then((payload) => sendResponse(payload))
      .catch((error) => sendResponse({ ok: false, error: error.message, results: [] }));
    return true;
  }

  if (message.type === 'getSettingsSummary') {
    getSettingsSummary()
      .then((payload) => sendResponse({ ok: true, ...payload }))
      .catch((error) => sendResponse({ ok: false, error: error.message }));
    return true;
  }

  if (message.type === 'getDashboardData') {
    getDashboardData()
      .then((payload) => sendResponse({ ok: true, ...payload }))
      .catch((error) => sendResponse({ ok: false, error: error.message }));
    return true;
  }

  if (message.type === 'clearAuditHistory') {
    clearAuditHistory()
      .then((payload) => sendResponse({ ok: true, ...payload }))
      .catch((error) => sendResponse({ ok: false, error: error.message }));
    return true;
  }

  return false;
});
