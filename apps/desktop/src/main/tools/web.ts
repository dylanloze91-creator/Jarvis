import dns from 'node:dns/promises';
import { z } from 'zod';
import {
  assessHtml,
  checkUrlSafety,
  classifyThrownError,
  compareSources,
  dedupeHits,
  defineTool,
  extractReadableText,
  fetchPublicText,
  formatClaimLabels,
  isPrivateIpAddress,
  selectSources,
  type ReadSource,
  type ResearchHit,
  type SearchProviderRegistry,
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
      const { provider, fellBack } = deps.searchRegistry.createOrFallback({
        provider: settings.searchProvider,
        apiKey: settings.searchApiKey,
      });

      try {
        const response = await provider.search({ query, limit });

        if (response.results.length === 0) {
          return {
            ok: true,
            content: `Aucun résultat trouvé pour « ${query} » via ${provider.label}.`,
            data: response,
          };
        }

        const lines = response.results.map(
          (result, index) =>
            `${index + 1}. ${result.title} — ${result.snippet || 'Pas de résumé disponible.'}\n   Source : ${result.url}`,
        );
        const fallbackNote =
          fellBack && settings.searchProvider !== provider.id
            ? `(Fournisseur « ${settings.searchProvider} » indisponible sans clé, recherche effectuée via ${provider.label}.)\n\n`
            : '';

        return {
          ok: true,
          content: `${fallbackNote}Résultats pour « ${query} » (via ${provider.label}) :\n\n${lines.join('\n')}\n\nLe premier résultat n'est pas une preuve. Distingue FAIT, SOURCE, INTERPRÉTATION et INCERTITUDE.`,
          data: response,
        };
      } catch (error) {
        const classified = classifyThrownError(error);
        return {
          ok: false,
          outcome: classified.outcome,
          content: `La recherche Internet n'a pas abouti pour « ${query} ». ${classified.userMessage}`,
          technicalDetail: classified.technicalDetail,
        };
      }
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
      const { provider, fellBack } = deps.searchRegistry.createOrFallback({
        provider: settings.searchProvider,
        apiKey: settings.searchApiKey,
      });

      const settled = await Promise.allSettled(
        queries.map((query) =>
          provider.search({
            query,
            limit: limitPerQuery,
            language: 'fr',
          }),
        ),
      );

      const merged: ResearchHit[] = settled.flatMap((item, index) =>
        item.status === 'fulfilled'
          ? item.value.results.map((result) => ({ ...result, query: queries[index] }))
          : [],
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
          `   URL : ${result.url}`,
      );

      const fallbackNote =
        fellBack && settings.searchProvider !== provider.id
          ? `Fournisseur configuré indisponible ; recherche effectuée via ${provider.label}.\n\n`
          : '';
      const brief = compareSources(reads);

      return {
        ok: true,
        content:
          `${fallbackNote}Recherche multi-angle terminée via ${provider.label}.\n` +
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

