import { describeAttempts } from '../search/chain.js';
import { formatCurrentDateTime, formatSourceDate } from '../search/dates.js';
import { sourceLabel, type CurrentSearchResult, type CurrentSource } from '../search/currentSearch.js';

const FOOTER_HEADER = 'Sources (recherche web du';
const FAILURE_HEADER = 'Détail de la recherche (';
const MAX_CITED = 4;

/** Date et heure du tour, ajoutées au prompt système des tours de recherche. */
export function currentDatePrompt(now: Date = new Date(), timeZone?: string): string {
  return `Date et heure actuelles : ${formatCurrentDateTime(now, timeZone)} (heure du PC). Toute information « actuelle » se rapporte à cette date.`;
}

export const CURRENT_INFO_TURN_PROMPT =
  "PROTOCOLE ACTUALITÉ : Jarvis vient de chercher sur Internet pour cette question (outil web_search_current) ; les résultats sont dans le message de l'outil. " +
  "Réponds d'après ces résultats, pas de mémoire : tes connaissances s'arrêtent avant aujourd'hui et peuvent être périmées. " +
  'Nomme la source et sa date dans ta phrase. Si les résultats ne contiennent pas la réponse, dis-le simplement. ' +
  "Tu peux lire une page avec fetch_page si un extrait ne suffit pas. Réponds brièvement : quelques phrases, ou une courte liste s'il y a plusieurs titres. N'écris pas de liens.";

function normalizeForMatch(text: string): string {
  return text
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
}

/**
 * Sources effectivement citées : celles dont le média, le domaine ou le
 * numéro (« [2] ») apparaît dans la réponse. À défaut, les premières : la
 * réponse vient de ces résultats, qui doivent rester vérifiables.
 */
export function citedSources(answer: string, sources: CurrentSource[]): CurrentSource[] {
  const haystack = normalizeForMatch(answer);
  const compactHaystack = haystack.replace(/[^a-z0-9]/g, '');
  const cited = sources.filter((source) => {
    if (new RegExp(`\\[${source.index}\\]`).test(answer)) return true;
    const names = [
      source.publisher,
      source.publisher?.replace(/\.(?:fr|com|net|org|eu|be|ch|ca)$/i, ''),
      source.domain,
      source.domain.replace(/\.[a-z]{2,}$/i, ''),
      // « fr.wikipedia.org » → « wikipedia », « lemonde.fr » → « lemonde »
      source.domain.split('.').slice(-2, -1)[0],
    ]
      .filter((name): name is string => Boolean(name && name.length >= 3))
      .map(normalizeForMatch);
    return names.some((name) => {
      if (haystack.includes(name)) return true;
      const compact = name.replace(/[^a-z0-9]/g, '');
      return compact.length >= 5 && compactHaystack.includes(compact);
    });
  });
  return (cited.length > 0 ? cited : sources.slice(0, 3)).slice(0, MAX_CITED);
}

/**
 * Bloc ajouté sous la réponse : sources citées avec lien et date. Vide si la
 * réponse contient déjà tous ces liens. Retiré de la synthèse vocale par
 * `stripSourcesFooter`.
 */
export function formatSourcesFooter(
  result: CurrentSearchResult,
  answer: string,
  timeZone?: string,
): string {
  if (result.sources.length === 0) return '';
  const now = new Date(result.searchedAt);
  const named = citedSources(answer, result.sources);
  // La source du passage clé est la preuve la plus directe : toujours listée.
  const key = result.sources.find((source) => source.index === result.keyPassage?.index);
  const withKey = key && !named.includes(key) ? [key, ...named].slice(0, MAX_CITED) : named;
  const cited = withKey
    .sort((a, b) => a.index - b.index)
    .filter((source) => !answer.includes(source.url));
  if (cited.length === 0) return '';
  // Liste Markdown : la bulle de réponse est rendue en Markdown, un simple retour à la ligne s'y efface.
  const lines = cited.map((source) => {
    const date = formatSourceDate(source.publishedAt, now, timeZone);
    return `- [${source.index}] ${source.title} — ${sourceLabel(source)}${date ? `, ${date}` : ''} — ${source.url}`;
  });
  return `\n\n${FOOTER_HEADER} ${formatCurrentDateTime(now, timeZone)}) :\n${lines.join('\n')}`;
}

/**
 * Réponse quand la recherche n'a rien donné : dit clairement l'échec au lieu
 * d'une réponse de mémoire présentée comme actuelle.
 */
export function currentInfoFailureReply(
  result: CurrentSearchResult | null,
  technicalDetail?: string,
  timeZone?: string,
): string {
  const lead =
    "Je n'ai pas pu faire la recherche sur Internet, donc je ne peux pas te donner une information à jour. " +
    'Je préfère ne pas répondre de mémoire : ce serait peut-être périmé. ' +
    'Réessaie dans un instant, ou ajoute une clé Brave Search ou Tavily dans Réglages, onglet Recherche et mémoire.';
  const when = formatCurrentDateTime(result ? new Date(result.searchedAt) : new Date(), timeZone);
  const reasons = result ? describeAttempts(result.attempts) : '';
  const detail = reasons || technicalDetail?.trim() || 'aucun fournisseur n’a répondu.';
  return `${lead}\n\n${FAILURE_HEADER}${when}) :\n${detail}`;
}

/**
 * Texte à dire à voix haute : sans le bloc des sources ni le détail technique
 * ajoutés par Jarvis (les liens lus par la synthèse allongeraient la réponse
 * et retarderaient la fenêtre de suivi). Tout autre texte est inchangé.
 */
export function stripSourcesFooter(text: string): string {
  const markers = [`\n\n${FOOTER_HEADER} `, `\n\n${FAILURE_HEADER}`];
  let cut = -1;
  for (const marker of markers) {
    const index = text.lastIndexOf(marker);
    if (index >= 0 && (cut < 0 || index < cut)) cut = index;
  }
  return cut >= 0 ? text.slice(0, cut).trimEnd() : text;
}
