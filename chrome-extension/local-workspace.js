(function initShieldLocalWorkspace(globalScope) {
  const scope = globalScope || globalThis;
  const root = scope.SHIELD || (scope.SHIELD = {});
  if (!root.issueTechnicalContext) {
    throw new Error('SHIELD issue-technical-context.js must be loaded before local-workspace.js');
  }

  const HANDLE_DB_NAME = 'shield-local-workspace';
  const HANDLE_STORE_NAME = 'handles';
  const DIRECTORY_KINDS = {
    projectRoot: {
      id: 'projectRoot',
      label: 'Raiz local do projeto SHIELD',
      storageKey: 'projectRootDirLabel',
    },
    erpBackend: {
      id: 'erpBackend',
      label: 'ERP Back-end local',
      storageKey: 'workspaceErpBackendDirLabel',
    },
    mobileFrontend: {
      id: 'mobileFrontend',
      label: 'App mobile Front-end local',
      storageKey: 'workspaceMobileFrontendDirLabel',
    },
  };

  const ALLOWED_EXTENSIONS = new Set(
    'js,ts,java,py,cs,go,kt,jsx,tsx,vue,rb,php,prx,prw,tlpp,ch'
      .split(',')
      .map((item) => `.${item.trim().toLowerCase()}`)
      .filter(Boolean)
  );

  const MOBILE_FRONTEND_HINTS = [
    { rx: /\bminha produ[cç][aã]o\b/i, weight: 4, label: 'Minha Producao' },
    { rx: /\bapp(?:licativo)?\s+mobile\b/i, weight: 4, label: 'app mobile' },
    { rx: /\bmobile\b/i, weight: 3, label: 'mobile' },
    { rx: /\bcelular\b/i, weight: 3, label: 'celular' },
    { rx: /\btablet\b/i, weight: 3, label: 'tablet' },
    { rx: /\bsmartphone\b/i, weight: 3, label: 'smartphone' },
    { rx: /\bandroid\b/i, weight: 3, label: 'Android' },
    { rx: /\bios\b/i, weight: 3, label: 'iOS' },
    { rx: /\bionic\b/i, weight: 2, label: 'Ionic' },
    { rx: /\bapk\b/i, weight: 2, label: 'APK' },
    { rx: /\bplay store\b/i, weight: 2, label: 'Play Store' },
    { rx: /\bapp\b/i, weight: 1, label: 'app' },
  ];

  const IGNORED_DIRECTORIES = new Set([
    '.git',
    '.idea',
    '.vscode',
    'node_modules',
    'dist',
    'build',
    'coverage',
    'vendor',
    'output',
    '.next',
  ]);

  const DEFAULT_LIMITS = {
    maxDiscoveredFiles: 2000,
    maxCandidates: 80,
    maxTotalChars: 22000,
    maxFileBytes: 256 * 1024,
    backendChars: 6500,
    frontendChars: 2800,
    backendFiles: 4,
    frontendFiles: 2,
  };

  function openHandleDb() {
    return new Promise((resolve, reject) => {
      if (!scope.indexedDB) {
        reject(new Error('indexedDB indisponivel neste contexto da extensao.'));
        return;
      }

      const request = scope.indexedDB.open(HANDLE_DB_NAME, 1);
      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains(HANDLE_STORE_NAME)) {
          db.createObjectStore(HANDLE_STORE_NAME, { keyPath: 'id' });
        }
      };
      request.onerror = () => reject(request.error || new Error('Falha ao abrir o banco local da extensao.'));
      request.onsuccess = () => resolve(request.result);
    });
  }

  async function withStore(mode, handler) {
    const db = await openHandleDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(HANDLE_STORE_NAME, mode);
      const store = tx.objectStore(HANDLE_STORE_NAME);
      let settled = false;

      tx.oncomplete = () => {
        db.close();
        if (!settled) resolve();
      };
      tx.onerror = () => {
        db.close();
        reject(tx.error || new Error('Falha ao acessar o armazenamento local da extensao.'));
      };

      Promise.resolve(handler(store, tx))
        .then((value) => {
          settled = true;
          resolve(value);
        })
        .catch((error) => {
          settled = true;
          reject(error);
        });
    });
  }

  function promisifyRequest(request) {
    return new Promise((resolve, reject) => {
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error || new Error('Falha na operacao do banco local.'));
    });
  }

  async function saveDirectoryHandle(kindId, handle) {
    const kind = DIRECTORY_KINDS[kindId];
    if (!kind) throw new Error(`Diretorio local desconhecido: ${kindId}`);

    await withStore('readwrite', async (store) => {
      await promisifyRequest(store.put({
        id: kind.id,
        label: handle.name,
        updatedAt: new Date().toISOString(),
        handle,
      }));
    });

    return handle.name;
  }

  async function loadDirectoryHandle(kindId) {
    const kind = DIRECTORY_KINDS[kindId];
    if (!kind) return null;

    const record = await withStore('readonly', async (store) => (
      promisifyRequest(store.get(kind.id))
    ));
    return record || null;
  }

  async function removeDirectoryHandle(kindId) {
    const kind = DIRECTORY_KINDS[kindId];
    if (!kind) return;
    await withStore('readwrite', async (store) => {
      await promisifyRequest(store.delete(kind.id));
    });
  }

  async function getDirectoryStatus(kindId) {
    const kind = DIRECTORY_KINDS[kindId];
    if (!kind) return null;

    const record = await loadDirectoryHandle(kindId);
    if (!record || !record.handle) {
      return {
        ...kind,
        configured: false,
        label: '',
        permission: 'missing',
      };
    }

    let permission = 'unknown';
    if (typeof record.handle.queryPermission === 'function') {
      try {
        permission = await record.handle.queryPermission({ mode: 'read' });
      } catch {
        permission = 'unknown';
      }
    }

    return {
      ...kind,
      configured: true,
      label: record.label || record.handle.name || '',
      permission,
    };
  }

  async function getDirectoryStatuses() {
    const [erpBackend, mobileFrontend] = await Promise.all([
      getDirectoryStatus('erpBackend'),
      getDirectoryStatus('mobileFrontend'),
    ]);

    return { erpBackend, mobileFrontend };
  }

  async function getProjectRootStatus() {
    return getDirectoryStatus('projectRoot');
  }

  function normalizeEnvPathValue(value) {
    return String(value || '').trim().replace(/\\/g, '/');
  }

  function parseEnvContent(content) {
    const result = {};
    String(content || '').split(/\r?\n/).forEach((line) => {
      const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
      if (!match) return;
      let value = match[2] || '';
      if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
        value = value.slice(1, -1);
      }
      result[match[1]] = value;
    });
    return result;
  }

  function quoteEnvValue(value) {
    if (!/[\s#"]/u.test(value)) return value;
    return `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
  }

  function upsertEnvAssignments(content, entries) {
    const lines = String(content || '').split(/\r?\n/);
    const keys = Object.keys(entries);
    const nextLines = [];
    const replaced = new Set();

    lines.forEach((line) => {
      const match = line.match(/^\s*#?\s*([A-Z0-9_]+)\s*=/);
      if (!match || !keys.includes(match[1])) {
        nextLines.push(line);
        return;
      }
      if (replaced.has(match[1])) return;
      nextLines.push(`${match[1]}=${quoteEnvValue(entries[match[1]])}`);
      replaced.add(match[1]);
    });

    keys.forEach((key) => {
      if (replaced.has(key)) return;
      while (nextLines.length > 0 && nextLines[nextLines.length - 1] === '') nextLines.pop();
      if (nextLines.length > 0) nextLines.push('');
      nextLines.push(`${key}=${quoteEnvValue(entries[key])}`);
    });

    return `${nextLines.join('\n').replace(/\n{3,}/g, '\n\n')}\n`;
  }

  async function getProjectEnvHandle(createIfMissing = false) {
    const projectRoot = await loadDirectoryHandle('projectRoot');
    if (!projectRoot || !projectRoot.handle) {
      return { ok: false, reason: 'Projeto local nao configurado no plugin.' };
    }

    const permission = typeof projectRoot.handle.queryPermission === 'function'
      ? await projectRoot.handle.queryPermission({ mode: 'readwrite' }).catch(() => 'unknown')
      : 'unknown';

    if (permission !== 'granted') {
      return {
        ok: false,
        reason: permission === 'denied'
          ? 'O navegador negou acesso a raiz do projeto.'
          : 'A raiz do projeto precisa ser selecionada novamente para confirmar o acesso.',
      };
    }

    try {
      const envHandle = await projectRoot.handle.getFileHandle('.env', { create: createIfMissing });
      return { ok: true, envHandle, projectRoot };
    } catch (error) {
      return {
        ok: false,
        reason: createIfMissing
          ? `Nao foi possivel criar ou abrir o arquivo .env: ${error.message}`
          : 'Arquivo .env nao encontrado na raiz local selecionada.',
      };
    }
  }

  async function readEnvValues() {
    const envState = await getProjectEnvHandle(false);
    if (!envState.ok) {
      return {
        ok: false,
        values: {},
        reason: envState.reason,
      };
    }

    const file = await envState.envHandle.getFile();
    const text = await file.text();
    const parsed = parseEnvContent(text);
    return {
      ok: true,
      values: {
        WORKSPACE_ERP_BACKEND_DIR: normalizeEnvPathValue(parsed.WORKSPACE_ERP_BACKEND_DIR || parsed.WORKSPACE_BACKEND_DIR || ''),
        WORKSPACE_MOBILE_FRONTEND_DIR: normalizeEnvPathValue(parsed.WORKSPACE_MOBILE_FRONTEND_DIR || parsed.WORKSPACE_FRONTEND_DIR || ''),
        WORKSPACE_ERP_INCLUDE_DIR: normalizeEnvPathValue(parsed.WORKSPACE_ERP_INCLUDE_DIR || parsed.WORKSPACE_INCLUDE_DIR || ''),
      },
    };
  }

  async function ensureEnvExists() {
    const projectRoot = await loadDirectoryHandle('projectRoot');
    if (!projectRoot || !projectRoot.handle) {
      return { ok: false, reason: 'Projeto local nao configurado no plugin.' };
    }

    try {
      await projectRoot.handle.getFileHandle('.env', { create: false });
      return { ok: true, created: false };
    } catch {
      // .env nao existe — tenta semear do .env.example
    }

    let seedContent = '';
    try {
      const exampleHandle = await projectRoot.handle.getFileHandle('.env.example', { create: false });
      const exampleFile = await exampleHandle.getFile();
      seedContent = await exampleFile.text();
    } catch {
      // .env.example tambem nao encontrado — cria .env vazio
    }

    try {
      const envHandle = await projectRoot.handle.getFileHandle('.env', { create: true });
      const writable = await envHandle.createWritable();
      await writable.write(seedContent);
      await writable.close();
      return { ok: true, created: true, fromExample: !!seedContent };
    } catch (error) {
      return { ok: false, reason: `Nao foi possivel criar o arquivo .env: ${error.message}` };
    }
  }

  async function writeEnvValues(values) {
    const envState = await getProjectEnvHandle(true);
    if (!envState.ok) {
      throw new Error(envState.reason);
    }

    const currentFile = await envState.envHandle.getFile();
    let currentContent = await currentFile.text();

    if (!currentContent.trim()) {
      try {
        const exampleHandle = await envState.projectRoot.handle.getFileHandle('.env.example', { create: false });
        const exampleFile = await exampleHandle.getFile();
        currentContent = await exampleFile.text();
      } catch {
        // .env.example nao encontrado — continua com base vazia
      }
    }

    const nextContent = upsertEnvAssignments(currentContent, {
      WORKSPACE_ERP_BACKEND_DIR: normalizeEnvPathValue(values.WORKSPACE_ERP_BACKEND_DIR || ''),
      WORKSPACE_MOBILE_FRONTEND_DIR: normalizeEnvPathValue(values.WORKSPACE_MOBILE_FRONTEND_DIR || ''),
      WORKSPACE_ERP_INCLUDE_DIR: normalizeEnvPathValue(values.WORKSPACE_ERP_INCLUDE_DIR || ''),
    });

    const writable = await envState.envHandle.createWritable();
    await writable.write(nextContent);
    await writable.close();

    return {
      ok: true,
      values: {
        WORKSPACE_ERP_BACKEND_DIR: normalizeEnvPathValue(values.WORKSPACE_ERP_BACKEND_DIR || ''),
        WORKSPACE_MOBILE_FRONTEND_DIR: normalizeEnvPathValue(values.WORKSPACE_MOBILE_FRONTEND_DIR || ''),
        WORKSPACE_ERP_INCLUDE_DIR: normalizeEnvPathValue(values.WORKSPACE_ERP_INCLUDE_DIR || ''),
      },
    };
  }

  function detectMobileFrontendContext(text) {
    const source = String(text || '');
    let score = 0;
    const hits = [];

    MOBILE_FRONTEND_HINTS.forEach((entry) => {
      if (entry.rx.test(source)) {
        score += entry.weight;
        hits.push(entry.label);
      }
    });

    return {
      enabled: score >= 3,
      score,
      hits: [...new Set(hits)],
    };
  }

  function escapeRegex(value) {
    return String(value || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  const UPPERCASE_IDENTIFIER_STOP_WORDS = new Set([
    'API', 'APIS', 'APP', 'CLI', 'DB', 'ERP', 'HTTP', 'HTTPS', 'HTML', 'JSON',
    'JIRA', 'LGPD', 'LLM', 'PDF', 'PII', 'SQL', 'TXT', 'UI', 'URL', 'XML',
  ]);

  const TECHNICAL_NAME_HINT_RX = /\b(?:user\s+function|static\s+function|function|method|class|fonte|source|programa|routine|rotina)\s+([A-Za-z_][A-Za-z0-9_.:-]{2,})/gi;

  function normalizeTechnicalToken(value) {
    let normalized = String(value || '').trim();
    if (!normalized) return '';

    normalized = normalized
      .replace(/^[`'"]+|[`'"]+$/g, '')
      .replace(/[),;:]+$/g, '');

    const parenIndex = normalized.indexOf('(');
    if (parenIndex > 0) normalized = normalized.slice(0, parenIndex);

    return normalized.trim();
  }

  function addTechnicalToken(target, value, allowedExtensions = new Set()) {
    const normalized = normalizeTechnicalToken(value);
    if (!normalized || normalized.length < 3) return;

    target.add(normalized);

    const dotIndex = normalized.lastIndexOf('.');
    if (dotIndex <= 0) return;

    const ext = `.${normalized.slice(dotIndex + 1).toLowerCase()}`;
    if (allowedExtensions.size > 0 && !allowedExtensions.has(ext)) return;

    const stem = normalized.slice(0, dotIndex);
    if (stem.length >= 3) target.add(stem);
  }

  function isTechnicalArtifactToken(value, allowedExtensions = new Set()) {
    const normalized = normalizeTechnicalToken(value);
    if (!normalized || normalized.length < 3) return false;

    const dotIndex = normalized.lastIndexOf('.');
    if (dotIndex > 0) {
      const ext = `.${normalized.slice(dotIndex + 1).toLowerCase()}`;
      if (allowedExtensions.has(ext)) return true;
    }

    return (
      /[0-9]/.test(normalized) ||
      /[_.-]/.test(normalized) ||
      /[a-z][A-Z]/.test(normalized) ||
      /[A-Z]{2,}/.test(normalized) ||
      /^[A-Z]{3}$/i.test(normalized)
    );
  }

  function isHighSignalIdentifier(identifier) {
    const value = String(identifier || '').trim();
    if (!value) return false;

    return (
      /[0-9]/.test(value) ||
      /^[A-Z][A-Z0-9]{2,}$/.test(value) ||
      /^[A-Z][a-zA-Z0-9]{4,}[A-Z0-9][a-zA-Z0-9]*$/.test(value)
    );
  }

  function getIdentifierWeight(identifier) {
    return isHighSignalIdentifier(identifier) ? 8 : 5;
  }

  function extractSearchTerms(text) {
    const clean = String(text || '').replace(/\[[\w-]+\]/g, '');
    const knownFileExtensions = new Set(ALLOWED_EXTENSIONS);
    const stopWords = new Set([
      'https', 'lgpd', 'issue', 'campo', 'email', 'texto', 'valor', 'false',
      'true', 'null', 'undefined', 'return', 'function', 'const', 'class',
      'import', 'export', 'public', 'private', 'static', 'void', 'string',
      'number', 'boolean', 'object', 'array', 'promise', 'async', 'await',
      'throw', 'catch', 'error', 'where', 'which', 'there', 'their', 'about',
    ]);

    const camel = (clean.match(/\b[a-z][a-zA-Z0-9]{3,}\b/g) || [])
      .filter((item) => /[A-Z]/.test(item));
    const pascal = (clean.match(/\b[A-Z][a-zA-Z0-9]{3,}\b/g) || [])
      .filter((item) => /[A-Z0-9]/.test(item.slice(1)));
    const snake = clean.match(/\b[a-z]{3,}(?:_[a-z]{2,}){1,}\b/g) || [];
    const screaming = clean.match(/\b[A-Z]{2,}(?:_[A-Z0-9]{2,})+\b/g) || [];
    const upperAlnum = (clean.match(/\b[A-Z][A-Z0-9]{2,}\b/g) || [])
      .filter((item) => /\D/.test(item))
      .filter((item) => !UPPERCASE_IDENTIFIER_STOP_WORDS.has(item));
    const routes = clean.match(/\/[a-zA-Z0-9_\-]{2,}(?:\/[a-zA-Z0-9_\-]{2,})+/g) || [];
    const words = [...new Set((clean.match(/\b[a-zA-Z]{6,}\b/g) || []).map((item) => item.toLowerCase()))]
      .filter((item) => !stopWords.has(item));

    // Frases literais de mensagens do sistema — buscadas como substring nos fontes.
    // Captura strings entre aspas (simples ou duplas) com 10+ chars.
    const phraseSet = new Set();
    const qRx = /["']([^"'\n\r]{10,100})["']/g;
    let qm;
    while ((qm = qRx.exec(clean)) !== null) phraseSet.add(qm[1].trim());

    // Captura texto após palavras-chave de mensagens do sistema (PT e EN).
    const kwRx = /\b(?:erro|error|aviso|alerta|alert|mensagem|message|warning|warn|help|ajuda|exception|falha|fault|informa[cç][aã]o|instru[cç][aã]o)\s*[:\-–]\s*([^\n\r.]{10,100})/gi;
    let km;
    while ((km = kwRx.exec(clean)) !== null) phraseSet.add(km[1].trim());

    const phrases = [...phraseSet].filter((p) => p.length >= 10).slice(0, 10);

    const namedArtifacts = new Set();
    let nm;
    while ((nm = TECHNICAL_NAME_HINT_RX.exec(clean)) !== null) {
      addTechnicalToken(namedArtifacts, nm[1], knownFileExtensions);
    }

    for (const rawToken of (clean.match(/\b[A-Za-z0-9_][A-Za-z0-9_.-]{2,}\b/g) || [])) {
      if (!isTechnicalArtifactToken(rawToken, knownFileExtensions)) continue;
      addTechnicalToken(namedArtifacts, rawToken, knownFileExtensions);
    }

    // Termos individuais extraídos de dentro das mensagens do sistema.
    // Palavras de 4+ chars dentro de erros/alertas/help recebem peso maior que palavras gerais.
    const msgTermSet = new Set();
    for (const phrase of phraseSet) {
      for (const w of (phrase.match(/\b[a-zA-Z]{4,}\b/g) || [])) {
        const wl = w.toLowerCase();
        if (!stopWords.has(wl)) msgTermSet.add(wl);
      }
    }
    const messageTerms = [...msgTermSet].slice(0, 30);

    return {
      identifiers: [...new Set([
        ...camel,
        ...pascal,
        ...snake,
        ...screaming,
        ...upperAlnum,
        ...namedArtifacts,
      ])]
        .filter((item) => {
          const lower = item.toLowerCase();
          return (
            !stopWords.has(lower) &&
            !UPPERCASE_IDENTIFIER_STOP_WORDS.has(String(item).toUpperCase())
          );
        })
        .slice(0, 30),
      routes: [...new Set(routes)].slice(0, 10),
      words: words.slice(0, 30),
      // Peso 4 — frases literais de mensagens do sistema (erro, alerta, help, aviso)
      phrases,
      // Peso 3 — termos individuais extraídos de dentro das mensagens do sistema
      messageTerms,
    };
  }

  function scoreTextLines(lines, terms, keepMatchedLines = true) {
    const matchedLines = [];
    let score = 0;

    terms.identifiers.forEach((identifier) => {
      const rx = new RegExp(`\\b${escapeRegex(identifier)}\\b`, 'gi');
      const weight = getIdentifierWeight(identifier);
      lines.forEach((line, index) => {
        const hits = (line.match(rx) || []).length;
        if (hits > 0) {
          score += hits * weight;
          matchedLines.push(index);
        }
      });
    });

    terms.routes.forEach((route) => {
      lines.forEach((line, index) => {
        if (line.includes(route)) {
          score += 3;
          matchedLines.push(index);
        }
      });
    });

    terms.words.forEach((word) => {
      const rx = new RegExp(`\\b${escapeRegex(word)}\\b`, 'gi');
      lines.forEach((line, index) => {
        const hits = (line.match(rx) || []).length;
        if (hits > 0) {
          score += hits;
          matchedLines.push(index);
        }
      });
    });

    (terms.phrases || []).forEach((phrase) => {
      lines.forEach((line, index) => {
        if (line.includes(phrase)) {
          score += 4;
          matchedLines.push(index);
        }
      });
    });

    (terms.messageTerms || []).forEach((term) => {
      const rx = new RegExp(`\\b${escapeRegex(term)}\\b`, 'gi');
      lines.forEach((line, index) => {
        const hits = (line.match(rx) || []).length;
        if (hits > 0) {
          score += hits * 3;
          matchedLines.push(index);
        }
      });
    });

    return {
      score,
      matchedLines: keepMatchedLines
        ? [...new Set(matchedLines)].sort((a, b) => a - b)
        : [],
    };
  }

  function extractSnippets(content, matchedLines, ctx = 10, maxSnippets = 5, maxChars = 3000) {
    const lines = String(content || '').split('\n');

    if (!matchedLines.length) {
      const end = Math.min(35, lines.length);
      return {
        text: lines.slice(0, end).join('\n') + '\n// [cabecalho - sem ocorrencias diretas dos termos da issue]',
        lineRanges: end > 0 ? [{ start: 1, end }] : [],
        totalLines: lines.length,
      };
    }

    const expanded = new Set();
    matchedLines.forEach((index) => {
      for (let lineIndex = Math.max(0, index - ctx); lineIndex <= Math.min(lines.length - 1, index + ctx); lineIndex += 1) {
        expanded.add(lineIndex);
      }
    });

    const sorted = [...expanded].sort((a, b) => a - b);
    const spans = [];
    let start = sorted[0];
    let end = sorted[0];

    for (let index = 1; index < sorted.length; index += 1) {
      if (sorted[index] <= end + 4) {
        end = sorted[index];
      } else {
        spans.push([start, end]);
        start = sorted[index];
        end = sorted[index];
      }
    }
    spans.push([start, end]);

    let out = '';
    let chars = 0;
    const lineRanges = [];

    for (let spanIndex = 0; spanIndex < Math.min(spans.length, maxSnippets); spanIndex += 1) {
      const [spanStart, spanEnd] = spans[spanIndex];
      const block = `// L${spanStart + 1}-${spanEnd + 1}\n${lines.slice(spanStart, spanEnd + 1).join('\n')}\n`;
      if (chars + block.length > maxChars) {
        break;
      }
      out += (out ? '\n// ...\n\n' : '') + block;
      chars += block.length;
      lineRanges.push({ start: spanStart + 1, end: spanEnd + 1 });
    }

    return {
      text: out.trim(),
      lineRanges,
      totalLines: lines.length,
    };
  }

  function formatLineRanges(lineRanges, totalLines) {
    if (!lineRanges || !lineRanges.length) {
      return totalLines ? `1-${totalLines}` : 'sem linhas';
    }
    return lineRanges.map((range) => `${range.start}-${range.end}`).join(', ');
  }

  function scorePath(relativePath, terms) {
    const normalized = String(relativePath || '').replace(/\\/g, '/').toLowerCase();
    const parts = normalized.split('/');
    const base = parts[parts.length - 1] || normalized;
    const dotIndex = base.lastIndexOf('.');
    const stem = dotIndex > 0 ? base.slice(0, dotIndex) : base;
    let score = 0;

    terms.identifiers.forEach((identifier) => {
      const token = String(identifier || '').toLowerCase();
      if (!token) return;

      if (stem === token) {
        score += isHighSignalIdentifier(identifier) ? 18 : 10;
        return;
      }
      if (base.includes(token)) {
        score += isHighSignalIdentifier(identifier) ? 8 : 4;
        return;
      }
      if (normalized.includes(token)) {
        score += isHighSignalIdentifier(identifier) ? 3 : 2;
      }
    });

    terms.words.forEach((word) => {
      const token = String(word || '').toLowerCase();
      if (!token) return;

      if (stem === token) {
        score += 4;
      } else if (normalized.includes(token)) {
        score += 1;
      }
    });

    return score;
  }

  function extractSearchTerms(text, technicalContext = null) {
    return root.issueTechnicalContext.extractSearchTerms(text, technicalContext);
  }

  function scoreTextLines(lines, terms, keepMatchedLines = true) {
    return root.issueTechnicalContext.scoreTextLines(lines, terms, keepMatchedLines);
  }

  function formatLineRanges(lineRanges, totalLines) {
    return root.issueTechnicalContext.formatLineRanges(lineRanges, totalLines);
  }

  function scorePath(relativePath, terms) {
    return root.issueTechnicalContext.scorePath(relativePath, terms);
  }

  async function* walkDirectory(handle, prefix = '', stats = { discoveredFiles: 0 }, limits = DEFAULT_LIMITS) {
    for await (const [name, entry] of handle.entries()) {
      if (stats.discoveredFiles >= limits.maxDiscoveredFiles) return;

      const relativePath = prefix ? `${prefix}/${name}` : name;
      if (entry.kind === 'directory') {
        if (IGNORED_DIRECTORIES.has(name.toLowerCase())) continue;
        yield* walkDirectory(entry, relativePath, stats, limits);
        continue;
      }

      const lowerName = name.toLowerCase();
      const extension = lowerName.slice(lowerName.lastIndexOf('.'));
      if (!ALLOWED_EXTENSIONS.has(extension)) continue;

      stats.discoveredFiles += 1;
      yield { handle: entry, rel: relativePath, extension };
    }
  }

  async function readTextFile(fileHandle, limits) {
    const file = await fileHandle.getFile();
    if (file.size > limits.maxFileBytes) return null;
    return file.text();
  }

  async function loadDir(handleRecord, label, terms, limits, charLimit, fileLimit) {
    if (!handleRecord || !handleRecord.handle) {
      return {
        files: [],
        scanned: 0,
        status: 'missing',
        label,
        rootLabel: '',
      };
    }

    const permission = typeof handleRecord.handle.queryPermission === 'function'
      ? await handleRecord.handle.queryPermission({ mode: 'read' }).catch(() => 'unknown')
      : 'unknown';

    if (permission !== 'granted') {
      return {
        files: [],
        scanned: 0,
        status: permission === 'denied' ? 'denied' : 'prompt',
        label,
        rootLabel: handleRecord.label || handleRecord.handle.name || '',
      };
    }

    const candidates = [];
    const stats = { discoveredFiles: 0 };

    for await (const fileEntry of walkDirectory(handleRecord.handle, '', stats, limits)) {
      candidates.push({
        ...fileEntry,
        pathScore: scorePath(fileEntry.rel, terms),
      });
    }

    candidates.sort((a, b) => b.pathScore - a.pathScore);
    const selectedCandidates = candidates.slice(0, limits.maxCandidates);
    const scored = [];

    for (const candidate of selectedCandidates) {
      try {
        const content = await readTextFile(candidate.handle, limits);
        if (!content) continue;
        const { score, matchedLines } = scoreTextLines(content.split('\n'), terms, true);
        scored.push({
          rel: candidate.rel,
          pathScore: candidate.pathScore,
          contentScore: score,
          totalScore: candidate.pathScore * 2 + score,
          content,
          matchedLines,
        });
      } catch {
        // Ignora arquivos ilegiveis ou sem permissao de leitura.
      }
    }

    scored.sort((a, b) => b.totalScore - a.totalScore);

    const files = [];
    let totalChars = 0;
    for (const entry of scored.slice(0, fileLimit)) {
      if (totalChars >= charLimit) break;
      const snippet = extractSnippets(entry.content, entry.matchedLines);
      if (!snippet.text) continue;
      totalChars += snippet.text.length;
      files.push({
        rel: entry.rel,
        content: snippet.text,
        lineRanges: snippet.lineRanges,
        totalLines: snippet.totalLines,
        score: entry.totalScore,
        pathScore: entry.pathScore,
        contentScore: entry.contentScore,
      });
    }

    return {
      files,
      scanned: candidates.length,
      status: 'granted',
      label,
      rootLabel: handleRecord.label || handleRecord.handle.name || '',
    };
  }

  function buildWorkspaceBlock(files, label) {
    if (!files || !files.length) return '';
    const header = `## Arquivos do ${label} (contexto local do plugin)`;
    const body = files.map((file) => (
      `### ${label}/${file.rel}\n` +
      `Linhas enviadas: ${formatLineRanges(file.lineRanges, file.totalLines)}\n` +
      '```\n' +
      `${file.content}\n` +
      '```'
    )).join('\n\n');

    return `${header}\n\n${body}\n\n`;
  }

  function buildWorkspacePromptContext(workspace) {
    if (!workspace) {
      return '## Fontes locais do plugin\n- Nenhum contexto local disponivel.\n';
    }

    const safeTechnicalContext = root.core && typeof root.core.sanitizeStructuredData === 'function'
      ? root.core.sanitizeStructuredData(workspace.technicalContext)
      : workspace.technicalContext;
    const technicalBlock = root.issueTechnicalContext.buildTechnicalContextPromptSection(
      safeTechnicalContext,
      workspace.technicalCorrelation
    );
    const lines = ['## Fontes locais do plugin'];
    const backendStatus = workspace.backendStatus;
    const frontendStatus = workspace.frontendStatus;

    if (backendStatus.configured) {
      lines.push(`- ERP Back-end local: ${backendStatus.rootLabel || 'selecionado'} (${backendStatus.status})`);
    } else {
      lines.push('- ERP Back-end local: nao configurado');
    }

    if (!frontendStatus.configured) {
      lines.push('- App mobile Front-end local: nao configurado');
    } else if (!workspace.frontendContext.enabled) {
      lines.push('- App mobile Front-end local: configurado, mas ignorado por falta de sinais de app mobile/Minha Producao/celular/tablet no ticket');
    } else {
      lines.push(`- App mobile Front-end local: ${frontendStatus.rootLabel || 'selecionado'} (${frontendStatus.status})`);
      lines.push(`- Sinais de contexto mobile detectados: ${workspace.frontendContext.hits.join(', ')}`);
    }

    if (workspace.warnings.length) {
      workspace.warnings.forEach((warning) => lines.push(`- Aviso: ${warning}`));
    }

    lines.push('');

    const backendBlock = buildWorkspaceBlock(workspace.backend, 'Backend');
    const frontendBlock = buildWorkspaceBlock(workspace.frontend, 'Frontend');

    if (!backendBlock && !frontendBlock) {
      lines.push('Nenhum trecho local foi anexado ao prompt.');
      return `${technicalBlock}${lines.join('\n')}\n`;
    }

    return `${technicalBlock}${lines.join('\n')}\n${backendBlock}${frontendBlock}`;
  }

  function resolveDiagnosticContextArgs(maybeTechnicalContext, maybeLimits) {
    const looksLikeTechnicalContext = !!(
      maybeTechnicalContext &&
      typeof maybeTechnicalContext === 'object' &&
      !Array.isArray(maybeTechnicalContext) &&
      (Object.prototype.hasOwnProperty.call(maybeTechnicalContext, 'refs') ||
        Object.prototype.hasOwnProperty.call(maybeTechnicalContext, 'version'))
    );

    return {
      technicalContext: looksLikeTechnicalContext ? maybeTechnicalContext : null,
      limits: looksLikeTechnicalContext ? (maybeLimits || {}) : (maybeTechnicalContext || {}),
    };
  }

  async function collectDiagnosticWorkspaceContext(ticketText, maybeTechnicalContext = null, maybeLimits = {}) {
    const { technicalContext, limits } = resolveDiagnosticContextArgs(maybeTechnicalContext, maybeLimits);
    const effectiveLimits = { ...DEFAULT_LIMITS, ...limits };
    const terms = extractSearchTerms(ticketText, technicalContext);
    const mobileSignalText = [
      ticketText,
      ...root.issueTechnicalContext.flattenTechnicalReferences(technicalContext, ['modules', 'identifiers', 'sourceFiles'])
        .map((reference) => reference.value),
    ].filter(Boolean).join('\n');
    const frontendContext = detectMobileFrontendContext(mobileSignalText);
    const [backendHandle, frontendHandle] = await Promise.all([
      loadDirectoryHandle('erpBackend'),
      loadDirectoryHandle('mobileFrontend'),
    ]);

    const warnings = [];
    const backendLoad = await loadDir(
      backendHandle,
      'Backend',
      terms,
      effectiveLimits,
      effectiveLimits.backendChars,
      effectiveLimits.backendFiles
    );

    let frontendLoad = {
      files: [],
      scanned: 0,
      status: frontendHandle ? 'ignored' : 'missing',
      label: 'Frontend',
      rootLabel: frontendHandle ? frontendHandle.label || frontendHandle.handle?.name || '' : '',
    };

    if (frontendHandle && frontendContext.enabled) {
      frontendLoad = await loadDir(
        frontendHandle,
        'Frontend',
        terms,
        effectiveLimits,
        effectiveLimits.frontendChars,
        effectiveLimits.frontendFiles
      );
    }

    if (backendLoad.status !== 'granted' && backendHandle) {
      warnings.push('O diretorio local do ERP foi configurado, mas o navegador nao concedeu leitura nesta execucao.');
    }

    if (frontendHandle && frontendContext.enabled && frontendLoad.status !== 'granted') {
      warnings.push('O diretorio local do app mobile foi configurado, mas o navegador nao concedeu leitura nesta execucao.');
    }

    const technicalCorrelation = root.issueTechnicalContext.correlateTechnicalContextWithFiles(
      technicalContext,
      [
        ...backendLoad.files.map((file) => ({ ...file, scopeLabel: 'Backend' })),
        ...frontendLoad.files.map((file) => ({ ...file, scopeLabel: 'Frontend' })),
      ]
    );

    const workspace = {
      backend: backendLoad.files,
      frontend: frontendLoad.files,
      configured: !!(backendHandle || frontendHandle),
      technicalContext,
      technicalCorrelation,
      frontendContext,
      backendStatus: {
        configured: !!backendHandle,
        status: backendLoad.status,
        rootLabel: backendLoad.rootLabel,
      },
      frontendStatus: {
        configured: !!frontendHandle,
        status: frontendLoad.status,
        rootLabel: frontendLoad.rootLabel,
      },
      warnings,
      terms,
    };

    return {
      ...workspace,
      promptContext: buildWorkspacePromptContext(workspace),
    };
  }

  root.localWorkspace = {
    DIRECTORY_KINDS,
    DEFAULT_LIMITS,
    saveDirectoryHandle,
    loadDirectoryHandle,
    removeDirectoryHandle,
    getDirectoryStatus,
    getDirectoryStatuses,
    getProjectRootStatus,
    ensureEnvExists,
    readEnvValues,
    writeEnvValues,
    detectMobileFrontendContext,
    extractSearchTerms,
    scoreTextLines,
    extractSnippets,
    formatLineRanges,
    buildWorkspaceBlock,
    buildWorkspacePromptContext,
    collectDiagnosticWorkspaceContext,
    __test: {
      parseEnvContent,
      upsertEnvAssignments,
      normalizeEnvPathValue,
      scorePath,
    },
  };
}(typeof globalThis !== 'undefined' ? globalThis : this));
