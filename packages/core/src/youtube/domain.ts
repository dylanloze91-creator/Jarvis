export type VideoDomain = 'finance' | 'general';

/**
 * Mots qui, ensemble, indiquent une vidéo bourse / finance.
 * Le seuil évite de basculer sur un seul mot isolé.
 */
const FINANCE_KEYWORDS = [
  'bourse',
  'action',
  'actions',
  'dividende',
  'etf',
  'indice',
  'cac 40',
  's&p',
  'nasdaq',
  'inflation',
  'taux',
  'bce',
  'fed',
  'crypto',
  'bitcoin',
  'portefeuille',
  'rendement',
  'per',
  'bénéfice',
  'chiffre d\'affaires',
  'obligation',
  'trading',
  'investir',
  'valorisation',
];

const FINANCE_KEYWORD_HITS = 4;

export const FINANCE_DISCLAIMER =
  "Ceci est un résumé de la vidéo, pas un conseil d'investissement.";

/** Finance seulement si plusieurs termes du domaine sont vraiment présents. */
export function detectVideoDomain(text: string): VideoDomain {
  const hits = FINANCE_KEYWORDS.filter((keyword) => keywordHit(text, keyword)).length;
  return hits >= FINANCE_KEYWORD_HITS ? 'finance' : 'general';
}

function keywordHit(text: string, keyword: string): boolean {
  const escaped = keyword.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\s+/g, '\\s+');
  return new RegExp(`(?:^|[^\\p{L}\\p{N}])${escaped}(?=$|[^\\p{L}\\p{N}])`, 'iu').test(text);
}
