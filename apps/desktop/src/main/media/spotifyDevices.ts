/**
 * Choix d'un lecteur Spotify Connect : l'application de bureau Windows,
 * pas le téléphone ni le lecteur web, même s'ils sont déjà « actifs ».
 *
 * Noms vus sur un PC français : « Ordinateur », « Cet ordinateur »,
 * « Computer », « DESKTOP-… », le hostname Windows.
 */

export type ConnectDevice = {
  id: string | null;
  is_active: boolean;
  is_restricted: boolean;
  name: string;
  type: string;
  volume_percent?: number | null;
};

const WEB_PLAYER_NAME =
  /web\s*player|lecteur\s*web|spotify\s*web|webview|navigateur|\bbrowser\b/i;

const NON_DESKTOP_TYPE =
  /smartphone|tablet|speaker|tv|avr|stb|audiodongle|gameconsole|castvideo|castaudio|automobile|phone/i;

const LOCAL_PC_NAME =
  /^(cet\s+)?ordinateur(\s+(portable|de\s+bureau))?\s*$|^computer\s*$|^ce\s+pc\s*$|^this\s+(pc|computer)\s*$|^desktop[-_]/i;

export function isWebPlayerDevice(device: ConnectDevice): boolean {
  return WEB_PLAYER_NAME.test(device.name);
}

export function looksLikeLocalDesktopName(name: string, hostname = ''): boolean {
  const trimmed = name.trim();
  if (!trimmed) return false;
  if (LOCAL_PC_NAME.test(trimmed)) return true;
  const host = hostname.trim().toLowerCase();
  if (host && trimmed.toLowerCase().includes(host)) return true;
  return false;
}

export function isDesktopComputerDevice(device: ConnectDevice, hostname = ''): boolean {
  if (device.is_restricted || !device.id) return false;
  if (isWebPlayerDevice(device)) return false;
  if (NON_DESKTOP_TYPE.test(device.type)) return false;

  const type = device.type.trim().toLowerCase();
  const typeLooksPc = type === 'computer' || /ordinateur|desktop|\bpc\b/.test(type);
  if (typeLooksPc) return true;
  return looksLikeLocalDesktopName(device.name, hostname);
}

/**
 * Parmi les ordinateurs : l'appareil déjà actif, puis le hostname local,
 * puis un nom FR/EN de PC, puis le premier Computer. Jamais le téléphone.
 */
export function pickLocalDesktopDevice(
  devices: ConnectDevice[],
  hostname = '',
): ConnectDevice | null {
  const computers = devices.filter((device) => isDesktopComputerDevice(device, hostname));
  if (computers.length === 0) return null;

  const active = computers.filter((device) => device.is_active);
  const pool = active.length > 0 ? active : computers;

  const host = hostname.trim().toLowerCase();
  if (host) {
    const byHost = pool.find((device) => device.name.toLowerCase().includes(host));
    if (byHost) return byHost;
  }

  const byLocalName = pool.find((device) => looksLikeLocalDesktopName(device.name, hostname));
  if (byLocalName) return byLocalName;

  const namedSpotify = pool.find((device) => /spotify/i.test(device.name));
  return namedSpotify ?? pool[0] ?? null;
}

export function describeOtherConnectDevices(devices: ConnectDevice[]): string {
  const others = devices
    .filter((device) => device.id && !device.is_restricted && !isDesktopComputerDevice(device))
    .map((device) => device.name || device.type);
  return [...new Set(others)].join(', ');
}

/** Liste brute pour le message d'outil (prochain échec diagnostiquable). */
export function formatConnectDeviceInventory(devices: ConnectDevice[]): string {
  if (devices.length === 0) return 'Appareils Connect : aucun.';
  const parts = devices.map((device) => {
    const active = device.is_active ? 'oui' : 'non';
    const volume =
      device.volume_percent == null ? 'vol=?' : `vol=${device.volume_percent}`;
    const id = device.id ? `id=${device.id}` : 'id=null';
    const restricted = device.is_restricted ? ' restreint' : '';
    return `[name=« ${device.name || '?'} » type=${device.type || '?'} actif=${active} ${volume} ${id}${restricted}]`;
  });
  return `Appareils Connect : ${parts.join(' ; ')}`;
}

export function formatPlaybackDiagnostic(
  devices: ConnectDevice[],
  state: {
    is_playing?: boolean;
    device?: { id?: string | null; name?: string; type?: string } | null;
  } | null,
  selected?: ConnectDevice | null,
): string {
  const playing =
    state == null ? 'inconnu (204)' : state.is_playing === true ? 'true' : 'false';
  const name = state?.device?.name ?? selected?.name ?? 'aucun';
  const type = state?.device?.type ?? selected?.type ?? '?';
  return `${formatConnectDeviceInventory(devices)} État : is_playing=${playing}, appareil=« ${name} » (${type}).`;
}
