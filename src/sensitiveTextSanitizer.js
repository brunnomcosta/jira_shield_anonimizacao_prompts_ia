const CREDENTIAL_ASSIGNMENT_PREFIX =
  '\\b(?:senha|password|passwd|pwd|pass|api[-_\\s]?key|apikey|secret(?:[-_\\s]?key)?|client[-_\\s]?secret|access[-_\\s]?token|auth[-_\\s]?token|bearer[-_\\s]?token|private[-_\\s]?key|token|credencial(?:is)?|credential(?:s)?)(?:[ \\t]+[A-Za-zÀ-ÿ0-9_.\\/-]{2,}){0,3}';

const RULE_DEFINITIONS = [
  { id: 'email', source: '[a-zA-Z0-9._%+\\-]+@[a-zA-Z0-9.\\-]+\\.[a-zA-Z]{2,}', flags: 'g', tag: '[EMAIL]' },
  { id: 'cpf', source: '\\b\\d{3}\\.?\\d{3}\\.?\\d{3}[-–]?\\d{2}\\b', flags: 'g', tag: '[CPF]' },
  { id: 'cnpj', source: '\\b\\d{2}\\.?\\d{3}\\.?\\d{3}\\/?\\.?\\d{4}[-–]?\\d{2}\\b', flags: 'g', tag: '[CNPJ]' },
  { id: 'telefone', source: '\\(?\\d{2}\\)?\\s?\\d{4,5}[-–\\s]?\\d{4}\\b', flags: 'g', tag: '[TELEFONE]' },
  { id: 'cep', source: '\\b\\d{5}[-–]\\d{3}\\b', flags: 'g', tag: '[CEP]' },
  { id: 'rg', source: '(?<![=\\/#&?@])\\b\\d{2}\\.?\\d{3}\\.?\\d{3}[-–]?[0-9Xx]\\b', flags: 'g', tag: '[RG]' },
  { id: 'pis', source: '\\b\\d{3}\\.?\\d{5}\\.?\\d{2}[-–]?\\d\\b', flags: 'g', tag: '[PIS]' },
  { id: 'placa-antiga', source: '\\b[A-Z]{3}[-\\s]?\\d{4}\\b', flags: 'g', tag: '[PLACA]' },
  { id: 'placa-mercosul', source: '\\b[A-Z]{3}\\d[A-Z]\\d{2}\\b', flags: 'g', tag: '[PLACA]' },
  { id: 'titulo-eleitor', source: '\\b\\d{4}\\s?\\d{4}\\s?\\d{4}\\b', flags: 'g', tag: '[TITULO_ELEITOR]' },
  { id: 'passaporte', source: '\\b[A-Z]{2}\\d{6,7}\\b', flags: 'g', tag: '[PASSAPORTE]' },
  {
    id: 'authorization-header',
    source: '\\b(?:authorization|proxy-authorization)\\s*:\\s*(?:bearer|basic)\\s+[^\\s,;]+',
    flags: 'gi',
    tag: '[SENHA]',
  },
  {
    id: 'credential-assignment',
    source: `${CREDENTIAL_ASSIGNMENT_PREFIX}[ \\t]*[:=][ \\t]*(?:"[^"\\r\\n]+"|\'[^\'\\r\\n]+\'|\\\`[^\\\`\\r\\n]+\\\`|[^\\s,;]+)`,
    flags: 'gi',
    tag: '[SENHA]',
  },
  {
    id: 'credential-free-text',
    source: '\\b(?:senha|password|api[-_\\s]?key|secret|token|credencial(?:is)?|credential(?:s)?)[ \\t]+(?:e|eh|is|igual[ \\t]+a|vale|seria)?[ \\t]*(?:"[^"\\r\\n]+"|\'[^\'\\r\\n]+\'|`[^`\\r\\n]+`|[A-Za-z0-9._~+/=-]{8,})',
    flags: 'gi',
    tag: '[SENHA]',
  },
  {
    id: 'url-usuario',
    source: 'https?:\\/\\/[^\\s/]+\\/(?:users?|perfil|profile|u|account|conta)\\/[\\w.%@+\\-]{2,}',
    flags: 'gi',
    tag: '[URL_USUARIO]',
  },
  {
    id: 'telefone-internacional',
    source: '\\+\\d{1,3}[\\s\\-]?\\(?\\d{2}\\)?[\\s\\-]?\\d{4,5}[\\s\\-]?\\d{4}\\b',
    flags: 'g',
    tag: '[TELEFONE]',
  },
];

function cloneRule(rule) {
  return {
    ...rule,
    rx: new RegExp(rule.source, rule.flags),
  };
}

export function getSensitiveTextRules() {
  return RULE_DEFINITIONS.map(cloneRule);
}

export function maskSensitiveText(text, options = {}) {
  if (text == null) return text;

  const fallbackTag = options.fallbackTag || null;
  return getSensitiveTextRules().reduce((acc, rule) => {
    rule.rx.lastIndex = 0;
    return acc.replace(rule.rx, fallbackTag || rule.tag);
  }, String(text));
}

export function sanitizeStructuredData(value, options = {}) {
  if (typeof value === 'string') {
    return maskSensitiveText(value, options);
  }

  if (Array.isArray(value)) {
    return value.map((item) => sanitizeStructuredData(item, options));
  }

  if (!value || typeof value !== 'object') {
    return value;
  }

  return Object.fromEntries(
    Object.entries(value).map(([key, entry]) => [key, sanitizeStructuredData(entry, options)])
  );
}
