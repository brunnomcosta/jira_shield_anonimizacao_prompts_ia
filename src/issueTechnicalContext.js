export const TECHNICAL_CONTEXT_VERSION = 2;

const FILE_EXTENSION_PATTERN =
  '(?:prw|prx|tlpp|ch|js|ts|tsx|jsx|java|cs|py|rb|php|go|kt|sql|json|xml)';
const FILE_REFERENCE_RX = new RegExp(`\\b[\\w./-]+\\.${FILE_EXTENSION_PATTERN}\\b`, 'gi');
const ROUTE_RX = /\/[a-zA-Z0-9_-]{2,}(?:\/[a-zA-Z0-9_:@.-]{2,})+/g;
const TOTVS_MODULE_RX = /\bSIG[AW][A-Z0-9]{3,}\b/gi;
const TOTVS_ROUTINE_RX = /\b(?:U_)?[A-Z]{4,}\d{2,}\b/g;
const MESSAGE_QUOTE_RX = /["']([^"'\n\r]{10,120})["']/g;
const MESSAGE_KEYWORD_RX = /\b(?:erro|error|aviso|alerta|alert|mensagem|message|warning|warn|help|ajuda|exception|falha|fault|instru[cç][aã]o)\s*[:=-]\s*([^\n\r.]{10,120})/gi;

const CAMEL_IDENTIFIER_RX = /\b[a-z][a-zA-Z0-9]{3,}\b/g;
const PASCAL_IDENTIFIER_RX = /\b[A-Z][a-zA-Z0-9]{3,}\b/g;
const SNAKE_IDENTIFIER_RX = /\b[a-z]{3,}(?:_[a-z0-9]{2,})+\b/g;
const SCREAMING_IDENTIFIER_RX = /\b[A-Z]{2,}(?:_[A-Z0-9]{2,})+\b/g;
const UPPER_ALNUM_IDENTIFIER_RX = /\b[A-Z][A-Z0-9]{2,}\b/g;
const DB_IDENTIFIER_RX = /\b(?:tabela|table|campo|field|coluna|column|view|query|sql)\s*(?:do|da|de)?\s*[:=-]?\s*([A-Za-z_][\w$.]{2,})/gi;
const MODULE_LABEL_RX = /\b(?:modulo|m[oó]dulo|componente|subsistema|dominio|dominio|area|area)\s*(?:do|da|de)?\s*[:=-]?\s*([A-Za-z0-9_./-]{3,}(?:\s+[A-Za-z0-9_./-]{2,}){0,4})/gi;
const ROUTINE_LABEL_RX = /\b(?:rotina|user\s+function|fun[cç][aã]o|function|metodo|m[eé]todo|classe|service|controller|handler|job|trigger|evento|programa|fonte)\s*(?:do|da|de)?\s*[:=-]?\s*([A-Za-z_][\w.$/-]{2,}(?:\(\))?)/gi;
const UI_LABEL_RX = /\b(?:tela|aba|painel|grid|formulario|formulario|botao|botao|campo)\s*(?:do|da|de)?\s*[:=-]?\s*([A-Za-z0-9_./ -]{3,48})/gi;

const TECHNICAL_NAME_HINT_RX = /\b(?:user\s+function|static\s+function|function|method|class|fonte|source|programa|routine|rotina)\s+([A-Za-z_][A-Za-z0-9_.:-]{2,})/gi;

const KNOWN_FILE_EXTENSIONS = new Set([
  '.prw',
  '.prx',
  '.tlpp',
  '.ch',
  '.js',
  '.ts',
  '.tsx',
  '.jsx',
  '.java',
  '.cs',
  '.py',
  '.rb',
  '.php',
  '.go',
  '.kt',
  '.sql',
  '.json',
  '.xml',
]);

const HIGH_WEIGHT_PROTHEUS_MODULE_NAMES = Object.freeze([
  'SIGAACD',
  'SIGABSC',
  'SIGADW',
  'SIGAGFE',
  'SIGAIMAGENS',
  'SIGAJURI',
  'SIGAMEX1',
  'SIGAMEX2',
  'SIGAPAINEISTOII',
  'SIGAPFS',
  'SIGAPRA',
  'SIGASGI',
  'SIGWAGR',
  'SIGWAPD',
  'SIGWAPT',
  'SIGWATF',
  'SIGWCDA',
  'SIGWCOM',
  'SIGWCRD',
  'SIGWCRM',
  'SIGWCSA',
  'SIGWCTB',
  'SIGWECO',
  'SIGWEDC',
  'SIGWEEC',
  'SIGWEFF',
  'SIGWEIC',
  'SIGWESS',
  'SIGWEST',
  'SIGWFAT',
  'SIGWFIN',
  'SIGWFIS',
  'SIGWFRT',
  'SIGWGCP',
  'SIGWGCT',
  'SIGWGPE',
  'SIGWGPR',
  'SIGWGTP',
  'SIGWHSP',
  'SIGWICE',
  'SIGWLOC',
  'SIGWLOJA',
  'SIGWMDT',
  'SIGWMNT',
  'SIGWOFI',
  'SIGWOMS',
  'SIGWORG',
  'SIGWPCO',
  'SIGWPDS',
  'SIGWPEC',
  'SIGWPHOTO',
  'SIGWPLS',
  'SIGWPMS',
  'SIGWPON',
  'SIGWPPAP',
  'SIGWQAD',
  'SIGWQDO',
  'SIGWQIE',
  'SIGWQIP',
  'SIGWQMT',
  'SIGWQNC',
  'SIGWREP',
  'SIGWRSP',
  'SIGWSGA',
  'SIGWSPED',
  'SIGWTAF',
  'SIGWTCF',
  'SIGWTEC',
  'SIGWTMK',
  'SIGWTMS',
  'SIGWTRM',
  'SIGWVDF',
  'SIGWVEI',
  'SIGWWF',
  'SIGWWMS',
]);

