const AI_URLS = {
  claude: 'https://claude.ai/new',
  chatgpt: 'https://chat.openai.com/',
  gemini: 'https://gemini.google.com/app',
  copilot: 'https://copilot.microsoft.com/',
};

const state = {
  settings: null,
  history: [],
  detectedIssue: null,
  exportResults: [],
  pendingDiagnosticPayload: null,
};

function getAIProviderLabel(value) {
  const labels = {
    claude: 'Claude.ai',
    chatgpt: 'ChatGPT',
    gemini: 'Gemini',
    copilot: 'Copilot',
  };
  return labels[value] || 'Claude.ai';
}

function getAIActionLabel(value) {
  return value === 'copy-only' ? 'Somente copiar prompt' : 'Copiar prompt e abrir IA';
}

function getPromptTemplateSummary(settings) {
  const templateId = (settings && settings.activePromptTemplateId) || 'documentation';
  const descriptor = SHIELD.prompts.buildTemplateDescriptor(templateId, settings || {});
  return {
    label: descriptor.label,
    copy: descriptor.usingDefaultBase ? 'Base padrao do sistema' : 'Base customizada nas opcoes',
  };
}

function getPromptLabel(templateId) {
  return SHIELD.prompts.getTemplateDefinition(templateId).label;
}

function getAIActionButtonLabel(templateId = 'documentation') {
  const action = (state.settings && state.settings.aiAction) || 'copy-and-open';
  return action === 'copy-only' ? `Copiar ${getPromptLabel(templateId)}` : getPromptLabel(templateId);
}

function syncAIActionButtonLabels() {
  document.querySelectorAll('.analyze-ai-btn').forEach((node) => {
    const templateId = node.dataset.templateId || 'documentation';
    node.textContent = getAIActionButtonLabel(templateId);
  });
}

function sendMessage(payload) {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage(payload, (response) => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
        return;
      }
      if (!response) {
        reject(new Error('Sem resposta da extensao. Verifique o service worker.'));
        return;
      }
      resolve(response);
    });
  });
}

function setStatus(message, variant) {
  const node = document.getElementById('status');
  node.textContent = message || '';
  node.className = `status${variant ? ` ${variant}` : ''}`;
}

function setBusy(busy) {
  document.getElementById('run-export').disabled = busy;
  document.getElementById('run-ai-doc').disabled = busy;
  document.getElementById('run-ai-diagnostic').disabled = busy;
  document.getElementById('run-ai-diagnostic-sources').disabled = busy;
  const confirmBtn = document.getElementById('source-preview-confirm');
  const cancelBtn = document.getElementById('source-preview-cancel');
  if (confirmBtn) confirmBtn.disabled = busy;
  if (cancelBtn) cancelBtn.disabled = busy;
  document.querySelectorAll('input[name="mode"]').forEach((node) => {
    node.disabled = busy;
  });
}

function escapeHtml(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function extractIssueKeyFromUrl(url) {
  const match = url.match(/\/browse\/([A-Z][A-Z0-9_]+-\d+)/i);
  return match ? match[1].toUpperCase() : null;
}

async function detectIssueFromTab(jiraBaseUrl) {
  if (!jiraBaseUrl) return null;
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab || !tab.url) return null;
    const tabOrigin = new URL(tab.url).origin;
    const jiraOrigin = new URL(jiraBaseUrl).origin;
    if (tabOrigin !== jiraOrigin) return null;
    return extractIssueKeyFromUrl(tab.url);
  } catch {
    return null;
  }
}

async function tryAutoSaveJiraBaseUrl() {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab || !tab.url) return null;
    if (!/jira/i.test(tab.url)) return null;
    const origin = new URL(tab.url).origin;
    await new Promise((resolve, reject) => {
      chrome.storage.local.set({ jiraBaseUrl: origin }, () => {
        if (chrome.runtime.lastError) reject(new Error(chrome.runtime.lastError.message));
        else resolve();
      });
    });
    return origin;
  } catch {
    return null;
  }
}

