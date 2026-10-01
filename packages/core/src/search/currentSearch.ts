import { ageInDays, formatCurrentDateTime, formatSourceDate } from './dates.js';
import { hostnameOf } from './http.js';
import {
  dedupeResults,
  newsProviderOrder,
  searchAllMerged,
  searchWithFallback,
  webProviderOrder,
  type SearchAttempt,
} from './chain.js';
import { significantTokens } from './relevance.js';
import { fetchOpenMeteoWeather, OPEN_METEO_LABEL } from './providers/openMeteo.js';
import type { SearchProviderRegistry } from './registry.js';
import type { SearchFreshness, SearchProviderConfig, SearchResultItem } from './types.js';

export interface CurrentSearchRequest {
  question: string;
  query: string;
  newsQuery: string;
  freshness: SearchFreshness;
  preferNews: boolean;
  city?: string;
}

export interface CurrentSource {
  index: number;
  title: string;
  url: string;
  snippet: string;
  domain: string;
  publisher?: string;
  publishedAt?: string;
  providerId: string;
  providerLabel: string;
  kind: 'news' | 'web' | 'weather';
  /** Passage de la page elle-même, quand elle a pu être lue. */
  pageExcerpt?: string;
}

export interface CurrentSearchResult {
  searchedAt: string;
  question: string;
  query: string;
  newsQuery: string;
  sources: CurrentSource[];
  attempts: SearchAttempt[];
  providersUsed: string[];
  /** Phrase lue sur une page qui répond le mieux à la question (copiée, jamais rédigée). */
  keyPassage?: { index: number; text: string };
}

export interface CurrentSearchDeps {
  registry: SearchProviderRegistry;
  config: SearchProviderConfig;
  now?: () => Date;
  signal?: AbortSignal;
  fetchImpl?: typeof fetch;
  /** Remplace Open-Meteo dans les tests. */
  weather?: (city: string, signal?: AbortSignal) => Promise<SearchResultItem>;
  /**
   * Lecture d'une page (texte lisible). Absente : pas de lecture. L'appli
   * fournit une lecture qui refuse les adresses privées.
   */
  readPage?: (url: string, signal?: AbortSignal) => Promise<{ text: string }>;
}

const MAX_SOURCES = 7;
const PAGES_READ = 2;
const PAGE_READ_TIMEOUT_MS = 6_000;
const EXCERPT_CHARS = 600;
/** Au-delà, un article n'est plus « l'actualité » d'une question du jour. */
const STALE_NEWS_DAYS = 45;

/**
 * Recherche pour une question d'actualité : flux d'actualité datés et web en
 * parallèle (chacun avec sa chaîne de repli), plus la météo Open-Meteo quand
 * une ville est nommée. Les sources sont numérotées, datées si possible, et
 * les plus récentes passent d'abord parmi les articles.
 */
