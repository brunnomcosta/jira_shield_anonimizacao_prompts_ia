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
  if (item.mode === 'jira-only') return 'Modo Jira only';
  if (item.zendeskSource === 'jira-proxy') return 'Zendesk via proxy Jira';
  if (item.zendeskSource === 'zendesk-api') return 'Zendesk via API direta';
  if (item.zendeskSource === 'jira-tab-scrape') return 'Zendesk via aba da issue';
  if (item.zendeskStatus === 'ticket-sem-retorno') return 'Ticket Zendesk encontrado sem comentarios acessiveis';
  if (item.zendeskStatus === 'sem-ticket-zendesk') return 'Issue sem ticket Zendesk vinculado';
  return 'Sem detalhes de Zendesk';
}

function buildAIPrompt(templateId, item) {
  const renderedPrompt = SHIELD.prompts.renderPrompt(templateId, {
    issueKey: item.issueKey,
    anonymizedText: item.anonymizedText || '(conteudo nao disponivel)',
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
      `Com Zendesk: ${response.summary.withZendesk} | Jira only: ${response.summary.jiraOnly}`;
  }

  results.forEach((item, index) => {
    const card = document.createElement('article');
    card.className = `result-card${item.ok ? '' : ' error'}`;

    if (item.ok) {
      const aiButton = `
        <div class="result-actions">
          <button class="ghost analyze-ai-btn" data-index="${index}" data-template-id="documentation" type="button">${escapeHtml(getAIActionButtonLabel('documentation'))}</button>
          <button class="ghost analyze-ai-btn" data-index="${index}" data-template-id="diagnostic" type="button">${escapeHtml(getAIActionButtonLabel('diagnostic'))}</button>
        </div>
      `;
      card.innerHTML = `
        <div class="row result-head">
          <strong>${escapeHtml(item.issueKey)}</strong>
          <span class="result-tag">${escapeHtml(item.mode === 'jira-only' ? 'Jira only' : 'Completo')}</span>
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
      : (entry.mode === 'jira-only' ? 'Modo Jira only' : 'Sem Zendesk');

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

  const issueKey = await detectIssueFromTab(response.settings.jiraBaseUrl);
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
  setStatus(`Executando exportacao de ${keys.length} issue(s) em modo ${mode === 'jira-only' ? 'Jira only' : 'Completo'}...`, '');
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
      card.innerHTML = `
        <div class="row result-head">
          <strong>${escapeHtml(item.issueKey)}</strong>
          <span class="result-tag">${escapeHtml(item.mode === 'jira-only' ? 'Jira only' : 'Completo')}</span>
        </div>
        <div class="result-title">${escapeHtml(item.issueSummary || '(sem resumo)')}</div>
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
      setStatus('Nenhuma issue processada com sucesso.', 'error');
      renderPromptResults(response, templateId);
    }
  } catch (error) {
    setStatus(error.message, 'error');
  } finally {
    setBusy(false);
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
