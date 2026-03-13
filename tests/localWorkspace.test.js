import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import vm from 'node:vm';

function loadIssueTechnicalContext(context) {
  const source = fs.readFileSync(new URL('../src/issueTechnicalContext.js', import.meta.url), 'utf-8');
  const browserSource = [
    '(function initShieldIssueTechnicalContext(globalScope) {',
    '  const scope = globalScope || globalThis;',
    '  const root = scope.SHIELD || (scope.SHIELD = {});',
    '',
    source.replace(/^export\s+/gmu, ''),
    '',
    '  root.issueTechnicalContext = {',
    '    TECHNICAL_CONTEXT_VERSION,',
    '    extractIssueTechnicalContext,',
    '    flattenTechnicalReferences,',
    '    formatLineRanges,',
    '    extractSearchTerms,',
    '    scoreTextLines,',
    '    scorePath,',
    '    correlateTechnicalContextWithFiles,',
    '    buildTechnicalContextPromptSection,',
    '  };',
    '}(typeof globalThis !== "undefined" ? globalThis : this));',
    '',
  ].join('\n');

  vm.runInNewContext(browserSource, context, { filename: 'issue-technical-context.js' });
}

function loadLocalWorkspace() {
  const source = fs.readFileSync(new URL('../chrome-extension/local-workspace.js', import.meta.url), 'utf-8');
  const context = {
    SHIELD: {},
    globalThis: null,
  };
  context.globalThis = context;
  loadIssueTechnicalContext(context);
  vm.runInNewContext(source, context, { filename: 'local-workspace.js' });
  return context.SHIELD.localWorkspace;
}

test('detectMobileFrontendContext mirrors the mobile gating used by diagnostics', () => {
  const localWorkspace = loadLocalWorkspace();
  const enabled = localWorkspace.detectMobileFrontendContext('Erro no app mobile Minha Producao ao abrir no celular Android');
  const disabled = localWorkspace.detectMobileFrontendContext('Falha no ERP ao calcular juros de contrato');

  assert.equal(enabled.enabled, true);
  assert.match(enabled.hits.join(' '), /Minha Producao/);
  assert.equal(disabled.enabled, false);
});

test('local workspace helpers parse and update WORKSPACE paths inside .env content', () => {
  const localWorkspace = loadLocalWorkspace();
  const currentEnv = [
    'JIRA_BASE_URL=https://jira.exemplo.com',
    'WORKSPACE_ERP_BACKEND_DIR=C:/erp/old',
    'WORKSPACE_MOBILE_FRONTEND_DIR=C:/mobile/old',
    '',
  ].join('\n');

  const parsed = localWorkspace.__test.parseEnvContent(currentEnv);
  const updated = localWorkspace.__test.upsertEnvAssignments(currentEnv, {
    WORKSPACE_ERP_BACKEND_DIR: localWorkspace.__test.normalizeEnvPathValue('C:\\erp\\novo'),
    WORKSPACE_MOBILE_FRONTEND_DIR: localWorkspace.__test.normalizeEnvPathValue('C:\\mobile\\novo'),
  });

  assert.equal(parsed.WORKSPACE_ERP_BACKEND_DIR, 'C:/erp/old');
  assert.match(updated, /WORKSPACE_ERP_BACKEND_DIR=C:\/erp\/novo/);
  assert.match(updated, /WORKSPACE_MOBILE_FRONTEND_DIR=C:\/mobile\/novo/);
});

