/** Exemple SFT issu d’un tour de discussion sur ce PC (jamais envoyé ailleurs). */
export interface LocalLearningExample {
  id: string;
  at: number;
  user: string;
  assistant: string;
  /** Correction explicite de l’utilisateur sur la réponse précédente. */
  correction?: string;
  /** Outils ayant réussi sur ce tour. */
  toolsOk: string[];
  conversationId: string;
}

export interface LocalLearningTrainPlan {
  /** Modèle Ollama de discussion installé. */
  chatModel: string;
  /** Modèle sur lequel l’adaptateur QLoRA sera entraîné (≤ ~3B sur 6 Go VRAM). */
  trainBaseModel: string;
  /** Explication courte pour l’interface (une ligne). */
  trainNote: string;
  /** Le chat peut utiliser directement l’adaptateur sur le même socle. */
  sameBaseAsChat: boolean;
}

export type LocalLearningRuntimeStatus = {
  running: boolean;
  /** Ligne discrète sous la discussion ; null si rien à afficher. */
  line: string | null;
};
