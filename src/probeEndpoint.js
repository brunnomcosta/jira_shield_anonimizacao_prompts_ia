#!/usr/bin/env node
/**
 * probeEndpoint.js — Testa um endpoint com as credenciais do Jira
 *
 * Uso:
 *   node src/probeEndpoint.js "https://jiraproducao.totvs.com.br/caminho/encontrado"
 *
 * Mostra:
 *   - Status HTTP
 *   - Headers relevantes da resposta
 *   - Primeiros 2000 caracteres do body (JSON formatado se possível)
 */

import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';
import dotenv from 'dotenv';

const __dirname = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: resolve(__dirname, '..', '.env') });

import fetch from 'node-fetch';
import https from 'https';

const agent  = new https.Agent({ rejectUnauthorized: false });
const c = {
  reset:  '\x1b[0m',
  bold:   '\x1b[1m',
  green:  '\x1b[32m',
  yellow: '\x1b[33m',
  red:    '\x1b[31m',
  cyan:   '\x1b[36m',
  gray:   '\x1b[90m',
};

function buildAuth() {
  const token    = process.env.JIRA_TOKEN;
  const user     = process.env.JIRA_USER;
  const password = process.env.JIRA_PASSWORD;
  if (token) return `Bearer ${token}`;
  if (user && password) return `Basic ${Buffer.from(`${user}:${password}`).toString('base64')}`;
  throw new Error('Credenciais não configuradas no .env');
}

async function probe(url) {
  console.log();
  console.log(`${c.bold}${c.cyan}URL:${c.reset} ${url}`);
  console.log();

  const res = await fetch(url, {
    method: 'GET',
    headers: {
      Accept: 'application/json, text/plain, */*',
      'Content-Type': 'application/json',
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36',
      'X-Atlassian-Token': 'no-check',
      Authorization: buildAuth(),
    },
    agent,
  });

  const statusColor = res.ok ? c.green : c.red;
  console.log(`${c.bold}Status:${c.reset} ${statusColor}${res.status} ${res.statusText}${c.reset}`);
  console.log();

  // Headers relevantes
  const relevantHeaders = ['content-type', 'x-auth-token', 'set-cookie', 'location'];
  relevantHeaders.forEach((h) => {
    const v = res.headers.get(h);
    if (v) console.log(`${c.gray}${h}:${c.reset} ${v}`);
  });

  const body = await res.text();

  if (!body) {
    console.log(`${c.yellow}(body vazio)${c.reset}`);
    return;
  }

  console.log();
  console.log(`${c.bold}Body (primeiros 3000 chars):${c.reset}`);

  try {
    const parsed = JSON.parse(body);
    console.log(JSON.stringify(parsed, null, 2).substring(0, 3000));
  } catch {
    console.log(body.substring(0, 3000));
  }
}

const url = process.argv[2];
if (!url) {
  console.error(`\n${c.yellow}Uso:${c.reset}  node src/probeEndpoint.js "https://..."`);
  console.error(`${c.gray}Ex:   node src/probeEndpoint.js "https://jiraproducao.totvs.com.br/rest/zndzjira/1.0/api/tickets/26518424/comments"${c.reset}\n`);
  process.exit(1);
}

probe(url).catch((err) => {
  console.error(`\n${c.red}Erro:${c.reset} ${err.message}\n`);
  process.exit(1);
});
