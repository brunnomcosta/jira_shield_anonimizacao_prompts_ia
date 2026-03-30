# Política de Segurança

Última atualização: 28 de março de 2026

Este documento descreve como reportar vulnerabilidades relacionadas ao projeto SHIELD e quais expectativas de tratamento responsável se aplicam a este repositório.

## Escopo

O escopo inclui:

- CLI em `src/`;
- extensão Chrome em `chrome-extension/`;
- scripts de build e automação do repositório;
- fluxos locais de exportação, sanitização, diagnóstico e integração suportados pelo projeto.

Questões puramente operacionais de ambientes de terceiros, contas individuais, credenciais já comprometidas fora do projeto ou má configuração local do usuário podem exigir tratamento separado.

## Como reportar uma vulnerabilidade

Não publique detalhes de exploração, segredos, dados pessoais ou amostras sensíveis em issue pública.

Sempre que possível:

- use o canal privado de reporte do repositório, se estiver habilitado;
- na ausência de canal privado, contate os mantenedores antes de qualquer divulgação pública;
- envie descrição objetiva do impacto, pré-requisitos, passos de reprodução, versões afetadas e sugestões de mitigação, se houver.

## O que incluir no reporte

Inclua, quando possível:

- componente afetado;
- cenário de ameaça e impacto esperado;
- passos mínimos para reprodução;
- evidências sanitizadas;
- versão, commit ou branch afetada;
- hipótese de correção ou contenção.

Nunca envie:

- tokens, senhas, cookies, segredos de `.env`;
- anexos com dados pessoais sem sanitização;
- dumps completos de conteúdo sensível se um exemplo reduzido e anonimizado for suficiente.

## Tratamento responsável

Os mantenedores podem:

- confirmar recebimento;
- solicitar contexto adicional sanitizado;
- classificar severidade e escopo;
- preparar correção, mitigação ou documentação complementar;
- coordenar divulgação responsável quando aplicável.

Prazos de resposta e correção dependem da disponibilidade dos mantenedores e da complexidade do problema. Este repositório não assume SLA contratual.

## Boas práticas esperadas

Ao usar ou contribuir com o projeto:

- mantenha segredos fora do versionamento;
- respeite o princípio do menor privilégio para integrações e permissões;
- valide mudanças que afetem anonimização, exportação, prompts, busca de contexto e envio a serviços externos;
- preserve garantias existentes de sanitização e não reduza controles sem justificativa técnica clara.

## Safe Harbor

Pesquisas realizadas de boa-fé, com foco em reporte responsável e sem exploração abusiva contra terceiros, serão tratadas como colaboração de segurança. Isso não autoriza acesso indevido, extração massiva de dados, degradação de serviço, violação de lei ou quebra de contratos aplicáveis.

## Versões suportadas

Como regra geral, o foco de correção recai sobre a versão atualmente mantida no branch principal e sobre mudanças ainda não publicadas definitivamente. Correções retroativas para snapshots antigos ou forks não são garantidas.
