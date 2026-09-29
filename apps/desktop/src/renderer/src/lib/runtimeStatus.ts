import type { RuntimeStatus } from '../../../shared/ipc';

/**
 * Démonstration = aucun vrai modèle derrière : repli faute de clé, ou
 * fournisseur de démo choisi (défaut d'une première installation).
 */
export function isDemoRuntime(status: Pick<RuntimeStatus, 'providerId' | 'usingFallback'>): boolean {
  return status.usingFallback || status.providerId === 'mock';
}
