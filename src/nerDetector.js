/**
 * nerDetector.js
 * Regex estrutural para dados sensiveis.
 * Executado apos a aplicacao do EntityMap.
 */

import { maskSensitiveText } from './sensitiveTextSanitizer.js';

export function anonymizePatterns(text) {
  return maskSensitiveText(text);
}