function parseIssueKeys(value) {
  return [...new Set(String(value || '')
    .split(/[\s,;]+/)
    .map((item) => item.trim().toUpperCase())
    .filter(Boolean))];
}

function renderCapabilities(capabilities) {
  const node = document.getElementById('capabilities');
  node.innerHTML = '';

  (capabilities || []).forEach((label) => {
    const span = document.createElement('span');
    span.className = 'pill';
    span.textContent = label;
    node.appendChild(span);
  });
}

function renderSettingsSummary(summary) {
  const node = document.getElementById('settings-summary');
  if (!node) return;
  if (!summary) {
    node.innerHTML = '';
    return;
  }

  const promptTemplate = getPromptTemplateSummary(summary);

  const cards = [
    {
      label: 'Jira',
      value: summary.ready ? summary.jiraBaseUrl : 'Nao configurado',
      copy: summary.ready ? summary.authModeLabel : 'Preencha JIRA_BASE_URL em Configurar.',
      tone: summary.ready ? '' : 'warn',
    },
    {
      label: 'Zendesk',
      value: summary.zendeskModeLabel,
      copy: `Campo Jira: ${summary.zendeskJiraField}`,
      tone: '',
    },
    {
      label: 'Saida',
      value: `Downloads/${summary.downloadFolder}`,
      copy: 'PDF anonimizado + metadata JSON',
      tone: '',
    },
    {
      label: 'IA',
      value: summary.aiProviderLabel || getAIProviderLabel(summary.aiProvider),
      copy: summary.aiActionLabel || getAIActionLabel(summary.aiAction),
      tone: '',
    },
    {
      label: 'Prompt',
      value: promptTemplate.label,
      copy: promptTemplate.copy,
      tone: '',
    },
    {
      label: 'Projeto local',
      value: summary.projectRootDirLabel || 'Nao vinculado',
      copy: 'Sincroniza WORKSPACE_* com o .env do projeto',
      tone: summary.projectRootDirLabel ? '' : 'warn',
    },
    {
      label: 'ERP do .env',
      value: summary.workspaceErpBackendDirLabel || 'Nao configurado',
      copy: 'Back-end local elegivel para Prompt Diagnostico',
      tone: summary.workspaceErpBackendDirLabel ? '' : 'warn',
    },
    {
      label: 'Mobile do .env',
      value: summary.workspaceMobileFrontendDirLabel || 'Nao configurado',
      copy: 'Front-end local so entra com contexto mobile',
      tone: summary.workspaceMobileFrontendDirLabel ? '' : 'warn',
    },
    {
      label: 'Includes do .env',
      value: summary.workspaceErpIncludeDirLabel || 'Nao configurado',
      copy: 'Mantido em sincronia com WORKSPACE_ERP_INCLUDE_DIR',
      tone: summary.workspaceErpIncludeDirLabel ? '' : 'warn',
    },
  ];

  node.innerHTML = cards.map((card) => `
    <article class="summary-card ${card.tone}">
      <span class="summary-label">${escapeHtml(card.label)}</span>
      <strong class="summary-value">${escapeHtml(card.value)}</strong>
      <span class="summary-copy">${escapeHtml(card.copy)}</span>
    </article>
  `).join('');
}

function renderDetectedIssue(issueKey) {
  const button = document.getElementById('use-current-issue');
  const hint = document.getElementById('keys-hint');

  state.detectedIssue = issueKey;
  if (!issueKey) {
    button.hidden = true;
    hint.textContent = 'Aceita uma ou varias chaves, separadas por espaco, virgula ou quebra de linha.';
    return;
  }

  button.hidden = false;
  hint.textContent = `Issue detectada na aba atual: ${issueKey}`;

  const textarea = document.getElementById('issue-keys');
  if (!textarea.value.trim()) {
    textarea.value = issueKey;
  }
}

