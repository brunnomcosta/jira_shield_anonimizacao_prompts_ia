/**
 * entityMap.js
 * Mapa de tokens consistentes para anonimização LGPD.
 *
 * Garante que:
 *  - O mesmo nome sempre gera o mesmo token dentro de uma issue
 *  - Substituição ocorre do nome mais longo para o mais curto (evita substituição parcial)
 *  - Tokens são sequenciais e legíveis: [PESSOA-1], [EMPRESA-1]
 */

const WB_CHARS = 'A-Za-zÃ¡Ã©Ã­Ã³ÃºÃ¢ÃªÃ®Ã´Ã»Ã£ÃµÃ Ã§ÃÃ‰ÃÃ“ÃšÃ‚ÃŠÃŽÃ”Ã›ÃƒÃ•Ã€Ã‡0-9_';

export class EntityMap {
  constructor() {
    this.pessoas  = new Map(); // "joao silva" → "[PESSOA-1]"
    this.empresas = new Map(); // "acme ltda"  → "[EMPRESA-1]"
    this.counters = { pessoa: 0, empresa: 0 };
  }

  registerPessoa(nome) {
    if (!nome || nome.trim().length < 2) return null;
    const key = nome.trim().toLowerCase();
    if (!this.pessoas.has(key)) {
      this.counters.pessoa++;
      this.pessoas.set(key, `[PESSOA-${this.counters.pessoa}]`);
    }
    return this.pessoas.get(key);
  }

  registerEmpresa(nome) {
    if (!nome || nome.trim().length < 2) return null;
    const key = nome.trim().toLowerCase();
    if (!this.empresas.has(key)) {
      this.counters.empresa++;
      this.empresas.set(key, `[EMPRESA-${this.counters.empresa}]`);
    }
    return this.empresas.get(key);
  }

  getPessoa(nome) {
    if (!nome) return '[PESSOA-?]';
    return this.pessoas.get(nome.trim().toLowerCase()) ?? '[PESSOA-?]';
  }

  /**
   * Aplica o mapa inteiro em um texto.
   * Ordena por comprimento decrescente para evitar substituição parcial.
   */
  applyToText(text) {
    if (!text) return text;
    let result = text;

    const sortedByLength = (map) =>
      [...map.entries()].sort((a, b) => b[0].length - a[0].length);

    for (const [nome, token] of sortedByLength(this.pessoas)) {
      const escaped = nome.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      result = result.replace(new RegExp(`(?<![${WB_CHARS}])${escaped}(?![${WB_CHARS}])`, 'gi'), token);
    }

    for (const [nome, token] of sortedByLength(this.empresas)) {
      const escaped = nome.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      result = result.replace(new RegExp(`(?<![${WB_CHARS}])${escaped}(?![${WB_CHARS}])`, 'gi'), token);
    }

    return result;
  }

  getSummary() {
    return {
      totalPessoas: this.counters.pessoa,
      totalEmpresas: this.counters.empresa,
    };
  }
}
