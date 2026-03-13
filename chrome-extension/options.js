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

const GENERATED_PROJECT_ENV_META = (window.SHIELD && SHIELD.generatedProjectEnv) || {};
const GENERATED_PROJECT_ENV = GENERATED_PROJECT_ENV_META.values || {};
Object.assign(DEFAULTS, {
  projectRootDirLabel: GENERATED_PROJECT_ENV_META.projectRootDir || DEFAULTS.projectRootDirLabel,
  workspaceErpBackendDirLabel: GENERATED_PROJECT_ENV.WORKSPACE_ERP_BACKEND_DIR || DEFAULTS.workspaceErpBackendDirLabel,
  workspaceMobileFrontendDirLabel: GENERATED_PROJECT_ENV.WORKSPACE_MOBILE_FRONTEND_DIR || DEFAULTS.workspaceMobileFrontendDirLabel,
  workspaceErpIncludeDirLabel: GENERATED_PROJECT_ENV.WORKSPACE_ERP_INCLUDE_DIR || DEFAULTS.workspaceErpIncludeDirLabel,
});

function applyGeneratedProjectEnvFallback(payload) {
  return {
    ...payload,
    projectRootDirLabel: payload.projectRootDirLabel || GENERATED_PROJECT_ENV_META.projectRootDir || '',
    workspaceErpBackendDirLabel: payload.workspaceErpBackendDirLabel || GENERATED_PROJECT_ENV.WORKSPACE_ERP_BACKEND_DIR || '',
    workspaceMobileFrontendDirLabel: payload.workspaceMobileFrontendDirLabel || GENERATED_PROJECT_ENV.WORKSPACE_MOBILE_FRONTEND_DIR || '',
    workspaceErpIncludeDirLabel: payload.workspaceErpIncludeDirLabel || GENERATED_PROJECT_ENV.WORKSPACE_ERP_INCLUDE_DIR || '',
  };
}

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

function normalizeWorkspacePath(value) {
  return String(value || '').trim().replace(/\\/g, '/');
}

function cloneMap(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {};
  }
  return { ...value };
}

