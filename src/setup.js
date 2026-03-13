#!/usr/bin/env node
/**
 * setup.js — Assistente de configuração inicial
 *
 * Cria o arquivo .env com as credenciais do Jira.
 * Execute uma vez antes de usar o export:
 *
 *   node src/setup.js
 */

import fs       from 'fs';
import path     from 'path';
import readline from 'readline';

const c = {
  reset:  '\x1b[0m',
  bold:   '\x1b[1m',
  green:  '\x1b[32m',
  yellow: '\x1b[33m',
  cyan:   '\x1b[36m',
  gray:   '\x1b[90m',
};

const rl = readline.createInterface({
  input:  process.stdin,
  output: process.stdout,
});

function ask(question) {
  return new Promise((resolve) => rl.question(question, resolve));
}

function askHidden(question) {
  return new Promise((resolve) => {
    process.stdout.write(question);
    process.stdin.setRawMode?.(true);
    process.stdin.resume();
    let input = '';
    process.stdin.on('data', function handler(char) {
      char = char.toString();
      if (char === '\n' || char === '\r' || char === '\u0004') {
        process.stdin.setRawMode?.(false);
        process.stdin.pause();
        process.stdin.removeListener('data', handler);
        process.stdout.write('\n');
        resolve(input);
      } else if (char === '\u0003') {
        process.exit();
      } else if (char === '\u007f') {
        input = input.slice(0, -1);
      } else {
        input += char;
        process.stdout.write('*');
      }
    });
  });
}

async function main() {
  console.log();
  console.log(`${c.bold}${c.cyan}╔══════════════════════════════════════╗`);
  console.log(`║   JIRA SHIELD LGPD Export — Setup     ║`);
  console.log(`╚══════════════════════════════════════╝${c.reset}`);
  console.log();

  if (fs.existsSync('.env')) {
    const resp = await ask(
      `${c.yellow}⚠️  Arquivo .env já existe. Sobrescrever? (s/N): ${c.reset}`
    );
    if (!resp.toLowerCase().startsWith('s')) {
      console.log('Configuração cancelada.\n');
      rl.close();
      return;
    }
  }

  console.log(`${c.gray}Pressione Enter para usar o valor padrão [entre colchetes].${c.reset}`);
  console.log();

  // URL do Jira
  const baseUrl = await ask(
    `${c.bold}URL do Jira Server${c.reset} [https://jiraproducao.totvs.com.br]: `
  );
  const jiraUrl = baseUrl.trim() || 'https://jiraproducao.totvs.com.br';

  // Método de autenticação
  console.log();
  console.log(`${c.bold}Método de autenticação:${c.reset}`);
  console.log(`  ${c.cyan}1${c.reset} — Personal Access Token ${c.green}(recomendado)${c.reset}`);
  console.log(`  ${c.cyan}2${c.reset} — Usuário + senha`);
  const authChoice = await ask('Escolha [1]: ');

  let envContent = `# LGPD Export — Configuração gerada em ${new Date().toLocaleString('pt-BR')}\n\n`;
  envContent += `JIRA_BASE_URL=${jiraUrl}\n\n`;

  if (!authChoice.trim() || authChoice.trim() === '1') {
    console.log();
    console.log(`${c.gray}Para gerar um token: Jira → Seu perfil → Personal Access Tokens${c.reset}`);
    const token = await askHidden(`${c.bold}Personal Access Token: ${c.reset}`);
    envContent += `JIRA_TOKEN=${token.trim()}\n`;
  } else {
    const user = await ask(`${c.bold}Usuário (e-mail): ${c.reset}`);
    const pass = await askHidden(`${c.bold}Senha: ${c.reset}`);
    envContent += `JIRA_USER=${user.trim()}\n`;
    envContent += `JIRA_PASSWORD=${pass.trim()}\n`;
  }

  // Pasta de saída
  console.log();
  const outputDir = await ask(`${c.bold}Pasta para salvar os PDFs${c.reset} [./output]: `);
  envContent += `\nOUTPUT_DIR=${outputDir.trim() || './output'}\n`;

  // Zendesk (opcional)
  console.log();
  console.log(`${c.bold}Zendesk Comments (opcional):${c.reset}`);
  console.log(`${c.gray}Se configurado, os comentários do ticket Zendesk vinculado à issue serão exportados.${c.reset}`);
  const configZd = await ask('Configurar integração Zendesk? (s/N): ');

  if (configZd.toLowerCase().startsWith('s')) {
    const zdUrl  = await ask(`${c.bold}URL do Zendesk${c.reset} [https://suaempresa.zendesk.com]: `);
    const zdUser = await ask(`${c.bold}E-mail do agente Zendesk: ${c.reset}`);
    const zdTok  = await askHidden(`${c.bold}API Token do Zendesk: ${c.reset}`);
    const zdFld  = await ask(`${c.bold}Campo Jira com ID do ticket Zendesk${c.reset} [customfield_11086]: `);

    envContent += `\n# Zendesk (opcional)\n`;
    envContent += `ZENDESK_BASE_URL=${zdUrl.trim() || 'https://suaempresa.zendesk.com'}\n`;
    envContent += `ZENDESK_USER=${zdUser.trim()}\n`;
    envContent += `ZENDESK_TOKEN=${zdTok.trim()}\n`;
    envContent += `ZENDESK_JIRA_FIELD=${zdFld.trim() || 'customfield_11086'}\n`;
  }

  // Salvar .env
  fs.writeFileSync('.env', envContent);
  console.log();
  console.log(`${c.green}✅ Arquivo .env criado com sucesso!${c.reset}`);
  console.log();
  console.log(`${c.bold}Próximos passos:${c.reset}`);
  console.log(`  1. Instalar dependências:  ${c.cyan}npm install${c.reset}`);
  console.log(`  2. Testar a conexão:       ${c.cyan}node src/index.js --test${c.reset}`);
  console.log(`  3. Exportar uma issue:     ${c.cyan}node src/index.js DMANQUALI-12311${c.reset}`);
  console.log();

  rl.close();
}

main().catch((err) => {
  console.error('\nErro:', err.message);
  rl.close();
  process.exit(1);
});
