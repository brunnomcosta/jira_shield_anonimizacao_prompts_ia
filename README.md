# SHIELD — Anonimização de Issues e Triagem Diagnóstica LGPD

> **S**mart **H**andler for **I**ssue **E**xport with **L**inked **D**ata
> *Gerenciador Inteligente para Exportação de Issues com Dados Vinculados*

Ferramenta CLI Node.js com dois módulos complementares para conformidade LGPD no Jira Server:

- **Módulo 1 — Exportação:** gera PDFs anonimizados de issues do Jira Server sem instalação de plugin, em dois modos (somente Jira ou completo com Zendesk)
- **Módulo 2 — Diagnóstico:** dois modos complementares: (a) avalia a qualidade da anonimização com laudo técnico LGPD e (b) analisa o problema de negócio reportado pelo cliente com causa raiz no produto — ambos sem vazar dados pessoais ao LLM

Compatível com Jira Server 8.x. A exportação ocorre **inteiramente no ambiente local** — nenhum dado pessoal é enviado a serviços externos.

Melhorias recentes:

- a extensao Chrome agora pode preparar documentacao tecnica com IA a partir do ticket anonimizado, copiando o prompt e abrindo Claude, ChatGPT, Gemini ou Copilot
- o popup da extensao foi reorganizado para destacar exportacao, historico e resumo do ambiente, com os cards de ambiente empilhados para melhor leitura
- a compactacao de contexto do diagnostico ganhou um terceiro tier ultra-compacto para reduzir prompts muito grandes antes do envio ao LLM
- a extracao contextual de pessoas ficou mais conservadora para evitar falsos positivos em termos de triagem e vocabulario tecnico
- a deteccao de RG passou a ignorar padroes dentro de URLs e query strings, reduzindo falso positivo em links
- a extracao da issue agora inclui `customfield_11069` (modulo da classificacao, ex: "INSPECAO DE PROCESSOS (SIGAQIP)") e `customfield_11078` (rotina relacionada, ex: "QIPA215 - RESULTADOS"), exibidos no PDF e salvos no metadata.json
- o nome da empresa cliente (`customfield_11071`) e automaticamente registrado no EntityMap antes do processamento, garantindo substituicao consistente por `[EMPRESA-N]` em todos os textos da issue
- os identificadores sensiveis do cliente — codigo de conta/CRM (`customfield_11085`), campo identificador (`customfield_11053`) e codigo do cliente (`customfield_11038`) — sao anonimizados 100% e nulificados na saida, com seus valores registrados no EntityMap para mascaramento em todo o texto

## Arquitetura e decisões técnicas

### Visão geral

- O CLI é o ponto canônico de exportação anonimizada e diagnóstico com LLM.
- A extensão Chrome é complementar: opera inteiramente no navegador, sem acesso direto ao workspace local por padrão, mas pode ler diretórios locais via permissão explícita do navegador.
- O mascaramento de segredos ocorre antes e depois da aplicação lexical do `EntityMap`, para evitar que falsos positivos de contexto quebrem palavras-chave como `password` e impeçam a redação do valor.
- O `metadata.json` gerado junto ao PDF contém mascaramento textual recursivo para não reaproveitar valores sensíveis em claro.
- Templates editáveis da extensão são limitados ao texto do prompt enviado à LLM — nenhuma opção do plugin altera as regras internas de anonimização.
- `Prompt Documentação` e `Prompt Diagnóstico` possuem arquivos físicos distintos de template e compartilham apenas a infraestrutura de registro/renderização.

### Riscos e limitações conhecidos

- Ainda existe duplicidade de regras de mascaramento entre o runtime Node e o runtime da extensão Chrome. O comportamento está alinhado, mas um ponto único cross-runtime ainda não existe.
- O plugin depende de permissão local explícita do navegador para ler diretórios do ERP/mobile. Os valores do `.env` deixam a configuração visível e sincronizada, mas não concedem acesso ao filesystem por si só.
- O template de diagnóstico da extensão espelha o contrato do CLI, mas não é gerado automaticamente a partir de `src/diagnostics.js`.

### Como validar

```bash
npm test
node --check src/index.js
node --check src/diagnostics.js
npm run build:extension
npm test
```

### Arquivos mais relevantes

