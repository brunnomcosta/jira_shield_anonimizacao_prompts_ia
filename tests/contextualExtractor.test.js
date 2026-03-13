import test from 'node:test';
import assert from 'node:assert/strict';

import { extractContextualEntities } from '../src/contextualExtractor.js';
import { PORTUGUESE_COMMON_WORDS_COUNT } from '../src/portugueseCommonWords.js';

test('extractContextualEntities ignora termos tecnicos de metrologia como pessoa', () => {
  const text = [
    'analista Laboratorio revisou o roteiro.',
    'analista Laborat\u00f3rio revisou o roteiro.',
    'responsavel Operacao liberou a Medicao.',
    'responsavel Opera\u00e7\u00e3o liberou a Medi\u00e7\u00e3o.',
    'solicitante Peca validou a Caracteristica.',
    'solicitante Pe\u00e7a validou a Caracter\u00edstica.',
    'tecnico Amostra registrou o Resultado.',
    'coordenador Metrologia iniciou a Inspecao.',
    'coordenador Qualidade iniciou a Inspe\u00e7\u00e3o.',
    'gerente Produto aprovou o Ensaio.',
    'analista Joao Silva validou o relatorio final.',
  ].join(' ');

  const { pessoas } = extractContextualEntities(text);

  assert.equal(pessoas.has('Joao Silva'), true);
  assert.equal(pessoas.has('Laboratorio'), false);
  assert.equal(pessoas.has('Laborat\u00f3rio'), false);
  assert.equal(pessoas.has('Operacao'), false);
  assert.equal(pessoas.has('Opera\u00e7\u00e3o'), false);
  assert.equal(pessoas.has('Peca'), false);
  assert.equal(pessoas.has('Pe\u00e7a'), false);
  assert.equal(pessoas.has('Caracteristica'), false);
  assert.equal(pessoas.has('Caracter\u00edstica'), false);
  assert.equal(pessoas.has('Amostra'), false);
  assert.equal(pessoas.has('Resultado'), false);
  assert.equal(pessoas.has('Metrologia'), false);
  assert.equal(pessoas.has('Qualidade'), false);
  assert.equal(pessoas.has('Inspecao'), false);
  assert.equal(pessoas.has('Inspe\u00e7\u00e3o'), false);
  assert.equal(pessoas.has('Produto'), false);
  assert.equal(pessoas.has('Ensaio'), false);
  assert.equal(pessoas.size, 1);
});

test('lista compartilhada de palavras comuns em portugues possui pelo menos 10000 entradas', () => {
  assert.equal(PORTUGUESE_COMMON_WORDS_COUNT >= 10000, true);
});

test('extractContextualEntities ignora palavras comuns como empresa e preserva nomes plausiveis', () => {
  const text = [
    'empresa Resultado foi registrada no ticket.',
    'fornecedor Processo retornou com ajuste.',
    'cliente Operacao aprovou a coleta.',
    'parceiro Totvs confirmou a janela.',
    'contrato com Banco do Brasil foi renovado.',
  ].join(' ');

  const { empresas } = extractContextualEntities(text);

  assert.equal(empresas.has('Resultado'), false);
  assert.equal(empresas.has('Processo'), false);
  assert.equal(empresas.has('Operacao'), false);
  assert.equal(empresas.has('Totvs'), true);
  assert.equal(empresas.has('Banco do Brasil'), true);
});

test('extractContextualEntities captura nomes apos rotulos de triagem e triador', () => {
  const text = [
    'Triagem: Joao da Silva',
    'Triador: Maria Souza',
    'Triadora: Ana Paula',
  ].join('\n');

  const { pessoas } = extractContextualEntities(text);

  assert.equal(pessoas.has('Joao da Silva'), true);
  assert.equal(pessoas.has('Maria Souza'), true);
  assert.equal(pessoas.has('Ana Paula'), true);
});

test('extractContextualEntities captura nome do cliente em capslock apos do cliente', () => {
  const text = [
    'Erro no cadastro do cliente JOAO DA SILVA durante a validacao.',
    'Retorno da cliente MARIA JOSE recebido no mesmo fluxo.',
    'Historico do cliente OPERACAO nao deve virar pessoa.',
  ].join(' ');

  const { pessoas } = extractContextualEntities(text);

  assert.equal(pessoas.has('JOAO DA SILVA'), true);
  assert.equal(pessoas.has('MARIA JOSE'), true);
  assert.equal(pessoas.has('OPERACAO'), false);
});
