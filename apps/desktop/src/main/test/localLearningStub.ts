import type { LocalLearningController } from '../learning/controller.js';

/** Stub minimal pour les tests de session (pas d’entraînement réel). */
export function stubLocalLearning(): LocalLearningController {
  return {
    status: () => ({ running: false, line: null }),
    recordTurn: async () => {},
    registerIpc: () => {},
    trainNow: async () => {},
  } as unknown as LocalLearningController;
}