const HIGH_WEIGHT_PROTHEUS_MODULE_NAME_SET = new Set(HIGH_WEIGHT_PROTHEUS_MODULE_NAMES);
const HIGH_WEIGHT_PROTHEUS_MODULE_CODE_SET = new Set(
  HIGH_WEIGHT_PROTHEUS_MODULE_NAMES
    .map((value) => {
      const match = value.match(/^SIG[AW]([A-Z0-9]{3})/u);
      return match ? match[1] : '';
    })
    .filter(Boolean)
);

const GROUP_ORDER = [
  'modules',
  'routines',
  'sourceFiles',
  'identifiers',
  'routes',
  'dbArtifacts',
  'uiArtifacts',
  'messages',
];

const GROUP_LABELS = {
  modules: 'Modulos',
  routines: 'Rotinas/servicos',
  sourceFiles: 'Fontes/arquivos',
  identifiers: 'Identificadores tecnicos',
  routes: 'Endpoints/rotas',
  dbArtifacts: 'Artefatos de dados',
  uiArtifacts: 'Artefatos de UI',
  messages: 'Mensagens/trechos literais',
};

const GROUP_ITEM_LABELS = {
  modules: 'modulo',
  routines: 'rotina',
  sourceFiles: 'fonte',
  identifiers: 'identificador',
  routes: 'rota',
  dbArtifacts: 'artefato de dados',
  uiArtifacts: 'artefato de UI',
  messages: 'mensagem',
};

const MAX_ITEMS_PER_GROUP = {
  modules: 10,
  routines: 12,
  sourceFiles: 12,
  identifiers: 18,
  routes: 8,
  dbArtifacts: 10,
  uiArtifacts: 10,
  messages: 8,
};

const CONFIDENCE_RANK = {
  explicit: 3,
  metadata: 2,
  heuristic: 1,
};

const GENERIC_STOPWORDS = new Set([
  'about',
  'alerta',
  'array',
  'async',
  'await',
  'botao',
  'campo',
  'class',
  'cliente',
  'component',
  'components',
  'const',
  'controller',
  'dados',
  'descricao',
  'description',
  'error',
  'erro',
  'false',
  'field',
  'fields',
  'file',
  'fonte',
  'function',
  'help',
  'https',
  'import',
  'issue',
  'jira',
  'label',
  'labels',
  'lgpd',
  'message',
  'mensagem',
  'metodo',
  'modulo',
  'null',
  'object',
  'output',
  'painel',
  'private',
  'public',
  'query',
  'report',
  'return',
  'rotina',
  'route',
  'routes',
  'service',
  'sql',
  'summary',
  'system',
  'tabela',
  'table',
  'task',
  'ticket',
  'true',
  'undefined',
  'usuario',
  'valor',
  'warning',
  'where',
]);

const UPPERCASE_IDENTIFIER_STOP_WORDS = new Set([
  'API',
  'APIS',
  'APP',
  'CLI',
  'DB',
  'ERP',
  'HTTP',
  'HTTPS',
  'HTML',
  'JSON',
  'JIRA',
  'LGPD',
  'LLM',
  'PDF',
  'PII',
  'SQL',
  'TXT',
  'UI',
  'URL',
  'XML',
]);

const ORIGIN_LABELS = {
  attachment: 'anexo',
  component: 'component',
  description: 'descricao',
  jira_comment: 'comentario Jira',
  label: 'label',
  summary: 'resumo',
  zendesk_comment: 'comentario Zendesk',
};