function describeZendeskStatus(item) {
  if (item.mode === 'jira-only') return 'Modo Somente JIRA';
  if (item.zendeskSource === 'jira-proxy') return 'Zendesk via proxy Jira';
  if (item.zendeskSource === 'zendesk-api') return 'Zendesk via API direta';
  if (item.zendeskSource === 'jira-tab-scrape') return 'Zendesk via aba da issue';
  if (item.zendeskStatus === 'ticket-sem-retorno') return 'Ticket Zendesk encontrado sem comentarios acessiveis';
  if (item.zendeskStatus === 'sem-ticket-zendesk') return 'Issue sem ticket Zendesk vinculado';
  return 'Sem detalhes de Zendesk';
}

function buildAIPrompt(templateId, item) {
  if (item && item.renderedPrompt) {
    return item.renderedPrompt;
  }

  const renderedPrompt = SHIELD.prompts.renderPrompt(templateId, {
    issueKey: item.issueKey,
    anonymizedText: item.anonymizedText || '(conteudo nao disponivel)',
    workspaceContext: item.workspace && item.workspace.promptContext
      ? item.workspace.promptContext
      : '## Fontes locais do plugin\n- Nenhum contexto local disponivel.\n',
  }, state.settings || {});

  return renderedPrompt.prompt;
}

async function analyzeWithAI(item, templateId = 'documentation') {
  const prompt = buildAIPrompt(templateId, item);
  await navigator.clipboard.writeText(prompt);
  const action = (state.settings && state.settings.aiAction) || 'copy-and-open';
  const promptLabel = getPromptLabel(templateId);
  if (action === 'copy-only') {
    setStatus(`${promptLabel} copiado para a area de transferencia. Abra sua IA favorita e cole com Ctrl+V.`, '');
    return;
  }
  const provider = (state.settings && state.settings.aiProvider) || 'claude';
  const url = AI_URLS[provider] || AI_URLS.claude;
  chrome.tabs.create({ url });
  setStatus(`${promptLabel} copiado. Cole-o na IA que foi aberta (Ctrl+V).`, '');
}

function renderResults(response) {
  const list = document.getElementById('results');
  const summary = document.getElementById('result-summary');
  list.innerHTML = '';
  summary.textContent = '';

  const results = response && response.results ? response.results : [];
  state.exportResults = results;
  if (!results.length) return;

  if (response.summary) {
    summary.textContent =
      `Sucesso: ${response.summary.success} | Falha: ${response.summary.failed} | ` +
      `Com Zendesk: ${response.summary.withZendesk} | Somente JIRA: ${response.summary.jiraOnly}`;
  }

  results.forEach((item, index) => {
    const card = document.createElement('article');
    card.className = `result-card${item.ok ? '' : ' error'}`;

    if (item.ok) {
      const aiButton = `
        <div class="result-actions">
          <button class="ghost analyze-ai-btn" data-index="${index}" data-template-id="documentation" type="button">${escapeHtml(getAIActionButtonLabel('documentation'))}</button>
          <button class="ghost analyze-ai-btn" data-index="${index}" data-template-id="diagnostic" type="button">${escapeHtml(getAIActionButtonLabel('diagnostic'))}</button>
          <button class="ghost analyze-ai-btn" data-index="${index}" data-template-id="diagnostic_with_sources" type="button">${escapeHtml(getAIActionButtonLabel('diagnostic_with_sources'))}</button>
        </div>
      `;
      card.innerHTML = `
        <div class="row result-head">
          <strong>${escapeHtml(item.issueKey)}</strong>
          <span class="result-tag">${escapeHtml(item.mode === 'jira-only' ? 'Somente JIRA' : 'Completo')}</span>
        </div>
        <div class="result-title">${escapeHtml(item.issueSummary || '(sem resumo)')}</div>
        <div class="result-meta">${escapeHtml(describeZendeskStatus(item))}</div>
        <div class="result-meta">Downloads/${escapeHtml(item.downloadFolder)}/${escapeHtml(item.pdfFilename)} e ${escapeHtml(item.metadataFilename)}</div>
        <div class="metric-row">
          <span class="metric">Pessoas ${item.summary.totalPessoas}</span>
          <span class="metric">Empresas ${item.summary.totalEmpresas}</span>
          <span class="metric">Comentarios ${item.commentCount}</span>
          <span class="metric">Anexos ${item.attachmentCount}</span>
        </div>
        ${aiButton}
      `;
    } else {
      card.innerHTML = `
        <div class="row result-head">
          <strong>${escapeHtml(item.issueKey)}</strong>
          <span class="result-tag error">Falha</span>
        </div>
        <div class="result-meta">${escapeHtml(item.error || 'Falha nao detalhada.')}</div>
      `;
    }

    list.appendChild(card);
  });

  syncAIActionButtonLabels();
}

