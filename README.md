# SHIELD — Anonimização de Issues e Triagem Diagnóstica LGPD

> **S**mart **H**andler for **I**ssue **E**xport with **L**inked **D**ata

Ferramenta CLI Node.js com dois módulos complementares para conformidade LGPD no Jira Server:

- **Módulo 1 — Exportação:** gera PDFs anonimizados de issues do Jira Server sem instalação de plugin
- **Módulo 2 — Diagnóstico:** avalia a qualidade da anonimização e produz um laudo técnico com análise de causa raiz via IA

Compatível com Jira Server 8.x. Todo processamento ocorre **localmente** — nenhum dado pessoal é enviado a serviços externos durante a exportação.

---

## Como funciona

### Módulo 1 — Exportação Anonimizada

```
node src/index.js DMANQUALI-12311

  1. Autentica via API REST do Jira (token pessoal ou usuário/senha)
  2. Busca a issue completa (campos + comentários Jira)
  3. Busca comentários Zendesk vinculados (3 estratégias em cascata)
  4. Fase 1 — Mineração: varre todos os textos para detectar entidades
  5. Fase 2 — Substituição: aplica tokens [PESSOA-1], [EMPRESA-1], [CPF], [RG]...
  6. Gera PDF em ./output/DMANQUALI-12311_LGPD_anonimizado.pdf
  7. Registra metadados no audit.log (Art. 37 LGPD)
```

### Módulo 2 — Diagnóstico Inteligente (Auxiliador de Triagem)

```
node src/diagnostics.js DMANQUALI-12311

  1. Extrai texto do PDF anonimizado
  2. Varredura local regex — detecta PII residual, tokens quebrados e fallbacks
  3. Sanitiza o conteúdo antes de enviar ao LLM (nenhuma PII real sai do ambiente)
  4. Envia código-fonte e contexto sanitizado ao LLM (fallback: Claude → Codex → Copilot → API)
  5. Gera laudo com 9 seções: causa raiz, trechos de código, diff de correção, critérios de aceite
  6. Salva em output/diagnostic_<ISSUE_KEY>_<timestamp>.md
```

---

## Pré-requisitos

- Node.js 18 LTS ou superior → https://nodejs.org
- Acesso à internet para instalar as dependências (`npm install`)
- Acesso ao Jira (mesmo acesso que você já usa no browser)
- *(Opcional)* Google Chrome ou Microsoft Edge instalado — necessário apenas para a estratégia de extração Zendesk via browser

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

### Zendesk (opcional)

| Variável | Descrição |
|---|---|
| `ZENDESK_BASE_URL` | URL base do Zendesk (ex: `https://suaempresa.zendesk.com`) |
| `ZENDESK_USER` | E-mail do agente Zendesk |
| `ZENDESK_TOKEN` | API Token do Zendesk |
| `ZENDESK_JIRA_FIELD` | Campo da issue Jira com o ID do ticket ZD (padrão: `customfield_11086`) |

### Diagnóstico com IA (opcional)

| Variável | Descrição |
|---|---|
| `ANTHROPIC_API_KEY` | Chave da API Anthropic para o módulo de diagnóstico |
| `WORKSPACE_BACKEND_DIR` | Raiz do código-fonte back-end para análise cruzada |
| `WORKSPACE_FRONTEND_DIR` | Raiz do código-fonte front-end para análise cruzada |
| `WORKSPACE_EXTENSIONS` | Extensões de arquivo a incluir (padrão: `js,ts,java,py,cs,go,kt,jsx,tsx,vue,rb,php`) |

---

## Gerar Personal Access Token (recomendado)

1. Acesse: `https://jiraproducao.totvs.com.br`
2. Clique no seu avatar → **Profile**
3. No menu lateral: **Personal Access Tokens**
4. Clique em **Create token**
5. Nome: "LGPD Export" — sem expiração ou 1 ano
6. Copie o token e cole no `.env` como `JIRA_TOKEN`

---

## Uso

### Exportar uma issue

```bash
node src/index.js DMANQUALI-12311
```

### Exportar várias issues de uma vez

```bash
node src/index.js DMANQUALI-12311 DMANQUALI-12312 DMANQUALI-12313
```

### Executar diagnóstico de qualidade da anonimização

```bash
node src/diagnostics.js DMANQUALI-12311
```

> Requer `ANTHROPIC_API_KEY` configurada no `.env`.
> Analisa o PDF gerado e o código-fonte (se `WORKSPACE_*` configurado) para avaliar riscos de reidentificação.

### Saída esperada no terminal

