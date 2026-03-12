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
  4. Reconstrói timeline de eventos a partir dos comentários
  5. Analisa sintomas, hipótese mais provável de causa raiz no produto e código do workspace
  6. Rejeita respostas do LLM sem causa principal ou sem evidência válida
  7. Salva em output/diagnostic_business_<ISSUE_KEY>_<timestamp>.md

Modo --lgpd (qualidade da anonimização):
  1. Extrai texto do PDF anonimizado
  2. Varredura local regex — detecta PII residual, tokens quebrados e fallbacks
  3. Sanitiza conteúdo (nenhuma PII real sai do ambiente)
  4. Envia código-fonte da pipeline ao LLM para análise de causa raiz técnica
  5. Salva em output/diagnostic_lgpd_<ISSUE_KEY>_<timestamp>.md

  (fallback automático: Claude CLI → Codex CLI → GitHub Copilot → API key)
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

# Ou: copiar o template manualmente
cp .env.example .env
# Editar .env com seu editor de texto
```

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
| `ANTHROPIC_API_KEY` | Chave da API Anthropic (fallback se Claude CLI não estiver instalado) |
| `WORKSPACE_BACKEND_DIR` | Raiz do código-fonte back-end para análise cruzada de causa raiz |
| `WORKSPACE_FRONTEND_DIR` | Raiz do código-fonte front-end para análise cruzada de causa raiz |
| `WORKSPACE_EXTENSIONS` | Extensões de arquivo a incluir (padrão: `js,ts,java,py,cs,go,kt,jsx,tsx,vue,rb,php,prx,prw,tlpp`) |

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
> Funciona com `claude` CLI instalado (Claude Code), Codex CLI, GitHub Copilot (`gh` CLI) ou `ANTHROPIC_API_KEY` no `.env`.

### Referência de scripts npm

| Script | Comando equivalente | Descrição |
|---|---|---|
| `npm run export -- KEY` | `node src/index.js KEY` | Exportação completa (Jira + Zendesk) |
| `npm run export:jira -- KEY` | `node src/index.js --jira-only KEY` | Exportação apenas Jira, sem browser |
| `npm run diagnose -- KEY` | `node src/diagnostics.js KEY` | Análise de negócio (padrão) |
| `npm run diagnose -- KEY --lgpd` | `node src/diagnostics.js KEY --lgpd` | Só análise LGPD (anonimização) |
| `npm run diagnose -- KEY --lgpd --business` | `node src/diagnostics.js KEY --lgpd --business` | Ambas as análises |
| `npm run setup` | `node src/setup.js` | Assistente interativo de configuração |

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

O módulo tenta os provedores na ordem abaixo, sem necessidade de configuração prévia:

1. `claude` CLI — sessão Claude Code / VS Code
2. `codex` CLI — sessão OpenAI Codex
3. GitHub Copilot — via `gh auth token` (plano Copilot ativo)
4. `ANTHROPIC_API_KEY` — chave direta no `.env`

---

## Segurança no Módulo de Diagnóstico

O diagnóstico foi projetado para **não vazar dados pessoais** ao LLM externo, mesmo quando a anonimização do PDF falhou:

- O texto do PDF passa por sanitização com as mesmas regex da pipeline antes de entrar no prompt
- Os exemplos dos achados (`findings.matches`) são substituídos por `[REDACTED]` — o LLM recebe apenas tipo, severidade e contagem
- O código-fonte do workspace nunca contém dados de clientes
- Antes de qualquer envio, o usuário recebe uma confirmação explícita mostrando PDF, metadados e quantidade de arquivos de workspace que serão enviados
- Se `JIRA_TOKEN` ou `WORKSPACE_BACKEND_DIR` / `WORKSPACE_FRONTEND_DIR` estiverem ausentes ou inválidos, o CLI alerta e pede o preenchimento do `.env` antes de continuar
- O prompt exige uma única causa principal (`Causa mais provável:` / `Causa raiz mais provável:`), proíbe inventar arquivos/linhas e limita as referências aos trechos realmente enviados
- Se o LLM retornar uma resposta sem causa principal ou com referências fora do contexto permitido, a saída é corrigida uma vez; se continuar sem evidência válida, o relatório é bloqueado para evitar conteúdo especulativo
- Referências `arquivo:linha` só são aceitas se o arquivo realmente fizer parte do contexto enviado; para workspaces, a linha também precisa estar dentro das faixas exibidas nos snippets

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
| `Nenhuma forma de acesso ao LLM` | Nenhum CLI instalado e sem API key | Instalar Claude Code ou configurar `ANTHROPIC_API_KEY` |

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
