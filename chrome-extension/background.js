importScripts('vendor/jspdf.umd.min.js', 'shield-core.js', 'pdf.js');

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
};

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
  return { ...DEFAULTS, ...stored };
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

function buildCapabilities(settings) {
  const capabilities = [
    'PDF anonimizado da issue',
    'metadata JSON para o diagnostics.js',
    'fila de multiplas issue keys',
    'historico local das exportacoes',
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
    `customfield_10014,customfield_10008`;

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

function buildMetadata(issueKey, issue, settings) {
  const fields = issue.fields || {};
  const zdField = settings.zendeskJiraField || 'customfield_11086';

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

  return {
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
    attachmentNames: (fields.attachment || []).map((item) => item.filename),
    commentCount: fields.comment
      ? (typeof fields.comment.total === 'number' ? fields.comment.total : ((fields.comment.comments || []).length))
      : 0,
    zendeskTicketId,
  };
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

  const { anonIssue, summary } = SHIELD.core.anonymizeIssue(issue, zendeskData);
  const pdfBuffer = SHIELD.pdf.generatePDF(anonIssue);
  const metadata = buildMetadata(issueKey, issue, settings);
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
    issueSummary: issue.fields && issue.fields.summary ? issue.fields.summary : '',
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
    issueSummary: issue.fields && issue.fields.summary ? issue.fields.summary : '',
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
