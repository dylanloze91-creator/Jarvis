export interface SourcePill {
  host: string;
  count: number;
}

interface SourceItem {
  kind: string;
  text?: string;
  content?: string;
}

const URL_RE = /https?:\/\/[^\s<>)\]]+/gi;

function collect(text: string, into: Set<string>): void {
  const matches = text.match(URL_RE);
  if (!matches) return;
  for (const match of matches) into.add(match.replace(/[.,;:]+$/, ''));
}

/**
 * Pastilles déduites des URL réellement présentes dans le message et les
 * outils qui le précèdent. Aucun hôte ni aucun compte n'est ajouté.
 */
export function sourcePills(items: readonly SourceItem[], assistantIndex: number): SourcePill[] {
  const current = items[assistantIndex];
  if (!current || current.kind !== 'assistant') return [];

  const urls = new Set<string>();
  if (current.text) collect(current.text, urls);
  for (let index = assistantIndex - 1; index >= 0; index -= 1) {
    const item = items[index];
    if (!item || item.kind === 'user') break;
    if (item.kind === 'tool' && item.content) collect(item.content, urls);
    if (item.kind === 'assistant' && item.text) collect(item.text, urls);
  }

  const counts = new Map<string, number>();
  for (const raw of urls) {
    try {
      const host = new URL(raw).hostname.replace(/^www\./, '');
      if (!host) continue;
      counts.set(host, (counts.get(host) ?? 0) + 1);
    } catch {
      continue;
    }
  }

  return [...counts.entries()].map(([host, count]) => ({ host, count }));
}

export function sourcePillLabel(pill: SourcePill): string {
  const noun = pill.count > 1 ? 'sources' : 'source';
  return `${pill.host} · ${pill.count.toLocaleString('fr-FR')} ${noun}`;
}
