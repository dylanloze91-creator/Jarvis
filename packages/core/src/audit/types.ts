import type { ToolCategory } from '../tools/types.js';
import type { ToolDecision } from '../types.js';

/**
 * Une ligne du journal d'audit : une exécution d'outil, qu'elle ait réussi,
 * échoué, ou été refusée. Chaque appel qui traverse le Tool Manager en
 * produit une, sans exception — c'est ce qui rend chaque action traçable.
 */
export interface AuditEntry {
  id: string;
  timestamp: number;
  toolName: string;
  category?: ToolCategory;
  arguments: Record<string, unknown>;
  decision: ToolDecision;
  status: 'ok' | 'error' | 'denied';
  /** Résultat renvoyé par l'outil, tronqué pour rester lisible dans la liste. */
  resultSummary: string;
  durationMs: number;
  /** Classification additive (§23), absente sur les journaux plus anciens. */
  outcome?:
    | 'success'
    | 'recoverable'
    | 'definitive'
    | 'timeout'
    | 'cancelled'
    | 'missing_dependency';
  /** Détail technique rédigé, absent quand l'outil n'en a pas fourni. */
  technicalDetail?: string;
}

export interface AuditLogStore {
  append(entry: AuditEntry): Promise<void>;
  list(limit?: number): Promise<AuditEntry[]>;
  clear(): Promise<void>;
}
