/**
 * nerDetector.js
 * Regex estrutural para dados sensíveis.
 * Executado APÓS a aplicação do EntityMap.
 */

const PATTERNS = [
  { rx: /[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}/g,                  tag: '[EMAIL]'    },
  { rx: /\b\d{3}\.?\d{3}\.?\d{3}[-–]?\d{2}\b/g,                                tag: '[CPF]'      },
  { rx: /\b\d{2}\.?\d{3}\.?\d{3}\/?\.?\d{4}[-–]?\d{2}\b/g,                     tag: '[CNPJ]'     },
  { rx: /\(?\d{2}\)?\s?\d{4,5}[-–\s]?\d{4}\b/g,                                tag: '[TELEFONE]' },
  { rx: /\b\d{5}[-–]\d{3}\b/g,                                                  tag: '[CEP]'      },
  // RG — formatos estaduais comuns (XX.XXX.XXX-X ou XXXXXXXXX com dígito verificador letra/número)
  // Lookbehind negativo exclui números dentro de URLs/query strings (ex: pageId=606095034)
  { rx: /(?<![=\/#&?@])\b\d{2}\.?\d{3}\.?\d{3}[-–]?[0-9Xx]\b/g,               tag: '[RG]'       },
  // PIS / PASEP
  { rx: /\b\d{3}\.?\d{5}\.?\d{2}[-–]?\d\b/g,                                   tag: '[PIS]'      },
  // Placa veicular — formato antigo (ABC-1234) e Mercosul (ABC1D23)
  { rx: /\b[A-Z]{3}[-\s]?\d{4}\b/g,                                             tag: '[PLACA]'    },
  { rx: /\b[A-Z]{3}\d[A-Z]\d{2}\b/g,                                            tag: '[PLACA]'    },
  // Título de eleitor (12 dígitos)
  { rx: /\b\d{4}\s?\d{4}\s?\d{4}\b/g,                                           tag: '[TITULO_ELEITOR]' },
  // Passaporte brasileiro (XX000000 ou XX0000000)
  { rx: /\b[A-Z]{2}\d{6,7}\b/g,                                                 tag: '[PASSAPORTE]' },
  // Senhas e credenciais explícitas em texto
  //   "senha: valor", "password=abc123", "api_key: xyz", "token: abc", "secret: 123"
  { rx: /\b(?:senha|password|passwd|pwd|pass|api[-_]?key|apikey|secret(?:[-_]key)?|client[-_]secret|access[-_]token|auth[-_]token|bearer[-_]token|private[-_]key)\s*[:=]\s*\S+/gi, tag: '[SENHA]' },
  // Telefone com prefixo internacional — "+55 11 99999-1234", "+55(11)98765-4321"
  { rx: /\+\d{1,3}[\s\-]?\(?\d{2}\)?[\s\-]?\d{4,5}[\s\-]?\d{4}\b/g,            tag: '[TELEFONE]'   },
  // URL com segmento de usuário — "https://app.com/users/joao.silva", "/profile/ana123"
  { rx: /https?:\/\/[^\s/]+\/(?:users?|perfil|profile|u|account|conta)\/[\w.%@+\-]{2,}/gi, tag: '[URL_USUARIO]' },
];

export function anonymizePatterns(text) {
  if (!text) return text;
  return PATTERNS.reduce((acc, { rx, tag }) => {
    rx.lastIndex = 0;
    return acc.replace(rx, tag);
  }, text);
}
