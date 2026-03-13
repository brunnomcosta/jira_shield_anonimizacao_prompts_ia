import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';

const diagnosticsSource = fs.readFileSync(new URL('../src/diagnostics.js', import.meta.url), 'utf-8');

test('business prompt exige secao de riscos relacionados ao contexto do caso', () => {
  assert.match(
    diagnosticsSource,
    /EXATAMENTE estas 13 seções[\s\S]*### Riscos relacionados ao contexto do caso[\s\S]*Nao liste riscos genericos[\s\S]*Risco atual se nada for feito/
  );
});

test('lgpd prompt mantem escopo original sem secao extra de riscos', () => {
  assert.match(diagnosticsSource, /EXATAMENTE estas 9 seções/);
  assert.doesNotMatch(diagnosticsSource, /Risco de vazamento residual/);
});
