import { describe, expect, it } from 'vitest';
import {
  describeOtherConnectDevices,
  formatConnectDeviceInventory,
  isDesktopComputerDevice,
  isWebPlayerDevice,
  looksLikeLocalDesktopName,
  pickLocalDesktopDevice,
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