function renderHistory(entries) {
  const container = document.getElementById('history');
  container.innerHTML = '';

  if (!entries || !entries.length) {
    container.innerHTML = '<div class="empty-state">Nenhuma exportacao registrada ainda.</div>';
    return;
  }

  entries.forEach((entry) => {
    const card = document.createElement('article');
    card.className = 'history-card';
    const when = entry.timestamp ? new Date(entry.timestamp).toLocaleString('pt-BR') : '-';
    const source = entry.zendeskSource
      ? `Zendesk: ${entry.zendeskSource}`
      : (entry.mode === 'jira-only' ? 'Modo Somente JIRA' : 'Sem Zendesk');

    card.innerHTML = `
      <div class="row result-head">
        <strong>${escapeHtml(entry.issueKey)}</strong>
        <span class="result-tag">${escapeHtml(when)}</span>
      </div>
      <div class="result-title">${escapeHtml(entry.issueSummary || '(sem resumo)')}</div>
      <div class="result-meta">${escapeHtml(source)}</div>
      <div class="result-meta">Downloads/${escapeHtml(entry.downloadFolder || 'shield')}/${escapeHtml(entry.filename || '')}</div>
      <div class="metric-row">
        <span class="metric">Pessoas ${(entry.entidades && entry.entidades.totalPessoas) || 0}</span>
        <span class="metric">Empresas ${(entry.entidades && entry.entidades.totalEmpresas) || 0}</span>
        <span class="metric">Comentarios ${entry.commentCount || 0}</span>
      </div>
    `;
    container.appendChild(card);
  });
}

async function loadDashboard(options = {}) {
  const response = await sendMessage({ type: 'getDashboardData' });
  if (!response.ok) {
    setStatus(response.error || 'Nao foi possivel carregar a extensao.', 'error');
    return;
  }

  state.settings = response.settings;
  state.history = response.history || [];

  renderSettingsSummary(response.settings);
  renderCapabilities(response.settings.capabilities);
  renderHistory(response.history);

  let jiraBaseUrl = response.settings.jiraBaseUrl;

  if (!jiraBaseUrl) {
    const detected = await tryAutoSaveJiraBaseUrl();
    if (detected) {
      jiraBaseUrl = detected;
      response.settings.jiraBaseUrl = detected;
      response.settings.ready = true;
      renderSettingsSummary(response.settings);
    }
  }

  const issueKey = await detectIssueFromTab(jiraBaseUrl);
  renderDetectedIssue(issueKey);

  if (options.preserveStatus) {
    return;
  }

  if (!response.settings.ready) {
    setStatus('Configure JIRA_BASE_URL antes de exportar.', 'warn');
  } else {
    setStatus(`Pronto para exportar em Downloads/${response.settings.downloadFolder}.`, '');
  }
}

