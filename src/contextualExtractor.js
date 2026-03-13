/**
 * contextualExtractor.js
 * Detecta nomes de pessoas e empresas por proximidade com palavras-gatilho.
 */

import { PORTUGUESE_COMMON_WORDS } from './portugueseCommonWords.js';

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
  // Triagem
  'triad[oa]r[a]?', 'triagista',
  'triagem\\s+(?:feita|realizada|executada|por)',
  'triad[oa]\\s+(?:por|pelo|pela)',
  'respons[aá]vel\\s+pela\\s+triagem',
  'fez\\s+a\\s+triagem', 'realizou\\s+a\\s+triagem',
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
const ARTIGO = '(?:(?:a|o|as|os|da|do|das|dos|de|um|uma)\\b\\s*)?';

function normalizeStopwordToken(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
}

// Palavras comuns em português/inglês que NÃO são nomes próprios,
// mas podem ser capturadas após gatilhos (ex: "analista sobre o escopo")
const STOPWORDS_PESSOA = new Set([
  // Preposições e conjunções
  'sobre', 'para', 'como', 'quando', 'onde', 'porque', 'pois', 'mas', 'porém',
  'contudo', 'todavia', 'portanto', 'assim', 'logo', 'então', 'após', 'antes',
  'depois', 'durante', 'entre', 'até', 'sem', 'sob', 'ante', 'que', 'se', 'ou',
  // Pronomes e determinantes
  'este', 'esta', 'esse', 'essa', 'aquele', 'aquela', 'aqueles', 'aquelas',
  'isto', 'isso', 'aquilo', 'tudo', 'nada', 'algo', 'alguém', 'ninguém',
  'todo', 'toda', 'todos', 'todas', 'outro', 'outra', 'outros', 'outras',
  'mesmo', 'mesma', 'próprio', 'própria',
  // Advérbios e locuções que começam com maiúscula no início de frase
  'aqui', 'ali', 'lá', 'cá', 'sim', 'não', 'também', 'ainda', 'já', 'sempre',
  'nunca', 'jamais', 'muito', 'pouco', 'mais', 'menos', 'bem', 'mal',
  'hoje', 'ontem', 'amanhã', 'agora', 'depois', 'antes', 'logo',
  // Ordinais e numerais que aparecem após gatilhos de papel
  'novo', 'nova', 'novos', 'novas', 'primeiro', 'primeira', 'segundo', 'segunda',
  'terceiro', 'terceira', 'quarto', 'quarta', 'quinto', 'quinta',
  'último', 'última', 'próximo', 'próxima', 'anterior', 'seguinte',
  // Siglas e acrônimos técnicos
  'app', 'api', 'web', 'url', 'sql', 'dev', 'qa', 'ti', 'pdf', 'xml', 'csv',
  'json', 'rest', 'soap', 'http', 'https', 'ftp', 'ssh', 'vpn', 'erp', 'crm',
  'bi', 'etl', 'ci', 'cd', 'git', 'saas', 'paas', 'iaas',
  'orm', 'sdk', 'ide', 'cli', 'gui', 'ui', 'ux', 'sla', 'slo', 'rpa',
  'iam', 'sso', 'mfa', 'otp', 'jwt', 'oauth', 'ldap', 'smtp', 'pop', 'imap',
  'dns', 'tcp', 'udp', 'ssl', 'tls', 'html', 'css', 'php', 'aws', 'gcp',
  'oci', 'poc', 'mvp', 'kpi', 'sre', 'devops', 'mlops', 'gitops',
  // Inglês — e-mails bilíngues e comunicação técnica
  'the', 'this', 'that', 'these', 'those', 'with', 'from', 'about', 'after',
  'before', 'during', 'between', 'into', 'onto', 'upon', 'within',
  'issue', 'task', 'feature', 'request', 'update', 'version', 'release',
  'sprint', 'module', 'service', 'system', 'project', 'team', 'client',
  'user', 'access', 'error', 'warning', 'test', 'production', 'staging',
  'development', 'config', 'deploy', 'build', 'branch', 'merge', 'review',
  'approval', 'pending', 'completed', 'closed', 'open', 'support', 'ticket',
  'fix', 'hotfix', 'patch', 'refactor', 'revert', 'rollback', 'workaround',
  'debugger', 'breakpoint', 'exception', 'handler', 'middleware', 'wrapper',
  'payload', 'response', 'callback', 'webhook', 'listener', 'trigger',
  'queue', 'worker', 'scheduler', 'cron', 'daemon', 'thread', 'process',
  'cache', 'session', 'cookie', 'header', 'body', 'query', 'param',
  'instance', 'cluster', 'container', 'namespace', 'replica', 'node',
  'pipeline', 'workflow', 'stage', 'step', 'action', 'runner', 'agent',
  'repository', 'registry', 'artifact', 'snapshot', 'backup', 'restore',
  'timeout', 'retry', 'fallback', 'circuit', 'breaker', 'proxy', 'gateway',
  'socket', 'port', 'host', 'domain', 'subdomain', 'endpoint', 'route',
  'schema', 'model', 'entity', 'record', 'index', 'cursor', 'transaction',
  'migration', 'seed', 'fixture', 'mock', 'stub', 'spy', 'assertion',
  'coverage', 'linter', 'formatter', 'bundler', 'minifier', 'transpiler',
  'dependency', 'package', 'library', 'framework', 'runtime', 'compiler',
  'environment', 'variable', 'secret', 'credential', 'profile', 'role',
  'permission', 'scope', 'claim', 'audience', 'issuer', 'subject',
  'dashboard', 'widget', 'panel', 'sidebar', 'modal', 'drawer', 'toast',
  'layout', 'component', 'template', 'theme', 'style', 'class', 'selector',
  'event', 'listener', 'observer', 'subscriber', 'publisher', 'emitter',
  // Termos de projeto e trabalho (vocabulário comum que NÃO é nome)
  'projeto', 'projetos', 'subprojeto', 'subprojetos',
  'serviço', 'serviços', 'sistema', 'sistemas',
  'módulo', 'módulos', 'processo', 'processos',
  'relatório', 'relatórios',
  'configuração', 'configurações',
  'integração', 'integrações',
  'solicitação', 'solicitações',
  'chamado', 'chamados', 'incidente', 'incidentes',
  'contrato', 'contratos', 'aditivo', 'aditivos',
  'proposta', 'propostas',
  'orçamento', 'orçamentos',
  'pedido', 'pedidos',
  'fatura', 'faturas',
  'produto', 'produtos',
  'solução', 'soluções',
  'versão', 'versões', 'subversão',
  'ambiente', 'ambientes',
  'recurso', 'recursos',
  'funcionalidade', 'funcionalidades',
  'requisito', 'requisitos',
  'demanda', 'demandas',
  'tarefa', 'tarefas',
  'atividade', 'atividades',
  'entrega', 'entregas',
  'escopo', 'escopos',
  'cronograma', 'cronogramas',
  'prazo', 'prazos',
  'etapa', 'etapas',
  'fase', 'fases',
  'plano', 'planos',
  'meta', 'metas',
  'objetivo', 'objetivos',
  'resultado', 'resultados',
  'roadmap', 'backlog', 'kanban',
  // Infraestrutura, DevOps e cloud
  'banco', 'tabela', 'arquivo', 'arquivos', 'pasta', 'pastas',
  'servidor', 'servidores', 'cluster', 'nó', 'instância',
  'container', 'contêiner', 'imagem', 'volume', 'rede', 'redes',
  'microsserviço', 'microsserviços', 'monolito', 'monólito',
  'repositório', 'repositórios', 'registro', 'registros',
  'pipeline', 'pipelines', 'esteira', 'esteiras',
  'orquestrador', 'balanceador', 'roteador', 'firewall',
  'backup', 'restore', 'snapshot', 'replicação', 'sincronização',
  // Desenvolvimento de software — português
  'código', 'códigos', 'fonte', 'binário',
  'classe', 'classes', 'objeto', 'objetos',
  'método', 'métodos', 'função', 'funções',
  'variável', 'variáveis', 'constante', 'constantes',
  'parâmetro', 'parâmetros', 'argumento', 'argumentos',
  'retorno', 'retornos', 'exceção', 'exceções',
  'interface', 'interfaces', 'abstrato', 'abstrata',
  'herança', 'polimorfismo', 'encapsulamento',
  'instância', 'instâncias', 'singleton', 'factory',
  'repositório', 'serviço', 'controlador', 'rota', 'rotas',
  'modelo', 'modelos', 'entidade', 'entidades',
  'schema', 'schemas', 'migração', 'migrações', 'semente',
  'teste', 'testes', 'cobertura', 'mock', 'stub',
  'depuração', 'depurador', 'ponto de parada', 'rastreamento',
  'log', 'logs', 'rastreio', 'rastreios', 'trace', 'traces',
  'evento', 'eventos', 'fila', 'filas', 'tópico', 'tópicos',
  'mensageria', 'publicador', 'assinante', 'consumidor',
  'cache', 'invalidação', 'expiração', 'ttl',
  'autenticação', 'autorização', 'sessão', 'sessões',
  'token', 'tokens', 'chave', 'chaves', 'segredo', 'segredos',
  'certificado', 'certificados', 'assinatura', 'assinaturas',
  'criptografia', 'hash', 'checksum', 'digest',
  'webhook', 'webhooks', 'callback', 'callbacks',
  'payload', 'payloads', 'requisição', 'requisições',
  'resposta', 'respostas', 'cabeçalho', 'cabeçalhos',
  'pacote', 'pacotes', 'biblioteca', 'bibliotecas',
  'dependência', 'dependências', 'framework', 'frameworks',
  'compilador', 'interpretador', 'transpilador', 'bundler',
  'linter', 'formatter', 'analisador', 'validador',
  'deploy', 'deployment', 'rollback', 'hotfix', 'patch',
  'build', 'builds', 'artifact', 'artefato', 'artefatos',
  'branch', 'branches', 'commit', 'commits', 'merge', 'merges',
  'pull request', 'code review', 'diff', 'diffs',
  'refatoração', 'refatorações',
  // Atendimento de suporte — português
  'atendimento', 'atendimentos', 'suporte', 'suportes',
  'triagem', 'triagens', 'classificação', 'classificações',
  'prioridade', 'prioridades', 'severidade', 'severidades',
  'urgência', 'impacto', 'criticidade',
  'reabertura', 'reaberturas', 'reincidência', 'reincidências',
  'workaround', 'contorno', 'contornos',
  'diagnóstico', 'diagnósticos', 'investigação', 'investigações',
  'root cause', 'causa raiz', 'solução definitiva',
  'knowledge base', 'base de conhecimento',
  'sla', 'prazo de atendimento', 'nível de serviço',
  'escalação', 'escalações', 'escalamento', 'escalamentos',
  'transferência', 'transferências', 'encaminhamento', 'encaminhamentos',
  'resolução', 'resoluções', 'encerramento', 'encerramentos',
  'reabertura', 'satisfação', 'avaliação', 'avaliações',
  // Processos e operações
  'homologação', 'validação', 'validações', 'aprovação', 'aprovações',
  'revisão', 'revisões', 'auditoria', 'auditorias',
  'monitoramento', 'monitoramentos', 'observabilidade',
  'alerta', 'alertas', 'notificação', 'notificações',
  'incidente', 'incidentes', 'problema', 'problemas',
  'mudança', 'mudanças', 'liberação', 'liberações',
  'implantação', 'implantações', 'instalação', 'instalações',
  'configuração', 'parametrização', 'personalização',
  'script', 'scripts', 'automação', 'automações',
  'agendamento', 'agendamentos', 'rotina', 'rotinas',
  'erro', 'erros', 'falha', 'falhas', 'anomalia', 'anomalias',
  'ajuste', 'ajustes', 'correção', 'correções',
  'atualização', 'atualizações', 'melhoria', 'melhorias',
  'acesso', 'acessos', 'permissão', 'permissões', 'perfil', 'perfis',
  'login', 'senha', 'credencial', 'credenciais',
  'endpoint', 'tela', 'telas', 'campo', 'campos',
  'formulário', 'formulários', 'relatório', 'relatórios',
  'painel', 'painéis', 'portal', 'portais',
  'aplicação', 'aplicativo', 'aplicativos', 'ferramenta', 'ferramentas',
  'protocolo', 'protocolos', 'formato', 'formatos',
  'estrutura', 'estruturas', 'esquema', 'esquemas',
  'certificação', 'certificações', 'conformidade',
  'compliance', 'lgpd', 'gdpr', 'iso', 'sox', 'pci',
  // Status e estados
  'pendente', 'pendentes',
  'concluído', 'concluída', 'concluídos', 'concluídas',
  'cancelado', 'cancelada', 'cancelados', 'canceladas',
  'aprovado', 'aprovada', 'aprovados', 'aprovadas',
  'reprovado', 'reprovada',
  'ativo', 'ativa', 'ativos', 'ativas',
  'inativo', 'inativa',
  'habilitado', 'habilitada', 'desabilitado', 'desabilitada',
  'disponível', 'indisponível',
  'aberto', 'aberta', 'fechado', 'fechada',
  'encerrado', 'encerrada', 'finalizado', 'finalizada',
  'pausado', 'pausada', 'bloqueado', 'bloqueada',
  'retornado', 'retornada', 'escalado', 'escalada',
  // Dias da semana e meses (aparecem em contexto de datas)
  'segunda', 'terça', 'quarta', 'quinta', 'sexta', 'sábado', 'domingo',
  'janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho',
  'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro',
  // Tempo e datas
  'hora', 'horas', 'minuto', 'minutos', 'dia', 'dias',
  'semana', 'semanas', 'mês', 'meses', 'ano', 'anos',
  'data', 'datas', 'período', 'períodos', 'tempo', 'tempos',
  'manhã', 'tarde', 'noite', 'madrugada',
  // Termos de negócio e financeiro
  'valor', 'valores', 'custo', 'custos', 'preço', 'preços',
  'desconto', 'descontos', 'taxa', 'taxas', 'imposto', 'impostos',
  'pagamento', 'pagamentos', 'cobrança', 'cobranças',
  'boleto', 'boletos', 'nota', 'notas', 'recibo', 'recibos',
  'saldo', 'saldos', 'débito', 'débitos', 'crédito', 'créditos',
  // Comunicação e documentos
  'email', 'mensagem', 'mensagens', 'resposta', 'respostas',
  'retorno', 'retornos', 'confirmação', 'confirmações',
  'aviso', 'avisos', 'alerta', 'alertas', 'notificação', 'notificações',
  'documento', 'documentos', 'anexo', 'anexos', 'arquivo',
  'protocolo', 'protocolos', 'número', 'números',
  // Adjetivos comuns que podem aparecer capitalizados
  'total', 'parcial', 'completo', 'completa', 'incompleto', 'incompleta',
  'geral', 'global', 'local', 'nacional', 'regional', 'oficial',
  'interno', 'interna', 'externo', 'externa',
  'público', 'pública', 'privado', 'privada',
  'manual', 'automático', 'automática',
  'antigo', 'antiga', 'atual', 'atual', 'vigente',
  'principal', 'secundário', 'secundária', 'adicional',
  'obrigatório', 'obrigatória', 'opcional',
  'urgente', 'crítico', 'crítica', 'importante',
  // Substantivos genéricos comuns
  'item', 'itens', 'lista', 'listas', 'grupo', 'grupos',
  'tipo', 'tipos', 'categoria', 'categorias', 'classe', 'classes',
  'nível', 'níveis', 'etapa', 'passo', 'passos',
  'opção', 'opções', 'seleção', 'seleções',
  'detalhe', 'detalhes', 'informação', 'informações',
  'descrição', 'descrições', 'título', 'títulos',
  'código', 'códigos', 'chave', 'chaves', 'identificador',
  'regra', 'regras', 'política', 'políticas',
  'evento', 'eventos', 'ocorrência', 'ocorrências',
  'instância', 'instâncias', 'sessão', 'sessões',
  'operação', 'operações', 'transação', 'transações',
  // Metrologia e inspecao da qualidade
  'metrologia', 'qualidade',
  'inspecao', 'inspecoes', 'inspeção', 'inspeções',
  'ensaio', 'ensaios',
  'roteiro', 'roteiros',
  'laboratorio', 'laboratorios', 'laboratório', 'laboratórios',
  'peca', 'pecas', 'peça', 'peças',
  'caracteristica', 'caracteristicas', 'característica', 'características',
  'medida', 'medidas',
  'medicao', 'medicoes', 'medição', 'medições',
  'amostra', 'amostras',
  'operacao', 'operacoes',
].map(normalizeStopwordToken));