- `src/sensitiveTextSanitizer.js` — ponto único de mascaramento textual
- `src/anonymizer.js` — orquestrador das 2 fases de anonimização
- `src/diagnostics.js` — diagnóstico com LLM (CLI)
- `src/index.js` — CLI principal de exportação
- `chrome-extension/shield-core.js` — núcleo da extensão Chrome
- `chrome-extension/background.js` — service worker da extensão
- `chrome-extension/prompt-templates.js` — templates do Prompt Documentação
- `chrome-extension/prompt-template-diagnostic.js` — templates do Prompt Diagnóstico
- `chrome-extension/popup.js` — interface principal do popup
- `chrome-extension/options.js` — configurações da extensão
- `tests/` — testes automatizados (sanitizador, anonimizador, templates, contratos de prompt)

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
  2. Se detectar `JIRA_TOKEN` / `WORKSPACE_*` ausentes ou inválidos em terminal interativo, pergunta se deseja preenchê-los e persiste no `.env` + ambiente do usuário do Windows
  3. Sanitiza conteúdo antes de enviar ao LLM
  4. Exibe confirmação pré-envio com nomes dos arquivos e indica se cada artefato vai completo ou por trecho
  5. Mostra progresso durante a chamada ao LLM, com provedor, comandos e tempo decorrido
  6. Compacta a janela de contexto antes do envio quando necessário
  7. Reconstrói timeline de eventos a partir dos comentários
  8. Analisa sintomas, hipótese mais provável de causa raiz no produto e código do workspace
  9. Rejeita respostas do LLM sem causa principal ou sem evidência válida
  10. Salva em output/diagnostic_business_<ISSUE_KEY>_<timestamp>.md

Modo --lgpd (qualidade da anonimização):
  1. Extrai texto do PDF anonimizado
  2. Varredura local regex — detecta PII residual, tokens quebrados e fallbacks
  3. Se detectar `JIRA_TOKEN` / `WORKSPACE_*` ausentes ou inválidos em terminal interativo, pergunta se deseja preenchê-los e persiste no `.env` + ambiente do usuário do Windows
  4. Sanitiza conteúdo (nenhuma PII real sai do ambiente)
  5. Exibe confirmação pré-envio com nomes dos arquivos e indica se cada artefato vai completo ou por trecho
  6. Mostra progresso durante a chamada ao LLM, com provedor, comandos e tempo decorrido
  7. Compacta a janela de contexto antes do envio quando necessário
  8. Envia código-fonte da pipeline ao LLM para análise de causa raiz técnica
  9. Salva em output/diagnostic_lgpd_<ISSUE_KEY>_<timestamp>.md

  (fallback automático configurável: Claude CLI → Codex CLI → GitHub Copilot → API key)
```

Se o prompt ainda ficar grande após a compactação normal, o diagnóstico aplica um terceiro tier ultra-compacto para reduzir ainda mais o contexto antes do envio ao provedor.

### Como o diagnóstico identifica arquivos de contexto do workspace

O módulo usa uma **estratégia de 3 passagens** para selecionar apenas os trechos de código mais relevantes a enviar ao LLM.

#### Etapa 0 — Extração de contexto técnico do issue

Antes de varrer o workspace, o sistema extrai **8 categorias de referências técnicas** do issue Jira (campos, comentários, labels, componentes e anexos):

| Categoria | Exemplos |
|---|---|
| `modules` | `SIGAWQIP`, `SIGACDA` |
| `routines` | `U_QIPA215`, nomes de funções |
| `sourceFiles` | caminhos e nomes de arquivos |
| `identifiers` | CamelCase, PascalCase, snake_case |
| `routes` | endpoints REST (`/api/v1/...`) |
| `dbArtifacts` | tabelas, colunas, views |
| `uiArtifacts` | elementos de tela |
| `messages` | mensagens de erro/sistema |

Cada referência recebe um nível de confiança: `explicit` (peso 3) > `metadata` (peso 2) > `heuristic` (peso 1).

#### Passagem 1 — Pré-filtro por caminho (sem I/O)

- Pontua **todos os arquivos do workspace** apenas pelo nome e caminho, sem abri-los
- Ex.: `calcularJuros.js` recebe pontuação alta se `calcularJuros` foi extraído do issue
- Identificadores PascalCase e numéricos recebem bônus extra de relevância
- Seleciona os **top 80 candidatos** (`MAX_CANDIDATES`)

#### Passagem 2 — Pontuação por conteúdo (com I/O)

- Lê apenas os 80 candidatos pré-filtrados
- Aplica regex com pesos por categoria no conteúdo de cada arquivo:
  - Identificadores: peso 5–8
  - Rotas: peso 3
  - Frases literais: peso 4
  - Palavras genéricas: peso 1
- Fórmula: `score = pathScore × 2 + contentScore`
  - O path score tem peso **2×** — convenção de nomes é mais confiável que ocorrências textuais
- Seleciona os **top 15 arquivos** (`MAX_FILES`)

#### Passagem 3 — Extração de trechos

- Para cada linha com match, expande **±10 linhas de contexto**
- Mescla intervalos sobrepostos
- Limita a 5 trechos por arquivo e 3.000 chars por arquivo
- Resultado: trechos com ranges explícitos, ex.: `L48-83`, `L150-175`

#### Detecção de contexto mobile

O workspace frontend só é incluído se o ticket apresentar sinais suficientes (score ≥ 3) de termos como `app mobile`, `android`, `ionic`, `celular`, etc. Isso evita incluir código frontend desnecessariamente em tickets de back-end.

#### Includes TOTVS (`.prw` / `.prx` / `.tlpp`)

Para fontes TOTVS, o sistema pré-indexa todos os arquivos `.ch` do `WORKSPACE_ERP_INCLUDE_DIR` e resolve os `#include` das primeiras 80 linhas de cada fonte. O conteúdo dos headers é incluído na pontuação de conteúdo — mas o trecho enviado ao LLM continua sendo apenas do fonte principal.