async function runExport() {
  const keys = parseIssueKeys(document.getElementById('issue-keys').value);
  const mode = document.querySelector('input[name="mode"]:checked').value;

  if (!keys.length) {
    setStatus('Informe ao menos uma issue key.', 'warn');
    renderResults({ results: [] });
    return;
  }

  if (!state.settings || !state.settings.ready) {
    setStatus('Configure JIRA_BASE_URL em Configurar antes de exportar.', 'warn');
    return;
  }

  setBusy(true);
  setStatus(`Executando exportacao de ${keys.length} issue(s) em modo ${mode === 'jira-only' ? 'Somente JIRA' : 'Completo'}...`, '');
  renderResults({ results: [] });

  try {
    const response = await sendMessage({
      type: 'exportIssues',
      issueKeys: keys,
      mode,
    });

    if (!response.ok && !response.results.length) {
      setStatus(response.error || 'Falha ao exportar.', 'error');
      return;
    }

    const summary = response.summary || { success: 0, failed: 0 };
    const variant = summary.failed > 0 ? 'warn' : '';
    setStatus(`Concluido. Sucesso: ${summary.success}. Falha: ${summary.failed}.`, variant);
    renderResults(response);
    await loadDashboard({ preserveStatus: true });
  } catch (error) {
    setStatus(error.message, 'error');
  } finally {
    setBusy(false);
  }
}

function renderPromptResults(response, templateId) {
  const list = document.getElementById('results');
  const summary = document.getElementById('result-summary');
  list.innerHTML = '';
  summary.textContent = '';

  const results = (response && response.results) || [];
  state.exportResults = results;
  if (!results.length) return;

  if (response.summary) {
    summary.textContent = `${getPromptLabel(templateId)} prontos: ${response.summary.success} | Falha: ${response.summary.failed}`;
  }

  results.forEach((item, index) => {
    const card = document.createElement('article');
    card.className = `result-card${item.ok ? '' : ' error'}`;

    if (item.ok) {
      const aiButtonLabel = getAIActionButtonLabel(templateId);
      const diagnosticMeta = templateId === 'diagnostic_with_sources' && item.workspace
        ? `<div class="result-meta">${escapeHtml(
          item.workspace.backend.length || item.workspace.frontend.length
            ? `Contexto local: ERP ${item.workspace.backend.length} arquivo(s), mobile ${item.workspace.frontend.length} arquivo(s)`
            : item.workspace.frontendContext && !item.workspace.frontendContext.enabled
              ? 'Contexto local: mobile ignorado por falta de sinais de app mobile no ticket'
              : 'Contexto local: nenhum trecho local anexado'
        )}</div>`
        : '';
      card.innerHTML = `
        <div class="row result-head">
          <strong>${escapeHtml(item.issueKey)}</strong>
          <span class="result-tag">${escapeHtml(item.mode === 'jira-only' ? 'Somente JIRA' : 'Completo')}</span>
        </div>
        <div class="result-title">${escapeHtml(item.issueSummary || '(sem resumo)')}</div>
        ${diagnosticMeta}
        <div class="result-actions">
          <button class="ghost analyze-ai-btn" data-index="${index}" data-template-id="${escapeHtml(templateId)}" type="button">${escapeHtml(aiButtonLabel)}</button>
        </div>
      `;
    } else {
      card.innerHTML = `
        <div class="row result-head">
          <strong>${escapeHtml(item.issueKey)}</strong>
          <span class="result-tag error">Falha</span>
        </div>
        <div class="result-meta">${escapeHtml(item.error || 'Falha nao detalhada.')}</div>
      `;
    }

    list.appendChild(card);
  });

  syncAIActionButtonLabels();
}

