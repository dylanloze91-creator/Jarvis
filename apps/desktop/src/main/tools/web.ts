import dns from 'node:dns/promises';
import { z } from 'zod';
import {
  checkUrlSafety,
  defineTool,
  extractReadableText,
  isPrivateIpAddress,
  type SearchProviderRegistry,
  type Settings,
} from '@jarvis/core';

const MAX_PAGE_BYTES = 2_000_000; // 2 Mo lus au maximum, pour ne jamais streamer une page entière
const MAX_TEXT_LENGTH = 6000; // caractères renvoyés au modèle après extraction
const FETCH_TIMEOUT_MS = 10_000;
const MAX_REDIRECTS = 5;

interface WebSearchDeps {
  getSettings: () => Settings;
  searchRegistry: SearchProviderRegistry;
}

/**
 * Recherche sur Internet : délègue au fournisseur choisi dans les réglages
 * (Wikipédia par défaut, Brave Search si une clé est renseignée) via le
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
          content: `${fallbackNote}Résultats pour « ${query} » (via ${provider.label}) :\n\n${lines.join('\n')}`,
          data: response,
        };
      } catch (error) {
        return {
          ok: false,
          content: `Recherche impossible pour « ${query} » via ${provider.label} : ${describeError(error)}`,
        };
      }
    },
  });
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
  execute: async ({ url }) => {
    let current = url;

    for (let hop = 0; hop <= MAX_REDIRECTS; hop += 1) {
      const guard = await guardUrl(current);
      if (!guard.allowed) {
        return { ok: false, content: `Adresse refusée : ${guard.reason}` };
      }

      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

      let response: Response;
      try {
        response = await fetch(current, {
          signal: controller.signal,
          redirect: 'manual',
          headers: { 'user-agent': 'Mozilla/5.0 (compatible; Jarvis/1.0; assistant personnel)' },
        });
      } catch (error) {
        clearTimeout(timeout);
        if (controller.signal.aborted) {
          return {
            ok: false,
            content: `La page « ${current} » n'a pas répondu à temps (délai dépassé).`,
          };
        }
        return {
          ok: false,
          content: `Impossible de récupérer la page « ${current} » : ${describeError(error)}`,
        };
      }
      clearTimeout(timeout);

      if (response.status >= 300 && response.status < 400) {
        const location = response.headers.get('location');
        if (!location) {
          return { ok: false, content: `Redirection sans destination reçue pour « ${current} ».` };
        }
        current = new URL(location, current).toString();
        continue;
      }

      if (!response.ok) {
        return {
          ok: false,
          content: `La page a répondu avec une erreur (HTTP ${response.status}).`,
        };
      }

      const contentType = response.headers.get('content-type') ?? '';
      const isTextual =
        contentType === '' ||
        contentType.includes('text/') ||
        contentType.includes('application/xhtml');
      if (!isTextual) {
        return {
          ok: false,
          content: `Type de contenu non pris en charge (${contentType.split(';')[0] || 'inconnu'}). Seules les pages HTML ou texte sont lues.`,
        };
      }

      const html = await readBody(response, MAX_PAGE_BYTES);
      const page = extractReadableText(html, MAX_TEXT_LENGTH);

      if (page.text.length === 0) {
        return { ok: true, content: `La page « ${current} » ne contient aucun texte exploitable.` };
      }

      const heading = page.title ? `${page.title}\n\n` : '';
      const truncationNote = page.truncated
        ? '\n\n_(texte tronqué : la page est plus longue que la limite lue par cet outil)_'
        : '';

      return {
        ok: true,
        content: `${heading}${page.text}${truncationNote}`,
        data: { url: current, title: page.title, truncated: page.truncated },
      };
    }

    return { ok: false, content: `Trop de redirections en partant de « ${url} ».` };
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

async function readBody(response: Response, maxBytes: number): Promise<string> {
  if (!response.body) return response.text();

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let received = 0;
  let text = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    received += value.byteLength;
    text += decoder.decode(value, { stream: true });
    if (received >= maxBytes) {
      await reader.cancel().catch(() => undefined);
      break;
    }
  }
  text += decoder.decode();

  return text;
}

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
