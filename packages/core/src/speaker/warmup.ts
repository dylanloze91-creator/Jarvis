/**
 * Chargement seul d'un modèle Ollama : requête vide, aucune génération.
 * Documentation : https://github.com/ollama/ollama/blob/main/docs/api.md
 * (« Load a model » : un prompt vide charge le modèle ; `keep_alive` dit
 * combien de temps il reste en mémoire, un nombre négatif le garde).
 */

export const SPEAKER_WAKE_KEEP_ALIVE = '10m';
/**
 * « Garder Jarvis éveillé » : une garde plus longue après chaque réveil d'enceinte. Jusqu'à la 5.0.81
 * c'était -1 (sans limite) : le modèle occupait la carte graphique jour et nuit, même Jarvis fermé, et
 * l'affichage de Windows saccadait (27 novembre 2026). La garde est maintenant bornée, et Jarvis libère
 * de lui-même ses modèles après dix minutes sans usage (`agent/modelIdle.ts`).
 */
export const SPEAKER_AWAKE_KEEP_ALIVE = '30m';
export const SPEAKER_WAKE_INTERVAL_MS = 10_000;

export interface OllamaLoadRequest {
  model: string;
  /** Vide : chargement seul, pas une génération. */
  prompt: '';
  keep_alive: string | number;
  stream: false;
  /** Jarvis Test : mêmes `num_ctx` / `num_gpu` que le chat (`ollamaLoadOptions`). */
  options?: { num_ctx: number; num_gpu?: number };
}

export interface SpeakerWarmupSettings {
  provider: string;
  model: string;
  orchestra?: {
    enabled?: boolean;
    brain?: string;
    router?: { model?: string };
    teams?: { conversation?: { model?: string } };
  };
  speakerKeepAwake?: boolean;
  speakerFastMode?: boolean;
}

function named(value: string | undefined): string | null {
  const trimmed = value?.trim() ?? '';
  return trimmed ? trimmed : null;
}

/**
 * Modèle qui trie (trieur s'il est réglé, sinon cerveau) et modèle de
 * l'équipe Conversation. Sans orchestre : le modèle du chat, une seule fois.
 */
export function speakerWarmupRequests(settings: SpeakerWarmupSettings): OllamaLoadRequest[] {
  if (settings.provider !== 'ollama') return [];
  const orchestra = settings.orchestra;
  const orchestraOn = orchestra?.enabled === true;
  const brain = orchestraOn ? named(orchestra?.brain) : null;
  const chat = named(settings.model);
  const sorter = (orchestraOn ? named(orchestra?.router?.model) : null) ?? brain ?? chat;
  const conversation = (orchestraOn ? named(orchestra?.teams?.conversation?.model) : null) ?? brain ?? chat;
  if (!sorter && !conversation) return [];
  const keepAwake = settings.speakerKeepAwake === true || settings.speakerFastMode === true;
  const requests: OllamaLoadRequest[] = [];
  const push = (model: string | null, keepAlive: string | number): void => {
    if (!model) return;
    if (requests.some((item) => item.model === model)) {
      const existing = requests.find((item) => item.model === model)!;
      if (keepAlive === SPEAKER_AWAKE_KEEP_ALIVE) existing.keep_alive = keepAlive;
      return;
    }
    requests.push({ model, prompt: '', keep_alive: keepAlive, stream: false });
  };
  push(sorter, keepAwake ? SPEAKER_AWAKE_KEEP_ALIVE : SPEAKER_WAKE_KEEP_ALIVE);
  push(conversation, SPEAKER_WAKE_KEEP_ALIVE);
  return requests;
}

/** Vrai si la requête ne demande aucune génération (prompt vide, pas de messages). */
export function isOllamaLoadOnly(body: unknown): boolean {
  if (!body || typeof body !== 'object') return false;
  const record = body as Record<string, unknown>;
  if (record.prompt !== '') return false;
  if ('messages' in record) return false;
  if (record.stream !== false) return false;
  if (typeof record.model !== 'string' || !record.model.trim()) return false;
  return true;
}