async function runPromptFlow(templateId) {
  const keys = parseIssueKeys(document.getElementById('issue-keys').value);
  const mode = document.querySelector('input[name="mode"]:checked').value;
  const promptLabel = getPromptLabel(templateId);

  if (!keys.length) {
    setStatus('Informe ao menos uma issue key.', 'warn');
    renderPromptResults({ results: [] }, templateId);
    return;
  }

  if (!state.settings || !state.settings.ready) {
    setStatus('Configure JIRA_BASE_URL em Configurar antes de usar.', 'warn');
    return;
  }

  setBusy(true);
  setStatus(`Buscando e anonimizando ${keys.length} issue(s) para preparar ${promptLabel}...`, '');
  renderPromptResults({ results: [] }, templateId);

  try {
    const response = await sendMessage({
      type: 'preparePromptPayload',
      issueKeys: keys,
      mode,
      templateId,
    });

    if (!response.ok && (!response.results || !response.results.length)) {
      setStatus(response.error || 'Falha ao processar issues.', 'error');
      return;
    }

    const successful = (response.results || []).filter((item) => item.ok);

    if (successful.length === 1) {
      await analyzeWithAI(successful[0], templateId);
    } else if (successful.length > 1) {
      const action = (state.settings && state.settings.aiAction) || 'copy-and-open';
      const actionText = action === 'copy-only'
        ? `Clique em "${getAIActionButtonLabel(templateId)}" em cada uma.`
        : `Clique em "${getPromptLabel(templateId)}" em cada uma.`;
      renderPromptResults(response, templateId);
      setStatus(`${successful.length} issues prontas para ${promptLabel}. ${actionText}`, '');
    } else {
      const firstError = (response.results || []).find((item) => !item.ok && item.error);
      setStatus(firstError ? firstError.error : 'Nenhuma issue processada com sucesso.', 'error');
      renderPromptResults(response, templateId);
    }
  } catch (error) {
    setStatus(error.message, 'error');
  } finally {
    setBusy(false);
  }
}

function truncateSnippet(content, maxLines) {
  const lines = String(content || '').split('\n');
  const limit = maxLines || 4;
  return {
    text: lines.slice(0, limit).join('\n'),
    truncated: lines.length > limit,
  };
}

function formatLineRangesDisplay(lineRanges) {
  if (!lineRanges || !lineRanges.length) return 'linhas desconhecidas';
  return 'linhas ' + lineRanges.map((r) => `${r.start}-${r.end}`).join(', ');
}

function buildSourceFileCard(file, kind) {
  const card = document.createElement('div');
  card.className = `source-file-card ${kind}`;

  const lineInfo = formatLineRangesDisplay(file.lineRanges);
  const charCount = String(file.content || '').length;
  const snippet = truncateSnippet(file.content, 4);

  const nameDiv = document.createElement('div');
  nameDiv.className = 'source-file-name';
  nameDiv.textContent = file.rel;

  const metaDiv = document.createElement('div');
  metaDiv.className = 'source-file-meta';
  metaDiv.textContent = `${lineInfo} · ${charCount} car. · ${file.totalLines} linhas no arquivo`;
  if (snippet.truncated) metaDiv.textContent += ' · trecho truncado para exibição';

  const pre = document.createElement('pre');
  pre.className = 'source-file-snippet';
  pre.textContent = snippet.text;

  card.appendChild(nameDiv);
  card.appendChild(metaDiv);
  card.appendChild(pre);
  return card;
}

function hideSourcePreview() {
  const panel = document.getElementById('source-preview');
  panel.hidden = true;
  document.getElementById('source-preview-body').innerHTML = '';
  document.getElementById('source-preview-badge').textContent = '';
  state.pendingDiagnosticPayload = null;
}

