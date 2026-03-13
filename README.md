# SHIELD — Anonimização de Issues e Triagem Diagnóstica LGPD

> **S**mart **H**andler for **I**ssue **E**xport with **L**inked **D**ata

Ferramenta CLI Node.js com dois módulos complementares para conformidade LGPD no Jira Server:

- **Módulo 1 — Exportação:** gera PDFs anonimizados de issues do Jira Server sem instalação de plugin, em dois modos (somente Jira ou completo com Zendesk)
- **Módulo 2 — Diagnóstico:** dois modos complementares: (a) avalia a qualidade da anonimização com laudo técnico LGPD e (b) analisa o problema de negócio reportado pelo cliente com causa raiz no produto — ambos sem vazar dados pessoais ao LLM

Compatível com Jira Server 8.x. A exportação ocorre **inteiramente no ambiente local** — nenhum dado pessoal é enviado a serviços externos.

---

## Como funciona

### Módulo 1 — Exportação Anonimizada

Dois modos disponíveis conforme necessidade:

```
# Modo jira-only (rápido, sem browser):
node src/index.js --jira-only DMANQUALI-12311

  1. Autentica via API REST do Jira
  2. Busca a issue completa (campos + comentários Jira)
  3. Fase 1 — Mineração: varre todos os textos para detectar entidades
  4. Fase 2 — Substituição: aplica tokens [PESSOA-1], [EMPRESA-1], [CPF], [RG]...
  5. Gera PDF em ./output/DMANQUALI-12311_LGPD_anonimizado.pdf
  6. Registra metadados no audit.log (Art. 37 LGPD)

# Modo completo (padrão):
node src/index.js DMANQUALI-12311

  Igual ao anterior + busca comentários Zendesk vinculados em cascata:
    Estratégia 1: proxy via plugin Jira (sem credenciais extras)
    Estratégia 2: API direta do Zendesk (ZENDESK_* no .env)
    Estratégia 3: browser com sessão SSO ativa (Chrome ou Edge)
```

### Módulo 2 — Diagnóstico Inteligente (Auxiliador de Triagem)

```
node src/diagnostics.js DMANQUALI-12311              # padrão: análise de negócio
node src/diagnostics.js DMANQUALI-12311 --lgpd       # só análise LGPD
node src/diagnostics.js DMANQUALI-12311 --lgpd --business  # ambas

Modo padrão / --business (análise de negócio):
  1. Lê o PDF anonimizado e os metadados estruturais do ticket (metadata.json)
  2. Alerta se JIRA_TOKEN / WORKSPACE_* estiverem ausentes e pede preenchimento para melhorar o resultado
  3. Sanitiza conteúdo antes de enviar ao LLM
  4. Exibe confirmação pré-envio com nomes dos arquivos e indica se cada artefato vai completo ou por trecho
  5. Reconstrói timeline de eventos a partir dos comentários
  6. Analisa sintomas, hipótese mais provável de causa raiz no produto e código do workspace
  7. Rejeita respostas do LLM sem causa principal ou sem evidência válida
  8. Salva em output/diagnostic_business_<ISSUE_KEY>_<timestamp>.md

Modo --lgpd (qualidade da anonimização):
  1. Extrai texto do PDF anonimizado
  2. Varredura local regex — detecta PII residual, tokens quebrados e fallbacks
  3. Sanitiza conteúdo (nenhuma PII real sai do ambiente)
  4. Exibe confirmação pré-envio com nomes dos arquivos e indica se cada artefato vai completo ou por trecho
  5. Envia código-fonte da pipeline ao LLM para análise de causa raiz técnica
  6. Salva em output/diagnostic_lgpd_<ISSUE_KEY>_<timestamp>.md

  (fallback automático configurável: Claude CLI → Codex CLI → GitHub Copilot → API key)
```

---

## Pré-requisitos

- Node.js 18 LTS ou superior
- Acesso ao Jira Server (mesmo acesso que você usa no browser)
- *(Apenas modo completo)* Google Chrome ou Microsoft Edge com sessão Zendesk ativa

---

## Instalação (fazer uma vez)

