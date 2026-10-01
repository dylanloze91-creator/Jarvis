import dns from 'node:dns/promises';
import { z } from 'zod';
import {
  CURRENT_INFO_TOOL_NAME,
  assessHtml,
  checkUrlSafety,
  classifyThrownError,
  compareSources,
  dedupeHits,
  defineTool,
  describeAttempts,
  extractReadableText,
  fetchPublicText,
  formatClaimLabels,
  formatCurrentSearchForModel,
  formatSourceDate,
  isPrivateIpAddress,
  localTimeZone,
  searchCurrentInfo,
  searchWithFallback,
  selectSources,
  webProviderOrder,
  type ReadSource,
  type ResearchHit,
  type SearchProviderConfig,
  type SearchProviderRegistry,
  type SearchResponse,
  type SearchResultItem,
  type Settings,
} from '@jarvis/core';

const MAX_PAGE_BYTES = 2_000_000; // 2 Mo lus au maximum, pour ne jamais streamer une page entière
const MAX_TEXT_LENGTH = 6000; // caractères renvoyés au modèle après extraction
const FETCH_TIMEOUT_MS = 10_000;
const MAX_REDIRECTS = 5;

export interface PageRead {
  title?: string;
  text: string;
  raw?: string;
}

interface WebSearchDeps {
  getSettings: () => Settings;
  searchRegistry: SearchProviderRegistry;
  /** Lecture d'une page. Absente : fetch HTML public, avec retries. */
  readPage?: (url: string, signal?: AbortSignal) => Promise<PageRead>;
}

/**
 * Recherche sur Internet : délègue au fournisseur choisi dans les réglages
 * (Wikipédia, Google sans clé, Brave Search si une clé est renseignée) via le
 * registre `SearchProviderRegistry` de `@jarvis/core`. L'outil ne connaît
 * jamais l'implémentation concrète, ce qui permet de changer de fournisseur
 * sans toucher à ce fichier.
 */
export function createWebSearchTool(deps: WebSearchDeps) {
  return defineTool({
    name: 'web_search',
    description:
      "Recherche sur Internet et retourne des résultats synthétisés avec leurs sources. À utiliser pour toute question dont la réponse n'est pas connue avec certitude, ou qui porte sur une information récente, changeante ou factuelle précise.",
    risk: 'safe',
    schema: z.object({
      query: z.string().min(1).max(300).describe('Termes de recherche.'),
      limit: z.number().int().min(1).max(8).default(5).describe('Nombre de résultats souhaité.'),
    }),
    summarize: ({ query }) => `Rechercher « ${query} » sur Internet.`,
    execute: async ({ query, limit }) => {
      const settings = deps.getSettings();
      const config = searchConfig(settings);
      const { provider, fellBack } = deps.searchRegistry.createOrFallback(config);

      let primaryError: unknown = null;
      let primaryEmpty = false;
      try {
        const response = await provider.search({ query, limit });
        if (response.results.length > 0) {
          const fallbackNote =
            fellBack && settings.searchProvider !== provider.id
              ? `(Fournisseur « ${settings.searchProvider} » indisponible sans clé, recherche effectuée via ${provider.label}.)\n\n`
              : '';
          return searchSuccess(query, provider.label, response, fallbackNote);
        }
        primaryEmpty = true;
      } catch (error) {
        primaryError = error;
      }

      // Le fournisseur choisi n'a rien donné : les autres moteurs sans clé prennent le relais.
      const fallback = await searchWithFallback(
        deps.searchRegistry,
        webProviderOrder(deps.searchRegistry, config).filter((id) => id !== provider.id),
        config,
        { query, limit },
      );
      if (fallback.results.length > 0) {
        return searchSuccess(
          query,
          fallback.label,
          fallback,
          `(${provider.label} n'a pas répondu ; recherche effectuée via ${fallback.label}.)\n\n`,
        );
      }

      if (primaryEmpty) {
        return {
          ok: true,
          content: `Aucun résultat trouvé pour « ${query} » via ${provider.label}.`,
          data: { providerId: provider.id, results: [] } satisfies SearchResponse,
        };
      }
      const classified = classifyThrownError(primaryError);
      const others = fallback.attempts.length
        ? ` Autres moteurs essayés — ${describeAttempts(fallback.attempts)}.`
        : '';
      return {
        ok: false,
        outcome: classified.outcome,
        content: `La recherche Internet n'a pas abouti pour « ${query} ». ${classified.userMessage}${others}`,
        technicalDetail: classified.technicalDetail,
      };
    },
  });
}