#### Limites de configuração

| Parâmetro | Valor padrão |
|---|---|
| Candidatos lidos no passo 2 | 80 arquivos |
| Arquivos incluídos no prompt | 15 arquivos |
| Total de chars no workspace | 22.000 |
| Chars backend / frontend | 9.000 / 4.500 |
| Arquivos backend / frontend | 6 / 4 |

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
#    Copia o jsPDF para chrome-extension/vendor e valida os arquivos da extensao
npm run build:extension

# Ou: copiar o template manualmente
cp .env.example .env
# Editar .env com seu editor de texto
```

---

## Extensao Google Chrome

O repositório agora inclui uma extensao Chrome em [chrome-extension/](./chrome-extension) para executar o **Módulo 1 — Exportação** dentro do navegador.

### O que a extensao faz

- Exporta uma ou varias issue keys do Jira para PDF anonimizado
- Detecta automaticamente a issue da aba atual quando voce esta no Jira
- Baixa junto o `{ISSUE_KEY}_metadata.json`, pronto para o `diagnostics.js`
- Tenta obter comentários Zendesk por 3 caminhos:
  - proxy do plugin Jira
  - API direta do Zendesk
  - scraping simples da aba Zendesk do Jira
- Mostra no popup o modo de autenticacao ativo, pasta de download e capacidades disponiveis
- Armazena historico local das exportacoes no `chrome.storage.local`
- Permite gerar `Prompt Documentacao`, `Prompt Diagnostico` e `Prompt Diagnostico + Contexto Fontes` a partir do ticket anonimizado
- Abre a IA escolhida no navegador e copia o prompt automaticamente para a area de transferencia
- No build da extensao, gera um snapshot interno dos `WORKSPACE_*` a partir do `.env` da raiz do projeto, para que o plugin enxergue esses valores mesmo sendo carregado a partir de `chrome-extension/`
- O mesmo snapshot tambem registra a raiz local do projeto e a exibe no campo `Raiz local do projeto SHIELD (.env)` do plugin
- O `Prompt Diagnostico + Contexto Fontes` monta o prompt final no service worker e exige ao menos um snippet real de fonte; sem isso, o plugin interrompe o fluxo com erro explicito

### O que fica fora da extensao

- `src/diagnostics.js` continua no CLI Node.js
- leitura de workspace local (`WORKSPACE_*`) continua no CLI
- fallback Playwright / cópia de perfil do navegador não existe na extensao
- a extensao baixa arquivos em `Downloads/<pasta-configurada>/`; ela não grava em `./output`

### Como carregar no Chrome

```bash
# 1. Copiar a dependência jsPDF e validar a extensao
npm run build:extension

#    O build tambem gera chrome-extension/generated-project-env.js
#    com snapshot dos WORKSPACE_* lidos do .env da raiz do projeto