```bash
# 1. Instalar dependências
npm install

# 2. Configurar credenciais (assistente interativo — recomendado)
node src/setup.js

# 3. Preparar a extensão Chrome (opcional)
npm run build:extension

# Ou: copiar o template manualmente
cp .env.example .env
# Editar .env com seu editor de texto
```

---

## Extensao Google Chrome (MVP)

O repositório agora inclui uma extensao Chrome em [chrome-extension/](./chrome-extension) para executar o **Módulo 1 — Exportação** dentro do navegador.

### O que a extensao faz

- Exporta issue(s) do Jira para PDF anonimizado
- Baixa junto o `{ISSUE_KEY}_metadata.json`
- Tenta obter comentários Zendesk por 3 caminhos:
  - proxy do plugin Jira
  - API direta do Zendesk
  - scraping simples da aba Zendesk do Jira
- Armazena histórico de auditoria no `chrome.storage.local`

### O que fica fora da extensao

- `src/diagnostics.js` continua no CLI Node.js
- leitura de workspace local (`WORKSPACE_*`) continua no CLI
- fallback Playwright / cópia de perfil do navegador não existe na extensao
- a extensao baixa arquivos em `Downloads/<pasta-configurada>/`; ela não grava em `./output`

### Como carregar no Chrome

```bash
# 1. Garantir que a dependência browser foi copiada
npm run build:extension

# 2. No Chrome
# chrome://extensions
# -> Developer mode
# -> Load unpacked
# -> selecionar a pasta ./chrome-extension
```

### Como usar

1. Abra **Options** da extensao e preencha `JIRA_BASE_URL`
2. Opcionalmente informe `JIRA_TOKEN` ou `JIRA_USER` + `JIRA_PASSWORD`
3. Opcionalmente configure `ZENDESK_*`
4. Abra o popup da extensao, informe uma ou mais issue keys e clique em **Exportar**

> Se `JIRA_TOKEN` ficar vazio, a extensao tenta usar a sessão já aberta no navegador.

---

## Configuração (.env)

Todas as configurações ficam no arquivo `.env` na raiz do projeto.
**Nunca commite este arquivo** — ele está no `.gitignore`.

### Jira (obrigatório)

| Variável | Descrição |
|---|---|
| `JIRA_BASE_URL` | URL base do Jira Server (sem barra final) |
| `JIRA_TOKEN` | Token de API pessoal *(recomendado — Jira 8.14+)* |
| `JIRA_USER` | Usuário (fallback para versões antigas do Jira) |
| `JIRA_PASSWORD` | Senha (fallback para versões antigas do Jira) |
| `OUTPUT_DIR` | Pasta de saída dos PDFs (padrão: `./output`) |

### Zendesk (opcional — apenas modo completo)

| Variável | Descrição |
|---|---|
| `ZENDESK_BASE_URL` | URL base do Zendesk (ex: `https://suaempresa.zendesk.com`) |
| `ZENDESK_USER` | E-mail do agente Zendesk |
| `ZENDESK_TOKEN` | API Token do Zendesk |
| `ZENDESK_JIRA_FIELD` | Campo da issue Jira com o ID do ticket ZD (padrão: `customfield_11086`) |

### Diagnóstico com IA (opcional)

| Variável | Descrição |
|---|---|
| `ANTHROPIC_API_KEY` | Chave da API Anthropic (fallback se as sessões CLI não estiverem disponíveis) |
| `LLM_PROVIDER_ORDER` | Ordem de tentativa dos provedores LLM (ex: `codex,claude,copilot,anthropic`) |
| `WORKSPACE_BACKEND_DIR` | Raiz do código-fonte back-end para análise cruzada de causa raiz |
| `WORKSPACE_FRONTEND_DIR` | Raiz do código-fonte front-end para análise cruzada de causa raiz |
| `WORKSPACE_INCLUDE_DIR` | Raiz dos includes usados por fontes `.prw/.prx/.tlpp`; o diagnóstico usa `.ch` referenciados via `#include` para enriquecer a correlação por conteúdo |
| `WORKSPACE_EXTENSIONS` | Extensões de arquivo a incluir (padrão: `js,ts,java,py,cs,go,kt,jsx,tsx,vue,rb,php,prx,prw,tlpp`) |