function searchConfig(settings: Settings): SearchProviderConfig {
  return { provider: settings.searchProvider, apiKey: settings.searchApiKey };
}

function publishedNote(result: SearchResultItem): string {
  const date = formatSourceDate(result.publishedAt, new Date(), localTimeZone());
  return date ? ` (publié le ${date})` : '';
}

function searchSuccess(query: string, label: string, response: SearchResponse, note: string) {
  const lines = response.results.map(
    (result, index) =>
      `${index + 1}. ${result.title} — ${result.snippet || 'Pas de résumé disponible.'}${publishedNote(result)}\n   Source : ${result.url}`,
  );
  return {
    ok: true,
    content: `${note}Résultats pour « ${query} » (via ${label}) :\n\n${lines.join('\n')}\n\nLe premier résultat n'est pas une preuve. Distingue FAIT, SOURCE, INTERPRÉTATION et INCERTITUDE.`,
    data: response,
  };
}

/**
 * Recherche faite par Jarvis avant le modèle pour une question d'actualité
 * (règle `detectCurrentInfoIntent`). Outil interne : absent du catalogue du
 * modèle, mais exécuté et audité par le Tool Manager comme les autres.
 */
export function createCurrentInfoSearchTool(deps: WebSearchDeps) {
  return defineTool({
    name: CURRENT_INFO_TOOL_NAME,
    internal: true,
    description:
      "Recherche d'actualité faite par Jarvis avant de répondre : articles datés (Google Actualités, Bing Actualités), web (DuckDuckGo, Bing, Google, Wikipédia) et météo Open-Meteo.",
    risk: 'safe',
    schema: z.object({
      question: z.string().min(1).max(400),
      query: z.string().min(1).max(300),
      newsQuery: z.string().min(1).max(300),
      freshness: z.enum(['day', 'week', 'month']).default('week'),
      preferNews: z.boolean().default(true),
      city: z.string().min(1).max(80).optional(),
    }),
    summarize: ({ question }) => `Chercher sur Internet : « ${question} ».`,
    execute: async (input, context) => {
      const settings = deps.getSettings();
      const result = await searchCurrentInfo(input, {
        registry: deps.searchRegistry,
        config: searchConfig(settings),
        signal: context.signal,
        readPage: deps.readPage ?? readPublicPage,
      });
      if (result.sources.length === 0) {
        const reasons = describeAttempts(result.attempts) || 'aucun fournisseur n’a répondu.';
        return {
          ok: false,
          outcome: 'recoverable',
          content: `La recherche Internet n'a rien donné pour « ${input.question} ». ${reasons}`,
          technicalDetail: reasons,
          data: result,
        };
      }
      return {
        ok: true,
        content: formatCurrentSearchForModel(result, { timeZone: localTimeZone() }),
        data: result,
      };
    },
  });
}

/**
 * Recherche approfondie : plusieurs angles indépendants sont interrogés,
 * les doublons sont retirés et les meilleurs résultats sont regroupés par
 * domaine. Le modèle reste responsable de la formulation des requêtes et de
 * la synthèse finale ; l'outil fournit un jeu de sources plus robuste qu'une
 * requête unique. Même politique que `web_search` : lecture Internet `safe`,
 * pas d'accès au PC.
 */