# 2. No Chrome
# chrome://extensions
# -> Developer mode
# -> Load unpacked
# -> selecionar a pasta ./chrome-extension
```

### Como usar

1. Abra **Options** da extensao e preencha `JIRA_BASE_URL`
2. Escolha a autenticacao:
   - `JIRA_TOKEN` como prioridade
   - ou `JIRA_USER` + `JIRA_PASSWORD`
   - ou deixe vazio para usar a sessao ja aberta no navegador
3. Opcionalmente configure `ZENDESK_*` para habilitar a API direta como fallback adicional
4. Defina a pasta relativa dentro de `Downloads/`
5. Em **Options**, escolha a IA preferida para os prompts (`Claude`, `ChatGPT`, `Gemini` ou `Copilot`)
6. Ainda em **Options**, revise os templates disponiveis:
   - visualize o template padrao do sistema
   - veja qual arquivo fisico define cada template
   - opcionalmente sobrescreva a base ou adicione regras complementares por template
7. Abra o popup da extensao:
   - use a issue detectada da aba atual
   - ou informe uma ou mais issue keys
   - escolha entre `Completo` e `Jira only`
8. Clique em **Exportar** e acompanhe o resultado no popup
9. Use **Prompt Documentacao**, **Prompt Diagnostico** ou **Prompt Diagnostico + Contexto Fontes** para preparar o prompt desejado e abrir a IA escolhida com o conteudo ja copiado
10. Consulte o bloco de **Historico recente** para revisar exportacoes anteriores

> Se os valores `WORKSPACE_*` nao aparecerem automaticamente no plugin apos alterar o `.env`, rode `npm run build:extension` novamente e recarregue a extensao no `chrome://extensions`.

> Os campos `WORKSPACE_*` exibidos nas options nao bastam, sozinhos, para leitura local. Para que `Prompt Diagnostico + Contexto Fontes` anexe trechos reais, tambem e preciso vincular a permissao de leitura do navegador para os diretorios de ERP e, se aplicavel, mobile.

> Se `JIRA_TOKEN` ficar vazio, a extensao tenta usar a sessão já aberta no navegador.

### O que fica disponivel pelo popup

- iniciar exportacao de uma fila de issues sem sair do navegador
- gerar PDF anonimizado e metadata JSON em `Downloads/<pasta>`
- operar em modo `Completo` ou `Jira only`
- ver rapidamente se a extensao esta usando token, usuario/senha ou sessao do navegador
- preparar prompts de documentacao e diagnostico sem reenviar dados brutos do ticket
- revisar historico local das ultimas exportacoes e limpar esse historico quando necessario

### Geracao de prompts com IA

O popup disponibiliza **Prompt Documentacao**, **Prompt Diagnostico** e **Prompt Diagnostico + Contexto Fontes** para a issue processada, com ou sem ticket Zendesk vinculado. O fluxo faz o seguinte:

- busca novamente a issue e os comentarios relacionados no modo selecionado
- monta um texto anonimizado do ticket para servir de base ao documento
- copia para a area de transferencia o prompt correspondente ao template selecionado
- abre automaticamente a IA escolhida nas options

Os templates podem ser revisados nas options e possuem arquivos fisicos separados:

- `chrome-extension/prompt-templates.js` para `Prompt Documentacao`
- `chrome-extension/prompt-template-diagnostic.js` para `Prompt Diagnostico`
- `chrome-extension/prompt-template-diagnostic.js` tambem registra `Prompt Diagnostico + Contexto Fontes`

O `Prompt Documentacao` instrui a IA a:

- gerar `Problema` e `Solucao` em formato resumido, curto, objetivo e funcional
- devolver `Assuntos Relacionados` sempre com `Titulo` e `URL` completa de referencia
- nao inventar links quando nao houver alta confianca na URL

O `Prompt Diagnostico` replica o contrato de analise de negocio do CLI:

- mantem as 13 secoes da analise de negocio
- exige `Riscos relacionados ao contexto do caso`
- deixa explicito quando o contexto do plugin nao for suficiente para localizar o ponto exato no codigo

O `Prompt Diagnostico + Contexto Fontes` faz o mesmo e, quando os diretorios locais estiverem configurados e autorizados no navegador, acrescenta trechos de codigo e contexto local relacionados a issue.

