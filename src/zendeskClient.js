/**
 * zendeskClient.js
 * Cliente HTTP para a API REST do Zendesk.
 *
 * Configuração via .env:
 *   ZENDESK_BASE_URL=https://suaempresa.zendesk.com
 *   ZENDESK_USER=seu_email@empresa.com
 *   ZENDESK_TOKEN=seu_api_token
 *   ZENDESK_JIRA_FIELD=customfield_10000  (campo do Jira que guarda o ID/URL do ticket ZD)
 */

import fetch from 'node-fetch';
import https from 'https';

const agent = new https.Agent({ rejectUnauthorized: false });

const DEFAULT_HEADERS = {
  Accept: 'application/json',
  'Content-Type': 'application/json',
};

function buildAuthHeader() {
  const user  = process.env.ZENDESK_USER;
  const token = process.env.ZENDESK_TOKEN;
  if (!user || !token) return null;

  const encoded = Buffer.from(`${user}/token:${token}`).toString('base64');
  return { Authorization: `Basic ${encoded}` };
}

export function isConfigured() {
  return !!(
    process.env.ZENDESK_BASE_URL &&
    process.env.ZENDESK_USER &&
    process.env.ZENDESK_TOKEN
  );
}

/**
 * Extrai o número do ticket Zendesk de um campo da issue do Jira.
 * O campo pode conter:
 *   - Um array: ["26518424"]          ← customfield_11086 (TOTVS)
 *   - Um número inteiro: 26518424
 *   - Uma string com número: "26518424"
 *   - Uma URL:  "https://empresa.zendesk.com/agent/tickets/26518424"
 *
 * Retorna apenas o primeiro ticket do array quando houver múltiplos.
 */
export function extractTicketId(fieldValue) {
  if (!fieldValue) return null;

  // Array — pega o primeiro elemento
  if (Array.isArray(fieldValue)) {
    return extractTicketId(fieldValue[0]);
  }

  // Número direto
  if (typeof fieldValue === 'number') return String(fieldValue);

  const str = String(fieldValue).trim();

  // URL: extrai o último segmento numérico
  const urlMatch = str.match(/\/tickets\/(\d+)/);
  if (urlMatch) return urlMatch[1];

  // String numérica pura
  if (/^\d+$/.test(str)) return str;

  return null;
}

/**
 * Busca os comentários de um ticket Zendesk.
 * Usa side-loading de usuários para obter os nomes dos autores.
 *
 * @param {string} ticketId
 * @returns {{ comments: Array, users: object }} users mapeado por ID
 */
export async function fetchTicketComments(ticketId) {
  const base = process.env.ZENDESK_BASE_URL?.replace(/\/$/, '');
  if (!base) throw new Error('ZENDESK_BASE_URL não configurada no arquivo .env');

  const authHeader = buildAuthHeader();
  if (!authHeader) throw new Error('Credenciais Zendesk não configuradas (ZENDESK_USER / ZENDESK_TOKEN).');

  const url = `${base}/api/v2/tickets/${ticketId}/comments?include=users&per_page=100`;

  const res = await fetch(url, {
    method: 'GET',
    headers: { ...DEFAULT_HEADERS, ...authHeader },
    agent,
  });

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    if (res.status === 401) throw new Error('Autenticação Zendesk falhou (401). Verifique ZENDESK_USER e ZENDESK_TOKEN.');
    if (res.status === 403) throw new Error(`Sem permissão para acessar o ticket Zendesk ${ticketId} (403).`);
    if (res.status === 404) throw new Error(`Ticket Zendesk ${ticketId} não encontrado (404).`);
    throw new Error(`Erro Zendesk HTTP ${res.status}: ${body}`);
  }

  const data = await res.json();

  // Monta mapa de usuários por ID para lookup rápido
  const userMap = {};
  (data.users ?? []).forEach((u) => { userMap[u.id] = u; });

  return { comments: data.comments ?? [], userMap };
}