Quando `WORKSPACE_INCLUDE_DIR` está configurado, arquivos `.prw`, `.prx` e `.tlpp` passam a considerar o conteúdo dos `.ch` incluídos no cabeçalho apenas para melhorar o rankeamento por conteúdo. O trecho enviado ao LLM continua sendo do fonte principal.

---

## Gerar Personal Access Token no Jira

1. Acesse o Jira Server da sua instância
2. Clique no seu avatar → **Profile**
3. No menu lateral: **Personal Access Tokens**
4. Clique em **Create token** → Nome: "SHIELD" — sem expiração ou 1 ano
5. Copie o token e cole no `.env` como `JIRA_TOKEN`

---

## Uso

### Modo 1 — Apenas Jira (rápido, sem browser)

Exporta somente a descrição e os comentários da issue no Jira. Não abre browser, não tenta conectar ao Zendesk. Ideal para triagem rápida ou ambientes sem acesso ao Zendesk.

```bash
node src/index.js --jira-only DMANQUALI-12311

# ou via npm:
npm run export:jira -- DMANQUALI-12311

# múltiplas issues:
node src/index.js --jira-only DMANQUALI-12311 DMANQUALI-12312
```

### Modo 2 — Completo com Zendesk (padrão)

Exporta Jira + tenta buscar os comentários do Zendesk vinculado em cascata: proxy Jira → API direta → browser com sessão SSO ativa (Chrome ou Edge).

```bash
node src/index.js DMANQUALI-12311

# ou via npm:
npm run export -- DMANQUALI-12311

# múltiplas issues:
node src/index.js DMANQUALI-12311 DMANQUALI-12312 DMANQUALI-12313
```

### Diagnóstico — LGPD e/ou análise de negócio

```bash
# Padrão — análise do problema de negócio reportado pelo cliente
node src/diagnostics.js DMANQUALI-12311

# Só análise de qualidade da anonimização (LGPD)
node src/diagnostics.js DMANQUALI-12311 --lgpd

# Ambas as análises
node src/diagnostics.js DMANQUALI-12311 --lgpd --business

# ou via npm:
npm run diagnose -- DMANQUALI-12311
npm run diagnose -- DMANQUALI-12311 --lgpd
```

> Não requer Zendesk nem browser. A análise de negócio usa o `{ISSUE_KEY}_metadata.json` gerado automaticamente pelo Módulo 1 — exporte primeiro com `node src/index.js` para habilitar o enriquecimento com labels, versões, issue links e sprint.
>
> Funciona com sessão ativa no `claude` CLI (Claude Code / VS Code), login ativo no Codex CLI, GitHub Copilot (`gh` CLI) ou `ANTHROPIC_API_KEY` no `.env`. Se um provedor falhar por crédito, quota, autenticação ou indisponibilidade, o fallback continua automaticamente para o próximo da ordem configurada.

### Referência de scripts npm

| Script | Comando equivalente | Descrição |
|---|---|---|
| `npm run export -- KEY` | `node src/index.js KEY` | Exportação completa (Jira + Zendesk) |
| `npm run export:jira -- KEY` | `node src/index.js --jira-only KEY` | Exportação apenas Jira, sem browser |
| `npm run diagnose -- KEY` | `node src/diagnostics.js KEY` | Análise de negócio (padrão) |
| `npm run diagnose -- KEY --lgpd` | `node src/diagnostics.js KEY --lgpd` | Só análise LGPD (anonimização) |
| `npm run diagnose -- KEY --lgpd --business` | `node src/diagnostics.js KEY --lgpd --business` | Ambas as análises |
| `npm run setup` | `node src/setup.js` | Assistente interativo de configuração |
| `npm run build:extension` | `node scripts/build-extension.js` | Copia o `jsPDF` para `chrome-extension/vendor/` e deixa a extensão carregável |

### Saída esperada no terminal (modo jira-only)

