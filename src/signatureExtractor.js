/**
 * signatureExtractor.js
 * Detecta blocos de assinatura no final de textos e extrai
 * nomes de pessoas e empresas com alta confiança.
 */

const SIGNATURE_OPENERS = [
  /^(att\.?|atenciosamente|abs\.?|abraços?|grato|grata|cordialmente|saudações?|obrigado|obrigada|respeitosamente)[,.]?\s*$/im,
  /^(de|from|enviado\s+por|sent\s+by)[:\s]+/im,
  /^[-–—]{2,}\s*$/m,
  // Despedidas formais/informais adicionais (PT)
  /^(até\s+logo|forte\s+abraço|um\s+abraço|com\s+respeito|aguardo\s+retorno|aguardo\s+(?:seu\s+)?contato)[,.]?\s*$/im,
  /^(fico\s+à\s+disposi[çc][aã]o|qualquer\s+d[uú]vida\s+estou\s+à\s+disposi[çc][aã]o)[,.]?\s*$/im,
  /^(atenciosamente\s+e\s+respeitosamente|com\s+estima|com\s+considera[çc][aã]o)[,.]?\s*$/im,
  // Despedidas em inglês (e-mails bilíngues)
  /^(best\s+regards?|kind\s+regards?|regards?|sincerely|thanks?|thank\s+you|cheers|yours?\s+truly)[,.]?\s*$/im,
  /^(warm\s+regards?|with\s+regards?|respectfully)[,.]?\s*$/im,
  // Despedidas adicionais PT
  /^(boa\s+sorte|sucesso|grande\s+abraço|beijinhos?|bjs\.?)[,.]?\s*$/im,
  /^(muito\s+obrigad[oa]|mto\s+obrigad[oa]|obg\.?)[,.]?\s*$/im,
  /^(sem\s+mais|nada\s+mais\s+a\s+declarar|encerrando\s+por\s+aqui)[,.]?\s*$/im,
  /^(qualquer\s+d[uú]vida[,\s]+(?:favor\s+)?(?:entre\s+em\s+)?contato)[,.]?\s*$/im,
  /^(em\s+caso\s+de\s+d[uú]vidas?)[,.,\s]*$/im,
  // Marcadores de rodapé / assinatura digital
  /^(--\s*$|_{3,}$)/m,
  /^(assinado\s+(?:digitalmente\s+)?por)[:\s]+/im,
  /^(este\s+e[-\s]?mail\s+foi\s+enviado\s+(?:por|de))[:\s]+/im,
];

// Segmento de nome: parte capitalizada, opcionalmente precedida por preposição
const NAME_SEGMENT = '(?:(?:\\s(?:de|da|do|dos|das|e))?\\s[A-ZÁÉÍÓÚÂÊÎÔÛÃÕÀÇ][a-záéíóúâêîôûãõàç]+)';
const FULL_NAME    = `[A-ZÁÉÍÓÚÂÊÎÔÛÃÕÀÇ][a-záéíóúâêîôûãõàç]+(?:${NAME_SEGMENT})+`;

const SIG_PATTERNS = {
  nameWithPipe: new RegExp(`^(${FULL_NAME})\\s*[|\\/]`, 'm'),
  nameAlone:    new RegExp(`^(${FULL_NAME})\\s*$`, 'm'),
  empresa:
    /\b([\w\s&]+?(?:S\.?A\.?|Ltda\.?|EIRELI|ME|EPP|SS|MEI|SCP|S\/A|SA|Group|Corp|Holdings|Serviços|Soluções|Sistemas|Tecnologia|Indústria|Industria|Comércio|Comercio|Distribuidora|Farmacêutica|Farmaceutica|Consultoria|Assessoria|Engenharia|Construções|Construcoes|Empreendimentos|Investimentos|Participações|Transportes|Logística|Logistica|Alimentos|Saúde|Saude|Comunicações|Telecomunicações|Energia|Agropecuária|Agropecuaria))\b/gi,
};

export function extractSignatureBlock(text) {
  if (!text) return { signatureBlock: null, bodyText: text };

  const lines = text.split('\n');
  let sigStartIndex = -1;

  for (let i = lines.length - 1; i >= Math.max(0, lines.length - 15); i--) {
    const line = lines[i].trim();
    if (SIGNATURE_OPENERS.some((p) => p.test(line))) {
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

export function extractEntitiesFromSignature(signatureBlock) {
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
  for (const match of signatureBlock.matchAll(SIG_PATTERNS.empresa)) {
    const nome = match[1]?.trim();
    if (nome && nome.length > 2) entities.empresas.push(nome);
  }

  return entities;
}
