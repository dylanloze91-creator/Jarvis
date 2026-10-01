import { filterRelevant, keywordQuery } from './relevance.js';
import type { SearchProviderRegistry } from './registry.js';
import type {
  SearchFreshness,
  SearchProviderConfig,
  SearchResponse,
  SearchResultItem,
} from './types.js';

/** Fournisseurs web sans clé, dans l'ordre de repli. */
export const KEYLESS_WEB_ORDER = ['duckduckgo', 'bing', 'google', 'wikipedia'] as const;
/** Actualité sans clé : Google Actualités (classement Google, daté), puis Bing Actualités. */
export const KEYLESS_NEWS_ORDER = ['google-news', 'bing-news'] as const;

export interface SearchAttempt {
  providerId: string;
  label: string;
  ok: boolean;
  count: number;
  ms: number;
  error?: string;
}

export interface ChainedSearchResponse extends SearchResponse {
  /** Libellé du fournisseur qui a répondu ; vide si tous ont échoué. */
  label: string;
  attempts: SearchAttempt[];
}

export interface ChainSearchOptions {
  query: string;
  limit?: number;
  language?: string;
  freshness?: SearchFreshness;
  signal?: AbortSignal;
  /** Seuil de pertinence (0–1). Les flux d'actualité titrent court : seuil plus bas. */
  minRelevance?: number;
  /** Fournisseurs dont les résultats sont gardés tels quels (pas de filtre de pertinence). */
  trusted?: string[];
}

/**
 * Ordre web : le fournisseur choisi dans les réglages d'abord (s'il est
 * utilisable — une clé requise et absente le fait sauter, comme
 * `createOrFallback`), puis les fournisseurs sans clé. Google HTML reste dans
 * la liste : il ne répond plus sans JavaScript depuis janvier 2025, mais
 * l'essai coûte une requête et respecte le choix de l'utilisateur.
 */
export function webProviderOrder(registry: SearchProviderRegistry, config: SearchProviderConfig): string[] {
  const order: string[] = [];
  const configured = registry.describe(config.provider);
  if (configured && (!configured.requiresApiKey || config.apiKey?.trim())) {
    order.push(configured.id);
  }
  for (const id of KEYLESS_WEB_ORDER) {
    if (registry.has(id) && !order.includes(id)) order.push(id);
  }
  return order;
}

export function newsProviderOrder(registry: SearchProviderRegistry, config: SearchProviderConfig): string[] {
  const order: string[] = [];
  const configured = registry.describe(config.provider);
  // Une clé configurée (Brave, Tavily) passe d'abord aussi pour l'actualité.
  if (configured?.requiresApiKey && config.apiKey?.trim()) order.push(configured.id);
  for (const id of KEYLESS_NEWS_ORDER) {
    if (registry.has(id) && !order.includes(id)) order.push(id);
  }
  return order;
}

/** Wikipédia cherche dans le texte intégral : une seule ville en commun ne suffit pas. */
const PROVIDER_MIN_RELEVANCE: Record<string, number> = { wikipedia: 0.6 };
/** Moteurs qui cherchent mot à mot : on leur passe les mots-clés, pas la question. */
const KEYWORD_PROVIDERS = new Set(['wikipedia']);

function redactKey(text: string, apiKey: string | undefined): string {
  const key = apiKey?.trim();
  return key && key.length >= 4 ? text.split(key).join('•••') : text;
}

/**
 * Essaie chaque fournisseur dans l'ordre et rend le premier jeu de résultats
 * pertinents. Ne lève pas : si tout échoue, `results` est vide et `attempts`
 * dit pourquoi, fournisseur par fournisseur. La clé n'est transmise qu'au
 * fournisseur configuré et n'apparaît dans aucun message.
 */