```
╔══════════════════════════════════════════╗
║   SHIELD — LGPD Export (Jira Server)     ║
╚══════════════════════════════════════════╝

ℹ️  Modo: jira-only — Zendesk desabilitado

🔌  Conectando em https://jiraproducao.totvs.com.br...
✅  Jira Server 8.20.20 — conexão OK

⏳  Buscando DMANQUALI-12311...
✅  Issue encontrada: [TRIAR] QIPA215 - LGERSLABOP
ℹ️  Modo jira-only — Zendesk ignorado
🔒  Aplicando anonimização LGPD...
📊  Entidades detectadas: 3 pessoa(s), 1 empresa(s)
📄  Gerando PDF...
✅  PDF salvo em: ./output/DMANQUALI-12311_LGPD_anonimizado.pdf

─── Resumo ───────────────────────────
✅ Exportados: 1
```

---

## Estrutura dos arquivos

```
lgpd-export-standalone/
├── .env.example              # Template de configuração
├── .env                      # Suas credenciais (NÃO commitar)
├── .gitignore
├── package.json
├── README.md
├── output/                   # PDFs e laudos gerados aqui
│   ├── DMANQUALI-12311_LGPD_anonimizado.pdf
│   ├── DMANQUALI-12311_metadata.json          # metadados estruturais (gerado junto ao PDF)
│   ├── diagnostic_lgpd_DMANQUALI-12311_2026-03-12T10-00-00.md
│   ├── diagnostic_business_DMANQUALI-12311_2026-03-12T10-00-00.md
│   └── audit.log             # Log de auditoria (Art. 37 LGPD)
└── src/
    ├── index.js              # CLI principal — dois modos: jira-only e completo
    ├── setup.js              # Assistente interativo de configuração
    ├── jiraClient.js         # Cliente REST para Jira Server 8.x
    ├── anonymizer.js         # Orquestrador das 2 fases de anonimização
    ├── entityMap.js          # Mapa de tokens consistentes ([PESSOA-1], [EMPRESA-1])
    ├── signatureExtractor.js # Detecta blocos de assinatura com nomes compostos
    ├── contextualExtractor.js# Detecta entidades por palavras-gatilho e preposições
    ├── nerDetector.js        # Regex para CPF/CNPJ/RG/PIS/placa/passaporte/e-mail/CEP
    ├── pdfGenerator.js       # Gera PDF com jsPDF
    ├── zendeskClient.js      # Cliente REST para a API do Zendesk
    ├── browserExtractor.js   # Extração Zendesk via automação de browser (Playwright)
    ├── probeEndpoint.js      # Sonda endpoints Zendesk no Jira (estratégia proxy)
    ├── diagnostics.js        # Diagnóstico de qualidade com IA — LLM-safe
    └── debugBrowser.js       # Utilitário de debug da extração via browser
```

---

## Estratégias de anonimização

| Fonte | Detecta | Confiança |
|---|---|---|
| Campos estruturados | Assignee, Reporter, autores de comentários | Alta |
| Bloco de assinatura | "Att, João da Silva \| Gerente \| Acme Ltda" | Alta |
| Sufixo jurídico | "TechCorp Ltda", "DataBrasil S.A.", "Farmacêutica XYZ" | Alta |
| Gatilho empresa | "cliente Acme", "reunião com a TechBrasil" | Média |
| Gatilho pessoa | "gerente Bruno", "Dra. Ana Paula", "atribuído ao Ricardo" | Média |
| Regex estrutural | CPF, CNPJ, RG, PIS/PASEP, placa, passaporte, título de eleitor, e-mail, telefone, CEP, senha | Determinístico |

> **Nomes compostos com preposição** são detectados corretamente em todos os detectores: `João da Silva`, `Maria dos Santos`, `Ana de Oliveira e Souza`.

### Tokens gerados

