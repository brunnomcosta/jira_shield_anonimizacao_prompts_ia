/**
 * pdfGenerator.js
 * Gera PDF anonimizado da issue usando jsPDF.
 *
 * Jira Server 8.x retorna os campos de texto como:
 *   - fields.description     → texto Wiki markup (legado)
 *   - renderedFields.description → HTML renderizado (preferido)
 *
 * Esta versão usa renderedFields quando disponível,
 * com fallback para o campo raw convertido para texto plano.
 */

import { jsPDF } from 'jspdf';

const MARGIN = 15;
const PAGE_W = 210;
const CONTENT_W = PAGE_W - MARGIN * 2;

// Paleta de cores [R, G, B]
const C = {
  azulEscuro: [31,  56, 100],
  azulMedio:  [46,  94, 170],
  azulClaro:  [214, 228, 247],
  texto:      [40,  40,  40],
  meta:       [80,  80,  80],
  rodape:     [130, 130, 130],
  verde:      [26,  107,  58],
  branco:     [255, 255, 255],
};

/**
 * Converte HTML simples (retornado pelo Jira renderedFields) em texto plano.
 */
export function htmlToText(html) {
  if (!html) return '';
  return html
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n')
    .replace(/<\/li>/gi, '\n')
    .replace(/<li>/gi, '• ')
    .replace(/<\/?(h[1-6]|p|div|blockquote|pre|ul|ol|tr|td|th)[^>]*>/gi, '\n')
    .replace(/<a\s[^>]*href=["']mailto:([^"'\s>]+)["'][^>]*>/gi, (_, email) => `${email} `) // preserva e-mail do href antes de remover tags
    .replace(/<[^>]+>/g, '')          // remove todas as outras tags
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/\n{3,}/g, '\n\n')       // colapsa quebras extras
    .trim();
}

/**
 * Extrai texto de um campo da issue:
 * prefere renderedFields (HTML), cai para fields (raw).
 */
export function extractText(issue, fieldName) {
  const rendered = issue.renderedFields?.[fieldName];
  if (rendered) return htmlToText(rendered);
  const raw = issue.fields?.[fieldName];
  if (typeof raw === 'string') return raw.trim();
  return '';
}

// ─── Helpers de desenho ───────────────────────────────────────────────────────

function drawDivider(doc, y, color = C.azulMedio) {
  doc.setDrawColor(...color);
  doc.setLineWidth(0.3);
  doc.line(MARGIN, y, PAGE_W - MARGIN, y);
  return y + 5;
}

function checkPage(doc, y, needed = 25) {
  if (y + needed > 280) { doc.addPage(); return 20; }
  return y;
}

function writeBlock(doc, text, x, y, maxWidth, fontSize = 10, color = C.texto) {
  if (!text) return y;
  doc.setFontSize(fontSize);
  doc.setTextColor(...color);
  doc.setFont(undefined, 'normal');
  const lines = doc.splitTextToSize(text, maxWidth);
  for (const line of lines) {
    y = checkPage(doc, y, 6);
    doc.text(line, x, y);
    y += fontSize * 0.45 + 1.2;
  }
  return y;
}

function sectionTitle(doc, y, label) {
  y = checkPage(doc, y, 18);
  doc.setFontSize(9);
  doc.setFont(undefined, 'bold');
  doc.setTextColor(...C.azulMedio);
  doc.text(label.toUpperCase(), MARGIN, y);
  doc.setFont(undefined, 'normal');
  return y + 5;
}

// ─── Gerador principal ────────────────────────────────────────────────────────

/**
 * Gera o PDF anonimizado e retorna o Buffer para salvar em disco.
 * @param {object} issue  Issue do Jira com campos já anonimizados
 * @returns {Buffer}
 */
