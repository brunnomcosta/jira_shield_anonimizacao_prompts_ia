# SHIELD

> Secure Handling of Issue Evidence, Linked Code, and Diagnostics
> Tratamento seguro de evidências de issues, código vinculado e diagnósticos

SHIELD e a base local para exportacao LGPD-safe de issues, enriquecimento com contexto tecnico e triagem assistida por IA. O projeto combina um runtime Node.js em `src/` com uma extensao Chrome em `chrome-extension/`, preservando o foco em anonimização, evidencias auditaveis e correlacao com codigo.

## O que o projeto faz

- Exporta issues do Jira para PDF anonimizado e gera `metadata.json` estruturado.
- Enriquece o pacote com comentarios/anexos do Zendesk quando configurado.
- Executa diagnosticos de negocio e de qualidade LGPD a partir do ticket, anexos e contexto tecnico.
- Correlaciona arquivos de workspace local e resultados do Azure DevOps Search para sustentar hipoteses tecnicas.
- Oferece uma extensao Chrome com popup, analysis workspace, anexos/Drive, prompts de diagnostico, source planner e code review.

Todo o fluxo foi desenhado para manter o tratamento de dados no ambiente local e evitar enfraquecer a anonimização antes de qualquer envio a LLM.

## Requisitos

- Node.js `>= 18`
- `npm`
- Acesso ao Jira Server usado pela operacao
- Opcional: Zendesk, chaves de LLM (`ANTHROPIC_API_KEY` ou `TOTVS_DTA_*`), paths de workspace local, `AZURE_DEVOPS_PAT`, `GOOGLE_SERVICE_ACCOUNT_KEY`

## Setup

1. Instale as dependencias:

```bash
npm install
```

2. Gere ou revise o `.env`:

```bash
npm run setup
```

Tambem e possivel copiar `.env.example` para `.env` manualmente.

3. Configure pelo menos as credenciais do Jira:

- Obrigatorio: `JIRA_BASE_URL` e `JIRA_TOKEN` ou `JIRA_USER` + `JIRA_PASSWORD`
- Opcional para exportacao completa: `ZENDESK_BASE_URL`, `ZENDESK_USER`, `ZENDESK_TOKEN`, `ZENDESK_JIRA_FIELD`
- Opcional para diagnostico/LLM: `ANTHROPIC_API_KEY`, `TOTVS_DTA_API_KEY`, `TOTVS_DTA_MODEL_LOW_COST`, `TOTVS_DTA_MODEL_HIGH_COST`, `LLM_PROVIDER_ORDER`
- Opcional para linked code: `WORKSPACE_ERP_BACKEND_DIR`, `WORKSPACE_MOBILE_FRONTEND_DIR`, `WORKSPACE_ERP_INCLUDE_DIR`, `AZURE_DEVOPS_PAT`
- Opcional para Drive no CLI: `GOOGLE_SERVICE_ACCOUNT_KEY`

## Uso pelo CLI

### Exportacao de evidencias

```bash
node src/index.js DMANQUALI-12311
node src/index.js --jira-only DMANQUALI-12311

# via npm scripts
npm run export -- DMANQUALI-12311
npm run export:jira -- DMANQUALI-12311
```

Modos:

- Padrao: Jira + tentativa de enriquecimento Zendesk via proxy, API e browser
- `--jira-only`: exportacao somente Jira, sem browser e sem Zendesk

Artefatos gerados em `OUTPUT_DIR` (padrao `./output`):

- `<ISSUE_KEY>_LGPD_anonimizado.pdf`
- `<ISSUE_KEY>_metadata.json`
- `audit.log`

### Diagnosticos

```bash
node src/diagnostics.js DMANQUALI-12311
node src/diagnostics.js --lgpd DMANQUALI-12311
node src/diagnostics.js --lgpd --business DMANQUALI-12311
node src/diagnostics.js --no-llm DMANQUALI-12311

# via npm script
npm run diagnose -- --lgpd --business DMANQUALI-12311
```

Modos:

- Padrao: diagnostico de negocio
- `--lgpd`: analise de qualidade de anonimização
- `--lgpd --business`: executa os dois relatorios
- `--no-llm`: limita o fluxo a varredura/local validation, sem envio a LLM

Comportamento relevante:

