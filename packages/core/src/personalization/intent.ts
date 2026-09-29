export interface PersonalizationToolPlan {
  tool: string;
  args: Record<string, unknown>;
}

/**
 * Extrait une demande explicite de personnalisation. Renvoie `null` si la
 * phrase n'est pas une consigne de mémorisation / oubli / consultation —
 * pour ne jamais enregistrer une conversation entière par accident.
 */
export function extractPersonalizationIntent(prompt: string): PersonalizationToolPlan | null {
  const text = prompt.trim();
  if (!text) return null;

  if (
    /(?:efface|supprime|r[ée]initialise|vide)\s+(?:toute\s+)?(?:ta\s+|la\s+)?(?:personnalisation|m[ée]moire(?:\s+persistante)?)/i.test(
      text,
    )
  ) {
    return { tool: 'reset_jarvis_personalization', args: {} };
  }

  if (
    /(?:montre|affiche|liste)[- ]?(?:moi\s+)?(?:ta\s+|la\s+)?personnalisation/i.test(text) ||
    /personnalisation actuelle/i.test(text) ||
    /quelles?\s+(?:sont\s+)?mes\s+pr[ée]f[ée]rences/i.test(text) ||
    /qu['’]as-tu retenu/i.test(text)
  ) {
    return { tool: 'get_jarvis_personalization', args: {} };
  }

  const forget = text.match(
    /oublie\s+(?:ma\s+pr[ée]f[ée]rence\s+)?(?:sur\s+|concernant\s+|comment\s+)?(.+)/i,
  );
  if (forget?.[1]) {
    const target = forget[1].replace(/[.!?]+$/, '').trim();
    const mapped = mapForgetTarget(target);
    if (mapped) return { tool: 'forget_jarvis_personalization', args: mapped };
  }

  const callMe = text.match(/appelle[- ]moi\s+(.+)/i);
  if (callMe?.[1]) {
    return {
      tool: 'set_jarvis_personalization',
      args: {
        scope: 'user',
        key: 'preferredName',
        value: stripTrailingPunctuation(callMe[1]),
      },
    };
  }

  const be = text.match(/(?:(?:à|a)\s+partir\s+de\s+maintenant,?\s+)?sois\s+(.+)/i);
  if (
    be?.[1] &&
    /personnal|pr[ée]f[ée]rence|ton|style|direct|professionnel|courtes?|formel/i.test(text)
  ) {
    return {
      tool: 'set_jarvis_personalization',
      args: {
        scope: 'assistant',
        key: 'tone',
        value: stripTrailingPunctuation(be[1]),
      },
    };
  }

  const remember = text.match(/(?:retiens|m[ée]morise)\s+que\s+(.+)/i);
  if (remember?.[1]) {
    return {
      tool: 'add_jarvis_personalization_rule',
      args: { rule: stripTrailingPunctuation(remember[1]) },
    };
  }

  return null;
}

function mapForgetTarget(target: string): { scope: 'assistant' | 'user'; key: string } | null {
  const normalized = target.toLowerCase();
  if (/ton|style|personnalit/.test(normalized)) return { scope: 'assistant', key: 'tone' };
  if (/appel|pr[ée]nom|nom/.test(normalized)) return { scope: 'user', key: 'preferredName' };
  if (!target.trim()) return null;
  return { scope: 'user', key: target.trim().slice(0, 80) };
}

function stripTrailingPunctuation(value: string): string {
  return value.replace(/[.!?]+$/, '').trim();
}