| Token | Dado protegido |
|---|---|
| `[PESSOA-1]`, `[PESSOA-2]`... | Nomes de pessoas (numerados consistentemente por issue) |
| `[EMPRESA-1]`, `[EMPRESA-2]`... | Nomes de empresas |
| `[CPF]` | CPF (formatos com e sem pontuação) |
| `[CNPJ]` | CNPJ |
| `[RG]` | RG (formatos estaduais XX.XXX.XXX-X) |
| `[PIS]` | PIS / PASEP |
| `[PLACA]` | Placas veiculares (formato antigo e Mercosul) |
| `[PASSAPORTE]` | Passaporte brasileiro |
| `[TITULO_ELEITOR]` | Título de eleitor |
| `[EMAIL]` | Endereços de e-mail |
| `[TELEFONE]` | Telefones (celular, fixo e internacional com `+55`) |
| `[CEP]` | CEP |
| `[SENHA]` | Senhas e credenciais explícitas: `senha:`, `password=`, `api_key=`, `token=`, `secret=`, `client_secret=`, `access_token=`, `auth_token=`, `bearer_token=`, `private_key=` |
| `[URL_USUARIO]` | URLs com segmento de usuário: `/users/`, `/profile/`, `/perfil/`, `/u/`, `/account/`, `/conta/` |

### Fluxo de 2 fases

**Fase 1 — Mineração:** todos os textos da issue são varridos antes de qualquer substituição. O `EntityMap` garante que o mesmo nome sempre gera o mesmo token dentro de uma issue.

**Fase 2 — Substituição:** o `EntityMap` é aplicado em ordem decrescente de comprimento (evita substituição parcial) e em seguida as regex estruturais substituem CPF, CNPJ, RG, PIS, placas e demais dados.

### Detecção de assinaturas expandida

O extrator de assinaturas reconhece mais de 20 padrões de abertura de bloco, incluindo:
- PT: `Att`, `Atenciosamente`, `Abs`, `Grato`, `Sem mais`, `Muito obrigado`, `Fico à disposição`
- EN: `Best regards`, `Kind regards`, `Sincerely`, `Thanks`, `Respectfully`
- Marcadores digitais: `--`, `___`, `Assinado digitalmente por`

---

## Integração com Zendesk

Disponível apenas no **modo completo** (sem `--jira-only`). Quando a issue possui um ticket Zendesk vinculado, o script tenta buscar os comentários em cascata:

| Ordem | Estratégia | Quando funciona |
|---|---|---|
| 1 | **Proxy via plugin Jira** | Plugin Zendesk instalado no Jira (sem credenciais extras) |
| 2 | **API direta do Zendesk** | `ZENDESK_BASE_URL`, `ZENDESK_USER` e `ZENDESK_TOKEN` configurados |
| 3 | **Automação de browser** | Chrome ou Edge aberto com sessão SSO ativa |

Na estratégia de browser, os dados de sessão são copiados para um diretório temporário e removidos automaticamente ao final.

### Campos extraídos por origem

#### 1. Integração principal via Jira REST

Esta é a fonte **obrigatória** do fluxo. O CLI sempre começa pela API do Jira em `/rest/api/2/issue/{ISSUE_KEY}` e pede os campos abaixo:

| Campo Jira | Nome interno / saída | Para que serve |
|---|---|---|
| `summary`, `status`, `priority`, `issuetype`, `project`, `created`, `updated` | `issue.fields.*` | Cabeçalho do PDF e contexto geral da issue |
| `description` + `renderedFields.description` | `issue.fields.description` / `issue.renderedFields.description` | Texto principal da issue a ser anonimizado |
| `comment` | `issue.fields.comment.comments` | Comentários nativos do Jira |
| `assignee.displayName`, `reporter.displayName` | `issue.fields.assignee`, `issue.fields.reporter` | Mineração de nomes de pessoas e identificação básica no PDF |
| `customfield_29200`, `customfield_29201`, `customfield_29202` | `fields.zdContact.nome`, `fields.zdContact.email`, `fields.zdContact.fone` | Contato do solicitante vindo do Jira; entra anonimizado no PDF |
| `ZENDESK_JIRA_FIELD` (padrão `customfield_11086`) | `ticketId` / `zendeskTicketId` | Descobre qual ticket Zendesk está vinculado à issue |
| `labels`, `components`, `fixVersions`, `versions`, `issuelinks`, `subtasks`, `parent`, `attachment`, `customfield_10014`, `customfield_10008` | `{ISSUE_KEY}_metadata.json` | Metadados não-PII usados no diagnóstico de negócio |

