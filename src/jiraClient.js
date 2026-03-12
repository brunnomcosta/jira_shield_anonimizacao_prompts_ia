/**
 * jiraClient.js
 * Cliente HTTP para a API REST do Jira Server 8.x.
 *
 * Suporta autenticação via:
 *   - Personal Access Token (Bearer) — recomendado para Jira 8.14+
 *   - Basic Auth (usuário + senha)   — fallback para versões mais antigas
 */

import fetch from 'node-fetch';
import https from 'https';

// Ignora erro de certificado autoassinado (comum em ambientes corporativos)
const agent = new https.Agent({ rejectUnauthorized: false });

const DEFAULT_HEADERS = {
  Accept: 'application/json',
  'Content-Type': 'application/json',
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36',
  'X-Atlassian-Token': 'no-check',
};

function buildAuthHeader() {
  const token    = process.env.JIRA_TOKEN;
  const user     = process.env.JIRA_USER;
  const password = process.env.JIRA_PASSWORD;

  if (token) {
    return { Authorization: `Bearer ${token}` };
  }

  if (user && password) {
    const encoded = Buffer.from(`${user}:${password}`).toString('base64');
    return { Authorization: `Basic ${encoded}` };
  }

  throw new Error(
    'Credenciais não configuradas.\n' +
    'Defina JIRA_TOKEN (recomendado) ou JIRA_USER + JIRA_PASSWORD no arquivo .env'
  );
}

/**
 * Busca uma issue completa com campos expandidos.
 * @param {string} issueKey ex: "DMANQUALI-12311"
 * @returns {object} issue completa com fields + comments
 */
export async function fetchIssue(issueKey) {
  const base = process.env.JIRA_BASE_URL?.replace(/\/$/, '');
  if (!base) throw new Error('JIRA_BASE_URL não configurada no arquivo .env');

  // Campo do Jira que contém o(s) ID(s) do ticket Zendesk (configurável via .env)
  // Padrão: customfield_11086 (array com IDs de tickets — configuração TOTVS)
  const zdField = process.env.ZENDESK_JIRA_FIELD || 'customfield_11086';

  // Jira Server 8.x usa API v2
  // expand=renderedFields traz o HTML renderizado dos campos rich-text
  const url = `${base}/rest/api/2/issue/${issueKey}` +
    `?expand=renderedFields,names,transitions` +
    `&fields=summary,status,priority,assignee,reporter,description,` +
    `comment,created,updated,issuetype,project,${zdField},` +
    // Dados do contato Zendesk (nome, email, CPF/fone do solicitante)
    `customfield_29200,customfield_29201,customfield_29202`;

  const res = await fetch(url, {
    method: 'GET',
    headers: { ...DEFAULT_HEADERS, ...buildAuthHeader() },
    agent,
  });

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    if (res.status === 401) {
      throw new Error(
        'Autenticação falhou (401).\n' +
        'Verifique JIRA_TOKEN ou JIRA_USER/JIRA_PASSWORD no .env\n' +
        'Para gerar um token: Jira → Seu perfil → Personal Access Tokens'
      );
    }
    if (res.status === 403) {
      throw new Error(`Sem permissão para acessar a issue ${issueKey} (403).`);
    }
    if (res.status === 404) {
      throw new Error(
        `Issue ${issueKey} não encontrada (404).\n` +
        'Verifique se a chave está correta e se você tem acesso ao projeto.'
      );
    }
    throw new Error(`Erro HTTP ${res.status}: ${body}`);
  }

  const data = await res.json();
  return data;
}

/**
 * Tenta buscar Zendesk Comments via proxy do plugin Zendesk instalado no Jira.
 * Usa as credenciais Jira (sem precisar de acesso direto ao Zendesk).
 *
 * O plugin Zendesk for Jira expõe um endpoint REST no servidor Jira que
 * autoproxy as requisições para o Zendesk usando as credenciais armazenadas.
 *
 * Retorna objeto normalizado { comments, userMap } ou null se não encontrou.
 *
 * @param {string} ticketId  ID do ticket Zendesk (ex: "26518424")
 * @param {string} issueKey  Chave da issue Jira (ex: "DMANQUALI-12311") — usado em alguns endpoints
 */
export async function fetchZendeskViaJira(ticketId, issueKey) {
  const base = process.env.JIRA_BASE_URL?.replace(/\/$/, '');
  if (!base) return null;

  const headers = { ...DEFAULT_HEADERS, ...buildAuthHeader() };

  // Padrões de endpoint conhecidos para os plugins Zendesk-Jira mais comuns.
  // São testados em ordem até que um retorne HTTP 2xx com dados válidos.
  const candidates = [
    // ZndzJira / Zendesk for Jira Server (plugin oficial Zendesk)
    `${base}/rest/zndzjira/1.0/api/tickets/${ticketId}/comments?include=users`,
    `${base}/rest/zndzjira/1.0/tickets/${ticketId}/comments`,
    // Atlassian Marketplace — Zendesk Integration Suite
    `${base}/rest/zis/1.0/tickets/${ticketId}/comments`,
    // TOTVS custom proxy (tenta via issueKey)
    `${base}/rest/zndzjira/1.0/api/issues/${issueKey}/zendesk-comments`,
    `${base}/plugins/servlet/ac/com.zendesk.jira-app/zendesk-comments?issueKey=${issueKey}`,
  ];

  for (const url of candidates) {
    try {
      const res = await fetch(url, { method: 'GET', headers, agent });
      if (!res.ok) continue;

      const data = await res.json();

      // Normaliza diferentes formatos de resposta
      const rawComments = data.comments ?? data.results ?? data.data ?? null;
      if (!Array.isArray(rawComments) || rawComments.length === 0) continue;

      // Constrói userMap a partir do side-loading, se disponível
      const userMap = {};
      (data.users ?? data.included?.users ?? []).forEach((u) => {
        userMap[u.id] = u;
      });

      // Normaliza cada comentário para o formato interno esperado
      const comments = rawComments.map((c) => ({
        id:         c.id,
        author_id:  c.author_id ?? c.authorId ?? null,
        body:       c.body ?? c.plain_body ?? '',
        html_body:  c.html_body ?? c.htmlBody ?? null,
        public:     c.public ?? c.isPublic ?? true,
        created_at: c.created_at ?? c.createdAt ?? null,
        // Algumas respostas embutem o autor diretamente
        _authorName: c.author?.name ?? c.authorName ?? null,
      }));

      // Complementa userMap com autores embutidos
      comments.forEach((c) => {
        if (c.author_id && c._authorName && !userMap[c.author_id]) {
          userMap[c.author_id] = { id: c.author_id, name: c._authorName };
        }
      });

      return { comments, userMap, _source: url };
    } catch {
      // Tenta o próximo candidato
    }
  }

  return null; // Nenhum endpoint funcionou
}

/**
 * Testa a conexão com o Jira e retorna a versão do servidor.
 */
export async function testConnection() {
  const base = process.env.JIRA_BASE_URL?.replace(/\/$/, '');
  if (!base) throw new Error('JIRA_BASE_URL não configurada no arquivo .env');

  const res = await fetch(`${base}/rest/api/2/serverInfo`, {
    headers: { ...DEFAULT_HEADERS, ...buildAuthHeader() },
    agent,
  });

  if (!res.ok) throw new Error(`Conexão falhou: HTTP ${res.status}`);
  return res.json();
}
