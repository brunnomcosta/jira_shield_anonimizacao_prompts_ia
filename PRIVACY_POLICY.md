# Política de Privacidade

Última atualização: 28 de março de 2026

Esta Política de Privacidade descreve como o projeto SHIELD trata dados quando utilizado por meio do CLI em `src/` e da extensão Chrome em `chrome-extension/`.

## 1. Escopo

O SHIELD é uma ferramenta voltada à exportação, sanitização, enriquecimento técnico e análise assistida de evidências relacionadas a issues. O projeto foi desenhado para priorizar processamento local e preservar mecanismos de anonimização antes de qualquer uso opcional de serviços externos configurados pelo operador.

## 2. Dados que podem ser tratados

Dependendo da configuração e das permissões concedidas pelo usuário, o SHIELD pode tratar:

- identificadores de issues e metadados associados;
- conteúdo de tickets, comentários e anexos oriundos de Jira e Zendesk;
- trechos de código e caminhos de arquivos do workspace local usados como evidência técnica;
- dados operacionais necessários para autenticação e integração com serviços configurados pelo operador;
- artefatos locais gerados pelo próprio fluxo, como PDF anonimizado, `metadata.json`, relatórios de diagnóstico e logs.

O projeto não tem como objetivo comercializar, perfilar usuários finais ou monetizar dados pessoais.

## 3. Como os dados são usados

Os dados são tratados exclusivamente para fins compatíveis com a finalidade principal da ferramenta, incluindo:

- exportar evidências de issues com sanitização e anonimização;
- consolidar contexto técnico e operacional para investigação;
- executar diagnósticos de negócio ou de qualidade LGPD;
- permitir uso local da extensão Chrome e do CLI com as integrações configuradas pelo operador.

## 4. Processamento local e compartilhamento

Sempre que possível, o tratamento ocorre localmente no ambiente do usuário.

Quando o operador configura integrações de terceiros, o SHIELD pode enviar apenas os dados estritamente necessários para essas integrações funcionarem, por exemplo:

- Jira;
- Zendesk;
- provedores de LLM configurados pelo operador;
- Azure DevOps Search;
- Google Drive ou outros serviços explicitamente habilitados.

O operador é responsável por avaliar se está autorizado a usar essas integrações com os dados processados e por configurar o ambiente de forma compatível com LGPD, políticas internas e obrigações contratuais aplicáveis.

## 5. Base de minimização e responsabilidade do operador

O projeto busca reduzir exposição de dados por meio de sanitização, uso local e limitação de contexto. Ainda assim:

- a qualidade da anonimização depende da configuração, da cobertura do fluxo e do conteúdo de origem;
- o operador deve revisar permissões, integrações, prompts e artefatos gerados antes de compartilhar resultados externamente;
- nenhuma funcionalidade deve ser interpretada como garantia absoluta de anonimização, conformidade regulatória ou irreversibilidade de dados.

## 6. Retenção e armazenamento

Os artefatos são armazenados localmente, conforme a configuração do ambiente do usuário, incluindo a pasta `output/` e outros arquivos gerados pelo fluxo.

Este repositório não opera um serviço central para retenção contínua de dados dos usuários. A retenção prática depende:

- do ambiente local do operador;
- dos serviços de terceiros integrados;
- das políticas internas da organização que utiliza a ferramenta.

## 7. Credenciais e segredos

Credenciais e segredos devem ser mantidos fora do versionamento, por exemplo em `.env` local ou em mecanismos equivalentes de gerenciamento seguro. O projeto não recomenda publicar tokens, chaves de API, cookies, dumps de sessão ou dados pessoais em issues, commits ou pull requests.

## 8. Direitos e conformidade

Se você utilizar o SHIELD para tratar dados pessoais, você é responsável por assegurar que possui base legal adequada, finalidade legítima e controles internos compatíveis com a legislação aplicável, incluindo a LGPD quando pertinente.

O projeto é disponibilizado como software e documentação de apoio. Ele não substitui avaliação jurídica, de segurança, privacidade ou compliance.

## 9. Extensão Chrome

Se publicada na Chrome Web Store, a extensão deverá manter descrição, permissões solicitadas e fluxo de dados coerentes com esta política e com a finalidade principal declarada ao usuário.

## 10. Alterações nesta política

Esta política pode ser atualizada a qualquer momento para refletir mudanças no projeto, em integrações suportadas ou em requisitos de publicação e conformidade. A versão publicada no repositório é a referência mais recente.

## 11. Contato

Para dúvidas sobre privacidade, uso de dados ou solicitação de correções documentais, utilize o canal público do repositório ou o canal privado indicado pelos mantenedores, quando disponível.