export function createWebResearchTool(deps: WebSearchDeps) {
  return defineTool({
    name: 'web_research',
    description:
      "Recherche approfondie sur Internet. Utilise-la pour une question complexe, actuelle ou importante nécessitant plusieurs sources. Donne 2 à 4 requêtes complémentaires (faits, source officielle, contre-vérification). L'outil déduplique et classe les résultats ; utilise ensuite fetch_page sur les sources importantes si nécessaire.",
    risk: 'safe',
    schema: z.object({
      queries: z
        .array(z.string().min(1).max(220))
        .min(2)
        .max(4)
        .describe('2 à 4 requêtes complémentaires, indépendantes et précises.'),
      limitPerQuery: z.number().int().min(2).max(6).default(4),
    }),
    summarize: ({ queries }) => `Recherche approfondie : ${queries.join(' | ')}`,
    execute: async ({ queries, limitPerQuery }) => {
      const settings = deps.getSettings();
      const config = searchConfig(settings);
      const { provider, fellBack } = deps.searchRegistry.createOrFallback(config);

      const settled = await Promise.allSettled(
        queries.map((query) =>
          provider.search({
            query,
            limit: limitPerQuery,
            language: 'fr',
          }),
        ),
      );

      // Requêtes sans résultat : repli une par une (DuckDuckGo limite les rafales).
      const fallbackIds = webProviderOrder(deps.searchRegistry, config).filter((id) => id !== provider.id);
      const fallbackLabels = new Set<string>();
      const perQuery: SearchResultItem[][] = [];
      for (const [index, item] of settled.entries()) {
        if (item.status === 'fulfilled' && item.value.results.length > 0) {
          perQuery.push(item.value.results);
          continue;
        }
        if (fallbackIds.length === 0) {
          perQuery.push([]);
          continue;
        }
        const chained = await searchWithFallback(deps.searchRegistry, fallbackIds, config, {
          query: queries[index] ?? '',
          limit: limitPerQuery,
          language: 'fr',
        });
        if (chained.results.length > 0) fallbackLabels.add(chained.label);
        perQuery.push(chained.results);
      }

      const merged: ResearchHit[] = perQuery.flatMap((results, index) =>
        results.map((result) => ({ ...result, query: queries[index] })),
      );
      const results = dedupeHits(merged);
      const selected = selectSources(results, 4);
      const reads = await readSelectedSources(selected, deps.readPage);

      if (results.length === 0) {
        const failed = settled.filter((item) => item.status === 'rejected').length;
        return {
          ok: false,
          content:
            `La recherche approfondie n'a retourné aucun résultat via ${provider.label}. ` +
            (failed ? `${failed} requête(s) ont échoué. ` : '') +
            'Réessaie avec des requêtes plus précises.',
        };
      }

      const lines = results.slice(0, 12).map(
        (result, index) =>
          `${index + 1}. ${result.title}\n` +
          `   Domaine : ${result.source || sourceDomain(result.url) || 'inconnu'}\n` +
          `   Extrait : ${result.snippet || 'Aucun extrait.'}\n` +
          (dateOf(result) ? `   Date : ${dateOf(result)}\n` : '') +
          `   URL : ${result.url}`,
      );

      const fallbackNote =
        (fellBack && settings.searchProvider !== provider.id
          ? `Fournisseur configuré indisponible ; recherche effectuée via ${provider.label}.\n\n`
          : '') +
        (fallbackLabels.size > 0
          ? `${provider.label} n'a pas répondu pour certaines requêtes ; repli : ${[...fallbackLabels].join(', ')}.\n\n`
          : '');
      const primaryAnswered = settled.some(
        (item) => item.status === 'fulfilled' && item.value.results.length > 0,
      );
      const usedLabel =
        [...(primaryAnswered ? [provider.label] : []), ...fallbackLabels].join(', ') || provider.label;
      const brief = compareSources(reads);

      return {
        ok: true,
        content:
          `${fallbackNote}Recherche multi-angle terminée via ${usedLabel}.\n` +
          `Requêtes : ${queries.join(' | ')}\n\n` +
          `${lines.join('\n')}\n\n` +
          'Consigne de synthèse : vérifie les affirmations importantes dans les sources originales ; ' +
          'ne traite pas un extrait de moteur de recherche comme une preuve suffisante.\n\n' +
          formatClaimLabels(brief),
        data: {
          provider: provider.id,
          queries,
          results: results.slice(0, 12),
          brief,
        },
      };
    },
  });
}

/** Lecture d'une page pour la recherche d'actualité : mêmes gardes que `fetch_page`. */
async function readPublicPage(url: string, signal?: AbortSignal): Promise<PageRead> {
  const fetched = await fetchPublicText(url, {
    timeoutMs: 6_000,
    maxRetries: 0,
    maxRedirects: MAX_REDIRECTS,
    readLimit: MAX_PAGE_BYTES,
    signal,
    guard: guardUrl,
  });
  if (!fetched.ok) throw new Error(fetched.technicalDetail);
  // Seul un passage de 600 caractères part au modèle : on lit large pour atteindre l'infobox ou le corps.
  const page = extractReadableText(fetched.text, 30_000);
  if (pageLooksBlocked(fetched.text, page.text)) throw new Error('anti-robot');
  return { title: page.title, text: page.text };
}

/** Un vrai mur anti-robot n'a presque pas de texte ; Wikipédia cite « captcha » dans ses scripts. */
export function pageLooksBlocked(raw: string, text: string): boolean {
  return text.length < 2_000 && assessHtml(raw, text).antiBot;
}

function dateOf(result: { publishedAt?: string }): string | undefined {
  return formatSourceDate(result.publishedAt, new Date(), localTimeZone());
}

