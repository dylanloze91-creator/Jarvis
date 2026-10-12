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
export async function developerMissionWebResearch(
  registry: SearchProviderRegistry,
  settings: Settings,
  query: string,
  request: string,
): Promise<string | null> {
  const config = searchConfig(settings);
  const order = webProviderOrder(registry, config);
  try {
    const response = await searchWithFallback(registry, order, config, { query, limit: 5 });
    const snippets = response.results.map((r) => r.snippet ?? r.title).join(' ');
    if (!snippets.trim()) return null;
    return webResearchChatLine(request, snippets);
  } catch {
    return null;
  }
}
