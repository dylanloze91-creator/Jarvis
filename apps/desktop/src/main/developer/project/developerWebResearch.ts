import {
  searchWithFallback,
  webProviderOrder,
  webResearchChatLine,
  type SearchProviderRegistry,
  type Settings,
} from '@jarvis/core';

function searchConfig(settings: Settings) {
  return {
    provider: settings.searchProvider,
    apiKey: settings.searchApiKey,
    googleCseId: settings.googleCseId,
  };
}

/** Recherche web pour une mission « Nouveau projet » (sans carte de confirmation). */
export interface DeveloperWebResearchOutcome {
  chatLine: string;
  /** Extraits pour le Codeur (3 meilleures pistes). */
  coderBlock: string;
}

export async function developerMissionWebResearch(
  registry: SearchProviderRegistry,
  settings: Settings,
  query: string,
  request: string,
): Promise<DeveloperWebResearchOutcome | null> {
  const config = searchConfig(settings);
  const order = webProviderOrder(registry, config);
  try {
    const response = await searchWithFallback(registry, order, config, { query, limit: 5 });
    const top = response.results.slice(0, 3);
    const snippets = top.map((r) => r.snippet ?? r.title).join(' ');
    if (!snippets.trim()) return null;
    const coderBlock = top
      .map((r, i) => `${i + 1}. ${r.title}${r.url ? ` (${r.url})` : ''} — ${(r.snippet ?? '').slice(0, 280)}`)
      .join('\n');
    return {
      chatLine: webResearchChatLine(request, snippets),
      coderBlock: `Recherche web (à respecter pour le plan) :\n${coderBlock}`,
    };
  } catch {
    return null;
  }
}
