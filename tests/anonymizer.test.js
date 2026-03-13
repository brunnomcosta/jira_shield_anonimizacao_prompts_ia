import test from 'node:test';
import assert from 'node:assert/strict';

import { anonymizeIssue } from '../src/anonymizer.js';

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
