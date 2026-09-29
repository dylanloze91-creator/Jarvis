import type { KnowledgeToolPlan } from './types.js';

/**
 * Demande explicite liée à la mémoire documentaire. Ne capture pas les
 * préférences (personnalisation) ni une recherche web générique.
 */
export function extractKnowledgeIntent(prompt: string): KnowledgeToolPlan | null {
  const text = prompt.trim();
  if (!text) return null;

  if (
    /(?:efface|supprime|vide|r[ée]initialise)\s+(?:toute\s+)?(?:ta\s+|la\s+)?m[ée]moire(?:\s+documentaire|\s+locale|\s+longue\s+dur[ée]e)?/i.test(
      text,
    ) &&
    /documentaire|index|souvenirs?|connaissances?|longue\s+dur[ée]e/i.test(text)
  ) {
    return { tool: 'clear_jarvis_memory', args: {} };
  }

  if (
    /(?:combien|stats?|statistiques?|taille)\s+(?:de\s+)?(?:ta\s+|la\s+)?m[ée]moire/i.test(text) ||
    /m[ée]moire\s+(?:documentaire\s+)?(?:actuelle|locale)/i.test(text)
  ) {
    return { tool: 'get_jarvis_memory_stats', args: {} };
  }

  const indexMatch = text.match(/index(?:e|er)?\s+(?:mon\s+|le\s+|du\s+)?dossier\s+(.+)/i);
  if (indexMatch?.[1]) {
    return {
      tool: 'index_jarvis_folder',
      args: { path: stripTrailingPunctuation(indexMatch[1]) },
    };
  }

  if (
    /(?:cherche|recherche|retrouve|rappelle[- ]moi)\s+(?:dans\s+)?(?:ta\s+|la\s+)?m[ée]moire/i.test(
      text,
    ) ||
    /dans\s+tes\s+souvenirs/i.test(text) ||
    /ce\s+que\s+tu\s+(?:sais|connais)\s+(?:d[ée]j[àa]\s+)?(?:de\s+moi|sur\s+moi|du\s+projet)/i.test(
      text,
    )
  ) {
    const query = extractMemoryQuery(text);
    if (query.length >= 2) {
      return { tool: 'search_jarvis_memory', args: { query, limit: 6 } };
    }
  }

  const remember = text.match(
    /(?:souviens[- ]toi|enregistre\s+(?:dans\s+ta\s+m[ée]moire)?|note\s+(?:dans\s+ta\s+m[ée]moire))\s+que\s+(.+)/i,
  );
  if (remember?.[1] && !isPreferenceSentence(text)) {
    return {
      tool: 'remember_jarvis',
      args: {
        text: stripTrailingPunctuation(remember[1]),
        title: 'Mémoire Jarvis',
      },
    };
  }

  return null;
}

function extractMemoryQuery(text: string): string {
  const cleaned = text
    .replace(
      /(?:cherche|recherche|retrouve|rappelle[- ]moi)\s+(?:dans\s+)?(?:ta\s+|la\s+)?m[ée]moire(?:\s+(?:si|de|sur|pour))?\s*/i,
      '',
    )
    .replace(/dans\s+tes\s+souvenirs\s*/i, '')
    .replace(/[.!?]+$/g, '')
    .trim();
  return cleaned.slice(0, 500);
}

function isPreferenceSentence(text: string): boolean {
  return /(?:ton|style|appelle[- ]moi|pr[ée]f[ée]rence|r[ée]ponses?\s+courtes?)/i.test(text);
}

function stripTrailingPunctuation(value: string): string {
  return value
    .replace(/^["«»']+|["«»']+$/g, '')
    .replace(/[.!?]+$/, '')
    .trim();
}
