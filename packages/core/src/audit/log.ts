import { randomId } from '../types.js';
import type { ToolCallOutcome } from '../types.js';
import type { AuditEntry, AuditLogStore } from './types.js';

const SUMMARY_MAX_LENGTH = 400;

/**
 * Construit l'entrée d'audit à partir du résultat d'exécution d'un outil. Le
 * Tool Manager produit déjà toute l'information nécessaire (arguments,
 * décision, durée) : cette fonction se limite à l'horodatage et à la
 * troncature du résultat pour l'affichage.
 */
export function buildAuditEntry(outcome: ToolCallOutcome): AuditEntry {
  return {
    id: randomId(),
    timestamp: Date.now(),
    toolName: outcome.name,
    category: outcome.category,
    arguments: outcome.arguments,
    decision: outcome.decision,
    status: outcome.status,
    resultSummary: truncate(outcome.content, SUMMARY_MAX_LENGTH),
    durationMs: outcome.durationMs,
  };
}

function truncate(text: string, max: number): string {
  const oneLine = text.replace(/\s+/g, ' ').trim();
  return oneLine.length > max ? `${oneLine.slice(0, max - 1)}…` : oneLine;
}

/** Implémentation en mémoire : sert aux tests et de valeur par défaut hors Electron. */
export class InMemoryAuditLogStore implements AuditLogStore {
  private entries: AuditEntry[] = [];

  constructor(private readonly capacity = 500) {}

  async append(entry: AuditEntry): Promise<void> {
    this.entries.push(entry);
    if (this.entries.length > this.capacity) {
      this.entries.splice(0, this.entries.length - this.capacity);
    }
  }

  async list(limit?: number): Promise<AuditEntry[]> {
    const sorted = [...this.entries].sort((a, b) => b.timestamp - a.timestamp);
    return limit ? sorted.slice(0, limit) : sorted;
  }

  async clear(): Promise<void> {
    this.entries = [];
  }
}
