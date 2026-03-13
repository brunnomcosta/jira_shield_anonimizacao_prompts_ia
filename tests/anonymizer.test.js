import test from 'node:test';
import assert from 'node:assert/strict';

import { anonymizeIssue } from '../src/anonymizer.js';
import { EntityMap } from '../src/entityMap.js';

test('anonymizeIssue mascara segredos presentes no summary', () => {
  const issue = {
    key: 'TEST-1',
    renderedFields: {
      description: '<p>password=segredo123</p>',
    },
    fields: {
      summary: 'Falha ao usar token: ZXCVBN12',
      status: { name: 'Aberto' },
      priority: { name: 'Alta' },
      issuetype: { name: 'Bug' },
      project: { name: 'ERP' },
      created: '2026-03-13T10:00:00Z',
      updated: '2026-03-13T10:30:00Z',
      assignee: { displayName: 'Joao Silva' },
      reporter: { displayName: 'Maria Souza' },
      description: 'password=segredo123',
      comment: {
        comments: [
          {
            author: { displayName: 'Joao Silva' },
            body: 'Authorization: Bearer abc.def.ghi',
            created: '2026-03-13T10:15:00Z',
          },
        ],
      },
      customfield_29200: null,
      customfield_29201: '',
      customfield_29202: '',
    },
  };

  const { anonIssue } = anonymizeIssue(issue, null);

  assert.match(anonIssue.fields.summary, /\[SENHA\]/);
  assert.equal(anonIssue.fields.summary.includes('ZXCVBN12'), false);
  assert.equal(anonIssue.fields.description.includes('segredo123'), false);
  assert.equal(anonIssue.fields.comment.comments[0].body.includes('abc.def.ghi'), false);
});

test('EntityMap nao substitui dentro de palavras nem dentro de tokens existentes', () => {
  const map = new EntityMap();
  map.registerEmpresa('ESA');

  const result = map.applyToText('MESA [EMPRESA-1] ESA');

  assert.equal(result, 'MESA [EMPRESA-1] [EMPRESA-1]');
});

test('anonymizeIssue nao inventa empresas em texto tecnico sem dados pessoais', () => {
  const description = 'Análise: Foi identificada inconsistência na rotina QIPA215 no tratamento do help LGERSLABOP. A validação de laudo inconsistente considerava operações do roteiro obtidas pela QQK, inclusive operações sem ensaios vinculados em QP7/QP8. Com isso, operações como 01 e 02, mesmo sem ensaio, podiam ser tratadas indevidamente como pendentes de laudo de operação, gerando bloqueio incorreto da inspeção. O ajuste aplicado restringe essa validação apenas às operações que efetivamente possuem ensaio na inspeção.';

  const issue = {
    key: 'TEST-2',
    renderedFields: {
      description,
    },
    fields: {
      summary: 'Ajuste na rotina QIPA215',
      status: { name: 'Aberto' },
      priority: { name: 'Alta' },
      issuetype: { name: 'Bug' },
      project: { name: 'ERP' },
      created: '2026-03-13T10:00:00Z',
      updated: '2026-03-13T10:30:00Z',
      assignee: null,
      reporter: null,
      description,
      comment: { comments: [] },
      customfield_29200: null,
      customfield_29201: '',
      customfield_29202: '',
    },
  };

  const { anonIssue, summary } = anonymizeIssue(issue, null);

  assert.equal(anonIssue.fields.description, description);
  assert.deepEqual(summary, { totalPessoas: 0, totalEmpresas: 0 });
});

test('anonymizeIssue mascara nome do cliente em capslock apos do cliente', () => {
  const description = 'Erro no cadastro do cliente JOAO DA SILVA durante a confirmacao do pedido.';

  const issue = {
    key: 'TEST-3',
    renderedFields: {
      description,
    },
    fields: {
      summary: 'Falha ao salvar cadastro do cliente',
      status: { name: 'Aberto' },
      priority: { name: 'Alta' },
      issuetype: { name: 'Bug' },
      project: { name: 'ERP' },
      created: '2026-03-13T10:00:00Z',
      updated: '2026-03-13T10:30:00Z',
      assignee: null,
      reporter: null,
      description,
      comment: { comments: [] },
      customfield_29200: null,
      customfield_29201: '',
      customfield_29202: '',
    },
  };

  const { anonIssue, summary } = anonymizeIssue(issue, null);

  assert.equal(anonIssue.fields.description.includes('JOAO DA SILVA'), false);
  assert.match(anonIssue.fields.description, /\[PESSOA-1\]/);
  assert.deepEqual(summary, { totalPessoas: 1, totalEmpresas: 0 });
});
