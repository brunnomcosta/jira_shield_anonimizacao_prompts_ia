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
  aiProvider: 'claude',
  aiAction: 'copy-and-open',
};

function setStatus(message, variant) {
  const node = document.getElementById('status');
  node.textContent = message || '';
  node.className = `status${variant ? ` ${variant}` : ''}`;
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

function normalizeUrl(value) {
  return String(value || '').trim().replace(/\/$/, '');
}

function normalizeFolder(value) {
  return String(value || 'shield').trim().replace(/^\/+|\/+$/g, '') || 'shield';
}

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
  return value === 'copy-only' ? 'Somente copiar o prompt' : 'Copiar e abrir a IA';
}

function readForm() {
  return {
    jiraBaseUrl: normalizeUrl(document.getElementById('jiraBaseUrl').value),
    jiraToken: document.getElementById('jiraToken').value.trim(),
    jiraUser: document.getElementById('jiraUser').value.trim(),
    jiraPassword: document.getElementById('jiraPassword').value.trim(),
    zendeskBaseUrl: normalizeUrl(document.getElementById('zendeskBaseUrl').value),
    zendeskUser: document.getElementById('zendeskUser').value.trim(),
    zendeskToken: document.getElementById('zendeskToken').value.trim(),
    zendeskJiraField: document.getElementById('zendeskJiraField').value.trim() || 'customfield_11086',
    downloadFolder: normalizeFolder(document.getElementById('downloadFolder').value),
    aiProvider: (document.querySelector('input[name="aiProvider"]:checked') || {}).value || 'claude',
    aiAction: (document.querySelector('input[name="aiAction"]:checked') || {}).value || 'copy-and-open',
  };
}

function fillForm(data) {
  document.getElementById('jiraBaseUrl').value = data.jiraBaseUrl || '';
  document.getElementById('jiraToken').value = data.jiraToken || '';
  document.getElementById('jiraUser').value = data.jiraUser || '';
  document.getElementById('jiraPassword').value = data.jiraPassword || '';
  document.getElementById('zendeskBaseUrl').value = data.zendeskBaseUrl || '';
  document.getElementById('zendeskUser').value = data.zendeskUser || '';
  document.getElementById('zendeskToken').value = data.zendeskToken || '';
  document.getElementById('zendeskJiraField').value = data.zendeskJiraField || 'customfield_11086';
  document.getElementById('downloadFolder').value = data.downloadFolder || 'shield';
  const aiProviderVal = data.aiProvider || 'claude';
  const aiRadio = document.querySelector(`input[name="aiProvider"][value="${aiProviderVal}"]`);
  if (aiRadio) aiRadio.checked = true;
  const aiActionVal = data.aiAction || 'copy-and-open';
  const aiActionRadio = document.querySelector(`input[name="aiAction"][value="${aiActionVal}"]`);
  if (aiActionRadio) aiActionRadio.checked = true;
}

function isValidHttpUrl(value) {
  if (!value) return true;
  try {
    const url = new URL(value);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
}

function renderStrategySummary(payload) {
  const node = document.getElementById('strategy-summary');

  const authMode = payload.jiraToken
    ? 'Token Jira'
    : (payload.jiraUser && payload.jiraPassword)
      ? 'Usuario/senha'
      : 'Sessao do navegador';
  const zendeskMode = payload.zendeskBaseUrl && payload.zendeskUser && payload.zendeskToken
    ? 'Proxy Jira + API Zendesk + aba da issue'
    : 'Proxy Jira + aba da issue';

  const cards = [
    {
      label: 'Autenticacao',
      value: authMode,
      copy: payload.jiraBaseUrl ? payload.jiraBaseUrl : 'Defina JIRA_BASE_URL',
      tone: payload.jiraBaseUrl ? '' : 'warn',
    },
    {
      label: 'Zendesk',
      value: zendeskMode,
      copy: `Campo: ${payload.zendeskJiraField || 'customfield_11086'}`,
      tone: '',
    },
    {
      label: 'Downloads',
      value: `Downloads/${payload.downloadFolder || 'shield'}`,
      copy: 'PDF anonimizado e metadata JSON',
      tone: '',
    },
    {
      label: 'IA',
      value: getAIProviderLabel(payload.aiProvider),
      copy: getAIActionLabel(payload.aiAction),
      tone: '',
    },
  ];

  node.innerHTML = cards.map((card) => `
    <article class="summary-card ${card.tone}">
      <span class="summary-label">${card.label}</span>
      <strong class="summary-value">${card.value}</strong>
      <span class="summary-copy">${card.copy}</span>
    </article>
  `).join('');
}

function validatePayload(payload) {
  if (!payload.jiraBaseUrl) {
    return 'JIRA_BASE_URL e obrigatoria.';
  }

  if (!isValidHttpUrl(payload.jiraBaseUrl)) {
    return 'JIRA_BASE_URL deve ser uma URL http/https valida.';
  }

  if (payload.zendeskBaseUrl && !isValidHttpUrl(payload.zendeskBaseUrl)) {
    return 'ZENDESK_BASE_URL deve ser uma URL http/https valida.';
  }

  const jiraBasicFilled = !!payload.jiraUser || !!payload.jiraPassword;
  if (jiraBasicFilled && !(payload.jiraUser && payload.jiraPassword)) {
    return 'Preencha JIRA_USER e JIRA_PASSWORD juntos, ou deixe ambos vazios.';
  }

  const zendeskPartial = !!payload.zendeskBaseUrl || !!payload.zendeskUser || !!payload.zendeskToken;
  if (zendeskPartial && !(payload.zendeskBaseUrl && payload.zendeskUser && payload.zendeskToken)) {
    return 'Para usar a API Zendesk, preencha ZENDESK_BASE_URL, ZENDESK_USER e ZENDESK_TOKEN juntos.';
  }

  return null;
}

async function loadOptions() {
  const data = await storageGet(DEFAULTS);
  const payload = { ...DEFAULTS, ...data };
  fillForm(payload);
  renderStrategySummary(payload);
}

async function saveOptions() {
  const payload = readForm();
  const validation = validatePayload(payload);
  if (validation) {
    setStatus(validation, 'warn');
    renderStrategySummary(payload);
    return;
  }

  await storageSet(payload);
  renderStrategySummary(payload);
  setStatus('Configuracao salva. A extensao ja pode exportar PDF + metadata com os parametros informados.', '');
}

function bindLiveSummary() {
  document.querySelectorAll('input').forEach((node) => {
    node.addEventListener('input', () => {
      renderStrategySummary(readForm());
    });
  });
}

async function resetOptions() {
  const confirmed = window.confirm('Restaurar os valores padrao da extensao?');
  if (!confirmed) return;

  await storageSet({ ...DEFAULTS });
  fillForm(DEFAULTS);
  renderStrategySummary(DEFAULTS);
  setStatus('Configuracao restaurada para o padrao.', '');
}

document.getElementById('save').addEventListener('click', () => {
  saveOptions().catch((error) => setStatus(error.message, 'error'));
});

document.getElementById('reset').addEventListener('click', () => {
  resetOptions().catch((error) => setStatus(error.message, 'error'));
});

bindLiveSummary();
loadOptions().catch((error) => setStatus(error.message, 'error'));