function renderSourcePreview(workspace) {
  const panel = document.getElementById('source-preview');
  const body = document.getElementById('source-preview-body');
  const badge = document.getElementById('source-preview-badge');

  body.innerHTML = '';

  const backendFiles = (workspace && workspace.backend) || [];
  const frontendFiles = (workspace && workspace.frontend) || [];
  const warnings = (workspace && workspace.warnings) || [];
  const frontendContext = workspace && workspace.frontendContext;
  const backendStatus = workspace && workspace.backendStatus;
  const frontendStatus = workspace && workspace.frontendStatus;

  const totalFiles = backendFiles.length + frontendFiles.length;
  badge.textContent = totalFiles === 0 ? 'Nenhum arquivo' : `${totalFiles} arquivo(s)`;

  warnings.forEach((warning) => {
    const el = document.createElement('div');
    el.className = 'source-preview-warn';
    el.textContent = warning;
    body.appendChild(el);
  });

  if (backendStatus && backendStatus.configured) {
    const label = document.createElement('div');
    label.className = 'source-preview-section-label';
    label.textContent = `ERP Back-end${backendStatus.rootLabel ? ' — ' + backendStatus.rootLabel : ''}`;
    body.appendChild(label);

    if (backendFiles.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'source-preview-empty';
      empty.textContent = backendStatus.status === 'granted'
        ? 'Nenhum trecho relevante encontrado no ERP para esta issue.'
        : `Sem acesso ao diretório ERP (status: ${backendStatus.status}).`;
      body.appendChild(empty);
    } else {
      backendFiles.forEach((f) => body.appendChild(buildSourceFileCard(f, 'backend')));
    }
  }

  if (frontendStatus && frontendStatus.configured) {
    const label = document.createElement('div');
    label.className = 'source-preview-section-label';

    if (frontendContext && !frontendContext.enabled) {
      label.textContent = 'App Mobile — ignorado (sem sinais de contexto mobile no ticket)';
      body.appendChild(label);
      const info = document.createElement('div');
      info.className = 'source-preview-empty';
      info.textContent = 'O front-end mobile não será incluído porque a issue não menciona mobile, celular, app, tablet, Android ou iOS.';
      body.appendChild(info);
    } else {
      label.textContent = `App Mobile${frontendStatus.rootLabel ? ' — ' + frontendStatus.rootLabel : ''}`;
      body.appendChild(label);

      if (frontendContext && frontendContext.hits && frontendContext.hits.length) {
        const hint = document.createElement('div');
        hint.className = 'source-file-meta';
        hint.textContent = `Sinais detectados: ${frontendContext.hits.join(', ')}`;
        body.appendChild(hint);
      }

      if (frontendFiles.length === 0) {
        const empty = document.createElement('div');
        empty.className = 'source-preview-empty';
        empty.textContent = 'Nenhum trecho relevante encontrado no mobile para esta issue.';
        body.appendChild(empty);
      } else {
        frontendFiles.forEach((f) => body.appendChild(buildSourceFileCard(f, 'frontend')));
      }
    }
  }

  if (totalFiles === 0 && warnings.length === 0
      && (!backendStatus || !backendStatus.configured)
      && (!frontendStatus || !frontendStatus.configured)) {
    const empty = document.createElement('div');
    empty.className = 'source-preview-empty';
    empty.textContent = 'Nenhum trecho local encontrado. Configure os diretórios de workspace em Configurar.';
    body.appendChild(empty);
  }

  panel.hidden = false;
}

async function runDiagnosticWithSourcesPreview() {
  const keys = parseIssueKeys(document.getElementById('issue-keys').value);
  const mode = document.querySelector('input[name="mode"]:checked').value;
  const templateId = 'diagnostic_with_sources';

  if (!keys.length) {
    setStatus('Informe ao menos uma issue key.', 'warn');
    return;
  }

  if (!state.settings || !state.settings.ready) {
    setStatus('Configure JIRA_BASE_URL em Configurar antes de usar.', 'warn');
    return;
  }

  hideSourcePreview();
  setBusy(true);
  setStatus(`Coletando contexto de fontes para ${keys.length} issue(s)...`, '');
  document.getElementById('result-summary').textContent = '';
  document.getElementById('results').innerHTML = '';

  try {
    const response = await sendMessage({
      type: 'preparePromptPayload',
      issueKeys: keys,
      mode,
      templateId,
    });

    if (!response.ok && (!response.results || !response.results.length)) {
      setStatus(response.error || 'Falha ao processar issues.', 'error');
      return;
    }

    state.pendingDiagnosticPayload = { response, templateId };

    const firstResult = (response.results || []).find((r) => r.ok) || (response.results || [])[0];
    const workspace = firstResult && firstResult.workspace;

    renderSourcePreview(workspace);

    const multiNote = keys.length > 1 ? ` (exibindo fontes da 1ª issue de ${keys.length})` : '';
    setStatus(`Revise as fontes${multiNote} e confirme para gerar o prompt.`, '');
  } catch (error) {
    setStatus(error.message, 'error');
    hideSourcePreview();
  } finally {
    setBusy(false);
  }
}