export async function searchWithFallback(
  registry: SearchProviderRegistry,
  providerIds: string[],
  config: SearchProviderConfig,
  options: ChainSearchOptions,
): Promise<ChainedSearchResponse> {
  const attempts: SearchAttempt[] = [];
  for (const id of providerIds) {
    if (options.signal?.aborted) break;
    const descriptor = registry.describe(id);
    if (!descriptor) continue;
    const started = Date.now();
    const apiKey = id === config.provider ? config.apiKey : undefined;
    try {
      const provider = registry.create({ provider: id, apiKey });
      const providerQuery = KEYWORD_PROVIDERS.has(id) ? keywordQuery(options.query) : options.query;
      const response = await provider.search({
        query: providerQuery,
        limit: options.limit,
        language: options.language ?? 'fr',
        freshness: options.freshness,
        signal: options.signal,
      });
      const minScore = Math.max(options.minRelevance ?? 0.34, PROVIDER_MIN_RELEVANCE[id] ?? 0);
      const relevant = options.trusted?.includes(id)
        ? response.results
        : filterRelevant(providerQuery, response.results, minScore);
      attempts.push({
        providerId: id,
        label: descriptor.label,
        ok: relevant.length > 0,
        count: relevant.length,
        ms: Date.now() - started,
        error:
          relevant.length > 0
            ? undefined
            : response.results.length > 0
              ? `${response.results.length} résultat(s) hors sujet écarté(s).`
              : 'aucun résultat.',
      });
      if (relevant.length > 0) {
        return {
          providerId: id,
          label: descriptor.label,
          results: relevant.slice(0, options.limit ?? relevant.length),
          answer: response.answer,
          attempts,
        };
      }
    } catch (error) {
      if (options.signal?.aborted) break;
      const message = error instanceof Error ? error.message : String(error);
      attempts.push({
        providerId: id,
        label: descriptor.label,
        ok: false,
        count: 0,
        ms: Date.now() - started,
        error: redactKey(message, apiKey),
      });
    }
  }
  return { providerId: '', label: '', results: [], attempts };
}

/**
 * Interroge tous les fournisseurs en parallèle et fusionne dans l'ordre
 * donné. Sert à l'actualité : Google Actualités classe le mieux mais ne donne
 * ni extrait ni lien direct ; Bing Actualités les donne. Un article présent
 * dans les deux garde le rang Google et prend le lien et l'extrait de Bing.
 */
export async function searchAllMerged(
  registry: SearchProviderRegistry,
  providerIds: string[],
  config: SearchProviderConfig,
  options: ChainSearchOptions,
): Promise<ChainedSearchResponse> {
  const responses = await Promise.all(
    providerIds.map((id) => searchWithFallback(registry, [id], config, options)),
  );
  const attempts = responses.flatMap((response) => response.attempts);
  const answered = responses.filter((response) => response.results.length > 0);
  if (answered.length === 0) return { providerId: '', label: '', results: [], attempts };

  // Alternance des flux (G1, B1, G2, B2…) : les extraits de Bing remontent parmi les premières sources.
  const interleaved: SearchResultItem[] = [];
  const longest = Math.max(...answered.map((response) => response.results.length));
  for (let rank = 0; rank < longest; rank += 1) {
    for (const response of answered) {
      const item = response.results[rank];
      if (item) interleaved.push(item);
    }
  }
  const merged: SearchResultItem[] = [];
  for (const item of interleaved) {
    const twin = merged.find((existing) => sameArticle(existing, item));
    if (!twin) {
      merged.push(item);
      continue;
    }
    if (/(^|\.)news\.google\.com$/i.test(hostOf(twin.url)) && !/(^|\.)news\.google\.com$/i.test(hostOf(item.url))) {
      twin.url = item.url;
    }
    if (!twin.snippet && item.snippet) twin.snippet = item.snippet;
    if (!twin.publishedAt && item.publishedAt) twin.publishedAt = item.publishedAt;
  }
  const first = answered[0]!;
  return {
    providerId: first.providerId,
    label: answered.map((response) => response.label).join(' + '),
    results: merged.slice(0, options.limit ?? merged.length),
    attempts,
  };
}

function hostOf(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return '';
  }
}

function titleKey(title: string): string {
  return title
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function sameArticle(a: SearchResultItem, b: SearchResultItem): boolean {
  if (a.url === b.url) return true;
  const ka = titleKey(a.title);
  const kb = titleKey(b.title);
  if (!ka || !kb) return false;
  if (ka === kb) return true;
  const short = ka.length < kb.length ? ka : kb;
  const long = ka.length < kb.length ? kb : ka;
  return short.length >= 30 && long.startsWith(short);
}

/** « Google (sans clé API) : page sans résultats ; DuckDuckGo (sans clé) : limite… » */
export function describeAttempts(attempts: SearchAttempt[]): string {
  return attempts
    .filter((attempt) => !attempt.ok)
    .map((attempt) => `${attempt.label} : ${attempt.error ?? 'échec'}`)
    .join(' ; ');
}

export function dedupeResults(results: SearchResultItem[]): SearchResultItem[] {
  const seen = new Set<string>();
  const out: SearchResultItem[] = [];
  for (const item of results) {
    let key = item.url;
    try {
      const url = new URL(item.url);
      url.hash = '';
      key = `${url.hostname.replace(/^www\./, '')}${url.pathname.replace(/\/+$/, '')}${url.search}`;
    } catch {
      // URL déjà validée par le fournisseur ; clé brute à défaut.
    }
    const titleKey = item.title.toLowerCase().replace(/\s+/g, ' ').trim();
    if (seen.has(key) || seen.has(titleKey)) continue;
    seen.add(key);
    seen.add(titleKey);
    out.push(item);
  }
  return out;
}