Se nenhum snippet real puder ser anexado, o plugin agora interrompe o fluxo com mensagem explicita. Isso evita gerar um prompt com o rotulo "Contexto Fontes" sem fontes reais do workspace.

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
| `WORKSPACE_ERP_BACKEND_DIR` | Raiz do código-fonte do ERP / back-end para análise cruzada de causa raiz |
| `WORKSPACE_MOBILE_FRONTEND_DIR` | Raiz do app mobile / front-end. O diagnóstico só usa esse workspace quando o ticket indicar contexto de app mobile, Minha Produção, celular, tablet ou sinônimos |
| `WORKSPACE_ERP_INCLUDE_DIR` | Raiz dos includes usados por fontes `.prw/.prx/.tlpp`; o diagnóstico usa `.ch` referenciados via `#include` para enriquecer a correlação por conteúdo |
| `WORKSPACE_EXTENSIONS` | Extensões de arquivo a incluir (padrão: `js,ts,java,py,cs,go,kt,jsx,tsx,vue,rb,php,prx,prw,tlpp`) |

Quando `WORKSPACE_ERP_INCLUDE_DIR` está configurado, arquivos `.prw`, `.prx` e `.tlpp` passam a considerar o conteúdo dos `.ch` incluídos no cabeçalho apenas para melhorar o rankeamento por conteúdo. O trecho enviado ao LLM continua sendo do fonte principal.

Em terminal interativo, `node src/diagnostics.js ...` detecta `JIRA_TOKEN`, `WORKSPACE_ERP_BACKEND_DIR`, `WORKSPACE_MOBILE_FRONTEND_DIR` e `WORKSPACE_ERP_INCLUDE_DIR` ausentes ou inválidos e pergunta se você quer preenchê-los na hora. Quando você confirma um valor, ele é aplicado imediatamente na execução atual, gravado no `.env` do projeto e também persistido no ambiente do usuário do Windows com `setx`.

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
| `npm run build:icons` | `node scripts/generate-icons.js` | Regenera os ícones PNG da extensão Chrome |

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
| Campos estruturados | Assignee, Reporter, autores de comentários, empresa cliente (`customfield_11071`), identificadores sensíveis (`customfield_11085`, `customfield_11053`, `customfield_11038`) | Alta |
| Bloco de assinatura | "Att, João da Silva \| Gerente \| Acme Ltda" | Alta |
| Sufixo jurídico | "TechCorp Ltda", "DataBrasil S.A.", "Farmacêutica XYZ" | Alta |
| Gatilho empresa | "cliente Acme", "reunião com a TechBrasil" | Média |
| Gatilho pessoa | "gerente Bruno", "Dra. Ana Paula", "atribuído ao Ricardo" | Média |
| Regex estrutural | CPF, CNPJ, RG, PIS/PASEP, placa, passaporte, título de eleitor, e-mail, telefone, CEP, senha | Determinístico |

> **Nomes compostos com preposição** são detectados corretamente em todos os detectores: `João da Silva`, `Maria dos Santos`, `Ana de Oliveira e Souza`.

Refinamentos recentes da anonimização:

- o extrator contextual passou a reconhecer melhor papéis de triagem, como `triagista`, `triador(a)` e frases como `triagem feita por`
- a detecção de pessoas agora filtra melhor palavras comuns e vocabulário técnico para reduzir falso positivo após gatilhos contextuais
- a regex de `RG` passou a ignorar padrões inseridos dentro de URLs e query strings

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
| `customfield_11069` | `rotina` no PDF e metadata | Rotina relacionada à issue (ex: "QIPA215 - RESULTADOS") — campo não-PII exibido no PDF |
| `customfield_11078` | `modulo` no PDF e metadata | Módulo da classificação interna (ex: "INSPEÇÃO DE PROCESSOS (SIGAQIP)") — campo não-PII exibido no PDF |
| `customfield_11071` | anonimização — `[EMPRESA-N]` | Nome da empresa cliente; registrado no EntityMap e nulificado na saída |
| `customfield_11085` | anonimização — `[EMPRESA-N]` | Código de conta/CRM do cliente (string pura); mascarado em todo o texto e nulificado na saída |
| `customfield_11053` | anonimização — `[EMPRESA-N]` | Campo identificador do cliente; mascarado em todo o texto e nulificado na saída |
| `customfield_11038` | anonimização — `[EMPRESA-N]` | Código do cliente (customFieldOption, ex: "TFECXK"); mascarado em todo o texto e nulificado na saída |

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
  "rotina": "QIPA215 - RESULTADOS",
  "modulo": "INSPEÇÃO DE PROCESSOS (SIGAQIP)",
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
- Se `JIRA_TOKEN` ou `WORKSPACE_ERP_BACKEND_DIR` / `WORKSPACE_MOBILE_FRONTEND_DIR` estiverem ausentes ou inválidos, o CLI alerta sobre a perda de contexto local antes de continuar
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
