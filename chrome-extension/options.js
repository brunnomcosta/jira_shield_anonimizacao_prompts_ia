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
  activePromptTemplateId: 'documentation',
  promptTemplateOverrides: {},
  promptTemplateAdditions: {},
};

const promptEditorState = {
  activeTemplateId: 'documentation',
  overrides: {},
  additions: {},
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

function normalizeMultiline(value) {
  return String(value || '').replace(/\r\n/g, '\n').trim();
}

function cloneMap(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {};
  }
  return { ...value };
}

function getTemplateRegistry() {
  return (window.SHIELD && SHIELD.prompts && SHIELD.prompts.listTemplates()) || [];
}

function getCurrentTemplateId() {
  const registry = getTemplateRegistry();
  const fallback = registry[0] ? registry[0].id : 'documentation';
  return promptEditorState.activeTemplateId || fallback;
}

function getTemplateDescriptor(templateId, payload) {
  return SHIELD.prompts.buildTemplateDescriptor(templateId, payload);
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

function syncPromptEditorStateFromFields() {
  const templateId = getCurrentTemplateId();
  promptEditorState.overrides[templateId] = normalizeMultiline(
    document.getElementById('promptTemplateOverride').value
  );
  promptEditorState.additions[templateId] = normalizeMultiline(
    document.getElementById('promptTemplateAddition').value
  );
}

function renderPromptTemplateSelect() {
  const select = document.getElementById('promptTemplateId');
  const templates = getTemplateRegistry();
  const activeTemplateId = getCurrentTemplateId();

  select.innerHTML = templates.map((template) => (
    `<option value="${template.id}">${template.label}</option>`
  )).join('');

  select.value = activeTemplateId;
}

function renderPromptTemplateEditor() {
  const templateId = getCurrentTemplateId();
  const defaultNode = document.getElementById('promptTemplateDefault');
  const sourceNode = document.getElementById('promptTemplateSource');
  const overrideNode = document.getElementById('promptTemplateOverride');
  const additionNode = document.getElementById('promptTemplateAddition');
  const previewNode = document.getElementById('promptTemplatePreview');
  const hintNode = document.getElementById('promptTemplateHint');
  const payload = {
    activePromptTemplateId: templateId,
    promptTemplateOverrides: promptEditorState.overrides,
    promptTemplateAdditions: promptEditorState.additions,
  };
  const descriptor = getTemplateDescriptor(templateId, payload);

  sourceNode.value = descriptor.sourceFile;
  defaultNode.value = descriptor.defaultTemplate;
  overrideNode.value = promptEditorState.overrides[templateId] || '';
  additionNode.value = promptEditorState.additions[templateId] || '';
  previewNode.value = descriptor.finalTemplate;

  if (descriptor.missingPlaceholders.length) {
    hintNode.textContent = `O SHIELD reintroduziu automaticamente os placeholders obrigatorios removidos: ${descriptor.missingPlaceholders.map((item) => `{{${item}}}`).join(', ')}. Isso afeta apenas o prompt enviado a LLM.`;
    return;
  }

  hintNode.textContent = 'Os placeholders da issue sao preservados neste preview e sao resolvidos apenas na hora de gerar o prompt. Isso afeta apenas o prompt enviado a LLM.';
}

function buildPromptSummary(payload) {
  const templateId = payload.activePromptTemplateId || getCurrentTemplateId();
  const descriptor = getTemplateDescriptor(templateId, payload);
  return {
    label: descriptor.label,
    mode: descriptor.usingDefaultBase ? 'Base padrao do arquivo' : 'Base customizada nas opcoes',
  };
}

function readForm() {
  syncPromptEditorStateFromFields();

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
    activePromptTemplateId: getCurrentTemplateId(),
    promptTemplateOverrides: cloneMap(promptEditorState.overrides),
    promptTemplateAdditions: cloneMap(promptEditorState.additions),
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

  promptEditorState.overrides = cloneMap(data.promptTemplateOverrides);
  promptEditorState.additions = cloneMap(data.promptTemplateAdditions);
  promptEditorState.activeTemplateId = data.activePromptTemplateId || 'documentation';

  renderPromptTemplateSelect();
  renderPromptTemplateEditor();
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
  const promptSummary = buildPromptSummary(payload);

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
    {
      label: 'Prompt',
      value: promptSummary.label,
      copy: promptSummary.mode,
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
    renderPromptTemplateEditor();
    return;
  }

  await storageSet(payload);
  renderStrategySummary(payload);
  renderPromptTemplateEditor();
  setStatus('Configuracao salva. O template editavel afeta apenas o prompt enviado a LLM; a anonimização continua no pipeline interno.', '');
}

function bindLiveSummary() {
  document.querySelectorAll('input, select, textarea').forEach((node) => {
    node.addEventListener('input', () => {
      if (node.id === 'promptTemplateOverride' || node.id === 'promptTemplateAddition') {
        syncPromptEditorStateFromFields();
        renderPromptTemplateEditor();
      }
      renderStrategySummary(readForm());
    });
  });

  document.getElementById('promptTemplateId').addEventListener('change', (event) => {
    syncPromptEditorStateFromFields();
    promptEditorState.activeTemplateId = event.target.value || 'documentation';
    renderPromptTemplateEditor();
    renderStrategySummary(readForm());
  });
}

async function resetOptions() {
  const confirmed = window.confirm('Restaurar os valores padrao da extensao?');
  if (!confirmed) return;

  promptEditorState.overrides = {};
  promptEditorState.additions = {};
  promptEditorState.activeTemplateId = DEFAULTS.activePromptTemplateId;

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
