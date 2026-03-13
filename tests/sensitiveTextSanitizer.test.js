import test from 'node:test';
import assert from 'node:assert/strict';

import { maskSensitiveText, sanitizeStructuredData } from '../src/sensitiveTextSanitizer.js';

test('maskSensitiveText mascara credenciais explicitas e texto livre', () => {
  const input = [
    'senha: abc123',
    'senha   :   abc321',
    'Senha Admin: Alfa@123',
    'SENHA ADMIN: Beta@456',
    'password \t: \t xyz987',
    'Authorization: Bearer abc.def.ghi',
    'api key = "XYZ-999"',
    'o token e ZXCVBN12',
  ].join(' | ');

  const masked = maskSensitiveText(input);

  assert.equal(masked.includes('abc123'), false);
  assert.equal(masked.includes('abc321'), false);
  assert.equal(masked.includes('Alfa@123'), false);
  assert.equal(masked.includes('Beta@456'), false);
  assert.equal(masked.includes('xyz987'), false);
  assert.equal(masked.includes('abc.def.ghi'), false);
  assert.equal(masked.includes('XYZ-999'), false);
  assert.equal(masked.includes('ZXCVBN12'), false);
  assert.match(masked, /\[SENHA\]/);
});

test('maskSensitiveText usa o prefixo da credencial como gatilho e nao um valor especifico', () => {
  assert.equal(maskSensitiveText('Senha Admin: Qualquer@2026'), '[SENHA]');
  assert.equal(maskSensitiveText('SENHA ADMIN: OutroValor#99'), '[SENHA]');
  assert.equal(maskSensitiveText('senha admin = valor-final_123'), '[SENHA]');
  assert.equal(maskSensitiveText('Senha@123'), 'Senha@123');
});

test('maskSensitiveText nao atravessa quebra de linha entre dois pontos e valor da senha', () => {
  const input = 'senha   :\nabc123';

  const masked = maskSensitiveText(input);

  assert.equal(masked.includes('abc123'), true);
  assert.equal(masked.includes('[SENHA]'), false);
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