export async function searchCurrentInfo(
  request: CurrentSearchRequest,
  deps: CurrentSearchDeps,
): Promise<CurrentSearchResult> {
  const now = deps.now?.() ?? new Date();
  const webOrder = webProviderOrder(deps.registry, deps.config);
  const newsOrder = newsProviderOrder(deps.registry, deps.config);

  const [web, news, weather] = await Promise.all([
    searchWithFallback(deps.registry, webOrder, deps.config, {
      query: request.query,
      limit: 5,
      signal: deps.signal,
    }),
    // Les flux d'actualité cherchent dans le corps des articles : un titre sans les mots
    // de la requête reste pertinent (« Lecornu présente le budget » pour « Premier ministre »).
    searchAllMerged(deps.registry, newsOrder, deps.config, {
      query: request.newsQuery,
      limit: 8,
      freshness: request.freshness,
      signal: deps.signal,
      minRelevance: 0.25,
      trusted: ['google-news', 'bing-news'],
    }),
    request.city ? weatherSource(request.city, deps) : Promise.resolve(null),
  ]);

  const newsItems = freshNews(news.results, now).map((item) => ({ item, kind: 'news' as const, id: news.providerId, label: news.label }));
  const webItems = web.results.map((item) => ({ item, kind: 'web' as const, id: web.providerId, label: web.label }));
  const weatherItems = weather?.item
    ? [{ item: weather.item, kind: 'weather' as const, id: 'open-meteo', label: OPEN_METEO_LABEL }]
    : [];

  // Météo mesurée pour la ville : les pages web n'apportent que du bruit, deux articles au plus.
  const ordered = weatherItems.length
    ? [...weatherItems, ...newsItems.slice(0, 2)]
    : request.preferNews
      ? [...newsItems.slice(0, 4), ...webItems.slice(0, 3), ...newsItems.slice(4), ...webItems.slice(3)]
      : [...webItems.slice(0, 4), ...newsItems.slice(0, 3), ...webItems.slice(4), ...newsItems.slice(3)];

  const unique = dedupeResults(ordered.map((entry) => entry.item));
  const sources: CurrentSource[] = [];
  for (const entry of ordered) {
    if (!unique.includes(entry.item) || sources.length >= MAX_SOURCES) continue;
    sources.push({
      index: sources.length + 1,
      title: entry.item.title,
      url: entry.item.url,
      snippet: entry.item.snippet,
      domain: entry.item.source || hostnameOf(entry.item.url) || '',
      publisher: entry.item.publisher,
      publishedAt: entry.item.publishedAt,
      providerId: entry.id,
      providerLabel: entry.label,
      kind: entry.kind,
    });
  }

  const keyPassage = deps.readPage ? await readTopPages(sources, request, deps) : undefined;

  const attempts = [...(weather?.attempt ? [weather.attempt] : []), ...news.attempts, ...web.attempts];
  const providersUsed = [
    ...new Set(sources.flatMap((source) => source.providerLabel.split(' + '))),
  ];
  return {
    searchedAt: now.toISOString(),
    question: request.question,
    query: request.query,
    newsQuery: request.newsQuery,
    sources,
    attempts,
    providersUsed,
    ...(keyPassage ? { keyPassage } : {}),
  };
}

async function weatherSource(
  city: string,
  deps: CurrentSearchDeps,
): Promise<{ item: SearchResultItem | null; attempt: SearchAttempt }> {
  const started = Date.now();
  try {
    const item = deps.weather
      ? await deps.weather(city, deps.signal)
      : await fetchOpenMeteoWeather(city, { signal: deps.signal, fetchImpl: deps.fetchImpl });
    return {
      item,
      attempt: { providerId: 'open-meteo', label: OPEN_METEO_LABEL, ok: true, count: 1, ms: Date.now() - started },
    };
  } catch (error) {
    return {
      item: null,
      attempt: {
        providerId: 'open-meteo',
        label: OPEN_METEO_LABEL,
        ok: false,
        count: 0,
        ms: Date.now() - started,
        error: error instanceof Error ? error.message : String(error),
      },
    };
  }
}

/**
 * Lit les premières pages à lien direct (pas les redirections Google
 * Actualités) et garde le passage qui partage le plus de mots avec la
 * question : le modèle reçoit un fait de la page, pas seulement un titre.
 */
async function readTopPages(
  sources: CurrentSource[],
  request: CurrentSearchRequest,
  deps: CurrentSearchDeps,
): Promise<{ index: number; text: string } | undefined> {
  const direct = sources.filter(
    (source) => source.kind !== 'weather' && !/(^|\.)news\.google\.com$/i.test(hostnameOf(source.url) ?? ''),
  );
  const readable = direct.slice(0, PAGES_READ);
  // Wikipédia dit l'état présent en une phrase (« actuellement en fonction est… ») : deux pages lues en plus.
  const encyclopedias = direct
    .filter((source) => /(^|\.)wikipedia\.org$/i.test(hostnameOf(source.url) ?? ''))
    .slice(0, 2);
  for (const page of encyclopedias) if (!readable.includes(page)) readable.push(page);

  const question = `${request.question} ${request.query}`;
  const now = deps.now?.() ?? new Date();
  const best: { index: number; text: string; score: number }[] = [];
  await Promise.all(
    readable.map(async (source) => {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), PAGE_READ_TIMEOUT_MS);
      const onAbort = () => controller.abort();
      deps.signal?.addEventListener('abort', onAbort, { once: true });
      try {
        const page = await deps.readPage!(source.url, controller.signal);
        const ranked = rankSentences(page.text, question, now);
        const excerpt = joinPassage(ranked, EXCERPT_CHARS);
        if (excerpt) source.pageExcerpt = excerpt;
        const top = [...ranked].sort((a, b) => b.score - a.score || a.index - b.index)[0];
        // Un article de la semaine décrit le présent mieux qu'une page de référence.
        const fresh = (ageInDays(source.publishedAt, now) ?? Infinity) <= 7 ? 0.5 : 0;
        if (top) best.push({ index: source.index, text: top.sentence, score: top.score + fresh });
      } catch {
        // Page illisible (anti-robot, délai) : l'extrait du moteur reste.
      } finally {
        clearTimeout(timer);
        deps.signal?.removeEventListener('abort', onAbort);
      }
    }),
  );
  const key = best.sort((a, b) => b.score - a.score || a.index - b.index)[0];
  return key && key.score >= 1.5 ? { index: key.index, text: key.text } : undefined;
}

