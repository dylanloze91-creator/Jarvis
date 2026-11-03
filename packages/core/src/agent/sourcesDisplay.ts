import { stripSourcesFooter } from './citations.js';

export interface SourceDisplayLink {
  label: string;
  url: string;
}

const FOOTER_LINE =
  /^-\s*\[\d+\]\s+.+\s+—\s+(.+?)\s+—\s+(https?:\/\/[^\s<>)\]]+)\s*$/iu;

/** Nom affiché : libellé média avant parenthèse de domaine ou virgule de date. */
export function mediaLabelFromFooterSegment(segment: string): string {
  const trimmed = segment.trim();
  const paren = trimmed.indexOf(' (');
  const base = paren >= 0 ? trimmed.slice(0, paren) : trimmed.split(',')[0]?.trim() ?? trimmed;
  return base.trim() || 'source';
}

function parseFooterLinks(footer: string): SourceDisplayLink[] {
  const links: SourceDisplayLink[] = [];
  for (const line of footer.split('\n')) {
    const match = line.match(FOOTER_LINE);
    if (!match?.[1] || !match[2]) continue;
    const url = match[2].replace(/[.,;:]+$/, '');
    if (!/^https?:\/\//i.test(url)) continue;
    links.push({ label: mediaLabelFromFooterSegment(match[1]), url });
  }
  return links;
}

/**
 * Corps affiché sans le bloc « Sources (recherche web du …) » et liens compacts
 * pour l'interface (fenêtre, téléphone). Le texte stocké reste inchangé.
 */
export function splitSourcesFooterForDisplay(text: string): {
  body: string;
  links: SourceDisplayLink[];
} {
  const body = stripSourcesFooter(text);
  const marker = '\n\nSources (recherche web du';
  const start = text.lastIndexOf(marker);
  if (start < 0) return { body, links: [] };
  const footer = text.slice(start);
  return { body, links: parseFooterLinks(footer) };
}

export function isSafeHttpUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
}
