(function (global) {
  const SHIELD = global.SHIELD || (global.SHIELD = {});

  const MARGIN = 15;
  const PAGE_W = 210;
  const CONTENT_W = PAGE_W - MARGIN * 2;

  const C = {
    azulEscuro: [31, 56, 100],
    azulMedio: [46, 94, 170],
    azulClaro: [214, 228, 247],
    texto: [40, 40, 40],
    meta: [80, 80, 80],
    rodape: [130, 130, 130],
    verde: [26, 107, 58],
  };

  function getJsPdf() {
    if (!global.jspdf || !global.jspdf.jsPDF) {
      throw new Error('jsPDF nao carregado na extensao.');
    }
    return global.jspdf.jsPDF;
  }

  function drawDivider(doc, y, color) {
    doc.setDrawColor.apply(doc, color || C.azulMedio);
    doc.setLineWidth(0.3);
    doc.line(MARGIN, y, PAGE_W - MARGIN, y);
    return y + 5;
  }

  function checkPage(doc, y, needed) {
    if (y + (needed || 25) > 280) {
      doc.addPage();
      return MARGIN;
    }
    return y;
  }

  function writeBlock(doc, text, x, y, maxWidth, fontSize, color) {
    if (!text) return y;
    doc.setFontSize(fontSize || 10);
    doc.setTextColor.apply(doc, color || C.texto);
    doc.setFont(undefined, 'normal');
    const lines = doc.splitTextToSize(text, maxWidth);
    lines.forEach((line) => {
      y = checkPage(doc, y, 6);
      doc.text(line, x, y);
      y += (fontSize || 10) * 0.45 + 1.2;
    });
    return y;
  }

  function sectionTitle(doc, y, label) {
    y = checkPage(doc, y, 18);
    doc.setFontSize(9);
    doc.setFont(undefined, 'bold');
    doc.setTextColor.apply(doc, C.azulMedio);
    doc.text(label.toUpperCase(), MARGIN, y);
    doc.setFont(undefined, 'normal');
    return y + 5;
  }

  function generatePDF(issue) {
    const jsPDF = getJsPdf();
    const core = SHIELD.core;
    const doc = new jsPDF({ unit: 'mm', format: 'a4' });
    const fields = issue.fields || {};
    const technicalContextText = SHIELD.issueTechnicalContext
      ? SHIELD.issueTechnicalContext.buildTechnicalContextTextSection(
        issue.technicalContext || fields.technicalContext || null,
        { includeHeading: false }
      )
      : '';
    let y = 15;

    doc.setFillColor.apply(doc, C.azulClaro);
    doc.roundedRect(MARGIN, y, CONTENT_W, 8, 2, 2, 'F');
    doc.setFontSize(8);
    doc.setTextColor.apply(doc, C.azulMedio);
    doc.text(
      `Exportado com anonimização LGPD - Lei 13.709/2018 - ${new Date().toLocaleString('pt-BR')}`,
      MARGIN + 3,
      y + 5.2
    );
    y += 13;

    doc.setFontSize(10);
    doc.setFont(undefined, 'bold');
    doc.setTextColor.apply(doc, C.azulMedio);
    doc.text(issue.key || '', MARGIN, y);
    y += 6;

    doc.setFontSize(14);
    doc.setFont(undefined, 'bold');
    doc.setTextColor.apply(doc, C.azulEscuro);
    const summaryLines = doc.splitTextToSize(fields.summary || '(sem resumo)', CONTENT_W);
    summaryLines.forEach((line) => {
      doc.text(line, MARGIN, y);
      y += 7;
    });
    y += 2;

    y = drawDivider(doc, y);

    const meta = [
      ['Status', fields.status && fields.status.name ? fields.status.name : '-'],
      ['Tipo', fields.issuetype && fields.issuetype.name ? fields.issuetype.name : '-'],
      ['Prioridade', fields.priority && fields.priority.name ? fields.priority.name : '-'],
      ['Projeto', fields.project && fields.project.name ? fields.project.name : '-'],
      ['Responsavel', fields.assignee && fields.assignee.displayName ? fields.assignee.displayName : 'Nao atribuido'],
      ['Reportado por', fields.reporter && fields.reporter.displayName ? fields.reporter.displayName : '-'],
      ['Criado em', fields.created ? new Date(fields.created).toLocaleString('pt-BR') : '-'],
      ['Atualizado em', fields.updated ? new Date(fields.updated).toLocaleString('pt-BR') : '-'],
    ];

    const colW = (CONTENT_W - 4) / 2;
    meta.forEach((entry, index) => {
      const label = entry[0];
      const value = entry[1];
      const col = index % 2;
      const row = Math.floor(index / 2);
      const x = MARGIN + col * (colW + 4);
      const lineY = y + row * 11;

      doc.setFontSize(7.5);
      doc.setFont(undefined, 'bold');
      doc.setTextColor.apply(doc, C.meta);
      doc.text(label.toUpperCase(), x, lineY);

      doc.setFontSize(9);
      doc.setFont(undefined, 'normal');
      doc.setTextColor.apply(doc, C.texto);
      doc.text(String(value), x, lineY + 4.5);
    });

    y += Math.ceil(meta.length / 2) * 11 + 4;

    const zdContact = fields.zdContact;
    if (zdContact) {
      y = checkPage(doc, y, 22);
      doc.setFillColor(210, 237, 218);
      doc.roundedRect(MARGIN, y, CONTENT_W, 18, 2, 2, 'F');

      doc.setFontSize(7.5);
      doc.setFont(undefined, 'bold');
      doc.setTextColor.apply(doc, C.verde);
      doc.text('CONTATO ZENDESK', MARGIN + 3, y + 5);

      const zdMeta = [
        ['Solicitante', zdContact.nome || '-'],
        ['E-mail', zdContact.email || '-'],
        ['Telefone/Doc', zdContact.fone || '-'],
      ];
      const zdColW = (CONTENT_W - 4) / 3;
      zdMeta.forEach((entry, index) => {
        const label = entry[0];
        const value = entry[1];
        const x = MARGIN + 3 + index * (zdColW + 2);
        doc.setFontSize(7);
        doc.setFont(undefined, 'bold');
        doc.setTextColor.apply(doc, C.verde);
        doc.text(label.toUpperCase(), x, y + 10);
        doc.setFontSize(8.5);
        doc.setFont(undefined, 'normal');
        doc.setTextColor.apply(doc, C.texto);
        doc.text(String(value), x, y + 15);
      });
      y += 22;
    }

    y = drawDivider(doc, y);

    const reporterName = fields.reporter && (
      fields.reporter.displayName || fields.reporter.name || ''
    );
    const isFromZendesk = String(reporterName).toLowerCase().includes('zendesk');
    y = sectionTitle(doc, y, isFromZendesk ? 'Mensagem inicial (Zendesk)' : 'Descricao');
    const descText = core.extractText(issue, 'description') || 'Sem descricao.';
    y = writeBlock(doc, descText, MARGIN, y, CONTENT_W, 9.5);
    y += 6;

    if (technicalContextText) {
      y = checkPage(doc, y, 20);
      y = drawDivider(doc, y);
      y = sectionTitle(doc, y, 'Contexto tecnico extraido');
      y = writeBlock(doc, technicalContextText, MARGIN, y, CONTENT_W, 8.8);
      y += 6;
    }

    const comments = (fields.comment && fields.comment.comments) || [];
    if (comments.length > 0) {
      y = checkPage(doc, y, 20);
      y = drawDivider(doc, y);
      y = sectionTitle(doc, y, `Comentarios (${comments.length})`);

      comments.forEach((comment, index) => {
        y = checkPage(doc, y, 28);

        doc.setFillColor.apply(doc, C.azulClaro);
        doc.roundedRect(MARGIN, y - 3.5, 6, 5.5, 1, 1, 'F');
        doc.setFontSize(7);
        doc.setTextColor.apply(doc, C.azulMedio);
        doc.text(String(index + 1), MARGIN + 1.5, y + 0.8);

        doc.setFontSize(8.5);
        doc.setFont(undefined, 'bold');
        doc.setTextColor.apply(doc, C.texto);
        const autor = comment.author && comment.author.displayName ? comment.author.displayName : '[PESSOA-?]';
        const data = comment.created ? new Date(comment.created).toLocaleString('pt-BR') : '';
        doc.text(`${autor}  -  ${data}`, MARGIN + 8, y);
        y += 5;

        const bodyText = comment.body || '(sem conteudo)';
        y = writeBlock(doc, bodyText, MARGIN + 2, y, CONTENT_W - 2, 9);
        y += 5;

        if (index < comments.length - 1) {
          doc.setDrawColor(200, 200, 200);
          doc.setLineWidth(0.1);
          doc.line(MARGIN + 8, y - 2, PAGE_W - MARGIN, y - 2);
        }
      });
    }

    const zdComments = fields.zdComments || [];
    if (zdComments.length > 0) {
      y = checkPage(doc, y, 20);
      y = drawDivider(doc, y);

      y = checkPage(doc, y, 18);
      doc.setFontSize(9);
      doc.setFont(undefined, 'bold');
      doc.setTextColor.apply(doc, C.verde);
      doc.text(`ZENDESK COMMENTS (${zdComments.length})`, MARGIN, y);
      doc.setFont(undefined, 'normal');
      y += 5;

      zdComments.forEach((comment, index) => {
        y = checkPage(doc, y, 28);

        doc.setFillColor(210, 237, 218);
        doc.roundedRect(MARGIN, y - 3.5, 6, 5.5, 1, 1, 'F');
        doc.setFontSize(7);
        doc.setTextColor.apply(doc, C.verde);
        doc.text(String(index + 1), MARGIN + 1.5, y + 0.8);

        doc.setFontSize(8.5);
        doc.setFont(undefined, 'bold');
        doc.setTextColor.apply(doc, C.texto);
        const autor = comment.author && comment.author.displayName ? comment.author.displayName : '[PESSOA-?]';
        const data = comment.created_at ? new Date(comment.created_at).toLocaleString('pt-BR') : '';
        const visibilidade = comment.public === false ? ' - privado' : ' - publico';
        doc.text(`${autor}  -  ${data}${visibilidade}`, MARGIN + 8, y);
        y += 5;

        const bodyText = comment.body || '(sem conteudo)';
        y = writeBlock(doc, bodyText, MARGIN + 2, y, CONTENT_W - 2, 9);
        y += 5;

        if (index < zdComments.length - 1) {
          doc.setDrawColor(200, 200, 200);
          doc.setLineWidth(0.1);
          doc.line(MARGIN + 8, y - 2, PAGE_W - MARGIN, y - 2);
        }
      });
    }

    const totalPages = doc.internal.getNumberOfPages();
    for (let page = 1; page <= totalPages; page += 1) {
      doc.setPage(page);
      doc.setDrawColor.apply(doc, C.azulMedio);
      doc.setLineWidth(0.3);
      doc.line(MARGIN, 288, PAGE_W - MARGIN, 288);
      doc.setFontSize(7.5);
      doc.setTextColor.apply(doc, C.rodape);
      doc.text('SHIELD Chrome Extension - Dados anonimizados conforme LGPD', MARGIN, 293);
      doc.text(`Pag. ${page} / ${totalPages}`, PAGE_W - MARGIN - 22, 293);
    }

    return doc.output('arraybuffer');
  }

  SHIELD.pdf = { generatePDF };
}(globalThis));
