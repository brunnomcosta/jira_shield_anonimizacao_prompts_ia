import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildTechnicalContextTextSection,
  buildTechnicalContextPromptSection,
  correlateTechnicalContextWithFiles,
  extractIssueTechnicalContext,
} from '../src/issueTechnicalContext.js';

test('extractIssueTechnicalContext captures module, routine, source and related technical references from Jira data', () => {
  const issue = {
    renderedFields: {
      description: [
        '<p>Erro na rotina MATA110 do modulo Financeiro ao abrir a tela Pedido.</p>',
        '<p>Fonte: MATA110.prw. Endpoint: /api/contracts. Campo: valor_total.</p>',
        '<p>Mensagem: "Saldo insuficiente para recalcular contrato".</p>',
      ].join(''),
    },
    fields: {
      summary: 'Falha no modulo Financeiro SIGAFIN',
      comment: {
        comments: [
          { body: 'Classe ContractService consulta a tabela SE1 antes de recalcular.' },
        ],
      },
      components: [{ name: 'Financeiro' }],
      labels: ['SIGAFIN', 'contas_pagar'],
      attachment: [{ filename: 'MATA110.PRW' }],
    },
  };

  const context = extractIssueTechnicalContext(issue);
  const valuesByGroup = Object.fromEntries(
    Object.entries(context.refs).map(([group, entries]) => [group, entries.map((entry) => entry.value)])
  );

  assert.match(valuesByGroup.modules.join(' '), /Financeiro/);
  assert.match(valuesByGroup.modules.join(' '), /SIGAFIN/);
  assert.match(valuesByGroup.routines.join(' '), /MATA110/);
  assert.match(valuesByGroup.routines.join(' '), /ContractService/);
  assert.match(valuesByGroup.sourceFiles.join(' '), /MATA110\.prw/i);
  assert.match(valuesByGroup.routes.join(' '), /\/api\/contracts/);
  assert.match(valuesByGroup.dbArtifacts.join(' '), /SE1/);
  assert.match(valuesByGroup.uiArtifacts.join(' '), /valor_total/);
  assert.match(valuesByGroup.messages.join(' '), /Saldo insuficiente/);
});

test('technical context prompt section distinguishes confirmed evidence from unconfirmed references', () => {
  const issue = {
    fields: {
      summary: 'Erro no modulo Financeiro',
      description: 'Rotina MATA110 chama fonte MATA110.prw e endpoint /api/contracts.',
      comment: { comments: [] },
      components: [{ name: 'Financeiro' }],
      labels: ['SIGAFIN'],
      attachment: [{ filename: 'MATA110.PRW' }],
    },
    renderedFields: {},
  };

  const context = extractIssueTechnicalContext(issue);
  const correlation = correlateTechnicalContextWithFiles(context, [
    {
      scopeLabel: 'Backend',
      rel: 'src/financeiro/MATA110.prw',
      content: [
        'User Function MATA110()',
        'ContractService():Post("/api/contracts")',
        'DbSelectArea("SE1")',
      ].join('\n'),
      lineRanges: [{ start: 48, end: 63 }],
      totalLines: 120,
    },
  ]);
  const promptSection = buildTechnicalContextPromptSection(context, correlation);

  assert.match(promptSection, /Confirmacoes por evidencia tecnica/);
  assert.match(promptSection, /rotina `MATA110` confirmado em `Backend\/src\/financeiro\/MATA110\.prw`/);
  assert.match(promptSection, /Sinais ainda nao confirmados por evidencia tecnica/);
  assert.match(promptSection, /modulo `SIGAFIN` citado em/);
});

test('technical context text section is suitable for PDF and generic prompt payloads', () => {
  const context = {
    refs: {
      modules: [{ value: 'SIGAFIN', origins: ['label'] }],
      routines: [{ value: 'MATA110', origins: ['summary'] }],
      sourceFiles: [{ value: 'MATA110.prw', origins: ['attachment'] }],
      identifiers: [{ value: 'QP215VLDJUS', origins: ['description'] }],
      routes: [],
      dbArtifacts: [],
      uiArtifacts: [],
      messages: [],
    },
  };

  const textSection = buildTechnicalContextTextSection(context);

  assert.match(textSection, /CONTEXTO TECNICO EXTRAIDO:/);
  assert.match(textSection, /Modulos:\n- SIGAFIN/);
  assert.match(textSection, /Rotinas\/servicos:\n- MATA110/);
  assert.match(textSection, /Fontes\/arquivos:\n- MATA110\.prw/);
  assert.match(textSection, /Identificadores tecnicos:\n- QP215VLDJUS/);
});