const PESSOA_CONECTORES = new Set(['de', 'da', 'do', 'dos', 'das', 'e']);
const STOPWORDS_EMPRESA = new Set([
  ...STOPWORDS_PESSOA,
  ...PORTUGUESE_COMMON_WORDS,
  'empresa', 'empresas',
  'cliente', 'clientes',
  'fornecedor', 'fornecedores',
  'parceiro', 'parceiros',
  'contratante', 'contratantes',
  'contratada', 'contratado', 'contratadas', 'contratados',
  'prestador', 'prestadores',
  'representante', 'representantes',
  'filial', 'filiais',
  'subsidiaria', 'subsidiarias',
  'organizacao', 'organizacoes',
  'instituicao', 'instituicoes',
  'fundacao', 'fundacoes',
  'associacao', 'associacoes',
  'cooperativa', 'cooperativas',
  'holding', 'holdings',
  'grupo', 'grupos',
  'plataforma', 'plataformas',
  'sistema', 'sistemas',
  'portal', 'portais',
  'produto', 'produtos',
  'servico', 'servicos',
  'solucao', 'solucoes',
  'processo', 'processos',
  'rotina', 'rotinas',
  'resultado', 'resultados',
  'operacao', 'operacoes',
  'qualidade', 'laboratorio', 'laboratorios',
].map(normalizeStopwordToken));
const EMPRESA_CONECTORES = new Set(['de', 'da', 'do', 'dos', 'das', 'e', '&']);

