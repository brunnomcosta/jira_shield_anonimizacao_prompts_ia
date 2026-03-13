const state = {
  settings: null,
  history: [],
  detectedIssue: null,
};

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

function renderResults(response) {
  const list = document.getElementById('results');
  const summary = document.getElementById('result-summary');
  list.innerHTML = '';
  summary.textContent = '';

  const results = response && response.results ? response.results : [];
  if (!results.length) return;

  if (response.summary) {
    summary.textContent =
      `Sucesso: ${response.summary.success} | Falha: ${response.summary.failed} | ` +
      `Com Zendesk: ${response.summary.withZendesk} | Jira only: ${response.summary.jiraOnly}`;
  }

  results.forEach((item) => {
    const card = document.createElement('article');
    card.className = `result-card${item.ok ? '' : ' error'}`;

    if (item.ok) {
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

document.getElementById('open-options').addEventListener('click', () => chrome.runtime.openOptionsPage());

document.getElementById('use-current-issue').addEventListener('click', () => {
  if (!state.detectedIssue) return;
  document.getElementById('issue-keys').value = state.detectedIssue;
});

document.getElementById('clear-history').addEventListener('click', () => {
  clearHistory().catch((error) => setStatus(error.message, 'error'));
});

loadDashboard().catch((error) => setStatus(error.message, 'error'));
