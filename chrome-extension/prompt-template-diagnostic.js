(function registerShieldDiagnosticPrompt(globalScope) {
  const scope = globalScope || globalThis;
  const root = scope.SHIELD || (scope.SHIELD = {});

  if (!root.prompts || typeof root.prompts.registerTemplate !== 'function') {
    throw new Error('SHIELD prompt registry must be loaded before prompt-template-diagnostic.js');
  }

  if (!root.promptShared) {
    throw new Error('SHIELD prompt-shared.js must be loaded before prompt-template-diagnostic.js');
  }

  const shared = root.promptShared;

  // Restricao exclusiva do plugin Chrome: sem acesso a workspace local
  const chromeOnlyConstraints = [
    '- Como este prompt foi gerado pelo plugin Chrome, nao presuma acesso a workspace local ou a outros arquivos alem do contexto incluido.',
  ];

  const requiredBlock = [
    '## Ticket anonimizado',
    'Issue: {{issueKey}}',
    '',
    '{{anonymizedText}}',
    '',
    '{{workspaceContext}}',
  ].join('\n');

  // ── Template 1: diagnostic (sem fontes locais) ────────────────────────────
  // Remove o marcador {{workspaceInstruction}} — workspace chega via {{workspaceContext}}
  const outputSections = shared.OUTPUT_SECTIONS
    .map(s => s.replace('\n{{workspaceInstruction}}', ''))
    .join('\n\n');

  root.prompts.registerTemplate({
    id: 'diagnostic',
    label: 'Prompt Diagnostico',
    description: 'Replica o contrato de analise de negocio do diagnostics.js para uso no plugin Chrome.',
    sourceFile: 'chrome-extension/prompt-template-diagnostic.js',
    requiredPlaceholders: ['issueKey', 'anonymizedText', 'workspaceContext'],
    requiredBlock,
    template: [
      shared.PERSONA,
      '',
      'Importante:',
      ...shared.CORE_CONSTRAINTS,
      ...chromeOnlyConstraints,
      '',
      '## Ticket anonimizado',
      'Issue: {{issueKey}}',
      '',
      '{{anonymizedText}}',
      '',
      '{{workspaceContext}}',
      '',
      '## Instrucao de saida',
      '',
      shared.OUTPUT_INTRO,
      '',
      outputSections,
    ].join('\n'),
  });

  // ── Template 2: diagnostic_with_sources (com trechos de código fornecidos) ─
  // Substitui {{workspaceInstruction}} pela instrucao positiva de uso das fontes
  const workspaceSourceInstruction =
    '- Trechos de codigo-fonte foram incluidos neste prompt. Tente identificar os fontes relacionados e os trechos que validam se o problema descrito realmente pode ocorrer e qual e a causa mais provavel em fonte. Cite arquivo:linha exatos quando identificar o ponto de falha ou o ponto de decisao relevante.';

  const outputSectionsWithSources = shared.OUTPUT_SECTIONS
    .map(s => s.replace('{{workspaceInstruction}}', workspaceSourceInstruction))
    .join('\n\n');

  root.prompts.registerTemplate({
    id: 'diagnostic_with_sources',
    label: 'Prompt Diagnostico + Contexto Fontes',
    description: 'Variante do diagnostic que inclui trechos de codigo-fonte como contexto adicional.',
    sourceFile: 'chrome-extension/prompt-template-diagnostic.js',
    requiredPlaceholders: ['issueKey', 'anonymizedText', 'workspaceContext'],
    requiredBlock,
    template: [
      shared.PERSONA,
      '',
      'Importante:',
      ...shared.CORE_CONSTRAINTS,
      ...chromeOnlyConstraints,
      '',
      '## Ticket anonimizado',
      'Issue: {{issueKey}}',
      '',
      '{{anonymizedText}}',
      '',
      '{{workspaceContext}}',
      '',
      '## Instrucao de saida',
      '',
      shared.OUTPUT_INTRO,
      '',
      outputSectionsWithSources,
    ].join('\n'),
  });
}(typeof globalThis !== 'undefined' ? globalThis : this));