```
╔═══════════════════════════════════╗
║   JIRA LGPD Export — Standalone   ║
╚═══════════════════════════════════╝

🔌  Conectando em https://jiraproducao.totvs.com.br...
✅  Jira Server 8.20.20 — conexão OK

⏳  Buscando DMANQUALI-12311...
✅  Issue encontrada: [TRIAR] QIPA215 - LGERSLABOP
🎫  Buscando Zendesk Comments (ticket #26518424)...
✅  3 Zendesk comment(s) via proxy Jira
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
├── output/                   # PDFs gerados aqui
│   ├── DMANQUALI-12311_LGPD_anonimizado.pdf
│   └── audit.log             # Log de auditoria (Art. 37 LGPD)
└── src/
    ├── index.js              # CLI principal — orquestra o fluxo completo
    ├── setup.js              # Assistente interativo de configuração
    ├── jiraClient.js         # Cliente REST para Jira Server 8.x
    ├── anonymizer.js         # Orquestrador das 2 fases de anonimização
    ├── entityMap.js          # Mapa de tokens consistentes ([PESSOA-1], [EMPRESA-1])
    ├── signatureExtractor.js # Detecta blocos de assinatura (alta confiança)
    ├── contextualExtractor.js# Detecta entidades por palavras-gatilho
    ├── nerDetector.js        # Regex para CPF/CNPJ/e-mail/telefone/CEP
    ├── pdfGenerator.js       # Gera PDF com jsPDF
    ├── zendeskClient.js      # Cliente REST para a API do Zendesk
    ├── browserExtractor.js   # Extração Zendesk via automação de browser (Playwright)
    ├── probeEndpoint.js      # Sonda endpoints Zendesk no Jira (estratégia proxy)
    ├── diagnostics.js        # Diagnóstico de qualidade com IA (Anthropic)
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
| Regex estrutural | CPF, CNPJ, RG, PIS/PASEP, placa, passaporte, título de eleitor, e-mail, telefone, CEP | Determinístico |

> **Nomes compostos com preposição** são detectados corretamente: `João da Silva`, `Maria dos Santos`, `Ana de Oliveira e Souza`.

### Fluxo de 2 fases

**Fase 1 — Mineração:** todos os textos da issue são varridos antes de qualquer substituição. O `EntityMap` garante que o mesmo nome sempre gera o mesmo token (`[PESSOA-1]`, `[PESSOA-2]`...) dentro de uma issue.

**Fase 2 — Substituição:** o `EntityMap` é aplicado em ordem decrescente de comprimento (evita substituição parcial) e em seguida as regex estruturais removem CPF, CNPJ, e-mail, telefone e CEP remanescentes.

---

## Integração com Zendesk

Quando a issue Jira possui um ticket Zendesk vinculado (campo `ZENDESK_JIRA_FIELD`), o script tenta buscar os comentários usando três estratégias em cascata:

| Ordem | Estratégia | Quando funciona |
|---|---|---|
| 1 | **Proxy via plugin Jira** | Plugin Zendesk instalado no Jira (sem credenciais extras) |
| 2 | **API direta do Zendesk** | `ZENDESK_BASE_URL`, `ZENDESK_USER` e `ZENDESK_TOKEN` configurados |
| 3 | **Automação de browser** | Nenhuma das anteriores funcionou — reutiliza a sessão SSO do Chrome ou Edge já aberto |

Na estratégia de browser, os cookies e dados de sessão são copiados para um diretório temporário para evitar conflito com o Chrome/Edge em uso. O diretório temporário é removido automaticamente ao final.

---

## Log de auditoria (Art. 37 LGPD)

Cada exportação gera uma linha em `output/audit.log`:

```json
{
  "timestamp": "2026-03-11T09:22:12.000Z",
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
| `certificate has expired` | Certificado SSL corporativo | Já tratado (`rejectUnauthorized: false`) |
| `Zendesk via API: 401` | Token Zendesk inválido | Gerar novo token em Zendesk Admin → Apps & Integrations → API |
| Browser abre mas sem comentários | DOM do Jira não tem seletor reconhecido | Verificar a aba Zendesk manualmente e abrir issue no GitHub |

---

## Conformidade LGPD

| Artigo | Status |
|---|---|
| Art. 6 — Finalidade | ✅ Compartilhamento seguro sem exposição de dados pessoais |
| Art. 7 — Base legal | ✅ Legítimo interesse do controlador |
| Art. 12 — Anonimização | ✅ Tokens não permitem reidentificação |
| Art. 33 — Transferência internacional | ✅ Exportação totalmente local, sem envio de dados a terceiros |
| Art. 37 — Registro de operações | ✅ `output/audit.log` gerado automaticamente |
| Art. 46 — Segurança técnica | ✅ Processamento em memória; diagnóstico sanitiza PII antes de qualquer chamada externa |

---

## Segurança no Módulo de Diagnóstico

O diagnóstico foi projetado para **não vazar dados pessoais** ao LLM externo:

- O texto do PDF é sanitizado (mesmas regex da pipeline) antes de entrar no prompt
- Os exemplos dos achados são substituídos por `[REDACTED]` — o LLM recebe apenas tipo, severidade e contagem
- O código-fonte do workspace nunca contém dados de clientes

Isso garante conformidade LGPD mesmo quando a anonimização do PDF falhou parcialmente.