/** Phrases de la page les plus proches de la question, dans leur ordre d'origine. */
export function bestPassage(text: string, question: string, maxChars = EXCERPT_CHARS, now: Date = new Date()): string {
  return joinPassage(rankSentences(text, question, now), maxChars);
}

interface RankedSentence {
  sentence: string;
  index: number;
  score: number;
}

const OFFICE_LABEL = /^(?:titulaire(?: actuel(?:le)?)?|actuel(?:le)? titulaire|en fonction)\b/i;

const PRESENT_TENSE =
  /\b(?:actuel(?:le)?(?:ment)?|en fonction|en poste|titulaire|depuis|derni[èe]re?|aujourd'hui|en ce moment|current|latest)/i;

/** Année récente : un fait d'aujourd'hui ; seulement des années anciennes : de l'histoire. */
function yearWeight(sentence: string, now: Date): number {
  const years = [...sentence.matchAll(/(?<!\d)(1[5-9]\d\d|20\d\d)(?!\d)/g)].map((match) => Number(match[1]));
  if (years.length === 0) return 0;
  return years.some((year) => year >= now.getFullYear() - 1) ? 0.5 : -1;
}

function joinPassage(ranked: RankedSentence[], maxChars: number): string {
  const top = [...ranked]
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .slice(0, 3)
    .sort((a, b) => a.index - b.index);
  let passage = '';
  for (const entry of top) {
    if (passage.includes(entry.sentence)) continue;
    const next = passage ? `${passage} ${entry.sentence}` : entry.sentence;
    if (next.length > maxChars) break;
    passage = next;
  }
  return passage;
}

function rankSentences(text: string, question: string, now: Date): RankedSentence[] {
  const tokens = significantTokens(question).filter((token) => !/^(?:19|20)\d\d$/.test(token));
  if (!text.trim() || tokens.length === 0) return [];
  const lines = text.split(/\n+/).map((line) => line.replace(/\s+/g, ' ').trim()).filter(Boolean);
  const sentences: string[] = [];
  for (const [index, line] of lines.entries()) {
    sentences.push(...line.split(/(?<=[.!?])\s+/));
    // Infobox : « Dernière version » puis « 26.10.0 (22 septembre 2026) » sur deux lignes courtes.
    // Pas pour un numéro de sommaire (« 3 » puis « Frameworks pour Node.js »).
    const next = lines[index + 1];
    const tocNumber = /^\d+(?:\.\d+)*$/.test(line) || /^\d+(?:\.\d+)*$/.test(next ?? '');
    const officeLabel = OFFICE_LABEL.test(line);
    const valueLine =
      next !== undefined && next.length <= 60 && (/\d/.test(next) || officeLabel) && !/[.!?]$/.test(next);
    if (!tocNumber && valueLine && line.length <= 40 && !/\d/.test(line) && !/[.!?]$/.test(line)) {
      // « Titulaire actuel » / « Sébastien Lecornu » / « depuis le 9 septembre 2025 »
      const since = lines[index + 2];
      const tail = officeLabel && since && /^depuis\b/i.test(since) && since.length <= 60 ? ` ${since}` : '';
      sentences.push(`${line} : ${next}${tail}`);
    }
  }
  const candidates = [...new Set(sentences.map((sentence) => sentence.trim()))].filter(
    (sentence) => sentence.length >= 25 && sentence.length <= 400,
  );
  return candidates
    .map((sentence, index) => {
      const words = new Set(significantTokens(sentence));
      const hits = tokens.filter((token) => words.has(token)).length;
      // Un chiffre qui porte une réponse : version, prix, pourcentage, score.
      const hasNumber = /\d+[.,]\d|\d\s?%|\d\s?(?:€|\$|euros?|dollars?)|\d+\s?-\s?\d+/.test(sentence) ? 0.5 : 0;
      const present = PRESENT_TENSE.test(sentence) ? 0.5 : 0;
      // L'infobox d'une fonction nomme le titulaire sans reprendre les mots de la question.
      const holder = OFFICE_LABEL.test(sentence) && /\s:\s/.test(sentence) ? 2 : 0;
      const matched = hits + holder;
      return { sentence, index, score: matched > 0 ? matched + hasNumber + present + yearWeight(sentence, now) : 0 };
    })
    .filter((entry) => entry.score >= 1);
}

/** Articles les plus récents d'abord ; les vieux articles sautent s'il en reste de frais. */
function freshNews(items: SearchResultItem[], now: Date): SearchResultItem[] {
  const sorted = [...items].sort(
    (a, b) => (Date.parse(b.publishedAt ?? '') || 0) - (Date.parse(a.publishedAt ?? '') || 0),
  );
  const fresh = sorted.filter((item) => (ageInDays(item.publishedAt, now) ?? 0) <= STALE_NEWS_DAYS);
  return fresh.length > 0 ? fresh : sorted;
}

export function sourceLabel(source: CurrentSource): string {
  if (source.publisher && source.domain && !source.domain.includes('.')) return source.publisher;
  if (source.publisher && source.domain) return `${source.publisher} (${source.domain})`;
  return source.publisher || source.domain || 'source inconnue';
}

/**
 * Texte remis au modèle : date et heure de la recherche, sources numérotées
 * et datées, puis la consigne. Un petit modèle suit mieux une consigne qui
 * arrive après les résultats que dans le prompt système seul.
 */
export function formatCurrentSearchForModel(
  result: CurrentSearchResult,
  options: { timeZone?: string } = {},
): string {
  const now = new Date(result.searchedAt);
  const when = formatCurrentDateTime(now, options.timeZone);
  if (result.sources.length === 0) {
    return `Recherche web du ${when} : aucun résultat exploitable pour « ${result.question} ».`;
  }
  const lines = result.sources.map((source) => {
    const date = formatSourceDate(source.publishedAt, now, options.timeZone);
    const header = `[${source.index}] ${source.title} — ${sourceLabel(source)}${date ? ` — publié le ${date}` : ' — date non indiquée'}`;
    const snippet = source.snippet ? `\n    Extrait : ${source.snippet.slice(0, 420)}` : '';
    const page = source.pageExcerpt ? `\n    Lu sur la page : ${source.pageExcerpt}` : '';
    return `${header}${snippet}${page}\n    Lien : ${source.url}`;
  });
  const key = result.keyPassage
    ? result.sources.find((source) => source.index === result.keyPassage?.index)
    : undefined;
  return [
    `Recherche web effectuée le ${when} (heure du PC).`,
    `Question : « ${result.question} »`,
    ...(key && result.keyPassage
      ? [`Passage clé lu sur la source [${key.index}] (${sourceLabel(key)}) : « ${result.keyPassage.text} »`]
      : []),
    '',
    'Résultats :',
    ...lines,
    '',
    `Fournisseurs : ${result.providersUsed.join(', ')}.`,
    'Consigne : réponds en français à partir de ces résultats seulement. Tes connaissances s’arrêtent à ton entraînement, bien avant aujourd’hui : depuis, des élections, nominations, sorties et résultats ont changé, et seuls ces résultats les connaissent. En cas de désaccord, les résultats l’emportent. ' +
      'Nomme la source (« selon Le Monde, le 30 septembre ») et donne la date quand elle est connue. ' +
      "Si ces résultats ne contiennent pas la réponse, dis-le clairement au lieu de répondre de mémoire. N'écris pas les liens : ils sont ajoutés sous ta réponse.",
  ].join('\n');
}