// Valida se o nome capturado é realmente um nome próprio (não uma palavra comum)
function isValidPessoaName(nome) {
  if (!nome || nome.length < 3) return false;
  // Deve começar com maiúscula E ter segunda letra minúscula (exclui siglas tipo APP, HPE, TI)
  if (!/^[A-ZÁÉÍÓÚÂÊÎÔÛÃÕÀÇ][a-záéíóúâêîôûãõàç]/.test(nome)) return false;
  // Não deve ser uma palavra comum da lista
  return !STOPWORDS_PESSOA.has(normalizeStopwordToken(nome));
}

function getPessoaNameCandidate(nome) {
  if (!nome || String(nome).trim().length < 3) return null;

  const tokens = String(nome)
    .trim()
    .split(/\s+/)
    .map((token) => token.replace(/^[^A-Za-zÀ-ÿ]+|[^A-Za-zÀ-ÿ]+$/g, ''))
    .filter(Boolean);

  const validTokens = [];

  for (const token of tokens) {
    const normalizedToken = normalizeStopwordToken(token);

    if (!validTokens.length) {
      if (!/^\p{Lu}\p{Ll}/u.test(token)) return null;
      if (STOPWORDS_PESSOA.has(normalizedToken)) return null;
      validTokens.push(token);
      continue;
    }

    if (PESSOA_CONECTORES.has(normalizedToken)) {
      validTokens.push(normalizedToken);
      continue;
    }

    if (/^\p{Lu}\p{Ll}/u.test(token)) {
      validTokens.push(token);
      continue;
    }

    break;
  }

  return validTokens.length ? validTokens.join(' ') : null;
}

