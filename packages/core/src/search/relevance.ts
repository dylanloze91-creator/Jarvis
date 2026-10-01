import type { SearchResultItem } from './types.js';

function normalize(text: string): string {
  return text
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
}

const STOPWORDS = new Set(
  (
    'le la les l un une des du de d au aux a à et ou en dans sur pour par avec sans ce cet cette ces ' +
    'qui que quoi qu quel quelle quels quelles quand comment combien pourquoi où ou est sont été etre être ' +
    'il elle ils elles on je tu nous vous me te se mon ma mes ton ta tes son sa ses leur leurs y ne pas plus ' +
    'c ca ça cest s se sait fait faire peux peut dis dit moi toi jarvis stp svp merci bien très tres ' +
    'actuel actuelle actuels actuelles actuellement moment maintenant aujourd hui aujourdhui ' +
    'the of and or in on for to is are what who when how which latest current'
  )
    .split(/\s+/)
    .map(normalize),
);

export function isStopword(word: string): boolean {
  return STOPWORDS.has(normalize(word));
}

/**
 * Mots-clés d'une question (« Quelle est la dernière version de Node.js ? »
 * → « dernière version Node.js ») pour les moteurs qui cherchent mot à mot,
 * comme Wikipédia. Casse et accents gardés ; années de fraîcheur retirées.
 */
export function keywordQuery(query: string): string {
  const words = query
    .replace(/[?!,;:«»"()]/g, ' ')
    .split(/\s+/)
    .map((word) => word.replace(/^(?:l|d|qu|c|j|n|s)['’]/iu, '').replace(/\.$/, ''))
    .filter(
      (word) =>
        word &&
        (/^\p{Lu}$/u.test(word) || (!isStopword(word) && !FRESHNESS_WORDS.has(normalize(word)))) &&
        !/^(?:19|20)\d\d$/.test(word),
    );
  return words.join(' ').trim() || query.trim();
}

/** Mots de fraîcheur : utiles au moteur web, ils égarent la recherche plein texte de Wikipédia. */
const FRESHNESS_WORDS = new Set(
  'dernier derniere derniers dernieres nouveau nouvelle nouveaux nouvelles version versions mise jour maj sortie sorti release prochain prochaine quand sort'
    .split(/\s+/),
);

function stem(token: string): string {
  if (token.length > 4 && /(?:es|s|x)$/.test(token)) return token.replace(/(?:es|s|x)$/, '');
  return token;
}

/** Termes porteurs de sens d'une requête : sans mots outils, accents ni pluriels. */
export function significantTokens(text: string): string[] {
  const tokens = normalize(text)
    .split(/[^a-z0-9]+/)
    .filter((token) => token && !STOPWORDS.has(token))
    .filter((token) => token.length >= 3 || /\d/.test(token) || token === 'js' || token === 'f1')
    .map(stem);
  return [...new Set(tokens)];
}

export function relevanceScore(queryTokens: string[], item: SearchResultItem): number {
  if (queryTokens.length === 0) return 1;
  const haystack = new Set(
    significantTokens(`${item.title} ${item.snippet} ${item.url} ${item.publisher ?? ''}`),
  );
  const hits = queryTokens.filter((token) => haystack.has(token)).length;
  return hits / queryTokens.length;
}

/**
 * Retire les résultats qui ne partagent presque rien avec la requête. Bing
 * HTML, depuis une adresse jugée robotique, renvoie des pages sans rapport
 * (Outlook pour « dernière version de Node.js ») avec un statut 200 : sans ce
 * filtre, elles passeraient pour des sources.
 */
export function filterRelevant(
  query: string,
  results: SearchResultItem[],
  minScore = 0.34,
): SearchResultItem[] {
  // L'année ajoutée pour la fraîcheur ne doit pas écarter une page officielle non datée.
  const tokens = significantTokens(query).filter((token) => !/^(?:19|20)\d\d$/.test(token));
  if (tokens.length === 0) return results;
  const threshold = tokens.length === 1 ? 1 : minScore;
  return results.filter((item) => relevanceScore(tokens, item) >= threshold);
}