export function generatePDF(issue) {
  const doc = new jsPDF({ unit: 'mm', format: 'a4' });
  const f   = issue.fields || {};
  let y = 15;

  // ── Banner LGPD ────────────────────────────────────────────────────────────
  doc.setFillColor(...C.azulClaro);
  doc.roundedRect(MARGIN, y, CONTENT_W, 8, 2, 2, 'F');
  doc.setFontSize(8);
  doc.setTextColor(...C.azulMedio);
  doc.text(
    `Exportado com anonimização LGPD — Lei 13.709/2018 — ${new Date().toLocaleString('pt-BR')}`,
    MARGIN + 3, y + 5.2
  );
  y += 13;

  // ── Chave da issue ─────────────────────────────────────────────────────────
  doc.setFontSize(10);
  doc.setFont(undefined, 'bold');
  doc.setTextColor(...C.azulMedio);
  doc.text(issue.key || '', MARGIN, y);
  y += 6;

  // ── Resumo ─────────────────────────────────────────────────────────────────
  doc.setFontSize(14);
  doc.setFont(undefined, 'bold');
  doc.setTextColor(...C.azulEscuro);
  const summaryLines = doc.splitTextToSize(f.summary || '(sem resumo)', CONTENT_W);
  summaryLines.forEach((line) => {
    doc.text(line, MARGIN, y);
    y += 7;
  });
  y += 2;

  y = drawDivider(doc, y);

  // ── Metadados em grid 2 colunas ────────────────────────────────────────────
  const meta = [
    ['Status',         f.status?.name           ?? '—'],
    ['Tipo',           f.issuetype?.name         ?? '—'],
    ['Prioridade',     f.priority?.name          ?? '—'],
    ['Projeto',        f.project?.name           ?? '—'],
    ['Responsável',    f.assignee?.displayName   ?? 'Não atribuído'],
    ['Reportado por',  f.reporter?.displayName   ?? '—'],
    ['Criado em',      f.created ? new Date(f.created).toLocaleString('pt-BR') : '—'],
    ['Atualizado em',  f.updated ? new Date(f.updated).toLocaleString('pt-BR') : '—'],
  ];

  const colW = (CONTENT_W - 4) / 2;
  meta.forEach(([label, value], i) => {
    const col  = i % 2;
    const row  = Math.floor(i / 2);
    const x    = MARGIN + col * (colW + 4);
    const lineY = y + row * 11;

    doc.setFontSize(7.5);
    doc.setFont(undefined, 'bold');
    doc.setTextColor(...C.meta);
    doc.text(label.toUpperCase(), x, lineY);

    doc.setFontSize(9);
    doc.setFont(undefined, 'normal');
    doc.setTextColor(...C.texto);
    doc.text(String(value), x, lineY + 4.5);
  });

  y += Math.ceil(meta.length / 2) * 11 + 4;

  // ── Contato Zendesk (quando disponível) ────────────────────────────────────
  const zdContact = f.zdContact;
  if (zdContact) {
    y = checkPage(doc, y, 22);
    doc.setFillColor(210, 237, 218);
    doc.roundedRect(MARGIN, y, CONTENT_W, 18, 2, 2, 'F');

    doc.setFontSize(7.5);
    doc.setFont(undefined, 'bold');
    doc.setTextColor(...C.verde);
    doc.text('CONTATO ZENDESK', MARGIN + 3, y + 5);

    const zdMeta = [
      ['Solicitante',  zdContact.nome  || '—'],
      ['E-mail',       zdContact.email || '—'],
      ['Telefone/Doc', zdContact.fone  || '—'],
    ];
    const zdColW = (CONTENT_W - 4) / 3;
    zdMeta.forEach(([label, value], i) => {
      const x = MARGIN + 3 + i * (zdColW + 2);
      doc.setFontSize(7);
      doc.setFont(undefined, 'bold');
      doc.setTextColor(...C.verde);
      doc.text(label.toUpperCase(), x, y + 10);
      doc.setFontSize(8.5);
      doc.setFont(undefined, 'normal');
      doc.setTextColor(...C.texto);
      doc.text(String(value), x, y + 15);
    });
    y += 22;
  }

  y = drawDivider(doc, y);

  // ── Descrição (= mensagem inicial do ticket Zendesk quando aplicável) ───────
  const isFromZendesk = f.reporter?.displayName?.toLowerCase().includes('zendesk') ||
                        f.reporter?.name?.toLowerCase().includes('zendesk');
  const descLabel = isFromZendesk ? 'Mensagem Inicial (Zendesk)' : 'Descrição';
  y = sectionTitle(doc, y, descLabel);
  const descText = extractText(issue, 'description') || 'Sem descrição.';
  y = writeBlock(doc, descText, MARGIN, y, CONTENT_W, 9.5);
  y += 6;

  // ── Comentários Jira ───────────────────────────────────────────────────────
  const comments = f.comment?.comments ?? [];
  if (comments.length > 0) {
    y = checkPage(doc, y, 20);
    y = drawDivider(doc, y);
    y = sectionTitle(doc, y, `Comentários (${comments.length})`);

    comments.forEach((comment, idx) => {
      y = checkPage(doc, y, 28);

      // Badge numérico
      doc.setFillColor(...C.azulClaro);
      doc.roundedRect(MARGIN, y - 3.5, 6, 5.5, 1, 1, 'F');
      doc.setFontSize(7);
      doc.setTextColor(...C.azulMedio);
      doc.text(String(idx + 1), MARGIN + 1.5, y + 0.8);

      // Autor + data
      doc.setFontSize(8.5);
      doc.setFont(undefined, 'bold');
      doc.setTextColor(...C.texto);
      const autor = comment.author?.displayName ?? '[PESSOA-?]';
      const data  = comment.created
        ? new Date(comment.created).toLocaleString('pt-BR') : '';
      doc.text(`${autor}  ·  ${data}`, MARGIN + 8, y);
      y += 5;

      // Corpo do comentário
      // Jira Server: corpo do comentário disponível em renderedFields.comment ou comment.body (wiki)
      let bodyText = '';
      if (comment.renderedBody) {
        bodyText = htmlToText(comment.renderedBody);
      } else if (typeof comment.body === 'string') {
        bodyText = comment.body;
      }
      bodyText = bodyText || '(sem conteúdo)';

      y = writeBlock(doc, bodyText, MARGIN + 2, y, CONTENT_W - 2, 9);
      y += 5;

      if (idx < comments.length - 1) {
        doc.setDrawColor(200, 200, 200);
        doc.setLineWidth(0.1);
        doc.line(MARGIN + 8, y - 2, PAGE_W - MARGIN, y - 2);
      }
    });
  }

  // ── Zendesk Comments ───────────────────────────────────────────────────────
  const zdComments = f.zdComments ?? [];
  if (zdComments.length > 0) {
    y = checkPage(doc, y, 20);
    y = drawDivider(doc, y);

    // Cabeçalho da seção com destaque Zendesk
    y = checkPage(doc, y, 18);
    doc.setFontSize(9);
    doc.setFont(undefined, 'bold');
    doc.setTextColor(...C.verde);
    doc.text(`ZENDESK COMMENTS (${zdComments.length})`, MARGIN, y);
    doc.setFont(undefined, 'normal');
    y += 5;

    zdComments.forEach((comment, idx) => {
      y = checkPage(doc, y, 28);

      // Badge numérico (cor verde para distinguir dos comentários Jira)
      doc.setFillColor(210, 237, 218);
      doc.roundedRect(MARGIN, y - 3.5, 6, 5.5, 1, 1, 'F');
      doc.setFontSize(7);
      doc.setTextColor(...C.verde);
      doc.text(String(idx + 1), MARGIN + 1.5, y + 0.8);

      // Autor + data + visibilidade
      doc.setFontSize(8.5);
      doc.setFont(undefined, 'bold');
      doc.setTextColor(...C.texto);
      const autor = comment.author?.displayName ?? '[PESSOA-?]';
      const data  = comment.created_at
        ? new Date(comment.created_at).toLocaleString('pt-BR') : '';
      const visibilidade = comment.public === false ? ' · privado' : ' · público';
      doc.text(`${autor}  ·  ${data}${visibilidade}`, MARGIN + 8, y);
      y += 5;

      // Corpo
      const bodyText = comment.body || '(sem conteúdo)';
      y = writeBlock(doc, bodyText, MARGIN + 2, y, CONTENT_W - 2, 9);
      y += 5;

      if (idx < zdComments.length - 1) {
        doc.setDrawColor(200, 200, 200);
        doc.setLineWidth(0.1);
        doc.line(MARGIN + 8, y - 2, PAGE_W - MARGIN, y - 2);
      }
    });
  }

  // ── Rodapé em todas as páginas ─────────────────────────────────────────────
  const totalPages = doc.internal.getNumberOfPages();
  for (let p = 1; p <= totalPages; p++) {
    doc.setPage(p);
    doc.setDrawColor(...C.azulMedio);
    doc.setLineWidth(0.3);
    doc.line(MARGIN, 288, PAGE_W - MARGIN, 288);
    doc.setFontSize(7.5);
    doc.setTextColor(...C.rodape);
    doc.text(
      'Plugin JIRA LGPD Export — Dados anonimizados conforme Lei 13.709/2018',
      MARGIN, 293
    );
    doc.text(`Pág. ${p} / ${totalPages}`, PAGE_W - MARGIN - 22, 293);
  }

  // Retorna Buffer para salvar em disco
  return Buffer.from(doc.output('arraybuffer'));
}