O `metadata.json` salvo junto com o PDF contém este subconjunto estruturado da issue:

```json
{
  "issueKey": "...",
  "summary": "...",
  "status": "...",
  "issueType": "...",
  "priority": "...",
  "project": "...",
  "projectKey": "...",
  "created": "...",
  "updated": "...",
  "labels": [],
  "components": [],
  "fixVersions": [],
  "affectedVersions": [],
  "issueLinks": [],
  "subtasks": [],
  "parent": null,
  "sprint": null,
  "epicKey": null,
  "attachmentNames": [],
  "commentCount": 0,
  "zendeskTicketId": null
}
```

#### 2. Integração via browser

O browser **não substitui** a leitura da issue no Jira. Ele só entra como fallback no modo completo para tentar capturar os **comentários do Zendesk** quando proxy Jira e API direta não funcionam.

O extrator via browser abre a aba Zendesk da issue, tenta capturar respostas JSON de rede e, se isso falhar, faz scraping do DOM. O payload é normalizado para:

| Campo normalizado | Quando costuma existir | Observação |
|---|---|---|
| `comments[].id` | Rede ou DOM | ID real do comentário; no scraping DOM pode virar índice sequencial |
| `comments[].author_id` | Rede | Normalmente ausente no scraping DOM |
| `comments[].body` | Rede ou DOM | Texto plano do comentário |
| `comments[].html_body` | Rede | HTML original do comentário quando a resposta JSON expõe isso |
| `comments[].public` | Rede ou DOM | Em DOM, o fallback assume `true` |
| `comments[].created_at` | Rede ou DOM | No DOM pode vir de `<time>` ou texto visível, se existir |
| `comments[]._authorName` | Rede ou DOM | Nome do autor quando vier embutido no payload ou visível na tela |
| `userMap` | Rede | Mapa `author_id -> usuário`; no scraping DOM geralmente fica vazio |

#### Diferença prática entre Jira e browser

- A integração do **Jira** é a fonte canônica da issue: dela saem descrição, comentários Jira, contato do solicitante, ticket Zendesk vinculado e todo o `metadata.json`.
- A integração via **browser** não busca a issue inteira nem gera metadados extras; ela só tenta preencher `fields.zdComments` com comentários do Zendesk.
- O Jira entrega dados mais estruturados e previsíveis. O browser depende da sessão SSO ativa e do que estiver disponível na aba Zendesk naquele momento.
- Quando o browser consegue capturar JSON de rede, o resultado é mais rico. Quando cai para scraping de DOM, alguns campos podem ficar parciais ou ausentes, especialmente `author_id`, `userMap` e datas exatas.
- Sem o campo `ZENDESK_JIRA_FIELD` vindo do Jira, o fallback de browser nem sabe qual ticket Zendesk procurar.

---

## Módulo de Diagnóstico — Laudos de Triagem

O diagnóstico produz até dois relatórios independentes com **9 seções padronizadas** cada.

### Relatório LGPD (`--lgpd`) — qualidade da anonimização

| # | Seção | Conteúdo |
|---|---|---|
| 1 | Sugestão de título | Título objetivo para o documento técnico |
| 2 | Descrição funcional do problema | Em linguagem de negócio, sem termos de código |
| 3 | Descrição funcional da solução | O que deve ser corrigido e resultado esperado |
| 4 | Problemas reportados | Tipo, evidência e severidade (🔴/🟡/🔵) |
| 5 | Análise de causa raiz | Fase 1 vs Fase 2, cobertura vs aplicação |
| 6 | Trechos de fonte relacionados | `arquivo.js:linha` + código exato |
| 7 | Sugestão de ajuste | Bloco `diff` com antes/depois |
| 8 | Critérios de aceite | Checklist verificável |
| 9 | Cenários de teste | Entrada e saída esperada |

### Relatório de Negócio (padrão / `--business`) — problema do cliente

