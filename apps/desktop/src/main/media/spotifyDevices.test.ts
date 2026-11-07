import { describe, expect, it } from 'vitest';
import {
  describeOtherConnectDevices,
  formatConnectDeviceInventory,
  isDesktopComputerDevice,
  isWebPlayerDevice,
  looksLikeLocalDesktopName,
  pickLocalDesktopDevice,
  listConnectSpeakers,
  pickNamedConnectDevice,
} from './spotifyDevices.js';
import { windowsSpotifyExeCandidates } from './launchSpotifyDesktop.js';

const phone = {
  id: 'phone-1',
  is_active: true,
  is_restricted: false,
  name: 'iPhone',
  type: 'Smartphone',
};

const web = {
  id: 'web-1',
  is_active: true,
  is_restricted: false,
  name: 'Web Player (Chrome)',
  type: 'Computer',
};

const desktop = {
  id: 'pc-1',
  is_active: false,
  is_restricted: false,
  name: 'DESKTOP-THX',
  type: 'Computer',
};

const ordinateur = {
  id: 'pc-fr',
  is_active: true,
  is_restricted: false,
  name: 'Ordinateur',
  type: 'Computer',
};

const devialet = {
  id: 'dev-1',
  is_active: false,
  is_restricted: false,
  name: 'Devialet Phantom',
  type: 'Speaker',
};

describe('pickNamedConnectDevice', () => {
  it('renvoie null si le réglage est vide (mode bureau)', () => {
    expect(pickNamedConnectDevice([devialet], '')).toBeNull();
    expect(pickNamedConnectDevice([devialet], '   ')).toBeNull();
  });

  it('trouve une correspondance exacte insensible à la casse et aux accents', () => {
    expect(pickNamedConnectDevice([devialet], 'devialet phantom')?.id).toBe('dev-1');
    expect(pickNamedConnectDevice([devialet], 'DÉVIALET PHANTOM')?.id).toBe('dev-1');
  });

  it('accepte une correspondance partielle (le nom contient la cible)', () => {
    expect(pickNamedConnectDevice([devialet], 'Devialet')?.id).toBe('dev-1');
  });

  it('renvoie null si l’enceinte est absente', () => {
    expect(pickNamedConnectDevice([phone, desktop], 'Devialet')).toBeNull();
  });
});

describe('spotifyDevices', () => {
  it('ne traite pas le lecteur web comme l’appli de bureau', () => {
    expect(isWebPlayerDevice(web)).toBe(true);
    expect(isDesktopComputerDevice(web)).toBe(false);
    expect(isDesktopComputerDevice(desktop)).toBe(true);
    expect(isDesktopComputerDevice(phone)).toBe(false);
  });

  it('accepte les noms français de PC (Ordinateur, Cet ordinateur)', () => {
    expect(looksLikeLocalDesktopName('Ordinateur')).toBe(true);
    expect(looksLikeLocalDesktopName('Cet ordinateur')).toBe(true);
    expect(looksLikeLocalDesktopName('Computer')).toBe(true);
    expect(isDesktopComputerDevice({ ...ordinateur, is_active: false })).toBe(true);
    expect(
      isDesktopComputerDevice({
        id: 'pc-cet',
        is_active: false,
        is_restricted: false,
        name: 'Cet ordinateur',
        type: 'Computer',
      }),
    ).toBe(true);
  });

  it('préfère l’ordinateur local même si le téléphone est déjà actif', () => {
    expect(pickLocalDesktopDevice([phone, desktop])?.id).toBe('pc-1');
  });

  it('parmi plusieurs Computer, préfère celui déjà actif', () => {
    expect(pickLocalDesktopDevice([desktop, ordinateur], 'DESKTOP-THX')?.id).toBe('pc-fr');
  });

  it('préfère le nom qui contient le hostname s’il n’y a pas d’actif', () => {
    const otherPc = { ...desktop, id: 'pc-2', name: 'AUTRE-PC' };
    expect(pickLocalDesktopDevice([otherPc, desktop], 'DESKTOP-THX')?.id).toBe('pc-1');
  });

  it('ignore le Web Player au profit du vrai client Computer', () => {
    expect(pickLocalDesktopDevice([web, desktop])?.id).toBe('pc-1');
  });

  it('liste téléphone / web quand le bureau est absent', () => {
    expect(describeOtherConnectDevices([phone, web])).toContain('iPhone');
    expect(describeOtherConnectDevices([phone, web])).toMatch(/Web Player/i);
  });

  it('formate la liste brute des appareils pour le diagnostic', () => {
    const text = formatConnectDeviceInventory([ordinateur, phone]);
    expect(text).toMatch(/Appareils Connect/);
    expect(text).toMatch(/Ordinateur/);
    expect(text).toMatch(/actif=oui/);
    expect(text).toMatch(/iPhone/);
  });
});

describe('windowsSpotifyExeCandidates', () => {
  it('liste les enceintes Connect hors PC et téléphone', () => {
    const speaker = {
      id: 'sp-1',
      is_active: false,
      is_restricted: false,
      name: 'Devialet',
      type: 'Speaker',
    };
    expect(listConnectSpeakers([phone, web, desktop, speaker])).toEqual([speaker]);
  });

  it('pointe vers AppData\\Spotify, WindowsApps et le menu Démarrer', () => {
    const paths = windowsSpotifyExeCandidates({
      APPDATA: 'C:\\Users\\dex\\AppData\\Roaming',
      LOCALAPPDATA: 'C:\\Users\\dex\\AppData\\Local',
      USERPROFILE: 'C:\\Users\\dex',
      ProgramData: 'C:\\ProgramData',
    });
    expect(paths.some((path) => /Roaming[/\\]Spotify[/\\]Spotify\.exe$/i.test(path))).toBe(true);
    expect(paths.some((path) => /WindowsApps[/\\]Spotify\.exe$/i.test(path))).toBe(true);
    expect(paths.some((path) => /Start Menu[/\\]Programs[/\\]Spotify\.lnk$/i.test(path))).toBe(true);
  });
});
