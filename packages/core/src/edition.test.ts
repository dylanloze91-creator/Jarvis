import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { GOOGLE_OAUTH_PORT } from './google/scopes.js';
import { PHONE_PORT } from './phone/phone.js';
import { SPEAKER_PORT } from './speaker/speaker.js';
import {
  LIVE_EDITION,
  TEST_EDITION,
  applyEditionPaths,
  edition,
  editionUserDataDir,
  grantReservation,
  hotkeyFallback,
  hotkeyToRegister,
  reservedAllows,
  reservedHeld,
  type EditionPathHost,
} from './edition.js';

const LIVE_TODAY = {
  id: 'live',
  productName: 'Jarvis',
  appId: 'com.thedexios.jarvis',
  userDataDirName: null,
  pinUserData: false,
  shortcut: 'Control+Space',
  shortcutFallback: 'Control+Space',
  portBase: 53124,
  ports: { spotify: 53124, google: 53125, phone: 53130, speaker: 53131 },
  reservedFunctions: ['wakeWord', 'speaker', 'phone', 'shortcut'],
  reservedOffByDefault: false,
  reservedPhrase: 'Réservé à Jarvis Live',
  updateChannel: 'latest',
  allowPrerelease: false,
  badge: null,
} as const;

describe('édition Live', () => {
  it('est exactement celle d’aujourd’hui, champ par champ', () => {
    expect(edition({ env: undefined, baked: undefined })).toEqual(LIVE_TODAY);
    expect(LIVE_EDITION).toEqual(LIVE_TODAY);
    expect(LIVE_EDITION.ports.speaker).toBe(SPEAKER_PORT);
    expect(LIVE_EDITION.ports.phone).toBe(PHONE_PORT);
    expect(LIVE_EDITION.ports.google).toBe(GOOGLE_OAUTH_PORT);
    expect(LIVE_EDITION.ports.spotify).toBe(53124);
  });

  it('ne change pas le dossier de réglages', () => {
    const host = fakeHost();
    applyEditionPaths(LIVE_EDITION, host);
    expect(host.calls).toEqual([]);
    expect(editionUserDataDir(LIVE_EDITION, join('appdata', 'Roaming'))).toBeNull();
  });
});

describe('édition Test', () => {
  it('a son dossier, ses ports longs et le même canal Spotify et Google', () => {
    expect(edition({ env: 'test' })).toBe(TEST_EDITION);
    expect(TEST_EDITION.userDataDirName).not.toBe('Jarvis');
    expect(TEST_EDITION.pinUserData).toBe(true);
    expect(TEST_EDITION.ports.phone).not.toBe(PHONE_PORT);
    expect(TEST_EDITION.ports.speaker).not.toBe(SPEAKER_PORT);
    expect(TEST_EDITION.ports.phone).toBe(53230);
    expect(TEST_EDITION.ports.speaker).toBe(53231);
    expect(TEST_EDITION.ports.spotify).toBe(LIVE_EDITION.ports.spotify);
    expect(TEST_EDITION.ports.google).toBe(LIVE_EDITION.ports.google);
    expect(TEST_EDITION.shortcut).toBe('Control+Alt+Space');
    expect(TEST_EDITION.shortcutFallback).toBeNull();
    expect(TEST_EDITION.updateChannel).toBe('test');
    expect(TEST_EDITION.allowPrerelease).toBe(true);
    expect(TEST_EDITION.reservedOffByDefault).toBe(true);
    expect(TEST_EDITION.badge).toEqual({ label: 'TEST', color: '#E07A1F' });
  });

  it('impose son dossier, pas celui de Live', () => {
    const host = fakeHost();
    const appData = join('Users', 'Roaming');
    host.appDataDir = appData;
    applyEditionPaths(TEST_EDITION, host);
    const dir = join(appData, 'Jarvis Test');
    expect(dir).not.toBe(join(appData, 'Jarvis'));
    expect(host.calls).toEqual([`dir:${dir}`, `userData:${dir}`, `sessionData:${dir}`]);
  });
});

describe('fonctions réservées', () => {
  it('Live les laisse au réglage, Test les coupe tant qu’on ne les active pas', () => {
    for (const name of ['wakeWord', 'speaker', 'phone', 'shortcut'] as const) {
      expect(reservedHeld(LIVE_EDITION, {}, name)).toBe(false);
      expect(reservedAllows(LIVE_EDITION, {}, name)).toBe(true);
      expect(reservedHeld(TEST_EDITION, {}, name)).toBe(true);
      expect(reservedAllows(TEST_EDITION, grantReservation({}, name), name)).toBe(true);
    }
  });

  it('le raccourci de Test n’est pas Ctrl+Espace, et Live garde son repli', () => {
    expect(hotkeyToRegister(LIVE_EDITION, 'Control+Space', true)).toBe('Control+Space');
    expect(hotkeyToRegister(LIVE_EDITION, 'Alt+J', true)).toBe('Alt+J');
    expect(hotkeyToRegister(TEST_EDITION, 'Control+Space', false)).toBeNull();
    expect(hotkeyToRegister(TEST_EDITION, 'Control+Space', true)).toBe('Control+Alt+Space');
    expect(hotkeyToRegister(TEST_EDITION, 'Alt+J', true)).toBe('Alt+J');
    expect(hotkeyFallback(LIVE_EDITION, 'Alt+J')).toBe('Control+Space');
    expect(hotkeyFallback(LIVE_EDITION, 'Control+Space')).toBeNull();
    expect(hotkeyFallback(TEST_EDITION, 'Control+Alt+Space')).toBeNull();
  });
});

describe('choix de l’édition', () => {
  it('Live sans rien, Test seulement si on le demande', () => {
    expect(edition({}).id).toBe('live');
    expect(edition({ baked: 'test' }).id).toBe('test');
    expect(edition({ env: 'live', baked: 'test' }).id).toBe('live');
    expect(edition({ env: 'autre', baked: 'test' }).id).toBe('test');
    expect(edition({ env: 'autre' }).id).toBe('live');
  });
});

function fakeHost(): EditionPathHost & { calls: string[]; appDataDir: string } {
  const host = {
    calls: [] as string[],
    appDataDir: 'appdata',
    appData: () => host.appDataDir,
    ensureDir: (dir: string) => {
      host.calls.push(`dir:${dir}`);
    },
    setPath: (name: 'userData' | 'sessionData', dir: string) => {
      host.calls.push(`${name}:${dir}`);
    },
  };
  return host;
}
