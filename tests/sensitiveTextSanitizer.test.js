import test from 'node:test';
import assert from 'node:assert/strict';

import { maskSensitiveText, sanitizeStructuredData } from '../src/sensitiveTextSanitizer.js';

test('maskSensitiveText mascara credenciais explicitas e texto livre', () => {
  const input = [
    'senha: abc123',
    'Authorization: Bearer abc.def.ghi',
    'api key = "XYZ-999"',
    'o token e ZXCVBN12',
  ].join(' | ');

  const masked = maskSensitiveText(input);

  assert.equal(masked.includes('abc123'), false);
  assert.equal(masked.includes('abc.def.ghi'), false);
  assert.equal(masked.includes('XYZ-999'), false);
  assert.equal(masked.includes('ZXCVBN12'), false);
  assert.match(masked, /\[SENHA\]/);
});

test('sanitizeStructuredData mascara recursivamente estruturas aninhadas', () => {
  const payload = {
    summary: 'password=segredo123',
    issueLinks: [
      { summary: 'Authorization: Basic dXNlcjpzZWdyZWRv' },
    ],
    nested: {
      values: ['token e ABCD1234'],
    },
  };

  const safePayload = sanitizeStructuredData(payload);
  const serialized = JSON.stringify(safePayload);

  assert.equal(serialized.includes('segredo123'), false);
  assert.equal(serialized.includes('dXNlcjpzZWdyZWRv'), false);
  assert.equal(serialized.includes('ABCD1234'), false);
  assert.match(serialized, /\[SENHA\]/);
});
