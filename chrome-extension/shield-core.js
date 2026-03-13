(function (global) {
  const SHIELD = global.SHIELD || (global.SHIELD = {});

  function htmlToText(html) {
    if (!html) return '';
    return String(html)
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<\/p>/gi, '\n')
      .replace(/<\/li>/gi, '\n')
      .replace(/<li>/gi, '- ')
      .replace(/<\/?(h[1-6]|p|div|blockquote|pre|ul|ol|tr|td|th)[^>]*>/gi, '\n')
      .replace(/<a\s[^>]*href=["']mailto:([^"'\s>]+)["'][^>]*>/gi, (_, email) => `${email} `)
      .replace(/<[^>]+>/g, '')
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      .replace(/&nbsp;/g, ' ')
      .replace(/\n{3,}/g, '\n\n')
      .trim();
  }

  function extractText(issue, fieldName) {
    const rendered = issue && issue.renderedFields ? issue.renderedFields[fieldName] : null;
    if (rendered) return htmlToText(rendered);
    const raw = issue && issue.fields ? issue.fields[fieldName] : null;
    return typeof raw === 'string' ? raw.trim() : '';
  }

  const WB_CHARS = 'A-Za-záéíóúâêîôûãõàçÁÉÍÓÚÂÊÎÔÛÃÕÀÇ0-9_';

  class EntityMap {
    constructor() {
      this.pessoas = new Map();
      this.empresas = new Map();
      this.counters = { pessoa: 0, empresa: 0 };
    }

    registerPessoa(nome) {
      if (!nome || String(nome).trim().length < 2) return null;
      const key = String(nome).trim().toLowerCase();
      if (!this.pessoas.has(key)) {
        this.counters.pessoa += 1;
        this.pessoas.set(key, `[PESSOA-${this.counters.pessoa}]`);
      }
      return this.pessoas.get(key);
    }

    registerEmpresa(nome) {
      if (!nome || String(nome).trim().length < 2) return null;
      const key = String(nome).trim().toLowerCase();
      if (!this.empresas.has(key)) {
        this.counters.empresa += 1;
        this.empresas.set(key, `[EMPRESA-${this.counters.empresa}]`);
      }
      return this.empresas.get(key);
    }

    getPessoa(nome) {
      if (!nome) return '[PESSOA-?]';
      return this.pessoas.get(String(nome).trim().toLowerCase()) || '[PESSOA-?]';
    }

    applyToText(text) {
      if (!text) return text;
      let result = String(text);

      const sortedByLength = (map) => Array.from(map.entries()).sort((a, b) => b[0].length - a[0].length);

      for (const [nome, token] of sortedByLength(this.pessoas)) {
        const escaped = nome.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        result = result.replace(new RegExp(`(?<![${WB_CHARS}])${escaped}(?![${WB_CHARS}])`, 'gi'), token);
      }

      for (const [nome, token] of sortedByLength(this.empresas)) {
        const escaped = nome.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        result = result.replace(new RegExp(`(?<![${WB_CHARS}])${escaped}(?![${WB_CHARS}])`, 'gi'), token);
      }

      return result;
    }

    getSummary() {
      return {
        totalPessoas: this.counters.pessoa,
        totalEmpresas: this.counters.empresa,
      };
    }
  }

  const SIGNATURE_OPENERS = [
    /^(att\.?|atenciosamente|abs\.?|abracos?|grato|grata|cordialmente|saudacoes?|obrigado|obrigada|respeitosamente)[,.]?\s*$/im,
    /^(de|from|enviado\s+por|sent\s+by)[:\s]+/im,
    /^[-–—]{2,}\s*$/m,
    /^(ate\s+logo|forte\s+abraco|um\s+abraco|com\s+respeito|aguardo\s+retorno|aguardo\s+(?:seu\s+)?contato)[,.]?\s*$/im,
    /^(fico\s+a\s+disposicao|qualquer\s+duvida\s+estou\s+a\s+disposicao)[,.]?\s*$/im,
    /^(best\s+regards?|kind\s+regards?|regards?|sincerely|thanks?|thank\s+you|cheers|yours?\s+truly)[,.]?\s*$/im,
    /^(warm\s+regards?|with\s+regards?|respectfully)[,.]?\s*$/im,
    /^(muito\s+obrigad[oa]|mto\s+obrigad[oa]|obg\.?)[,.]?\s*$/im,
    /^(sem\s+mais|nada\s+mais\s+a\s+declarar|encerrando\s+por\s+aqui)[,.]?\s*$/im,
    /^(assinado\s+(?:digitalmente\s+)?por)[:\s]+/im,
  ];

  const NAME_SEGMENT = '(?:(?:\\s(?:de|da|do|dos|das|e))?\\s[A-ZÁÉÍÓÚÂÊÎÔÛÃÕÀÇ][a-záéíóúâêîôûãõàç]+)';
  const FULL_NAME = `[A-ZÁÉÍÓÚÂÊÎÔÛÃÕÀÇ][a-záéíóúâêîôûãõàç]+(?:${NAME_SEGMENT})+`;

  const SIG_PATTERNS = {
    nameWithPipe: new RegExp(`^(${FULL_NAME})\\s*[|\\/]`, 'm'),
    nameAlone: new RegExp(`^(${FULL_NAME})\\s*$`, 'm'),
    empresa: /(?<![A-Za-záéíóúâêîôûãõàçÁÉÍÓÚÂÊÎÔÛÃÕÀÇ])([A-ZÁÉÍÓÚÂÊÎÔÛÃÕÀÇ][A-Za-záéíóúâêîôûãõàçÁÉÍÓÚÂÊÎÔÛÃÕÀÇ&\s]*?)\s+(?:S\.?A\.?|Ltda\.?|EIRELI|ME|EPP|SS|MEI|SCP|S\/A|Group|Corp|Holdings|Servicos|Solucoes|Sistemas|Tecnologia|Industria|Comercio|Consultoria|Assessoria|Engenharia|Construcoes|Empreendimentos|Investimentos|Participacoes|Transportes|Logistica|Alimentos|Saude|Comunicacoes|Telecomunicacoes|Energia|Agropecuaria)\b/gi,
  };

  function extractSignatureBlock(text) {
    if (!text) return { signatureBlock: null, bodyText: text };

    const lines = String(text).split('\n');
    let sigStartIndex = -1;

    for (let i = lines.length - 1; i >= Math.max(0, lines.length - 40); i -= 1) {
      const line = lines[i].trim();
      if (SIGNATURE_OPENERS.some((pattern) => pattern.test(line))) {
        sigStartIndex = i;
        break;
      }
    }

    if (sigStartIndex === -1) return { signatureBlock: null, bodyText: text };

    return {
      bodyText: lines.slice(0, sigStartIndex).join('\n'),
      signatureBlock: lines.slice(sigStartIndex).join('\n'),
    };
  }

  function extractEntitiesFromSignature(signatureBlock) {
    const entities = { pessoas: [], empresas: [] };
    if (!signatureBlock) return entities;

    const nameWithPipe = signatureBlock.match(SIG_PATTERNS.nameWithPipe);
    if (nameWithPipe) {
      entities.pessoas.push(nameWithPipe[1].trim());
    } else {
      const nameAlone = signatureBlock.match(SIG_PATTERNS.nameAlone);
      if (nameAlone) entities.pessoas.push(nameAlone[1].trim());
    }

    SIG_PATTERNS.empresa.lastIndex = 0;
    const matches = signatureBlock.matchAll(SIG_PATTERNS.empresa);
    for (const match of matches) {
      const nome = match[1] && match[1].trim();
      if (nome && nome.length > 2) entities.empresas.push(nome);
    }

    return entities;
  }

  const GATILHOS_EMPRESA = [
    'empresa', 'client[ea]', 'fornecedor[a]?', 'parceiro[a]?',
    'contratante', 'contratad[ao]', 'prestador[a]?', 'representante',
    'trabalhando\\s+(?:com|para|na|no)', 'reuniao\\s+(?:com|na|no)',
    'contrato\\s+(?:com|da|do)', 'projeto\\s+(?:da|do|com)',
    'demanda\\s+(?:da|do|de)', 'solicitacao\\s+(?:da|do|de)',
    'chamado\\s+(?:da|do|de)', 'ticket\\s+(?:da|do|de)',
    'atendimento\\s+(?:da|do|de|ao|a)', 'laboratorio', 'parceria\\s+(?:com|da|do)',
    'servico\\s+(?:da|do|de|para)', 'sistema\\s+(?:da|do|de)',
    'plataforma\\s+(?:da|do|de)', 'portal\\s+(?:da|do|de)',
    'aplicacao\\s+(?:da|do|de)', 'produto\\s+(?:da|do|de)',
    'fatura\\s+(?:da|do|de|para)', 'pedido\\s+(?:da|do|de)',
    'proposta\\s+(?:da|do|de|para)', 'orcamento\\s+(?:da|do|de|para)',
    'ordem\\s+de\\s+servico\\s+(?:da|do|de|para)', 'implantacao\\s+(?:na|no|da|do)',
    'migracao\\s+(?:da|do|para)', 'integracao\\s+(?:com|da|do)',
    'subsidiaria', 'filial', 'sede', 'grupo', 'holding', 'conglomerado',
    'organizacao', 'instituicao', 'fundacao', 'associacao',
    'cooperativa', 'consorcio', 'distribuidora', 'comercializadora',
    'integradora', 'consultoria', 'assessoria', 'gestora'
  ];

  const GATILHOS_PESSOA = [
    'sr\\.?', 'sra\\.?', 'dr\\.?', 'dra\\.?', 'eng\\.?', 'prof\\.?', 'me\\.?',
    'msc\\.?', 'esp\\.?', 'rev\\.?', 'des\\.?', 'cel\\.?', 'maj\\.?',
    'ten\\.?', 'cap\\.?', 'cmt\\.?', 'min\\.?', 'dep\\.?', 'sen\\.?', 'ver\\.?',
    'usuario', 'responsavel', 'solicitante', 'aprovador[a]?', 'analista',
    'gerente', 'coordenador[a]?', 'diretor[a]?', 'consultor[a]?', 'tecnico[a]?',
    'atendente', 'operador[a]?', 'desenvolvedor[a]?', 'arquiteto[a]?',
    'especialista', 'supervisor[a]?', 'lider', 'assistente', 'auxiliar',
    'suporte', 'presidente', 'socio[a]?', 'proprietario[a]?', 'administrador[a]?',
    'gestor[a]?', 'executivo[a]?', 'contador[a]?', 'advogado[a]?', 'agente',
    'colaborador[a]?', 'funcionario[a]?', 'triagem\\s+(?:feita|realizada|executada|por)',
    'triad[oa]\\s+(?:por|pelo|pela)', 'falar\\s+com', 'contatar', 'ligar\\s+para',
    'enviado\\s+por', 'solicitado\\s+por', 'reportado\\s+por', 'aprovado\\s+por',
    'validado\\s+por', 'aberto\\s+por', 'atribuido\\s+(?:a|ao|a)',
    'escalado\\s+(?:a|ao|a|para)', 'aguardando\\s+(?:retorno|resposta)\\s+d[eo]',
    'alinhado\\s+com', 'confirmado\\s+com', 'verificado\\s+com',
    'informado\\s+por', 'comunicado\\s+(?:por|ao|a)', 'encaminhado\\s+(?:por|ao|para)',
    'representado\\s+(?:por|pelo|pela)', 'autorizado\\s+(?:por|pelo|pela)',
    'orientado\\s+(?:por|pelo|pela)', 'identificado\\s+(?:como|por)',
    'cadastrado\\s+(?:como|por)', 'registrado\\s+(?:por|como)', 'contato\\s+(?:e|do|da|com)',
    'nome\\s+(?:e|do|da|completo)', 'segundo\\s+(?:o|a)?', 'de\\s+acordo\\s+com',
    'mencionado[a]?\\s+por', 'citado[a]?\\s+por', 'assinado[a]?\\s+(?:por|pelo|pela)',
    'destinatario[a]?\\s+(?:e|:|do|da)', 'em\\s+nome\\s+d[eo]', 'por\\s+parte\\s+d[eo]',
    'o\\s+(?:client[ea]|usuario[a])', 'a\\s+(?:client[ea]|usuario[a])',
    'o\\s+(?:responsavel|titular)', 'cpf\\s+d[eo]', 'rg\\s+d[eo]'
  ];

  const NOME_PROPRIO = '([A-ZÁÉÍÓÚÂÊÎÔÛÃÕÀÇ][a-záéíóúâêîôûãõàç]+(?:(?:\\s(?:de|da|do|dos|das|e))?\\s[A-ZÁÉÍÓÚÂÊÎÔÛÃÕÀÇ][a-záéíóúâêîôûãõàç]+){0,4})';
  const ARTIGO = '(?:a|o|as|os|da|do|das|dos|de|um|uma)?\\s*';

  const PATTERN_SUFIXO_JURIDICO = new RegExp(
    NOME_PROPRIO +
      '\\s+(?:S\\.?A\\.?|Ltda\\.?|EIRELI|ME|EPP|SS|MEI|SCP|S\\/A|SA|Group|Corp|Holdings|' +
      'Servicos|Solucoes|Sistemas|Tecnologia|Industria|Distribuidora|Comercio|Consultoria|' +
      'Assessoria|Engenharia|Construcoes|Empreendimentos|Investimentos|Participacoes|' +
      'Transportes|Logistica|Alimentos|Imoveis|Saude|Educacao|Comunicacoes|Telecomunicacoes|' +
      'Energia|Mineracao|Agro|Agropecuaria)',
    'gi'
  );

  function buildPattern(gatilhos) {
    return new RegExp(`(?:${gatilhos.join('|')})\\s+${ARTIGO}${NOME_PROPRIO}`, 'gi');
  }

  const PATTERN_EMPRESA = buildPattern(GATILHOS_EMPRESA);
  const PATTERN_PESSOA = buildPattern(GATILHOS_PESSOA);

  const NOME_SIMPLES = '[A-ZÁÉÍÓÚÂÊÎÔÛÃÕÀÇ][a-záéíóúâêîôûãõàç]{1,}(?:\\s+[A-ZÁÉÍÓÚÂÊÎÔÛÃÕÀÇ][a-záéíóúâêîôûãõàç]{1,})*';
  const PATTERN_LABELED_PERSON = new RegExp(
    `\\b(?:triagem|analista|analise|revisao|aprovacao|responsavel|solicitante)\\s*:\\s*(${NOME_SIMPLES})(?:\\s*[/|]\\s*(${NOME_SIMPLES}))?`,
    'gi'
  );

  function extractContextualEntities(text) {
    const empresas = new Set();
    const pessoas = new Set();
    if (!text) return { empresas, pessoas };

    PATTERN_EMPRESA.lastIndex = 0;
    const empresaMatches = text.matchAll(PATTERN_EMPRESA);
    for (const match of empresaMatches) {
      const nome = match[match.length - 1] && match[match.length - 1].trim();
      if (nome && nome.length > 2) empresas.add(nome);
    }

    PATTERN_SUFIXO_JURIDICO.lastIndex = 0;
    const juridicoMatches = text.matchAll(PATTERN_SUFIXO_JURIDICO);
    for (const match of juridicoMatches) {
      const nome = match[1] && match[1].trim();
      if (nome) empresas.add(nome);
    }

    PATTERN_PESSOA.lastIndex = 0;
    const pessoaMatches = text.matchAll(PATTERN_PESSOA);
    for (const match of pessoaMatches) {
      const nome = match[match.length - 1] && match[match.length - 1].trim();
      if (nome && nome.length > 2) pessoas.add(nome);
    }

    PATTERN_LABELED_PERSON.lastIndex = 0;
    const labeledMatches = text.matchAll(PATTERN_LABELED_PERSON);
    for (const match of labeledMatches) {
      if (match[1]) pessoas.add(match[1].trim());
      if (match[2]) pessoas.add(match[2].trim());
    }

    return { empresas, pessoas };
  }

  const PATTERNS = [
    { rx: /[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}/g, tag: '[EMAIL]' },
    { rx: /\b\d{3}\.?\d{3}\.?\d{3}[-–]?\d{2}\b/g, tag: '[CPF]' },
    { rx: /\b\d{2}\.?\d{3}\.?\d{3}\/?\.?\d{4}[-–]?\d{2}\b/g, tag: '[CNPJ]' },
    { rx: /\(?\d{2}\)?\s?\d{4,5}[-–\s]?\d{4}\b/g, tag: '[TELEFONE]' },
    { rx: /\b\d{5}[-–]\d{3}\b/g, tag: '[CEP]' },
    { rx: /\b\d{2}\.?\d{3}\.?\d{3}[-–]?[0-9Xx]\b/g, tag: '[RG]' },
    { rx: /\b\d{3}\.?\d{5}\.?\d{2}[-–]?\d\b/g, tag: '[PIS]' },
    { rx: /\b[A-Z]{3}[-\s]?\d{4}\b/g, tag: '[PLACA]' },
    { rx: /\b[A-Z]{3}\d[A-Z]\d{2}\b/g, tag: '[PLACA]' },
    { rx: /\b\d{4}\s?\d{4}\s?\d{4}\b/g, tag: '[TITULO_ELEITOR]' },
    { rx: /\b[A-Z]{2}\d{6,7}\b/g, tag: '[PASSAPORTE]' },
    { rx: /\b(?:senha|password|passwd|pwd|pass|api[-_]?key|apikey|secret(?:[-_]key)?|client[-_]secret|access[-_]token|auth[-_]token|bearer[-_]token|private[-_]key)\s*[:=]\s*\S+/gi, tag: '[SENHA]' },
    { rx: /\+\d{1,3}[\s\-]?\(?\d{2}\)?[\s\-]?\d{4,5}[\s\-]?\d{4}\b/g, tag: '[TELEFONE]' },
    { rx: /https?:\/\/[^\s/]+\/(?:users?|perfil|profile|u|account|conta)\/[\w.%@+\-]{2,}/gi, tag: '[URL_USUARIO]' },
  ];

  function anonymizePatterns(text) {
    if (!text) return text;
    return PATTERNS.reduce((acc, pattern) => {
      pattern.rx.lastIndex = 0;
      return acc.replace(pattern.rx, pattern.tag);
    }, String(text));
  }

  function extractTicketId(fieldValue) {
    if (!fieldValue) return null;
    if (Array.isArray(fieldValue)) return extractTicketId(fieldValue[0]);
    if (typeof fieldValue === 'number') return String(fieldValue);

    const str = String(fieldValue).trim();
    const urlMatch = str.match(/\/tickets\/(\d+)/);
    if (urlMatch) return urlMatch[1];
    if (/^\d+$/.test(str)) return str;
    return null;
  }

  function looksLikeZendeskComments(data) {
    if (!data || typeof data !== 'object') return false;
    const arr = data.comments || data.results || data.data || null;
    if (!Array.isArray(arr) || arr.length === 0) return false;
    const first = arr[0];
    return !!first && (
      typeof first.body === 'string' ||
      typeof first.html_body === 'string' ||
      typeof first.plain_body === 'string'
    );
  }

  function normalizeZendeskPayload(data) {
    const rawComments = data.comments || data.results || data.data || [];
    const userMap = {};

    (data.users || (data.included && data.included.users) || []).forEach((user) => {
      userMap[user.id] = user;
    });

    const comments = rawComments.map((comment) => ({
      id: comment.id,
      author_id: comment.author_id || comment.authorId || null,
      body: comment.body || comment.plain_body || '',
      html_body: comment.html_body || comment.htmlBody || null,
      public: typeof comment.public === 'boolean' ? comment.public : (typeof comment.isPublic === 'boolean' ? comment.isPublic : true),
      created_at: comment.created_at || comment.createdAt || null,
      _authorName: (comment.author && comment.author.name) || comment.authorName || null,
    }));

    comments.forEach((comment) => {
      if (comment.author_id && comment._authorName && !userMap[comment.author_id]) {
        userMap[comment.author_id] = { id: comment.author_id, name: comment._authorName };
      }
    });

    return { comments, userMap };
  }

  function anonymizeIssue(issue, zendeskData) {
    const map = new EntityMap();
    const fields = issue.fields || {};

    const autores = [
      fields.assignee && fields.assignee.displayName,
      fields.reporter && fields.reporter.displayName,
      fields.customfield_29200,
      ...((fields.comment && fields.comment.comments) || []).map((comment) => comment.author && comment.author.displayName),
    ].filter(Boolean);

    autores.forEach((nome) => map.registerPessoa(nome));

    if (zendeskData) {
      const zdAutores = zendeskData.comments
        .map((comment) => {
          const user = zendeskData.userMap[comment.author_id];
          return user && user.name;
        })
        .filter(Boolean);
      zdAutores.forEach((nome) => map.registerPessoa(nome));
    }

    const descText = extractText(issue, 'description');
    const commentTexts = ((fields.comment && fields.comment.comments) || [])
      .map((comment) => {
        if (comment.renderedBody) return htmlToText(comment.renderedBody);
        if (typeof comment.body === 'string') return comment.body;
        return '';
      })
      .filter(Boolean);

    const zdCommentTexts = zendeskData
      ? zendeskData.comments.map((comment) => {
          if (comment.html_body) return htmlToText(comment.html_body);
          if (typeof comment.body === 'string') return comment.body;
          return '';
        }).filter(Boolean)
      : [];

    const allTexts = [descText, ...commentTexts, ...zdCommentTexts].filter(Boolean);

    allTexts.forEach((text) => {
      const signature = extractSignatureBlock(text);
      const sigEntities = extractEntitiesFromSignature(signature.signatureBlock);
      sigEntities.pessoas.forEach((item) => map.registerPessoa(item));
      sigEntities.empresas.forEach((item) => map.registerEmpresa(item));

      const contextual = extractContextualEntities(text);
      contextual.pessoas.forEach((item) => map.registerPessoa(item));
      contextual.empresas.forEach((item) => map.registerEmpresa(item));
    });

    function process(text) {
      if (!text) return text;
      return anonymizePatterns(map.applyToText(text));
    }

    const anonComments = ((fields.comment && fields.comment.comments) || []).map((comment) => {
      let anonBody = '';
      if (comment.renderedBody) {
        anonBody = process(htmlToText(comment.renderedBody));
      } else if (typeof comment.body === 'string') {
        anonBody = process(comment.body);
      }

      return {
        ...comment,
        author: { displayName: map.getPessoa(comment.author && comment.author.displayName) },
        body: anonBody,
        renderedBody: null,
      };
    });

    const anonZdComments = zendeskData
      ? zendeskData.comments.map((comment) => {
          let anonBody = '';
          if (comment.html_body) {
            anonBody = process(htmlToText(comment.html_body));
          } else if (typeof comment.body === 'string') {
            anonBody = process(comment.body);
          }

          const authorName = zendeskData.userMap[comment.author_id]
            ? zendeskData.userMap[comment.author_id].name
            : null;

          return {
            id: comment.id,
            public: comment.public,
            created_at: comment.created_at,
            author: { displayName: map.getPessoa(authorName) },
            body: anonBody,
          };
        })
      : null;

    const anonIssue = {
      key: issue.key,
      renderedFields: {
        description: process(descText),
      },
      fields: {
        summary: fields.summary,
        status: fields.status,
        priority: fields.priority,
        issuetype: fields.issuetype,
        project: fields.project,
        created: fields.created,
        updated: fields.updated,
        assignee: fields.assignee ? { displayName: map.getPessoa(fields.assignee.displayName) } : null,
        reporter: fields.reporter ? { displayName: map.getPessoa(fields.reporter.displayName) } : null,
        description: process(descText),
        comment: { comments: anonComments },
        zdContact: fields.customfield_29200 ? {
          nome: map.getPessoa(fields.customfield_29200),
          email: process(fields.customfield_29201 || ''),
          fone: process(fields.customfield_29202 || ''),
        } : null,
        zdComments: anonZdComments,
      },
    };

    return { anonIssue, summary: map.getSummary() };
  }

  SHIELD.core = {
    htmlToText,
    extractText,
    extractTicketId,
    looksLikeZendeskComments,
    normalizeZendeskPayload,
    anonymizeIssue,
  };
}(globalThis));
