import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';

// O contrato do business prompt agora vive em diagnosticPromptBase.js (fonte unica).
// O contrato do prompt LGPD permanece inline em diagnostics.js.
const diagnosticsSource = fs.readFileSync(new URL('../src/diagnostics.js', import.meta.url), 'utf-8');
const promptBaseSource = fs.readFileSync(new URL('../src/diagnosticPromptBase.js', import.meta.url), 'utf-8');

test('business prompt exige secao de riscos relacionados ao contexto do caso', () => {
  assert.match(
    promptBaseSource,
    /EXATAMENTE estas 13 seções[\s\S]*### Riscos relacionados ao contexto do caso[\s\S]*Não liste riscos genéricos[\s\S]*Risco atual se nada for feito/
  );
});

test('business prompt exige tentativa de validar a hipotese em fonte quando houver codigo', () => {
  assert.match(
    promptBaseSource,
    /Quando houver trechos de código ou contexto de workspace[\s\S]*validam se o problema relatado realmente pode ocorrer[\s\S]*causa mais provável em fonte/
  );
  assert.match(
    promptBaseSource,
    /Evidências principais:[\s\S]*priorize evidências de código[\s\S]*validar se o problema relatado realmente pode ocorrer/
  );
});

test('business prompt exige marcar referencias tecnicas nao confirmadas em codigo', () => {
  assert.match(
    promptBaseSource,
    /inferência não confirmada por evidência técnica/i
  );
});

test('lgpd prompt mantem escopo original sem secao extra de riscos', () => {
  assert.match(diagnosticsSource, /EXATAMENTE estas 9 seções/);
  assert.doesNotMatch(diagnosticsSource, /Risco de vazamento residual/);
});

test('diagnostics CLI pode inspecionar espelho local do workspace em modo somente leitura', () => {
  assert.match(
    diagnosticsSource,
    /arquivos locais espelhados nesta workspace de diagnostico/
  );
  assert.match(
    diagnosticsSource,
    /comandos ou ferramentas somente leitura/
  );
  assert.doesNotMatch(
    diagnosticsSource,
    /Nao execute comandos shell, nao tente inspecionar arquivos adicionais e nao navegue pelo workspace/
  );
});
