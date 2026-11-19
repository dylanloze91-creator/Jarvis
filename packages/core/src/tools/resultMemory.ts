/**
 * Mémoire courte des résultats d'outils (mission « Jarvis plus rapide, sans nouveau modèle »).
 *
 * La même question deux fois de suite ne refait pas le travail : un résultat **réussi** d'un outil
 * de **lecture** est gardé quelques minutes. La durée de chaque outil est écrite ici. Un outil
 * qui agit (musique, robot, imprimante, enceinte, fichiers, applications) n'est pas dans la
 * table : il n'est jamais gardé.
 */
import type { ToolResult } from './types.js';

const MINUTE = 60_000;

/** Durée de garde par outil. Un outil absent de cette table n'est jamais gardé. */
export const TOOL_MEMORY_TTL_MS: Readonly<Record<string, number>> = {
  // Recherche et lecture de pages : une actualité ne change pas en cinq minutes.
  web_search: 5 * MINUTE,
  web_research: 5 * MINUTE,
  fetch_page: 5 * MINUTE,
  // Actualité et météo du moment : un peu plus court.
  web_search_current: 3 * MINUTE,
  // Un cours bouge pendant la séance.
  get_stock_quote: 2 * MINUTE,
  // Une vidéo ne change pas, et l'écouter prend des minutes.
  youtube_transcript: 30 * MINUTE,
};

/** Résultats gardés au plus : au-delà, le plus ancien part. */
export const TOOL_MEMORY_MAX_ENTRIES = 40;

export interface KeptToolResult {
  result: ToolResult;
  /** Âge du résultat, en millisecondes. */
  ageMs: number;
}

interface Entry {
  result: ToolResult;
  at: number;
}

/** Clé stable : les mêmes arguments dans un autre ordre donnent la même clé. */
function stable(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`;
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stable(record[key])}`)
      .join(',')}}`;
  }
  // Une demande tapée avec des espaces en trop reste la même demande. La casse est gardée :
  // deux adresses de page peuvent ne différer que par elle.
  if (typeof value === 'string') return JSON.stringify(value.trim().replace(/\s+/g, ' '));
  return JSON.stringify(value) ?? 'null';
}

/** « vieille de 40 s », « vieille de 3 min ». */
export function keptAgeText(ageMs: number): string {
  if (ageMs < MINUTE) return `réponse gardée, vieille de ${Math.max(1, Math.round(ageMs / 1000))} s`;
  return `réponse gardée, vieille de ${Math.round(ageMs / MINUTE)} min`;
}

export class ToolResultMemory {
  private readonly entries = new Map<string, Entry>();

  constructor(
    private readonly ttls: Readonly<Record<string, number>> = TOOL_MEMORY_TTL_MS,
    private readonly now: () => number = Date.now,
    private readonly maxEntries: number = TOOL_MEMORY_MAX_ENTRIES,
  ) {}

  /** Vrai si cet outil peut être gardé (il est dans la table des durées). */
  keeps(name: string): boolean {
    return (this.ttls[name] ?? 0) > 0;
  }

  /**
   * `extra` : ce qui change le résultat sans être dans les arguments (ex. la place préférée
   * du chemin bourse express).
   */
  private key(name: string, args: unknown, extra: unknown): string {
    return `${name}|${stable(args)}|${stable(extra ?? null)}`;
  }

  lookup(name: string, args: unknown, extra?: unknown): KeptToolResult | null {
    const ttl = this.ttls[name] ?? 0;
    if (ttl <= 0) return null;
    const key = this.key(name, args, extra);
    const entry = this.entries.get(key);
    if (!entry) return null;
    const ageMs = this.now() - entry.at;
    if (ageMs < 0 || ageMs >= ttl) {
      this.entries.delete(key);
      return null;
    }
    return { result: entry.result, ageMs };
  }

  /** Seul un résultat réussi d'un outil de la table est gardé. */
  store(name: string, args: unknown, extra: unknown, result: ToolResult): void {
    if (!this.keeps(name) || !result.ok) return;
    if (result.outcome !== undefined && result.outcome !== 'success') return;
    const key = this.key(name, args, extra);
    this.entries.delete(key);
    this.entries.set(key, { result, at: this.now() });
    while (this.entries.size > this.maxEntries) {
      const oldest = this.entries.keys().next().value;
      if (oldest === undefined) break;
      this.entries.delete(oldest);
    }
  }

  /** Réglages changés (moteur de recherche, clé…) : rien de l'ancien réglage ne doit resservir. */
  clear(): void {
    this.entries.clear();
  }

  get size(): number {
    return this.entries.size;
  }
}