| # | Seção | Conteúdo |
|---|---|---|
| 1 | Título do documento | Descreve o problema de negócio (ex: "Falha no cálculo de juros após migração 2.4.1") |
| 2 | Resumo da situação reportada | O que o cliente reportou e qual o impacto percebido — sem hipóteses, como para um gerente |
| 3 | Resumo da análise | Hipótese mais provável de causa raiz, localização no sistema e grau de confiança |
| 4 | Resumo da solução proposta | O que precisa ser feito e o resultado esperado pelo cliente |
| 5 | Timeline de eventos | Cronologia extraída dos comentários e metadados |
| 6 | Sintomas vs. causa raiz hipotética | O que o cliente vê + hipóteses ordenadas por probabilidade |
| 7 | Trechos de código relacionados | `arquivo:linha` + código do workspace (se configurado) |
| 8 | Passos para reproduzir e investigar | Como replicar + logs/queries para confirmar a hipótese |
| 9 | Critérios de aceite | Condições verificáveis de resolução |
| 10 | Cenários de teste regressivo | Casos de teste com entrada/saída esperada |
| 11 | Contexto adicional | Issue links, versões afetadas, sprint, labels, attachments |

### Detecções automáticas do diagnóstico

| Tipo | Descrição | Severidade |
|---|---|---|
| `leaked_email` / `leaked_cpf` / `leaked_cnpj` / `leaked_password` | PII estrutural que escapou da pipeline | 🔴 Crítico |
| `leaked_rg` / `leaked_pis` / `leaked_phone` / `leaked_cep` | Dados pessoais remanescentes | 🟡 Atenção |
| `leaked_url_usuario` | URL com segmento de usuário (`/users/joao.silva`) não anonimizado | 🟡 Atenção |
| `broken_token` | Token com colchete não fechado | 🟡 Atenção |
| `fallback_token` | `[PESSOA-?]` — nome não registrado na Fase 1 | 🟡 Atenção |
| `high_token_density` | Mais de 15% das palavras são tokens (super-anonimização) | 🔵 Info |

### Fallback de LLM (automático)

O módulo tenta os provedores na ordem configurada em `LLM_PROVIDER_ORDER`.
Se a variável não existir, a ordem padrão é:

1. `claude` CLI — sessão Claude Code / VS Code
2. `codex` CLI — sessão OpenAI Codex / login ChatGPT
3. GitHub Copilot — via `gh auth token` (plano Copilot ativo)
4. `ANTHROPIC_API_KEY` — chave direta no `.env`

O fallback não depende mais apenas de "CLI não instalado". Ele também continua automaticamente quando o provedor retorna erro de crédito baixo, quota, autenticação, assinatura/licença indisponível ou outro bloqueio operacional.

Exemplo para priorizar a licença do Codex CLI:

```env
LLM_PROVIDER_ORDER=codex,claude,copilot,anthropic
```

---

## Segurança no Módulo de Diagnóstico

O diagnóstico foi projetado para **não vazar dados pessoais** ao LLM externo, mesmo quando a anonimização do PDF falhou:

- O texto do PDF passa por sanitização com as mesmas regex da pipeline antes de entrar no prompt
- Os exemplos dos achados (`findings.matches`) são substituídos por `[REDACTED]` — o LLM recebe apenas tipo, severidade e contagem
- O código-fonte do workspace nunca contém dados de clientes
- Antes de qualquer envio, o usuário recebe uma confirmação explícita mostrando PDF, metadados e a lista nominal dos arquivos que entrarão no prompt
- O resumo diferencia envio completo vs. trecho: arquivos da pipeline `src/*.js` seguem completos; arquivos de backend/frontend do workspace seguem apenas com as faixas de linha extraídas
- Se `JIRA_TOKEN` ou `WORKSPACE_BACKEND_DIR` / `WORKSPACE_FRONTEND_DIR` estiverem ausentes ou inválidos, o CLI alerta e pede o preenchimento do `.env` antes de continuar
- O prompt exige uma única causa principal (`Causa mais provável:` / `Causa raiz mais provável:`), proíbe inventar arquivos/linhas e limita as referências aos trechos realmente enviados
- Se o LLM retornar uma resposta sem causa principal ou com referências fora do contexto permitido, a saída é corrigida uma vez; se continuar sem evidência válida, o relatório é bloqueado para evitar conteúdo especulativo
- Referências `arquivo:linha` só são aceitas se o arquivo realmente fizer parte do contexto enviado; para workspaces, a linha também precisa estar dentro das faixas exibidas nos snippets