function htmlToText(html) {
  if (!html) return '';
  return String(html)
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n')
    .replace(/<\/li>/gi, '\n')
    .replace(/<li>/gi, '- ')
    .replace(/<\/?(h[1-6]|p|div|blockquote|pre|ul|ol|tr|td|th)[^>]*>/gi, '\n')
    .replace(/<a\s[^>]*href=["']mailto:([^"'\s>]+)["'][^>]*>/gi, (_, email) => `${email} `)
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function normalizeWhitespace(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function cleanReferenceValue(value) {
  return normalizeWhitespace(value)
    .replace(/^[`"'([{]+/, '')
    .replace(/[`"')\]}.,;:]+$/, '')
    .trim();
}

function normalizeTechnicalToken(value) {
  let normalized = cleanReferenceValue(value);
  if (!normalized) return '';

  const parenIndex = normalized.indexOf('(');
  if (parenIndex > 0) normalized = normalized.slice(0, parenIndex);

  return normalized
    .replace(/^[`'"]+|[`'"]+$/g, '')
    .replace(/[),;:]+$/g, '')
    .trim();
}

function normalizeReferenceKey(value) {
  return cleanReferenceValue(value).toLowerCase();
}

function escapeRegex(value) {
  return String(value || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function countSubstringOccurrences(haystack, needle) {
  if (!haystack || !needle) return 0;
  let count = 0;
  let index = 0;
  const source = String(haystack);
  const query = String(needle);

  while (true) {
    const next = source.indexOf(query, index);
    if (next === -1) return count;
    count += 1;
    index = next + query.length;
  }
}

function isMeaningfulPhrase(value) {
  const clean = cleanReferenceValue(value);
  if (!clean || clean.length < 3 || clean.length > 120) return false;
  if (/^\d+$/u.test(clean)) return false;
  if (/\S+@\S+/u.test(clean)) return false;
  if (/\b\d{3}\.?\d{3}\.?\d{3}/u.test(clean)) return false;
  return !GENERIC_STOPWORDS.has(clean.toLowerCase());
}

function isMeaningfulIdentifier(value) {
  const clean = normalizeTechnicalToken(value);
  if (!clean || clean.length < 3) return false;
  if (/^\d+$/u.test(clean)) return false;
  if (GENERIC_STOPWORDS.has(clean.toLowerCase())) return false;
  return /[A-Z_]/u.test(clean) || /_/u.test(clean) || /\d/u.test(clean) || isKnownProtheusModuleValue(clean);
}

function isMeaningfulUiReference(value) {
  const clean = cleanReferenceValue(value);
  if (!clean || clean.length < 3 || clean.length > 48) return false;
  if (GENERIC_STOPWORDS.has(clean.toLowerCase())) return false;
  return clean.split(/\s+/).length <= 5;
}

function sanitizeEvidenceSample(value) {
  return normalizeWhitespace(value).slice(0, 140);
}

function createCollector() {
  const store = new Map();

  function add(group, value, origin, evidence, confidence = 'explicit') {
    const clean = cleanReferenceValue(value);
    if (!clean) return;

    const key = `${group}|${normalizeReferenceKey(clean)}`;
    const entry = store.get(key);
    if (!entry) {
      store.set(key, {
        group,
        value: clean,
        normalizedValue: normalizeReferenceKey(clean),
        confidence,
        origins: origin ? [origin] : [],
        evidenceSamples: evidence ? [sanitizeEvidenceSample(evidence)] : [],
      });
      return;
    }

    if (origin && !entry.origins.includes(origin)) entry.origins.push(origin);
    if (evidence) {
      const sample = sanitizeEvidenceSample(evidence);
      if (!entry.evidenceSamples.includes(sample) && entry.evidenceSamples.length < 3) {
        entry.evidenceSamples.push(sample);
      }
    }
    if ((CONFIDENCE_RANK[confidence] || 0) > (CONFIDENCE_RANK[entry.confidence] || 0)) {
      entry.confidence = confidence;
    }
  }

  function build() {
    const refs = {};
    for (const group of GROUP_ORDER) refs[group] = [];

    for (const entry of store.values()) {
      refs[entry.group].push(entry);
    }

    for (const group of GROUP_ORDER) {
      refs[group] = refs[group]
        .sort((left, right) => {
          const confidenceDiff = (CONFIDENCE_RANK[right.confidence] || 0) - (CONFIDENCE_RANK[left.confidence] || 0);
          if (confidenceDiff !== 0) return confidenceDiff;
          return left.value.localeCompare(right.value);
        })
        .slice(0, MAX_ITEMS_PER_GROUP[group] || 12);
    }

    return refs;
  }

  return { add, build };
}

function collectMatches(rx, text) {
  const matches = [];
  rx.lastIndex = 0;
  let match;
  while ((match = rx.exec(text)) !== null) {
    matches.push(match);
  }
  return matches;
}

function addWordsAsTerms(target, phrase, weight, type) {
  const words = cleanReferenceValue(phrase)
    .split(/[\s/.-]+/)
    .map((item) => item.trim())
    .filter((item) => item.length >= 4 && !GENERIC_STOPWORDS.has(item.toLowerCase()));

  for (const word of words) {
    addWeightedTerm(target, word, weight, type, 'word');
  }
}

function basename(pathValue) {
  const clean = String(pathValue || '').replace(/\\/g, '/');
  const parts = clean.split('/');
  return parts[parts.length - 1] || clean;
}

function basenameWithoutExtension(pathValue) {
  const name = basename(pathValue);
  const lastDot = name.lastIndexOf('.');
  return lastDot > 0 ? name.slice(0, lastDot) : name;
}

function referenceMatchMode(value) {
  return /^[A-Za-z0-9_]+$/u.test(value) ? 'word' : 'substring';
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

function getKnownProtheusModuleCode(value) {
  const normalized = normalizeTechnicalToken(value).toUpperCase();
  if (!normalized) return '';

  if (HIGH_WEIGHT_PROTHEUS_MODULE_CODE_SET.has(normalized)) return normalized;

  const prefixedMatch = normalized.match(/^SIG[AW]([A-Z0-9]{3,})$/u);
  if (prefixedMatch) {
    const code = prefixedMatch[1].slice(0, 3);
    return HIGH_WEIGHT_PROTHEUS_MODULE_CODE_SET.has(code) ? code : '';
  }

  const prefix = normalized.slice(0, 3);
  if (normalized.length > 3 && HIGH_WEIGHT_PROTHEUS_MODULE_CODE_SET.has(prefix)) return prefix;

  return '';
}

function isKnownProtheusModuleValue(value) {
  const normalized = normalizeTechnicalToken(value).toUpperCase();
  if (!normalized) return false;
  return HIGH_WEIGHT_PROTHEUS_MODULE_NAME_SET.has(normalized) || !!getKnownProtheusModuleCode(normalized);
}

function addProtheusModuleSignals(target, value) {
  const normalized = normalizeTechnicalToken(value);
  if (!normalized) return;

  const upper = normalized.toUpperCase();
  const moduleCode = getKnownProtheusModuleCode(upper);
  if (!moduleCode) return;

  if (/^SIG[AW][A-Z0-9]{3,}$/u.test(upper)) target.add(upper);
  target.add(moduleCode);
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
    isKnownProtheusModuleValue(normalized) ||
    /[0-9]/u.test(normalized) ||
    /[_.-]/u.test(normalized) ||
    /[a-z][A-Z]/u.test(normalized) ||
    /[A-Z]{2,}/u.test(normalized) ||
    /^[A-Z]{3}$/iu.test(normalized)
  );
}

function isHighSignalIdentifier(value) {
  const normalized = normalizeTechnicalToken(value);
  if (!normalized) return false;

  return (
    isKnownProtheusModuleValue(normalized) ||
    /[0-9]/u.test(normalized) ||
    /^[A-Z][A-Z0-9]{2,}$/u.test(normalized) ||
    /^[A-Z][a-zA-Z0-9]{4,}[A-Z0-9][a-zA-Z0-9]*$/u.test(normalized)
  );
}

function getIdentifierWeights(value) {
  if (isKnownProtheusModuleValue(value)) {
    return { text: 7, path: 7 };
  }

  if (isHighSignalIdentifier(value)) {
    return { text: 6, path: 5 };
  }

  return { text: 5, path: 4 };
}

function addWeightedTerm(targetMap, value, weight, type, mode) {
  const clean = cleanReferenceValue(value);
  if (!clean) return;

  const key = `${type}|${mode}|${clean.toLowerCase()}`;
  const current = targetMap.get(key);
  if (current && current.weight >= weight) return;
  targetMap.set(key, {
    value: clean,
    weight,
    type,
    mode,
  });
}

function collectTextReferences(text, origin, collector) {
  const clean = normalizeWhitespace(text);
  if (!clean) return;

  for (const match of collectMatches(MODULE_LABEL_RX, clean)) {
    if (isMeaningfulPhrase(match[1])) collector.add('modules', match[1], origin, match[0], 'explicit');
  }

  for (const match of collectMatches(ROUTINE_LABEL_RX, clean)) {
    if (isMeaningfulPhrase(match[1])) collector.add('routines', match[1], origin, match[0], 'explicit');
  }

  for (const match of collectMatches(DB_IDENTIFIER_RX, clean)) {
    if (isMeaningfulPhrase(match[1])) collector.add('dbArtifacts', match[1], origin, match[0], 'explicit');
  }

  for (const match of collectMatches(UI_LABEL_RX, clean)) {
    if (isMeaningfulUiReference(match[1])) collector.add('uiArtifacts', match[1], origin, match[0], 'explicit');
  }

  for (const match of collectMatches(FILE_REFERENCE_RX, clean)) {
    collector.add('sourceFiles', match[0], origin, match[0], 'explicit');
    const routineName = basenameWithoutExtension(match[0]);
    if (isMeaningfulIdentifier(routineName)) {
      collector.add('routines', routineName, origin, match[0], 'heuristic');
    }
  }

  for (const match of collectMatches(ROUTE_RX, clean)) {
    collector.add('routes', match[0], origin, match[0], 'explicit');
  }

  for (const match of collectMatches(TOTVS_MODULE_RX, clean)) {
    const moduleValue = normalizeTechnicalToken(match[0]).toUpperCase();
    if (!moduleValue) continue;
    collector.add('modules', moduleValue, origin, match[0], 'heuristic');

    const reducedCode = getKnownProtheusModuleCode(moduleValue);
    if (reducedCode) collector.add('modules', reducedCode, origin, match[0], 'heuristic');
  }

  for (const match of collectMatches(TOTVS_ROUTINE_RX, clean)) {
    collector.add('routines', match[0], origin, match[0], 'heuristic');
  }

  for (const match of collectMatches(UPPER_ALNUM_IDENTIFIER_RX, clean)) {
    const reducedCode = getKnownProtheusModuleCode(match[0]);
    if (reducedCode) collector.add('modules', reducedCode, origin, match[0], 'heuristic');
  }

  for (const match of collectMatches(TECHNICAL_NAME_HINT_RX, clean)) {
    const reducedCode = getKnownProtheusModuleCode(match[1]);
    if (reducedCode) collector.add('modules', reducedCode, origin, match[0], 'heuristic');
  }

  for (const match of collectMatches(MESSAGE_QUOTE_RX, clean)) {
    if (isMeaningfulPhrase(match[1])) collector.add('messages', match[1], origin, match[1], 'explicit');
  }

  for (const match of collectMatches(MESSAGE_KEYWORD_RX, clean)) {
    if (isMeaningfulPhrase(match[1])) collector.add('messages', match[1], origin, match[0], 'explicit');
  }

  const identifiers = [
    ...collectMatches(CAMEL_IDENTIFIER_RX, clean).map((match) => match[0]),
    ...collectMatches(PASCAL_IDENTIFIER_RX, clean).map((match) => match[0]),
    ...collectMatches(SNAKE_IDENTIFIER_RX, clean).map((match) => match[0]),
    ...collectMatches(SCREAMING_IDENTIFIER_RX, clean).map((match) => match[0]),
  ];

  for (const identifier of identifiers) {
    if (isMeaningfulIdentifier(identifier)) {
      collector.add('identifiers', identifier, origin, identifier, 'heuristic');
      if (/(Service|Controller|Repository|UseCase|Handler|Job|Command|Query)$/u.test(identifier)) {
        collector.add('routines', identifier, origin, identifier, 'heuristic');
      }
    }
  }
}

export function extractIssueTechnicalContext(issue, zendeskData = null) {
  const collector = createCollector();
  const fields = issue?.fields || {};
  const renderedFields = issue?.renderedFields || {};

  const summary = fields.summary || '';
  const description = renderedFields.description
    ? htmlToText(renderedFields.description)
    : (typeof fields.description === 'string' ? fields.description : '');

  if (summary) collectTextReferences(summary, 'summary', collector);
  if (description) collectTextReferences(description, 'description', collector);

  const comments = (fields.comment?.comments || []);
  comments.forEach((comment) => {
    const body = comment?.renderedBody
      ? htmlToText(comment.renderedBody)
      : (typeof comment?.body === 'string' ? comment.body : '');
    if (body) collectTextReferences(body, 'jira_comment', collector);
  });

  if (zendeskData?.comments?.length) {
    zendeskData.comments.forEach((comment) => {
      const body = comment?.html_body
        ? htmlToText(comment.html_body)
        : (typeof comment?.body === 'string' ? comment.body : '');
      if (body) collectTextReferences(body, 'zendesk_comment', collector);
    });
  }

  (fields.components || []).forEach((component) => {
    if (isMeaningfulPhrase(component?.name)) {
      collector.add('modules', component.name, 'component', component.name, 'metadata');
    }
  });

  (fields.labels || []).forEach((label) => {
    if (isMeaningfulIdentifier(label) || isMeaningfulPhrase(label)) {
      collector.add('identifiers', label, 'label', label, 'metadata');
    }
    if (isKnownProtheusModuleValue(label)) {
      const normalizedLabel = normalizeTechnicalToken(label).toUpperCase();
      if (normalizedLabel) collector.add('modules', normalizedLabel, 'label', label, 'metadata');

      const reducedCode = getKnownProtheusModuleCode(label);
      if (reducedCode) collector.add('modules', reducedCode, 'label', label, 'metadata');
    }
  });

  (fields.attachment || []).forEach((attachment) => {
    const fileName = String(attachment?.filename || '');
    FILE_REFERENCE_RX.lastIndex = 0;
    if (FILE_REFERENCE_RX.test(fileName)) {
      collector.add('sourceFiles', fileName, 'attachment', fileName, 'metadata');
    }
  });
  FILE_REFERENCE_RX.lastIndex = 0;

  return {
    version: TECHNICAL_CONTEXT_VERSION,
    refs: collector.build(),
    extractedFrom: {
      hasSummary: !!summary,
      hasDescription: !!description,
      jiraCommentCount: comments.length,
      zendeskCommentCount: zendeskData?.comments?.length || 0,
    },
  };
}

export function flattenTechnicalReferences(technicalContext, groups = GROUP_ORDER) {
  if (!technicalContext?.refs) return [];
  return groups.flatMap((group) => technicalContext.refs[group] || []);
}

export function formatLineRanges(lineRanges, totalLines) {
  if (!lineRanges || !lineRanges.length) {
    return totalLines ? `1-${totalLines}` : 'sem linhas';
  }
  return lineRanges.map((range) => `${range.start}-${range.end}`).join(', ');
}

export function extractSearchTerms(text, technicalContext = null) {
  const clean = String(text || '').replace(/\[[\w-]+\]/g, ' ');
  const textTerms = new Map();
  const pathTerms = new Map();

  const camel = collectMatches(CAMEL_IDENTIFIER_RX, clean).map((match) => match[0]);
  const pascal = collectMatches(PASCAL_IDENTIFIER_RX, clean)
    .map((match) => match[0])
    .filter((item) => /[A-Z0-9]/.test(item.slice(1)));
  const snake = collectMatches(SNAKE_IDENTIFIER_RX, clean).map((match) => match[0]);
  const screaming = collectMatches(SCREAMING_IDENTIFIER_RX, clean).map((match) => match[0]);
  const upperAlnum = collectMatches(UPPER_ALNUM_IDENTIFIER_RX, clean)
    .map((match) => match[0])
    .filter((item) => /\D/u.test(item))
    .filter((item) => !UPPERCASE_IDENTIFIER_STOP_WORDS.has(item.toUpperCase()));
  const fileStems = collectMatches(FILE_REFERENCE_RX, clean)
    .map((match) => basenameWithoutExtension(match[0]))
    .filter(Boolean);
  const routes = collectMatches(ROUTE_RX, clean).map((match) => match[0]);
  const words = [...new Set((clean.match(/\b[a-zA-Z]{6,}\b/g) || []).map((item) => item.toLowerCase()))]
    .filter((item) => !GENERIC_STOPWORDS.has(item));

  const phraseSet = new Set();
  for (const match of collectMatches(MESSAGE_QUOTE_RX, clean)) {
    if (isMeaningfulPhrase(match[1])) phraseSet.add(cleanReferenceValue(match[1]));
  }
  for (const match of collectMatches(MESSAGE_KEYWORD_RX, clean)) {
    if (isMeaningfulPhrase(match[1])) phraseSet.add(cleanReferenceValue(match[1]));
  }
  const phrases = [...phraseSet].slice(0, 10);

  const messageTerms = [];
  const messageTermSeen = new Set();
  for (const phrase of phrases) {
    for (const word of (phrase.match(/\b[a-zA-Z]{4,}\b/g) || [])) {
      const lower = word.toLowerCase();
      if (GENERIC_STOPWORDS.has(lower) || messageTermSeen.has(lower)) continue;
      messageTermSeen.add(lower);
      messageTerms.push(lower);
    }
  }

  const namedArtifacts = new Set();
  for (const match of collectMatches(TECHNICAL_NAME_HINT_RX, clean)) {
    addTechnicalToken(namedArtifacts, match[1], KNOWN_FILE_EXTENSIONS);
  }

  for (const rawToken of (clean.match(/\b[A-Za-z0-9_][A-Za-z0-9_.:-]{2,}\b/g) || [])) {
    if (!isTechnicalArtifactToken(rawToken, KNOWN_FILE_EXTENSIONS)) continue;
    addTechnicalToken(namedArtifacts, rawToken, KNOWN_FILE_EXTENSIONS);
  }

  const moduleSignals = new Set();
  [...upperAlnum, ...fileStems, ...namedArtifacts].forEach((item) => addProtheusModuleSignals(moduleSignals, item));

  const identifiers = [...new Set([
    ...camel,
    ...pascal,
    ...snake,
    ...screaming,
    ...upperAlnum,
    ...fileStems,
    ...namedArtifacts,
    ...moduleSignals,
  ])]
    .filter((item) => (
      isMeaningfulIdentifier(item) &&
      !UPPERCASE_IDENTIFIER_STOP_WORDS.has(String(item).toUpperCase())
    ))
    .slice(0, 30);

  identifiers.forEach((identifier) => {
    const weights = getIdentifierWeights(identifier);
    addWeightedTerm(textTerms, identifier, weights.text, 'identifier', 'word');
    addWeightedTerm(pathTerms, identifier, weights.path, 'identifier', 'substring');
  });

  [...new Set(routes)].slice(0, 10).forEach((route) => {
    addWeightedTerm(textTerms, route, 4, 'route', 'substring');
    addWeightedTerm(pathTerms, basename(route), 2, 'route', 'substring');
  });

  words.slice(0, 30).forEach((word) => {
    addWeightedTerm(textTerms, word, 1, 'word', 'word');
    addWeightedTerm(pathTerms, word, 1, 'word', 'substring');
  });

  phrases.forEach((phrase) => {
    addWeightedTerm(textTerms, phrase, 4, 'message', 'substring');
    addWordsAsTerms(pathTerms, phrase, 2, 'message');
  });

  messageTerms.slice(0, 30).forEach((term) => {
    addWeightedTerm(textTerms, term, 3, 'message', 'word');
    addWeightedTerm(pathTerms, term, 2, 'message', 'substring');
  });

  flattenTechnicalReferences(technicalContext).forEach((reference) => {
    const value = reference.value;
    switch (reference.group) {
      case 'modules':
        addWeightedTerm(textTerms, value, 7, 'module', referenceMatchMode(value));
        addWeightedTerm(pathTerms, value, 7, 'module', 'substring');
        addWordsAsTerms(textTerms, value, 2, 'module');
        addWordsAsTerms(pathTerms, value, 3, 'module');
        break;
      case 'routines':
        addWeightedTerm(textTerms, value, 7, 'routine', referenceMatchMode(value));
        addWeightedTerm(pathTerms, value, 7, 'routine', 'substring');
        break;
      case 'sourceFiles': {
        const fileName = basename(value);
        const bareName = basenameWithoutExtension(value);
        addWeightedTerm(textTerms, fileName, 7, 'sourceFile', 'substring');
        addWeightedTerm(pathTerms, fileName, 8, 'sourceFile', 'substring');
        if (bareName && isMeaningfulIdentifier(bareName)) {
          addWeightedTerm(textTerms, bareName, 6, 'sourceFile', referenceMatchMode(bareName));
          addWeightedTerm(pathTerms, bareName, 7, 'sourceFile', 'substring');
        }
        break;
      }
      case 'identifiers':
        addWeightedTerm(textTerms, value, 5, 'identifier', referenceMatchMode(value));
        addWeightedTerm(pathTerms, value, 5, 'identifier', 'substring');
        break;
      case 'routes':
        addWeightedTerm(textTerms, value, 4, 'route', 'substring');
        addWeightedTerm(pathTerms, basename(value), 2, 'route', 'substring');
        break;
      case 'dbArtifacts':
        addWeightedTerm(textTerms, value, 5, 'db', referenceMatchMode(value));
        addWeightedTerm(pathTerms, value, 4, 'db', 'substring');
        break;
      case 'uiArtifacts':
        addWeightedTerm(textTerms, value, 3, 'ui', referenceMatchMode(value));
        addWeightedTerm(pathTerms, value, 2, 'ui', 'substring');
        addWordsAsTerms(pathTerms, value, 2, 'ui');
        break;
      case 'messages':
        addWeightedTerm(textTerms, value, 4, 'message', 'substring');
        addWordsAsTerms(textTerms, value, 3, 'message');
        break;
      default:
        break;
    }
  });

  return {
    identifiers,
    routes: [...new Set(routes)].slice(0, 10),
    words: words.slice(0, 30),
    phrases,
    messageTerms: messageTerms.slice(0, 30),
    textTerms: [...textTerms.values()],
    pathTerms: [...pathTerms.values()],
  };
}

export function scoreTextLines(lines, terms, keepMatchedLines = true) {
  const matchedLines = [];
  let score = 0;

  for (const term of terms?.textTerms || []) {
    const value = String(term.value || '');
    if (!value) continue;

    if (term.mode === 'word') {
      const rx = new RegExp(`\\b${escapeRegex(value)}\\b`, 'gi');
      lines.forEach((line, index) => {
        const hits = (String(line).match(rx) || []).length;
        if (hits > 0) {
          score += hits * term.weight;
          matchedLines.push(index);
        }
      });
      continue;
    }

    const query = value.toLowerCase();
    lines.forEach((line, index) => {
      const hits = countSubstringOccurrences(String(line).toLowerCase(), query);
      if (hits > 0) {
        score += hits * term.weight;
        matchedLines.push(index);
      }
    });
  }

  return {
    score,
    matchedLines: keepMatchedLines
      ? [...new Set(matchedLines)].sort((left, right) => left - right)
      : [],
  };
}

export function scorePath(relativePath, terms) {
  const lowerPath = String(relativePath || '').replace(/\\/g, '/').toLowerCase();
  const fileName = basename(lowerPath);
  const stem = basenameWithoutExtension(fileName);

  return (terms?.pathTerms || []).reduce((sum, term) => {
    const rawQuery = String(term.value || '').toLowerCase();
    if (!rawQuery) return sum;

    const queryFileName = basename(rawQuery);
    const queryStem = basenameWithoutExtension(queryFileName);
    const exactBonus = ['sourceFile', 'routine', 'module', 'identifier'].includes(term.type) ? 4 : 2;
    const partialBonus = ['sourceFile', 'routine', 'module', 'identifier'].includes(term.type) ? 2 : 1;

    if (queryStem && stem === queryStem) {
      return sum + term.weight + exactBonus;
    }

    if (queryFileName && fileName === queryFileName) {
      return sum + term.weight + exactBonus;
    }

    if (queryFileName && fileName.includes(queryFileName)) {
      return sum + term.weight + partialBonus;
    }

    if (lowerPath.includes(rawQuery)) {
      return sum + term.weight;
    }

    return sum;
  }, 0);
}

function referenceMatchesFile(reference, file) {
  const rel = String(file?.rel || '').replace(/\\/g, '/');
  const content = String(file?.content || '');
  const haystack = `${rel}\n${content}`.toLowerCase();
  const value = reference.value.toLowerCase();
  if (!value) return false;

  if (reference.group === 'sourceFiles') {
    const fileName = basename(reference.value).toLowerCase();
    const bareName = basenameWithoutExtension(reference.value).toLowerCase();
    return haystack.includes(fileName) || (bareName && haystack.includes(bareName));
  }

  if (reference.group === 'modules' || reference.group === 'uiArtifacts') {
    const words = reference.value
      .toLowerCase()
      .split(/[\s/.-]+/)
      .filter((item) => item.length >= 4 && !GENERIC_STOPWORDS.has(item));
    if (words.length > 1) {
      return words.every((word) => haystack.includes(word));
    }
  }

  if (/^[A-Za-z0-9_]+$/u.test(reference.value)) {
    const rx = new RegExp(`\\b${escapeRegex(reference.value)}\\b`, 'i');
    return rx.test(`${rel}\n${content}`);
  }

  return haystack.includes(value);
}

function formatOriginList(reference) {
  const labels = (reference.origins || [])
    .map((origin) => ORIGIN_LABELS[origin] || origin)
    .slice(0, 3);
  return labels.length ? labels.join(', ') : 'origem nao identificada';
}

export function correlateTechnicalContextWithFiles(technicalContext, files) {
  const references = flattenTechnicalReferences(technicalContext)
    .filter((reference) => reference.group !== 'messages' || reference.value.length >= 12);
  const normalizedFiles = (files || [])
    .filter(Boolean)
    .map((file) => ({
      ...file,
      scopeLabel: file.scopeLabel || file.label || 'Workspace',
    }));

  const confirmed = [];
  const unconfirmed = [];

  references.forEach((reference) => {
    const matches = normalizedFiles
      .filter((file) => referenceMatchesFile(reference, file))
      .slice(0, 3)
      .map((file) => ({
        scopeLabel: file.scopeLabel,
        rel: file.rel,
        lineRanges: file.lineRanges || [],
        totalLines: file.totalLines || 0,
      }));

    const enriched = {
      ...reference,
      matches,
      originLabel: formatOriginList(reference),
    };

    if (matches.length > 0) {
      confirmed.push(enriched);
      return;
    }

    unconfirmed.push(enriched);
  });

  return {
    confirmed,
    unconfirmed,
  };
}

function formatReferenceList(groupKey, items) {
  if (!items.length) return null;
  const rendered = items
    .slice(0, 6)
    .map((item) => `\`${item.value}\` (${formatOriginList(item)})`)
    .join(', ');
  return `- ${GROUP_LABELS[groupKey]}: ${rendered}`;
}

function formatCorrelationLine(reference) {
  const firstMatch = reference.matches[0];
  const label = `${firstMatch.scopeLabel}/${firstMatch.rel}`;
  const lines = formatLineRanges(firstMatch.lineRanges, firstMatch.totalLines);
  return `- ${GROUP_ITEM_LABELS[reference.group]} \`${reference.value}\` confirmado em \`${label}\` (linhas ${lines}).`;
}

function formatUnconfirmedLine(reference) {
  return `- ${GROUP_ITEM_LABELS[reference.group]} \`${reference.value}\` citado em ${reference.originLabel}, mas sem confirmacao tecnica nos snippets anexados.`;
}

export function buildTechnicalContextTextSection(technicalContext, options = {}) {
  const references = flattenTechnicalReferences(technicalContext);
  if (!references.length) return '';

  const {
    heading = 'CONTEXTO TECNICO EXTRAIDO',
    includeHeading = true,
    includeNote = true,
  } = options;

  const lines = [];
  if (includeHeading && heading) {
    lines.push(`${heading}:`);
  }

  if (includeNote) {
    lines.push('Os itens abaixo foram extraidos do ticket e dos metadados disponiveis; quando nao houver evidencia direta em codigo, trate-os como sinal tecnico a confirmar.');
    lines.push('');
  }

  GROUP_ORDER.forEach((group) => {
    const items = (technicalContext?.refs?.[group] || []).slice(0, MAX_ITEMS_PER_GROUP[group] || 12);
    if (!items.length) return;
    lines.push(`${GROUP_LABELS[group]}:`);
    lines.push(...items.map((item) => `- ${item.value}`));
    lines.push('');
  });

  return lines.join('\n').trim();
}

export function buildTechnicalContextPromptSection(technicalContext, correlation = null) {
  const hasRefs = flattenTechnicalReferences(technicalContext).length > 0;
  if (!hasRefs && !correlation) {
    return '## Contexto tecnico extraido da issue\n- Nenhuma referencia tecnica relevante foi extraida da issue.\n';
  }

  const lines = ['## Contexto tecnico extraido da issue'];

  if (hasRefs) {
    GROUP_ORDER.forEach((group) => {
      const rendered = formatReferenceList(group, technicalContext.refs[group] || []);
      if (rendered) lines.push(rendered);
    });
  } else {
    lines.push('- Nenhuma referencia tecnica relevante foi extraida da issue.');
  }

  lines.push('');
  lines.push('### Confirmacoes por evidencia tecnica');
  if (correlation?.confirmed?.length) {
    correlation.confirmed
      .slice(0, 10)
      .forEach((reference) => lines.push(formatCorrelationLine(reference)));
  } else {
    lines.push('- Nenhuma referencia extraida da issue foi confirmada nos snippets anexados.');
  }

  lines.push('');
  lines.push('### Sinais ainda nao confirmados por evidencia tecnica');
  if (correlation?.unconfirmed?.length) {
    correlation.unconfirmed
      .slice(0, 12)
      .forEach((reference) => lines.push(formatUnconfirmedLine(reference)));
  } else if (!correlation && hasRefs) {
    lines.push('- Nao foi possivel confirmar tecnicamente as referencias extraidas porque nenhum snippet de codigo foi correlacionado nesta execucao.');
  } else {
    lines.push('- Nao ha sinais pendentes de confirmacao tecnica no contexto atual.');
  }

  lines.push('');
  return `${lines.join('\n')}\n`;
}