async function confirmDiagnosticWithSources() {
  const pending = state.pendingDiagnosticPayload;
  if (!pending) return;

  const { response, templateId } = pending;
  hideSourcePreview();

  try {
    const successful = (response.results || []).filter((item) => item.ok);

    if (successful.length === 1) {
      await analyzeWithAI(successful[0], templateId);
    } else if (successful.length > 1) {
      const action = (state.settings && state.settings.aiAction) || 'copy-and-open';
      const actionText = action === 'copy-only'
        ? `Clique em "${getAIActionButtonLabel(templateId)}" em cada uma.`
        : `Clique em "${getPromptLabel(templateId)}" em cada uma.`;
      renderPromptResults(response, templateId);
      setStatus(`${successful.length} issues prontas para ${getPromptLabel(templateId)}. ${actionText}`, '');
    } else {
      const firstError = (response.results || []).find((item) => !item.ok && item.error);
      setStatus(firstError ? firstError.error : 'Nenhuma issue processada com sucesso.', 'error');
      renderPromptResults(response, templateId);
    }
  } catch (error) {
    setStatus(error.message, 'error');
  }
}

async function clearHistory() {
  const confirmed = window.confirm('Limpar o historico local de exportacoes da extensao?');
  if (!confirmed) return;

  const response = await sendMessage({ type: 'clearAuditHistory' });
  if (!response.ok) {
    throw new Error(response.error || 'Nao foi possivel limpar o historico.');
  }

  await loadDashboard({ preserveStatus: true });
  setStatus('Historico local limpo.', '');
}

document.getElementById('run-export').addEventListener('click', () => {
  runExport().catch((error) => setStatus(error.message, 'error'));
});

document.getElementById('run-ai-doc').addEventListener('click', () => {
  runPromptFlow('documentation').catch((error) => setStatus(error.message, 'error'));
});

document.getElementById('run-ai-diagnostic').addEventListener('click', () => {
  runPromptFlow('diagnostic').catch((error) => setStatus(error.message, 'error'));
});

document.getElementById('run-ai-diagnostic-sources').addEventListener('click', () => {
  runDiagnosticWithSourcesPreview().catch((error) => setStatus(error.message, 'error'));
});

document.getElementById('source-preview-confirm').addEventListener('click', () => {
  confirmDiagnosticWithSources().catch((error) => setStatus(error.message, 'error'));
});

document.getElementById('source-preview-cancel').addEventListener('click', () => {
  hideSourcePreview();
  setStatus('Operacao cancelada.', '');
});

document.getElementById('open-options').addEventListener('click', () => chrome.runtime.openOptionsPage());

document.getElementById('use-current-issue').addEventListener('click', () => {
  if (!state.detectedIssue) return;
  document.getElementById('issue-keys').value = state.detectedIssue;
});

document.getElementById('clear-history').addEventListener('click', () => {
  clearHistory().catch((error) => setStatus(error.message, 'error'));
});

document.getElementById('results').addEventListener('click', (event) => {
  const button = event.target.closest('.analyze-ai-btn');
  if (!button) return;
  const index = parseInt(button.dataset.index, 10);
  const templateId = button.dataset.templateId || 'documentation';
  const item = state.exportResults && state.exportResults[index];
  if (item) analyzeWithAI(item, templateId).catch((error) => setStatus(error.message, 'error'));
});

loadDashboard().catch((error) => setStatus(error.message, 'error'));