Exemplo de confirmação antes do envio:

```text
Os seguintes artefatos serão enviados ao LLM:

Arquivo PDF (texto extraído):   DMANQUALI-12311_LGPD_anonimizado.pdf  (336 chars - texto sanitizado completo)
Comentários Zendesk:            2.294 chars - trecho sanitizado
Código-fonte da pipeline:       5 arquivo(s) de src/ - enviados por completo
                                -> src/anonymizer.js  (arquivo completo)
                                -> src/nerDetector.js  (arquivo completo)
Arquivos Backend:               12 arquivo(s) do workspace - somente trechos
                                -> Backend/src/service/foo.ts  (linhas 48-83 - trecho)
Arquivos Frontend:              12 arquivo(s) do workspace - somente trechos
                                -> Frontend/src/pages/bar.tsx  (linhas 12-57 - trecho)
```

---

## Log de auditoria (Art. 37 LGPD)

Cada exportação gera uma linha em `output/audit.log`:

```json
{
  "timestamp": "2026-03-12T09:22:12.000Z",
  "issueKey": "DMANQUALI-12311",
  "filename": "DMANQUALI-12311_LGPD_anonimizado.pdf",
  "entidades": { "totalPessoas": 3, "totalEmpresas": 1 }
}
```

Nenhum dado pessoal é registrado — apenas metadados da operação.

---

## Resolução de problemas

| Erro | Causa | Solução |
|---|---|---|
| `Credenciais não configuradas` | `.env` não existe ou não tem token | Rodar `node src/setup.js` |
| `Autenticação falhou (401)` | Token inválido ou expirado | Gerar novo token no Jira |
| `Issue não encontrada (404)` | Chave errada ou sem acesso ao projeto | Verificar a chave e permissões |
| `Conexão falhou` | URL errada ou sem acesso à rede | Verificar `JIRA_BASE_URL` no `.env` |
| `certificate has expired` | Certificado SSL corporativo | Já tratado automaticamente (`rejectUnauthorized: false`) |
| `Zendesk via API: 401` | Token Zendesk inválido | Novo token em Zendesk Admin → Apps & Integrations → API |
| Browser sem comentários | DOM do Jira sem seletor reconhecido | Use `--jira-only` ou verifique a aba Zendesk manualmente |
| `claude CLI: exit 1 — Credit balance is too low` | Sessão Claude Code ativa, mas sem saldo/quota disponível para a chamada | O fallback agora tenta `codex`, `copilot` e `ANTHROPIC_API_KEY`; para priorizar Codex, configure `LLM_PROVIDER_ORDER=codex,claude,copilot,anthropic` |
| `Nenhuma forma de acesso ao LLM` | Nenhum provedor CLI/API ficou utilizável na ordem configurada | Verificar `claude auth status`, `codex login status`, `gh auth status` e/ou configurar `ANTHROPIC_API_KEY` |

---

## Conformidade LGPD

| Artigo | Status |
|---|---|
| Art. 6 — Finalidade | ✅ Compartilhamento seguro sem exposição de dados pessoais |
| Art. 7 — Base legal | ✅ Legítimo interesse do controlador |
| Art. 12 — Anonimização | ✅ Tokens cobrem 13 tipos de PII, incluindo RG, PIS, placas e senhas |
| Art. 33 — Transferência internacional | ✅ Exportação totalmente local; diagnóstico sanitiza antes de qualquer envio externo |
| Art. 37 — Registro de operações | ✅ `output/audit.log` gerado automaticamente sem PII |
| Art. 46 — Segurança técnica | ✅ Processamento em memória; PII nunca persiste em disco fora do PDF final |
