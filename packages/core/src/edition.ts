import { join } from 'node:path';

/**
 * Ce qui change entre Jarvis Live et Jarvis Test. Une seule table :
 * le reste du code la consulte, il n'ajoute pas de `if (test)`.
 *
 * Live ne fige pas son dossier (`pinUserData: false`) : l'installateur
 * d'aujourd'hui utilise déjà `productName: Jarvis`, et le développement
 * garde le dossier qu'Electron a choisi. Test impose « Jarvis Test »
 * avant le verrou d'instance.
 */

export const RESERVED_FUNCTIONS = ['wakeWord', 'speaker', 'phone', 'shortcut'] as const;
export type ReservedFunction = (typeof RESERVED_FUNCTIONS)[number];

export const RESERVED_PHRASE = 'Réservé à Jarvis Live';

export type EditionId = 'live' | 'test';
export type UpdateChannel = 'latest' | 'test';

export interface EditionPorts {
  /** Connexion Spotify : même port pour les deux (adresse enregistrée). */
  spotify: number;
  /** Connexion Google : port préféré, le même pour les deux. */
  google: number;
  phone: number;
  speaker: number;
}

export interface EditionBadge {
  label: 'TEST';
  color: string;
}

export interface Edition {
  id: EditionId;
  productName: string;
  appId: string;
  /** `null` avec `pinUserData: false` : ne pas appeler `setPath`. */
  userDataDirName: string | null;
  pinUserData: boolean;
  shortcut: string;
  /** `null` : ne pas retomber sur un autre raccourci. */
  shortcutFallback: string | null;
  portBase: number;
  ports: EditionPorts;
  reservedFunctions: readonly ReservedFunction[];
  /** Test : ces fonctions ne démarrent pas tant qu'on ne les active pas. */
  reservedOffByDefault: boolean;
  reservedPhrase: string;
  updateChannel: UpdateChannel;
  allowPrerelease: boolean;
  badge: EditionBadge | null;
}

const PHONE_OFFSET = 6;
const SPEAKER_OFFSET = 7;
/** Adresses déjà enregistrées chez Spotify et Google. Elles ne suivent pas la base. */
const SPOTIFY_PORT = 53124;
const GOOGLE_PORT = 53125;

function buildPorts(base: number): EditionPorts {
  return {
    spotify: SPOTIFY_PORT,
    google: GOOGLE_PORT,
    phone: base + PHONE_OFFSET,
    speaker: base + SPEAKER_OFFSET,
  };
}

export const LIVE_EDITION: Edition = {
  id: 'live',
  productName: 'Jarvis',
  appId: 'com.thedexios.jarvis',
  userDataDirName: null,
  pinUserData: false,
  shortcut: 'Control+Space',
  shortcutFallback: 'Control+Space',
  portBase: 53124,
  ports: buildPorts(53124),
  reservedFunctions: RESERVED_FUNCTIONS,
  reservedOffByDefault: false,
  reservedPhrase: RESERVED_PHRASE,
  updateChannel: 'latest',
  allowPrerelease: false,
  badge: null,
};

export const TEST_EDITION: Edition = {
  id: 'test',
  productName: 'Jarvis Test',
  appId: 'com.thedexios.jarvis.test',
  userDataDirName: 'Jarvis Test',
  pinUserData: true,
  shortcut: 'Control+Alt+Space',
  shortcutFallback: null,
  portBase: 53224,
  ports: buildPorts(53224),
  reservedFunctions: RESERVED_FUNCTIONS,
  reservedOffByDefault: true,
  reservedPhrase: RESERVED_PHRASE,
  updateChannel: 'test',
  allowPrerelease: true,
  badge: { label: 'TEST', color: '#E07A1F' },
};

export function readEditionId(input: { env?: string; baked?: string } = {}): EditionId {
  if (input.env === 'live' || input.env === 'test') return input.env;
  if (input.baked === 'test') return 'test';
  return 'live';
}

export function editionById(id: EditionId): Edition {
  return id === 'test' ? TEST_EDITION : LIVE_EDITION;
}

/**
 * Édition demandée par les valeurs données (variable d'environnement
 * ou champ écrit à la construction). Rien de donné : Live.
 * Le cœur ne lit pas `process` : c'est l'application qui transmet.
 */
export function edition(source: { env?: string; baked?: string } = {}): Edition {
  return editionById(readEditionId(source));
}

export interface EditionPathHost {
  appData(): string;
  ensureDir(dir: string): void;
  setPath(name: 'userData' | 'sessionData', dir: string): void;
}

/** Dossier à imposer, ou `null` quand il faut laisser Electron décider (Live). */
export function editionUserDataDir(current: Edition, appData: string): string | null {
  if (!current.pinUserData || !current.userDataDirName) return null;
  return join(appData, current.userDataDirName);
}

/**
 * À appeler avant `ready` et avant le premier `getPath('userData')`.
 * Live : ne touche à rien. Test : crée son dossier, puis `userData` et
 * `sessionData` (cookies et cache) vers ce dossier, jamais celui de Live.
 */
export function applyEditionPaths(current: Edition, host: EditionPathHost): void {
  const dir = editionUserDataDir(current, host.appData());
  if (!dir) return;
  host.ensureDir(dir);
  host.setPath('userData', dir);
  host.setPath('sessionData', dir);
}
