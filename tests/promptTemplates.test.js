import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import vm from 'node:vm';

function loadPromptRegistry() {
  const source = fs.readFileSync(new URL('../chrome-extension/prompt-templates.js', import.meta.url), 'utf-8');
  const context = {
    SHIELD: {},
    globalThis: null,
  };
  context.globalThis = context;
  vm.runInNewContext(source, context, { filename: 'prompt-templates.js' });
  return context.SHIELD.prompts;
}

test('prompt registry exposes the default system template', () => {
  const prompts = loadPromptRegistry();
  const descriptor = prompts.buildTemplateDescriptor('documentation', {});
  const templates = prompts.listTemplates();

  assert.equal(descriptor.label, 'Prompt Documentacao');
  assert.match(descriptor.defaultTemplate, /Regras obrigatorias de resposta:/);
  assert.match(descriptor.finalTemplate, /--- TICKET JIRA ANONIMIZADO: \{\{issueKey\}\} ---/);
  assert.equal(templates[0].sourceFile, 'chrome-extension/prompt-templates.js');
});

test('prompt registry appends user additions to the final prompt only', () => {
  const prompts = loadPromptRegistry();
  const descriptor = prompts.buildTemplateDescriptor('documentation', {
    promptTemplateAdditions: {
      documentation: 'Regra complementar de teste.',
    },
  });

  assert.match(descriptor.finalTemplate, /Regras complementares do usuario:\nRegra complementar de teste\./);
  assert.equal(descriptor.usingDefaultBase, true);
});

test('prompt registry restores required placeholders when override removes them', () => {
  const prompts = loadPromptRegistry();
  const descriptor = prompts.buildTemplateDescriptor('documentation', {
    promptTemplateOverrides: {
      documentation: 'Template incompleto sem placeholders obrigatorios.',
    },
  });

  assert.deepEqual(Array.from(descriptor.missingPlaceholders).sort(), ['anonymizedText', 'issueKey']);
  assert.match(descriptor.finalTemplate, /Bloco obrigatorio reintroduzido automaticamente pelo SHIELD/);
});

test('prompt registry accepts a second physical template file with isolated config', () => {
  const registry = loadPromptRegistry();
  const source = fs.readFileSync(new URL('../chrome-extension/prompt-template-diagnostic.js', import.meta.url), 'utf-8');
  const context = {
    SHIELD: { prompts: registry },
    globalThis: null,
  };
  context.globalThis = context;
  vm.runInNewContext(source, context, { filename: 'prompt-template-diagnostic.js' });

  const templates = registry.listTemplates();
  const diagnostic = registry.buildTemplateDescriptor('diagnostic', {
    promptTemplateAdditions: {
      diagnostic: 'Validar tambem o impacto de negocio.',
    },
  });

  assert.equal(templates.length, 2);
  assert.equal(templates[1].sourceFile, 'chrome-extension/prompt-template-diagnostic.js');
  assert.equal(diagnostic.label, 'Prompt Diagnostico');
  assert.match(diagnostic.finalTemplate, /Validar tambem o impacto de negocio\./);
});