- Sem issue na linha de comando, o CLI tenta usar o PDF mais recente em `./output`
- O diagnostico pode rodar com follow-up iterativo (`followup_searches`) para pedir mais trechos do workspace
- Quando ha workspace configurado, o prompt recebe apenas espelhos/trechos autorizados, em modo somente leitura

Artefatos de saida:

- `diagnostic_<mode>_<ISSUE_KEY>_<timestamp>.md`

## Extensao Chrome

Antes de carregar a extensao, gere os artefatos do build:

```bash
npm run build:extension
```

O build:

- copia dependencias browser-side para `chrome-extension/vendor/`
- gera bundles compartilhados a partir de `src/`
- gera `chrome-extension/generated-project-env.js` a partir do `.env`
- cria um pacote minificado em `dist/chrome-extension`

Carregamento:

1. Abra `chrome://extensions`
2. Ative `Developer mode`
3. Use `Load unpacked`
4. Aponte para `chrome-extension/` ou `dist/chrome-extension/`

Capacidades principais da extensao:

- detecta a issue a partir da aba atual do Jira
- abre o `analysis-workspace.html` como shell canonico por issue
- hidrata contexto de Jira, Zendesk, anexos e links Google Drive
- suporta iteracao de diagnostico com fila de jobs e follow-ups de workspace
- usa Azure DevOps Search quando disponivel e faz fallback para workspace local
- registra templates de prompt para diagnostico, diagnostico com fontes, source planner e code review

Observacoes operacionais:

- a extensao depende da sessao do navegador para Jira/SSO e integracoes baseadas em browser
- os downloads da extensao usam o fluxo do Chrome, nao `./output`
- sem `AZURE_DEVOPS_PAT`, a descoberta de codigo cai para o workspace local

## Estrutura do repositorio

- `src/`: runtime canonico do CLI e modulos compartilhados
- `chrome-extension/`: service worker, UI, templates de prompt e helpers browser-side
- `tests/`: suite `node --test`
- `scripts/`: build da extensao, icones e utilitarios
- `docs/superpowers/`: specs e planos de trabalho
- `output/`: artefatos gerados localmente

## Scripts npm

| Script | Comando | Uso |
|---|---|---|
| `setup` | `node src/setup.js` | cria/atualiza `.env` |
| `export` | `node src/index.js` | exportacao completa |
| `export:jira` | `node src/index.js --jira-only` | exportacao somente Jira |
| `diagnose` | `node src/diagnostics.js` | diagnosticos |
| `test` | `node --test tests/` | suite automatizada |
| `build:extension` | `node scripts/build-extension.js` | build browser-side |
| `build:icons` | `node scripts/generate-icons.js` | regeneracao de icones |

## Seguranca e LGPD

- O PDF exportado e o `metadata.json` passam por sanitizacao antes de alimentar fluxos de diagnostico.
- O workspace espelhado usado no diagnostico e tratado como evidencia local somente leitura.
- `.env` nunca deve ser versionado.
- Politica de privacidade publica: `PRIVACY_POLICY.md`
- Politica de seguranca: `SECURITY.md`
- Termos de uso: `TERMS_OF_USE.md`
- `chrome-extension/generated-project-env.js` e um snapshot gerado localmente no build da extensao. O repositorio agora carrega apenas um stub seguro; rode `npm run build:extension` localmente para regenerar esse arquivo a partir do seu `.env`.
- Revise esse snapshot antes de commitar qualquer alteracao de build. Ele pode carregar paths locais, ordem de provedores e credenciais de LLM.

## Validacao e desenvolvimento

Comandos mais uteis durante manutencao:

```bash
npm test
node --check src/index.js
node --check src/diagnostics.js
npm run build:extension
```

Os testes cobrem contratos da extensao, templates de prompt, anonimização, enriquecimento de contexto, linked code e fluxos do analysis workspace.

## Limitacoes conhecidas

- O CLI so consegue enriquecer links Google Drive automaticamente quando `GOOGLE_SERVICE_ACCOUNT_KEY` estiver configurado.
- Sem workspace configurado, o diagnostico fica restrito ao ticket, metadados e anexos disponiveis.
- A extensao precisa de build local para refletir seu `.env`, dependencias browser-side e defaults do projeto.
