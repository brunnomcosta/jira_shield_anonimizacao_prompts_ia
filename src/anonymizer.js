/**
 * anonymizer.js
 * Orquestra as 2 fases de anonimização de uma issue do Jira Server.
 *
 * FASE 1 — Mineração:
 *   Varre TODOS os textos da issue para construir o EntityMap
 *   ANTES de qualquer substituição.
 *   Fontes (em ordem de confiança):
 *     1. Campos estruturados: Assignee, Reporter, autores de comentários
 *     2. Blocos de assinatura nos textos
 *     3. Contexto por palavras-gatilho
 *
 * FASE 2 — Substituição:
 *   Aplica o EntityMap + regex estrutural em todos os textos.
 */

import { EntityMap } from './entityMap.js';
import { extractSignatureBlock, extractEntitiesFromSignature } from './signatureExtractor.js';
import { extractContextualEntities } from './contextualExtractor.js';
import { anonymizePatterns } from './nerDetector.js';
import { htmlToText, extractText } from './pdfGenerator.js';

/**
 * Anonimiza uma issue completa do Jira.
 * @param {object} issue Issue retornada pela API do Jira Server
 * @param {{ comments: Array, userMap: object }|null} zendeskData Comentários do Zendesk (opcional)
 * @returns {{ anonIssue: object, summary: object }}
 */
export function anonymizeIssue(issue, zendeskData = null) {
  const map = new EntityMap();
  const fields = issue.fields || {};

  // ── FASE 1: Mineração de entidades ────────────────────────────────────────

  // Fonte 1: campos estruturados (maior confiança)
  const autores = [
    fields.assignee?.displayName,
    fields.reporter?.displayName,
    fields.customfield_29200,                            // nome do contato Zendesk
    ...(fields.comment?.comments?.map((c) => c.author?.displayName) ?? []),
  ].filter(Boolean);
  autores.forEach((nome) => map.registerPessoa(nome));

  // Autores dos comentários Zendesk
  if (zendeskData) {
    const zdAutores = zendeskData.comments
      .map((c) => zendeskData.userMap[c.author_id]?.name)
      .filter(Boolean);
    zdAutores.forEach((nome) => map.registerPessoa(nome));
  }

  // Coleta todos os textos para mineração
  const descText = extractText(issue, 'description');
  const commentTexts = (fields.comment?.comments ?? []).map((c) => {
    if (c.renderedBody) return htmlToText(c.renderedBody);
    if (typeof c.body === 'string') return c.body;
    return '';
  }).filter(Boolean);

  // Textos dos comentários Zendesk para mineração
  const zdCommentTexts = zendeskData
    ? zendeskData.comments.map((c) => {
        if (c.html_body) return htmlToText(c.html_body);
        if (typeof c.body === 'string') return c.body;
        return '';
      }).filter(Boolean)
    : [];

  const allTexts = [descText, ...commentTexts, ...zdCommentTexts].filter(Boolean);

  // Fonte 2: assinaturas (alta confiança)
  // Fonte 3: contexto por gatilhos (média confiança)
  allTexts.forEach((text) => {
    const { signatureBlock } = extractSignatureBlock(text);
    const sigE = extractEntitiesFromSignature(signatureBlock);
    sigE.pessoas.forEach((p) => map.registerPessoa(p));
    sigE.empresas.forEach((e) => map.registerEmpresa(e));

    const ctxE = extractContextualEntities(text);
    ctxE.pessoas.forEach((p) => map.registerPessoa(p));
    ctxE.empresas.forEach((e) => map.registerEmpresa(e));
  });

  // ── FASE 2: Aplicação da anonimização ─────────────────────────────────────

  function process(text) {
    if (!text) return text;
    return anonymizePatterns(map.applyToText(text));
  }

  // Anonimiza corpo dos comentários Jira preservando metadados necessários para o PDF
  const anonComments = (fields.comment?.comments ?? []).map((c) => {
    let anonBody = '';
    if (c.renderedBody) {
      anonBody = process(htmlToText(c.renderedBody));
    } else if (typeof c.body === 'string') {
      anonBody = process(c.body);
    }

    return {
      ...c,
      author:       { displayName: map.getPessoa(c.author?.displayName) },
      body:         anonBody,
      renderedBody: null, // já processado acima
    };
  });

  // Anonimiza comentários Zendesk
  const anonZdComments = zendeskData
    ? zendeskData.comments.map((c) => {
        let anonBody = '';
        if (c.html_body) {
          anonBody = process(htmlToText(c.html_body));
        } else if (typeof c.body === 'string') {
          anonBody = process(c.body);
        }

        const authorName = zendeskData.userMap[c.author_id]?.name ?? null;

        return {
          id:         c.id,
          public:     c.public,
          created_at: c.created_at,
          author:     { displayName: map.getPessoa(authorName) },
          body:       anonBody,
        };
      })
    : null;

  // Monta issue anonimizada
  const anonIssue = {
    key:            issue.key,
    renderedFields: {
      // Sobrescreve com texto processado (o pdfGenerator vai ler daqui)
      description: process(descText),
    },
    fields: {
      summary:    fields.summary,     // resumo técnico — não anonimizar
      status:     fields.status,
      priority:   fields.priority,
      issuetype:  fields.issuetype,
      project:    fields.project,
      created:    fields.created,
      updated:    fields.updated,

      assignee: fields.assignee
        ? { displayName: map.getPessoa(fields.assignee.displayName) }
        : null,

      reporter: fields.reporter
        ? { displayName: map.getPessoa(fields.reporter.displayName) }
        : null,

      description: process(descText), // fallback para o pdfGenerator

      comment: { comments: anonComments },

      // Dados do contato Zendesk (anonimizados)
      zdContact: fields.customfield_29200 ? {
        nome:  map.getPessoa(fields.customfield_29200),
        email: process(fields.customfield_29201 ?? ''),
        fone:  process(fields.customfield_29202 ?? ''),
      } : null,

      // Comentários Zendesk anonimizados (null se não configurado)
      zdComments: anonZdComments,
    },
  };

  return { anonIssue, summary: map.getSummary() };
}