async function readSelectedSources(
  hits: ResearchHit[],
  readPage: WebSearchDeps['readPage'],
): Promise<ReadSource[]> {
  const reader =
    readPage ??
    (async (url: string) => {
      const fetched = await fetchPublicText(url, { timeoutMs: 8_000, maxRetries: 2 });
      if (!fetched.ok) return { title: '', text: '' };
      const page = extractReadableText(fetched.text, 4_000);
      return { title: page.title, text: page.text, raw: fetched.text };
    });

  const settled = await Promise.allSettled(
    hits.map(async (hit) => {
      const page = await reader(hit.url);
      const raw = page.raw ?? page.text;
      return {
        url: hit.url,
        title: page.title || hit.title,
        text: page.text || hit.snippet,
        assessment: assessHtml(raw, page.text || ''),
      } satisfies ReadSource;
    }),
  );
  return settled.flatMap((item) => (item.status === 'fulfilled' ? [item.value] : []));
}

export function normalizeUrl(raw: string): string {
  try {
    const url = new URL(raw);
    url.hash = '';
    url.hostname = url.hostname.toLowerCase();
    return url.toString().replace(/\/+$/, '');
  } catch {
    return '';
  }
}

export function sourceDomain(raw: string): string {
  try {
    return new URL(raw).hostname.replace(/^www\./i, '');
  } catch {
    return '';
  }
}

/**
 * Récupère une page web et en extrait le texte lisible. Deux niveaux de
 * protection contre les adresses locales ou internes : un premier filtrage
 * statique (`checkUrlSafety`, protocole + hostname/IP littéraux), puis une
 * résolution DNS réelle avant chaque requête — y compris après une
 * redirection — pour bloquer un domaine public qui pointerait vers le réseau
 * privé (« DNS rebinding »).
 */
export const fetchPageTool = defineTool({
  name: 'fetch_page',
  description:
    "Récupère une page web et en extrait le texte lisible, pour approfondir un résultat de recherche ou lire le contenu d'une URL donnée par l'utilisateur. Ne fonctionne que sur des adresses publiques (http/https).",
  risk: 'safe',
  schema: z.object({
    url: z.string().url().describe('Adresse de la page à récupérer (http ou https).'),
  }),
  summarize: ({ url }) => `Récupérer la page ${url}.`,
  execute: async ({ url }, context) => {
    const fetched = await fetchPublicText(url, {
      timeoutMs: FETCH_TIMEOUT_MS,
      maxRedirects: MAX_REDIRECTS,
      readLimit: MAX_PAGE_BYTES,
      signal: context.signal,
      guard: guardUrl,
    });
    if (!fetched.ok) {
      return {
        ok: false,
        outcome: fetched.outcome,
        content: fetched.userMessage,
        technicalDetail: fetched.technicalDetail,
      };
    }

    const page = extractReadableText(fetched.text, MAX_TEXT_LENGTH);
    const assessment = assessHtml(fetched.text, page.text);
    if (assessment.antiBot) {
      return {
        ok: false,
        outcome: 'recoverable',
        content: 'La page a renvoyé un mur anti-robot. Je n’ai pas lu son contenu.',
        technicalDetail: fetched.url,
      };
    }
    if (assessment.invalidHtml) {
      return {
        ok: false,
        outcome: 'definitive',
        content: 'Le HTML reçu est invalide. Je n’en tire aucun fait.',
        technicalDetail: fetched.url,
      };
    }
    if (page.text.length === 0 || assessment.empty) {
      return {
        ok: true,
        outcome: 'success',
        content: `La page « ${fetched.url} » ne contient aucun texte exploitable.`,
      };
    }

    const heading = page.title ? `${page.title}\n\n` : '';
    const truncationNote = page.truncated
      ? '\n\n_(texte tronqué : la page est plus longue que la limite lue par cet outil)_'
      : '';

    return {
      ok: true,
      outcome: 'success',
      content: `${heading}${page.text}${truncationNote}`,
      data: { url: fetched.url, title: page.title, truncated: page.truncated },
    };
  },
});

async function guardUrl(rawUrl: string): Promise<{ allowed: boolean; reason?: string }> {
  const safety = checkUrlSafety(rawUrl);
  if (!safety.allowed) return safety;

  const hostname = new URL(rawUrl).hostname;
  try {
    const records = await dns.lookup(hostname, { all: true });
    if (records.some((record) => isPrivateIpAddress(record.address))) {
      return {
        allowed: false,
        reason: 'ce domaine pointe vers une adresse réseau privée ou locale.',
      };
    }
  } catch {
    // Une résolution DNS impossible sera de toute façon rejetée par le fetch qui suit.
  }

  return { allowed: true };
}

