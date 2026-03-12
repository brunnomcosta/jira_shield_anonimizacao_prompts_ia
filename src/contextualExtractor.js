/**
 * contextualExtractor.js
 * Detecta nomes de pessoas e empresas por proximidade com palavras-gatilho.
 */

const GATILHOS_EMPRESA = [
  'empresa', 'client[ea]', 'fornecedor[a]?', 'parceiro[a]?',
  'contratante', 'contratad[ao]', 'prestador[a]?', 'representante',
  'trabalhando\\s+(?:com|para|na|no)',
  'reuni[aã]o\\s+(?:com|na|no)',
  'contrato\\s+(?:com|da|do)',
  'projeto\\s+(?:da|do|com)',
  'demanda\\s+(?:da|do|de)',
  'solicita[çc][aã]o\\s+(?:da|do|de)',
  'chamado\\s+(?:da|do|de)',
  'ticket\\s+(?:da|do|de)',
  'atendimento\\s+(?:da|do|de|ao|à)',
  'indústria', 'industria', 'laborat[oó]rio',
  // Relações comerciais e contratuais
  'parceria\\s+(?:com|da|do)',
  'servi[çc]o\\s+(?:da|do|de|para)',
  'sistema\\s+(?:da|do|de)',
  'plataforma\\s+(?:da|do|de)',
  'portal\\s+(?:da|do|de)',
  'aplica[çc][aã]o\\s+(?:da|do|de)',
  'produto\\s+(?:da|do|de)',
  'fatura\\s+(?:da|do|de|para)',
  'nota\\s+fiscal\\s+(?:da|do|de|para)',
  'pedido\\s+(?:da|do|de)',
  'proposta\\s+(?:da|do|de|para)',
  'or[çc]amento\\s+(?:da|do|de|para)',
  'ordem\\s+de\\s+servi[çc]o\\s+(?:da|do|de|para)',
  'implanta[çc][aã]o\\s+(?:na|no|da|do)',
  'migra[çc][aã]o\\s+(?:da|do|para)',
  'integra[çc][aã]o\\s+(?:com|da|do)',
  // Tipos de organização
  'subsidi[aá]ria', 'filial', 'sede', 'grupo', 'holding', 'conglomerado',
  'organiza[çc][aã]o', 'institui[çc][aã]o', 'funda[çc][aã]o', 'associa[çc][aã]o',
  'cooperativa', 'consórcio', 'cons[oó]rcio',
  // Setores
  'distribuidora', 'comercializadora', 'integradora',
  'consultoria', 'assessoria', 'gestora',
];

const GATILHOS_PESSOA = [
  // Títulos e tratamentos
  'sr\\.?', 'sra\\.?', 'dr\\.?', 'dra\\.?', 'eng\\.?', 'prof\\.?', 'prof[aª]\\.?',
  'me\\.?', 'msc\\.?', 'esp\\.?', 'rev\\.?', 'des\\.?', 'cel\\.?', 'maj\\.?',
  'ten\\.?', 'cap\\.?', 'cmt\\.?', 'min\\.?', 'dep\\.?', 'sen\\.?', 'ver\\.?',
  'il[uú]str[ií]ssimo[a]?', 'excelent[ií]ssimo[a]?', 'meritíssimo[a]?',
  // Papéis organizacionais
  'usu[aá]rio', 'respons[aá]vel', 'solicitante', 'aprovador[a]?',
  'analista', 'gerente', 'coordenador[a]?', 'diretor[a]?',
  'consultor[a]?', 't[eé]cnico[a]?', 'atendente', 'operador[a]?',
  'desenvolvedor[a]?', 'arquiteto[a]?', 'especialista', 'supervisor[a]?',
  'l[ií]der', 'facilitador[a]?', 'mediador[a]?',
  'assistente', 'auxiliar', 'suporte',
  'estagiário[a]?', 'trainee', 'aprendiz',
  'presidente', 'vice-presidente', 'sócio[a]?', 'proprietário[a]?',
  'administrador[a]?', 'gestor[a]?', 'executivo[a]?',
  'auditor[a]?', 'fiscal', 'inspetor[a]?',
  'contador[a]?', 'advogado[a]?', 'encarregado[a]?',
  'agente', 'colaborador[a]?', 'funcion[aá]rio[a]?',
  // Verbos de ação com pessoa
  'falar\\s+com', 'contatar', 'ligar\\s+para',
  'enviado\\s+por', 'solicitado\\s+por', 'reportado\\s+por',
  'aprovado\\s+por', 'validado\\s+por', 'aberto\\s+por',
  'atribu[ií]do\\s+(?:a|ao|à)',
  'escalado\\s+(?:a|ao|à|para)',
  'aguardando\\s+(?:retorno|resposta)\\s+d[eo]',
  'alinhado\\s+com', 'confirmado\\s+com', 'verificado\\s+com',
  'informado\\s+por', 'comunicado\\s+(?:por|ao|à)',
  'repassado\\s+(?:por|ao|para)',
  'encaminhado\\s+(?:por|ao|para)',
  'representado\\s+(?:por|pelo|pela)',
  'autorizado\\s+(?:por|pelo|pela)',
  'delegado\\s+(?:a|ao|para)',
  'orientado\\s+(?:por|pelo|pela)',
  'cobrado\\s+(?:por|de|com)',
  'identificado\\s+(?:como|por)',
  'cadastrado\\s+(?:como|por|como)',
  'registrado\\s+(?:por|como)',
  'contato\\s+(?:é|do|da|com)',
  'nome\\s+(?:é|do|da|completo)',
  // Referências diretas a pessoas
  'conforme\\s+(?:informado|solicitado|pedido)\\s+(?:por|pelo|pela)',
  'segundo\\s+(?:o|a)?',
  'de\\s+acordo\\s+com',
  'mencionado[a]?\\s+por',
  'citado[a]?\\s+por',
  'indicado[a]?\\s+por',
  'sugerido[a]?\\s+por',
  'assinado[a]?\\s+(?:por|pelo|pela)',
  'subscrito[a]?\\s+(?:por|pelo|pela)',
  'remetido[a]?\\s+(?:por|pelo|pela)',
  'destinat[aá]rio[a]?\\s+(?:é|:|do|da)',
  'em\\s+nome\\s+d[eo]',
  'por\\s+parte\\s+d[eo]',
  'o\\s+(?:client[ea]|usu[aá]rio[a])',
  'a\\s+(?:client[ea]|usu[aá]ria)',
  'o\\s+(?:respons[aá]vel|titular)',
  'data\\s+de\\s+nascimento\\s+d[eo]',
  'cpf\\s+d[eo]',
  'rg\\s+d[eo]',
];