function getUppercasePessoaNameCandidate(nome) {
  if (!nome || String(nome).trim().length < 3) return null;

  const tokens = String(nome)
    .trim()
    .split(/\s+/)
    .map((token) => token.replace(/^[^\p{L}'-]+|[^\p{L}'-]+$/gu, ''))
    .filter(Boolean);

  const validTokens = [];
  let significantTokens = 0;

  for (const token of tokens) {
    const normalizedToken = normalizeStopwordToken(token);

    if (PESSOA_CONECTORES.has(normalizedToken)) {
      if (significantTokens) validTokens.push(token);
      continue;
    }

    if (!/^\p{Lu}[\p{Lu}'-]*$/u.test(token)) break;
    if (STOPWORDS_PESSOA.has(normalizedToken)) break;

    validTokens.push(token);
    significantTokens += 1;
  }

  while (validTokens.length && PESSOA_CONECTORES.has(normalizeStopwordToken(validTokens[validTokens.length - 1]))) {
    validTokens.pop();
  }

  if (!significantTokens || !validTokens.length) return null;
  return validTokens.join(' ');
}

function looksLikeEmpresaToken(token) {
  return /^\p{Lu}[\p{L}\d&._'-]*$/u.test(token) || /^[A-Z\d&._'-]{2,}$/u.test(token);
}

function getEmpresaNameCandidate(nome) {
  if (!nome || String(nome).trim().length < 3) return null;

    const tokens = String(nome)
    .trim()
    .split(/\s+/)
    .map((token) => token.replace(/^[^\p{L}\d&._'-]+|[^\p{L}\d&._'-]+$/gu, ''))
    .filter(Boolean);

  const validTokens = [];
  const significantTokens = [];

  for (const token of tokens) {
    const normalizedToken = normalizeStopwordToken(token);

    if (EMPRESA_CONECTORES.has(normalizedToken)) {
      if (validTokens.length) validTokens.push(normalizedToken === '&' ? '&' : normalizedToken);
      continue;
    }

    if (!looksLikeEmpresaToken(token)) {
      break;
    }

    validTokens.push(token);
    significantTokens.push(normalizedToken);
  }

  if (!significantTokens.length) return null;
  if (significantTokens.length === 1 && STOPWORDS_EMPRESA.has(significantTokens[0])) return null;

  return validTokens.length ? validTokens.join(' ') : null;
}

const PATTERN_SUFIXO_JURIDICO = new RegExp(
  NOME_PROPRIO +
    '\\s+(?:S\\.?A\\.?|Ltda\\.?|EIRELI|ME|EPP|SS|MEI|SCP|S\\/A|SA|Group|Corp|Holdings|' +
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
const NOME_SIMPLES = '[\\p{Lu}][\\p{L}]{1,}(?:(?:[ \\t](?:de|da|do|dos|das|e))?[ \\t][\\p{Lu}][\\p{L}]{1,})*';
const NOME_CLIENTE_CAPS = '([\\p{Lu}][\\p{Lu}\'-]{1,}(?:(?:[ \\t](?:DE|DA|DO|DOS|DAS|E))?[ \\t][\\p{Lu}][\\p{Lu}\'-]{1,}){0,4})';
const PATTERN_LABELED_PERSON = new RegExp(
  `\\b(?:triagem|triador(?:a)?|triagista|analista|analise|revisao|aprovacao|responsavel|solicitante)[ \\t]*:[ \\t]*(${NOME_SIMPLES})(?:[ \\t]*[/|][ \\t]*(${NOME_SIMPLES}))?`,
  'giu'
);
const PATTERN_CLIENTE_CAPS_PERSON = new RegExp(
  `\\b(?:nome[ \\t]+)?d[oa]s?[ \\t]+client[ea][ \\t]*(?::|=|[-–—]|eh|é)?[ \\t]*${NOME_CLIENTE_CAPS}`,
  'gu'
);

export function extractContextualEntities(text) {
  const empresas = new Set();
  const pessoas  = new Set();
  if (!text) return { empresas, pessoas };

  PATTERN_EMPRESA.lastIndex = 0;
  for (const m of text.matchAll(PATTERN_EMPRESA)) {
    const nome = getEmpresaNameCandidate(m[m.length - 1]?.trim());
    if (nome) empresas.add(nome);
  }

  PATTERN_SUFIXO_JURIDICO.lastIndex = 0;
  for (const m of text.matchAll(PATTERN_SUFIXO_JURIDICO)) {
    const nome = getEmpresaNameCandidate(m[1]?.trim());
    if (nome) empresas.add(nome);
  }

  PATTERN_PESSOA.lastIndex = 0;
  for (const m of text.matchAll(PATTERN_PESSOA)) {
    const nome = getPessoaNameCandidate(m[m.length - 1]?.trim());
    if (nome) pessoas.add(nome);
  }

  PATTERN_LABELED_PERSON.lastIndex = 0;
  for (const m of text.matchAll(PATTERN_LABELED_PERSON)) {
    const nome1 = getPessoaNameCandidate(m[1]?.trim());
    const nome2 = getPessoaNameCandidate(m[2]?.trim());
    if (nome1) pessoas.add(nome1);
    if (nome2) pessoas.add(nome2);
  }

  PATTERN_CLIENTE_CAPS_PERSON.lastIndex = 0;
  for (const m of text.matchAll(PATTERN_CLIENTE_CAPS_PERSON)) {
    const nome = getUppercasePessoaNameCandidate(m[1]?.trim());
    if (nome) pessoas.add(nome);
  }

  const pessoasNormalizadas = new Set([...pessoas].map((nome) => normalizeStopwordToken(nome)));
  for (const nome of [...empresas]) {
    if (pessoasNormalizadas.has(normalizeStopwordToken(nome))) {
      empresas.delete(nome);
    }
  }

  return { empresas, pessoas };
}