test('workspace prompt context renders source snippets when backend files are attached', () => {
  const localWorkspace = loadLocalWorkspace();
  const promptContext = localWorkspace.buildWorkspacePromptContext({
    backend: [{
      rel: 'src/financeiro.prw',
      content: '// L48-83\nUser Function MATA110()\nReturn',
      lineRanges: [{ start: 48, end: 83 }],
      totalLines: 120,
    }],
    frontend: [],
    warnings: [],
    frontendContext: { enabled: false, hits: [] },
    backendStatus: { configured: true, status: 'granted', rootLabel: 'Fontes ERP' },
    frontendStatus: { configured: false, status: 'missing', rootLabel: '' },
  });

  assert.match(promptContext, /## Fontes locais do plugin/);
  assert.match(promptContext, /ERP Back-end local: Fontes ERP \(granted\)/);
  assert.match(promptContext, /Backend\/src\/financeiro\.prw/);
  assert.match(promptContext, /Linhas enviadas: 48-83/);
});

test('extractSearchTerms prioritizes ERP aliases, source names and function names', () => {
  const localWorkspace = loadLocalWorkspace();
  const terms = localWorkspace.extractSearchTerms([
    'Na rotina QIPA215 o help LGERSLABOP valida QQK, QP7 e QP8.',
    'Ajustar Function QP215VLDJUS no fonte qipa215.prw e revisar QIPLaudosEnsaios.',
  ].join(' '));

  const identifiers = new Set(terms.identifiers);
  assert.ok(identifiers.has('QIPA215'));
  assert.ok(identifiers.has('LGERSLABOP'));
  assert.ok(identifiers.has('QQK'));
  assert.ok(identifiers.has('QP7'));
  assert.ok(identifiers.has('QP8'));
  assert.ok(identifiers.has('QP215VLDJUS'));
  assert.ok(identifiers.has('qipa215'));
  assert.ok(identifiers.has('QIPLaudosEnsaios'));

  const exactSourceScore = localWorkspace.__test.scorePath('Gestao de Qualidade/qipa215.prw', terms);
  const genericSourceScore = localWorkspace.__test.scorePath('Gestao de Qualidade/QLTEnsaiosCalculados.prw', terms);
  assert.ok(exactSourceScore > genericSourceScore);
});

test('source names cited in issue text outrank only-related files', () => {
  const localWorkspace = loadLocalWorkspace();
  const terms = localWorkspace.extractSearchTerms(
    'Erro na rotina QIPA215 ao validar laudo da operacao no fluxo do cliente.'
  );

  const exactSourceScore = localWorkspace.__test.scorePath('Gestao de Qualidade/qipa215.prw', terms);
  const relatedSourceScore = localWorkspace.__test.scorePath('Gestao de Qualidade/QIPLaudosEnsaios.prw', terms);

  assert.ok(exactSourceScore > relatedSourceScore);
});

test('three-letter acronyms and compact technical codes are prioritized without helper words', () => {
  const localWorkspace = loadLocalWorkspace();
  const terms = localWorkspace.extractSearchTerms(
    'Falha em QQK, QP7, SIGAQIP e qp215j3 durante a validacao do fluxo.'
  );

  const identifiers = new Set(terms.identifiers);
  assert.ok(identifiers.has('QQK'));
  assert.ok(identifiers.has('QP7'));
  assert.ok(identifiers.has('SIGAQIP'));
  assert.ok(identifiers.has('qp215j3'));

  const acronymScore = localWorkspace.__test.scorePath('modulo/qqk.prw', terms);
  const genericScore = localWorkspace.__test.scorePath('modulo/validacao-laudo.prw', terms);
  assert.ok(acronymScore > genericScore);
});

test('Protheus module siglas and reduced codes receive high weight in issue text', () => {
  const localWorkspace = loadLocalWorkspace();
  const terms = localWorkspace.extractSearchTerms(
    'Falha no modulo SIGWQIP com reflexo em QIP, QIE e QDO ao abrir o fonte QIPLaudosEnsaios.'
  );

  const identifiers = new Set(terms.identifiers);
  assert.ok(identifiers.has('SIGWQIP'));
  assert.ok(identifiers.has('QIP'));
  assert.ok(identifiers.has('QIE'));
  assert.ok(identifiers.has('QDO'));
  assert.ok(identifiers.has('QIPLaudosEnsaios'));

  const qipTextTerm = terms.textTerms.find((term) => term.value === 'QIP' && term.type === 'identifier');
  const sigwqipTextTerm = terms.textTerms.find((term) => term.value === 'SIGWQIP' && term.type === 'identifier');
  assert.equal(qipTextTerm?.weight, 7);
  assert.equal(sigwqipTextTerm?.weight, 7);

  const qipScore = localWorkspace.__test.scorePath('Gestao de Qualidade/QIPLaudosEnsaios.prw', terms);
  const qieScore = localWorkspace.__test.scorePath('Gestao de Qualidade/QIELaudosEnsaios.prw', terms);
  assert.ok(qipScore > qieScore);
});
