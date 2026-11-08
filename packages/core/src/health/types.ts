/** Contrôles du bilan, dans l'ordre affiché. Un service non réglé n'apparaît pas. */
export const HEALTH_CHECK_ORDER = [
  'ollama',
  'models',
  'voice',
  'piper',
  'spotify',
  'google',
  'phone',
  'speakers',
  'robot',
  'printer',
  'disk',
  'backup',
  'vault',
] as const;

export type HealthCheckId = (typeof HEALTH_CHECK_ORDER)[number];

export type HealthLevel = 'green' | 'orange' | 'red';

/** Chaque contrôle est borné à 3 s ; le bilan entier à 10 s. */
export const HEALTH_CHECK_TIMEOUT_MS = 3_000;
export const HEALTH_TOTAL_TIMEOUT_MS = 10_000;

/** Alerte disque en dessous de 10 Go. */
export const HEALTH_DISK_ALERT_BYTES = 10 * 1024 * 1024 * 1024;

export interface HealthItem {
  id: HealthCheckId;
  level: HealthLevel;
  /** Phrase simple, tutoiement. */
  sentence: string;
  /** Court libellé pour la voix (« Ollama », « le modèle … »). */
  short: string;
  /** Clé de la carte des réglages ouverte par le bouton. */
  open: string;
}

export interface HealthReport {
  items: HealthItem[];
  /** Nombre de contrôles qui ne sont pas verts. */
  issues: number;
  /** Bandeau d'accueil. `null` si tout est vert. */
  banner: string | null;
  /** Bilan complet, pour la discussion écrite. */
  text: string;
  /** Phrase courte, pour la voix. */
  voice: string;
  at: number;
}

export type ProbeResult<T> = T | 'timeout' | 'skip';

export interface HealthFacts {
  ollama: ProbeResult<{ reachable: boolean }>;
  models: ProbeResult<{ missing: Array<{ name: string; role: string; open: string }> }>;
  voice: ProbeResult<{ missing: number }>;
  piper: ProbeResult<{ ready: boolean }>;
  spotify: ProbeResult<{ tokenOk: boolean; speakerName: string; speakerVisible: boolean | null }>;
  google: ProbeResult<{ needsReconsent: boolean; connected: boolean }>;
  phone: ProbeResult<{ published: boolean }>;
  speakers: ProbeResult<{ heard: boolean }>;
  robot: ProbeResult<{ reachable: boolean }>;
  printer: ProbeResult<{ reachable: boolean }>;
  disk: ProbeResult<{ freeBytes: number }>;
  backup: ProbeResult<{ configured: boolean; lastAt: number | null; ok: boolean; stale: boolean }>;
  vault: ProbeResult<{ encryptionAvailable: boolean }>;
  now?: number;
}