function isDirectoryPickerSupported() {
  return typeof window.showDirectoryPicker === 'function';
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

function getWorkspaceFieldId(kindId) {
  return kindId === 'erpBackend' ? 'workspaceErpBackendDirLabel' : 'workspaceMobileFrontendDirLabel';
}

function getWorkspaceHintId(kindId) {
  return kindId === 'erpBackend' ? 'workspaceErpBackendHint' : 'workspaceMobileFrontendHint';
}

function getPermissionCopy(permission) {
  if (permission === 'granted') return 'Permissao de leitura ativa no navegador.';
  if (permission === 'prompt') return 'A permissao local precisa ser confirmada novamente no navegador.';
  if (permission === 'denied') return 'O navegador negou a leitura deste diretorio.';
  return 'Permissao local ainda nao confirmada.';
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
    projectRootDirLabel: document.getElementById('projectRootDirLabel').value.trim(),
    workspaceErpBackendDirLabel: normalizeWorkspacePath(document.getElementById('workspaceErpBackendDirLabel').value),
    workspaceMobileFrontendDirLabel: normalizeWorkspacePath(document.getElementById('workspaceMobileFrontendDirLabel').value),
    workspaceErpIncludeDirLabel: normalizeWorkspacePath(document.getElementById('workspaceErpIncludeDirLabel').value),
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
  document.getElementById('projectRootDirLabel').value = data.projectRootDirLabel || '';
  document.getElementById('workspaceErpBackendDirLabel').value = data.workspaceErpBackendDirLabel || '';
  document.getElementById('workspaceMobileFrontendDirLabel').value = data.workspaceMobileFrontendDirLabel || '';
  document.getElementById('workspaceErpIncludeDirLabel').value = data.workspaceErpIncludeDirLabel || '';

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
    {
      label: 'Projeto local',
      value: payload.projectRootDirLabel || 'Nao vinculado',
      copy: 'Necessario para ler e atualizar o .env pelo plugin',
      tone: payload.projectRootDirLabel ? '' : 'warn',
    },
    {
      label: 'ERP do .env',
      value: payload.workspaceErpBackendDirLabel || 'Nao configurado',
      copy: 'Valor sincronizado com WORKSPACE_ERP_BACKEND_DIR',
      tone: payload.workspaceErpBackendDirLabel ? '' : 'warn',
    },
    {
      label: 'Mobile do .env',
      value: payload.workspaceMobileFrontendDirLabel || 'Nao configurado',
      copy: 'Valor sincronizado com WORKSPACE_MOBILE_FRONTEND_DIR',
      tone: payload.workspaceMobileFrontendDirLabel ? '' : 'warn',
    },
    {
      label: 'Includes do .env',
      value: payload.workspaceErpIncludeDirLabel || 'Nao configurado',
      copy: 'Valor sincronizado com WORKSPACE_ERP_INCLUDE_DIR',
      tone: payload.workspaceErpIncludeDirLabel ? '' : 'warn',
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

async function syncWorkspaceFieldsFromEnv() {
  const envState = await SHIELD.localWorkspace.readEnvValues();
  if (!envState.ok) {
    return envState;
  }

  document.getElementById('workspaceErpBackendDirLabel').value = envState.values.WORKSPACE_ERP_BACKEND_DIR || '';
  document.getElementById('workspaceMobileFrontendDirLabel').value = envState.values.WORKSPACE_MOBILE_FRONTEND_DIR || '';
  document.getElementById('workspaceErpIncludeDirLabel').value = envState.values.WORKSPACE_ERP_INCLUDE_DIR || '';

  await storageSet({
    workspaceErpBackendDirLabel: envState.values.WORKSPACE_ERP_BACKEND_DIR || '',
    workspaceMobileFrontendDirLabel: envState.values.WORKSPACE_MOBILE_FRONTEND_DIR || '',
    workspaceErpIncludeDirLabel: envState.values.WORKSPACE_ERP_INCLUDE_DIR || '',
  });

  renderStrategySummary(readForm());
  return envState;
}

async function renderWorkspaceDirectoryStatus() {
  const projectRootStatus = await SHIELD.localWorkspace.getProjectRootStatus().catch(() => null);
  const directoryStatuses = await SHIELD.localWorkspace.getDirectoryStatuses().catch(() => ({
    erpBackend: null,
    mobileFrontend: null,
  }));

  const projectRootField = document.getElementById('projectRootDirLabel');
  const projectRootHint = document.getElementById('projectRootHint');

  if (projectRootStatus && projectRootStatus.configured) {
    projectRootField.value = projectRootStatus.label || projectRootField.value;
    projectRootHint.textContent = getPermissionCopy(projectRootStatus.permission) + ' O plugin usa essa raiz para sincronizar o .env.';
  } else if (!isDirectoryPickerSupported()) {
    projectRootHint.textContent = 'O navegador atual nao suporta a selecao segura de diretorios usada pela extensao.';
  } else {
    projectRootHint.textContent = 'Selecione a raiz local do projeto para que o plugin leia e atualize o arquivo .env desta pasta.';
  }

  ['erpBackend', 'mobileFrontend'].forEach((kindId) => {
    const field = document.getElementById(getWorkspaceFieldId(kindId));
    const hint = document.getElementById(getWorkspaceHintId(kindId));
    const status = directoryStatuses[kindId];

    if (!status || !status.configured) {
      hint.textContent = kindId === 'erpBackend'
        ? 'Defina o valor no campo acima e vincule uma permissao de leitura para o navegador conseguir ler os fontes do ERP.'
        : 'Defina o valor no campo acima e vincule uma permissao de leitura. Esse front-end so entra quando o ticket indicar contexto mobile.';
      return;
    }

    const prefix = kindId === 'erpBackend'
      ? 'Permissao do ERP local: '
      : 'Permissao do app mobile local: ';
    hint.textContent = `${prefix}${getPermissionCopy(status.permission)} Pasta autorizada no navegador: ${status.label || 'selecionada'}.`;

    if (!field.value.trim()) {
      field.value = status.label || '';
    }
  });
}

async function loadOptions() {
  const data = await storageGet(DEFAULTS);
  const payload = applyGeneratedProjectEnvFallback({ ...DEFAULTS, ...data });
  fillForm(payload);
  renderStrategySummary(payload);
  await renderWorkspaceDirectoryStatus();

  if (payload.projectRootDirLabel) {
    await syncWorkspaceFieldsFromEnv().catch(() => null);
    await renderWorkspaceDirectoryStatus();
  }
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

  const projectRootStatus = await SHIELD.localWorkspace.getProjectRootStatus().catch(() => null);
  if (projectRootStatus && projectRootStatus.configured) {
    await SHIELD.localWorkspace.writeEnvValues({
      WORKSPACE_ERP_BACKEND_DIR: payload.workspaceErpBackendDirLabel,
      WORKSPACE_MOBILE_FRONTEND_DIR: payload.workspaceMobileFrontendDirLabel,
      WORKSPACE_ERP_INCLUDE_DIR: payload.workspaceErpIncludeDirLabel,
    });
  }

  await storageSet(payload);
  renderStrategySummary(payload);
  renderPromptTemplateEditor();
  await renderWorkspaceDirectoryStatus();

  if (projectRootStatus && projectRootStatus.configured) {
    setStatus('Configuracao salva e diretorios de workspace sincronizados com o .env do projeto.', '');
    return;
  }

  setStatus('Configuracao salva. Vincule a raiz local do projeto para que o plugin leia e atualize o .env automaticamente.', 'warn');
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

  await Promise.all([
    SHIELD.localWorkspace.removeDirectoryHandle('projectRoot'),
    SHIELD.localWorkspace.removeDirectoryHandle('erpBackend'),
    SHIELD.localWorkspace.removeDirectoryHandle('mobileFrontend'),
  ]);

  await storageSet({ ...DEFAULTS });
  fillForm(DEFAULTS);
  renderStrategySummary(DEFAULTS);
  await renderWorkspaceDirectoryStatus();
  setStatus('Configuracao restaurada para o padrao.', '');
}

async function pickProjectRoot() {
  if (!isDirectoryPickerSupported()) {
    setStatus('O navegador atual nao suporta a selecao segura de diretorios usada pela extensao.', 'warn');
    return;
  }

  const handle = await window.showDirectoryPicker({ mode: 'readwrite' });
  const label = await SHIELD.localWorkspace.saveDirectoryHandle('projectRoot', handle);
  document.getElementById('projectRootDirLabel').value = label;
  await storageSet({ projectRootDirLabel: label });
  await renderWorkspaceDirectoryStatus();

  const ensureResult = await SHIELD.localWorkspace.ensureEnvExists().catch(() => null);

  const envState = await syncWorkspaceFieldsFromEnv();
  if (envState.ok) {
    const msg = ensureResult && ensureResult.created
      ? ensureResult.fromExample
        ? 'Raiz do projeto vinculada. .env criado automaticamente a partir do .env.example — edite os valores antes de usar.'
        : 'Raiz do projeto vinculada. .env criado (sem .env.example disponivel) — preencha as variaveis manualmente.'
      : 'Raiz do projeto vinculada. Valores de workspace recarregados do .env.';
    setStatus(msg, '');
    return;
  }

  setStatus(`Raiz do projeto vinculada, mas o .env ainda nao foi lido: ${envState.reason}`, 'warn');
}

async function reloadEnvFromProjectRoot() {
  const envState = await syncWorkspaceFieldsFromEnv();
  await renderWorkspaceDirectoryStatus();
  if (envState.ok) {
    setStatus('Valores de workspace recarregados do .env do projeto.', '');
    return;
  }
  setStatus(envState.reason, 'warn');
}

async function clearProjectRoot() {
  await SHIELD.localWorkspace.removeDirectoryHandle('projectRoot');
  document.getElementById('projectRootDirLabel').value = '';
  await storageSet({ projectRootDirLabel: '' });
  await renderWorkspaceDirectoryStatus();
  renderStrategySummary(readForm());
  setStatus('Raiz do projeto desvinculada do plugin.', '');
}

async function pickWorkspaceDirectory(kindId) {
  if (!isDirectoryPickerSupported()) {
    setStatus('O navegador atual nao suporta a selecao segura de diretorios usada pela extensao.', 'warn');
    return;
  }

  const kind = SHIELD.localWorkspace.DIRECTORY_KINDS[kindId];
  const handle = await window.showDirectoryPicker({ mode: 'read' });
  const label = await SHIELD.localWorkspace.saveDirectoryHandle(kindId, handle);
  await renderWorkspaceDirectoryStatus();
  setStatus(`${kind.label} vinculado ao navegador. Se necessario, ajuste o caminho no campo acima e salve para sincronizar o .env. Pasta autorizada: ${label}.`, '');
}

async function clearWorkspaceDirectory(kindId) {
  const kind = SHIELD.localWorkspace.DIRECTORY_KINDS[kindId];
  await SHIELD.localWorkspace.removeDirectoryHandle(kindId);
  await renderWorkspaceDirectoryStatus();
  setStatus(`Permissao local removida para ${kind.label}. O valor do .env foi preservado no campo.`, '');
}

document.getElementById('save').addEventListener('click', () => {
  saveOptions().catch((error) => setStatus(error.message, 'error'));
});

document.getElementById('reset').addEventListener('click', () => {
  resetOptions().catch((error) => setStatus(error.message, 'error'));
});

document.getElementById('pick-project-root').addEventListener('click', () => {
  pickProjectRoot().catch((error) => setStatus(error.message, 'error'));
});

document.getElementById('reload-env').addEventListener('click', () => {
  reloadEnvFromProjectRoot().catch((error) => setStatus(error.message, 'error'));
});

document.getElementById('clear-project-root').addEventListener('click', () => {
  clearProjectRoot().catch((error) => setStatus(error.message, 'error'));
});

document.getElementById('pick-workspace-erp-backend').addEventListener('click', () => {
  pickWorkspaceDirectory('erpBackend').catch((error) => setStatus(error.message, 'error'));
});

document.getElementById('clear-workspace-erp-backend').addEventListener('click', () => {
  clearWorkspaceDirectory('erpBackend').catch((error) => setStatus(error.message, 'error'));
});

document.getElementById('pick-workspace-mobile-frontend').addEventListener('click', () => {
  pickWorkspaceDirectory('mobileFrontend').catch((error) => setStatus(error.message, 'error'));
});

document.getElementById('clear-workspace-mobile-frontend').addEventListener('click', () => {
  clearWorkspaceDirectory('mobileFrontend').catch((error) => setStatus(error.message, 'error'));
});

bindLiveSummary();
loadOptions().catch((error) => setStatus(error.message, 'error'));
