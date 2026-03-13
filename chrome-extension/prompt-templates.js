(function initShieldPromptTemplates(globalScope) {
  const scope = globalScope || globalThis;
  const root = scope.SHIELD || (scope.SHIELD = {});

  const TEMPLATE_FILE = 'chrome-extension/prompt-templates.js';
  const TEMPLATE_ORDER = [];
  const TEMPLATE_DEFINITIONS = {};

  function normalizeText(value) {
    return String(value || '').replace(/\r\n/g, '\n').trim();
  }

  function cloneTemplateMap(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      return {};
    }
    return { ...value };
  }

  function registerTemplate(definition) {
    if (!definition || !definition.id) {
      throw new Error('Template definition must include an id.');
    }

    TEMPLATE_DEFINITIONS[definition.id] = {
      sourceFile: TEMPLATE_FILE,
      requiredPlaceholders: [],
      requiredBlock: '',
      ...definition,
    };

    if (!TEMPLATE_ORDER.includes(definition.id)) {
      TEMPLATE_ORDER.push(definition.id);
    }
  }

  function getTemplateDefinition(templateId) {
    const fallbackId = TEMPLATE_ORDER[0];
    return TEMPLATE_DEFINITIONS[templateId] || TEMPLATE_DEFINITIONS[fallbackId];
  }

  function getTemplateSettings(settings) {
    const source = settings || {};
    return {
      activePromptTemplateId: source.activePromptTemplateId || TEMPLATE_ORDER[0] || 'documentation',
      promptTemplateOverrides: cloneTemplateMap(source.promptTemplateOverrides),
      promptTemplateAdditions: cloneTemplateMap(source.promptTemplateAdditions),
    };
  }

  function ensureRequiredPlaceholders(templateText, definition) {
    const normalized = normalizeText(templateText);
    const missing = (definition.requiredPlaceholders || []).filter((placeholder) => (
      !normalized.includes(`{{${placeholder}}}`)
    ));

    if (!missing.length) {
      return { templateText: normalized, missingPlaceholders: [] };
    }

    const safeTemplate = [
      normalized,
      '',
      'Bloco obrigatorio reintroduzido automaticamente pelo SHIELD para evitar prompt incompleto:',
      definition.requiredBlock,
    ].join('\n').trim();

    return {
      templateText: safeTemplate,
      missingPlaceholders: missing,
    };
  }

  function listTemplates() {
    return TEMPLATE_ORDER.map((templateId) => {
      const definition = getTemplateDefinition(templateId);
      return {
        id: definition.id,
        label: definition.label,
        description: definition.description,
        sourceFile: definition.sourceFile,
      };
    });
  }

  function buildTemplateDescriptor(templateId, settings) {
    const definition = getTemplateDefinition(templateId);
    const stored = getTemplateSettings(settings);
    const override = normalizeText(stored.promptTemplateOverrides[definition.id]);
    const addition = normalizeText(stored.promptTemplateAdditions[definition.id]);
    const usingDefaultBase = !override;
    const baseTemplate = usingDefaultBase ? definition.template : override;
    const ensured = ensureRequiredPlaceholders(baseTemplate, definition);
    const finalTemplate = addition
      ? `${ensured.templateText}\n\nRegras complementares do usuario:\n${addition}`
      : ensured.templateText;

    return {
      id: definition.id,
      label: definition.label,
      description: definition.description,
      sourceFile: definition.sourceFile,
      defaultTemplate: definition.template,
      usingDefaultBase,
      baseTemplate,
      additionalInstructions: addition,
      finalTemplate,
      missingPlaceholders: ensured.missingPlaceholders,
    };
  }

  function stringifyPromptValue(value) {
    if (value === null || value === undefined) return '';
    if (typeof value === 'string') return value;
    if (typeof value === 'number' || typeof value === 'boolean') return String(value);
    return JSON.stringify(value, null, 2);
  }

  function renderPrompt(templateId, data, settings) {
    const descriptor = buildTemplateDescriptor(templateId, settings);
    let prompt = descriptor.finalTemplate;

    Object.entries(data || {}).forEach(([key, value]) => {
      const replacement = stringifyPromptValue(value);
      prompt = prompt.split(`{{${key}}}`).join(replacement);
    });

    return {
      ...descriptor,
      prompt,
    };
  }

  registerTemplate({
    id: 'documentation',
    label: 'Prompt Documentacao',
    description: 'Gera documentacao tecnica TOTVS a partir do ticket anonimizado.',
    sourceFile: TEMPLATE_FILE,
    requiredPlaceholders: ['issueKey', 'anonymizedText'],
    requiredBlock: [
      '--- TICKET JIRA ANONIMIZADO: {{issueKey}} ---',
      '{{anonymizedText}}',
      '--- FIM DO TICKET ---',
    ].join('\n'),
    template: [
      'Voce e um redator tecnico especialista em documentacao de software da TOTVS. Com base no ticket JIRA abaixo (ja anonimizado conforme LGPD), gere um Documento Tecnico (DT) no padrao oficial TOTVS TDN.',
      '',
      'Regras obrigatorias de resposta:',
      '- responda em texto limpo, em portugues, com redacao tecnica, objetiva e natural',
      '- nao use emojis, icones, simbolos decorativos ou marcas visuais que denunciem geracao automatizada',
      '- entregue somente titulos e secoes essenciais, em formato pronto para copiar e colar',
      '- anonimize pessoas e empresas',
      '- pesquise no TDN publico pelos nomes oficiais das rotinas do caso',
      '- ao citar uma rotina, use o nome funcional oficial, o codigo entre parenteses e o modulo quando puder confirmar no TDN',
      '- ao citar campos, use o nome oficial quando confirmado e o identificador tecnico entre parenteses, quando aplicavel',
      '- use nomenclatura oficial de modulos e siglas apenas quando houver evidencia confiavel',
      '- se algum nome de rotina, campo ou modulo nao for encontrado no TDN, declare explicitamente "A confirmar no TDN"',
      '- nao invente dados: use somente o conteudo do ticket e o que puder ser confirmado no TDN publico',
      '',
      'Regras de nomenclatura do titulo (DT):',
      '- Implementacoes: DT + Descricao + Localizacao (se existir)',
      '- Correcoes: Ticket + ID da Issue + DT + Descricao + Localizacao (se existir)',
      '- Identifique o tipo correto pelo conteudo do ticket',
      '- Padronizacao TDN da Descricao: a Descricao que segue o DT deve iniciar com o codigo da rotina principal seguido de " - " e da descricao objetiva (ex: MATA110 - Correcao no calculo de impostos)',
      '',
      'Estrutura obrigatoria do documento:',
      '',
      '### [Titulo conforme regra acima]',
      '',
      '### Problema',
      'Resuma em poucas linhas, de forma objetiva, tecnica e funcional, a situacao que motivou o ticket. Seja curto e direto ao ponto.',
      '',
      '### Solucao',
      'Resuma em poucas linhas, de forma objetiva, tecnica e funcional, o que foi implementado ou corrigido para resolver o problema. Seja curto, direto ao ponto e foque no que realmente foi feito.',
      '',
      '### Assuntos Relacionados',
      'Liste documentacoes do TDN relacionadas ao tema tratado neste ticket. Para cada item, devolva obrigatoriamente:',
      '- Titulo: nome da documentacao ou assunto relacionado',
      '- URL: link completo de referencia',
      'Informe apenas links que voce tenha alta confianca que existem. Se nao tiver uma URL confiavel, nao invente e nao inclua o item.',
      '',
      'Baseie a resposta no contexto abaixo:',
      '',
      '--- TICKET JIRA ANONIMIZADO: {{issueKey}} ---',
      '{{anonymizedText}}',
      '--- FIM DO TICKET ---',
    ].join('\n'),
  });

  root.prompts = {
    TEMPLATE_FILE,
    listTemplates,
    registerTemplate,
    getTemplateDefinition,
    getTemplateSettings,
    buildTemplateDescriptor,
    renderPrompt,
  };
}(typeof globalThis !== 'undefined' ? globalThis : this));