// Captura nomes com preposições: "João da Silva", "Maria dos Santos", "Ana de Oliveira e Souza"
const NOME_PROPRIO =
  '([A-ZÁÉÍÓÚÂÊÎÔÛÃÕÀÇ][a-záéíóúâêîôûãõàç]+(?:(?:\\s(?:de|da|do|dos|das|e))?\\s[A-ZÁÉÍÓÚÂÊÎÔÛÃÕÀÇ][a-záéíóúâêîôûãõàç]+){0,4})';
const ARTIGO = '(?:a|o|as|os|da|do|das|dos|de|um|uma)?\\s*';

const PATTERN_SUFIXO_JURIDICO = new RegExp(
  NOME_PROPRIO +
    '\\s*(?:S\\.?A\\.?|Ltda\\.?|EIRELI|ME|EPP|SS|MEI|SCP|S\\/A|SA|Group|Corp|Holdings|' +
    'Servi[çc]os|Serviços|Soluções|Solu[çc]oes|Sistemas|Tecnologia|Ind[uú]stria|' +
    'Farmac[eê]utica|Distribuidora|Com[eé]rcio|Consultoria|Assessoria|Engenharia|' +
    'Constru[çc]ões|Empreendimentos|Investimentos|Participa[çc]ões|Transportes|' +
    'Log[ií]stica|Alimentos|Bebidas|Vest[uú]ario|Im[oó]veis|Sa[uú]de|Educa[çc][aã]o|' +
    'Comunica[çc]ões|Telecomunica[çc]ões|Energia|Minera[çc][aã]o|Agro|Agropecuária)',
  'gi'
);

function buildPattern(gatilhos) {
  return new RegExp(`(?:${gatilhos.join('|')})\\s+${ARTIGO}${NOME_PROPRIO}`, 'gi');
}

const PATTERN_EMPRESA = buildPattern(GATILHOS_EMPRESA);
const PATTERN_PESSOA  = buildPattern(GATILHOS_PESSOA);

export function extractContextualEntities(text) {
  const empresas = new Set();
  const pessoas  = new Set();
  if (!text) return { empresas, pessoas };

  PATTERN_EMPRESA.lastIndex = 0;
  for (const m of text.matchAll(PATTERN_EMPRESA)) {
    const nome = m[m.length - 1]?.trim();
    if (nome && nome.length > 2) empresas.add(nome);
  }

  PATTERN_SUFIXO_JURIDICO.lastIndex = 0;
  for (const m of text.matchAll(PATTERN_SUFIXO_JURIDICO)) {
    const nome = m[1]?.trim();
    if (nome) empresas.add(nome);
  }

  PATTERN_PESSOA.lastIndex = 0;
  for (const m of text.matchAll(PATTERN_PESSOA)) {
    const nome = m[m.length - 1]?.trim();
    if (nome && nome.length > 2) pessoas.add(nome);
  }

  return { empresas, pessoas };
}
