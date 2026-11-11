/**
 * Lignes échangées avec la carte pendant l'installation. Le mot de passe ne sort
 * jamais dans un journal : `redactProvision` le masque avant tout affichage.
 */

export const PROVISION_TOKEN_HEX = /^[0-9a-fA-F]{64}$/;
export const PROVISION_PC_ID_HEX = /^[0-9a-fA-F]{8}$/;

export interface ProvisionConfig {
  ssid: string;
  pass: string;
  name: string;
  token: string;
  pcId: string;
  port: number;
  hosts: string[];
}

export type ProvisionError = 'ssid' | 'pass' | 'name' | 'token' | 'pc_id' | 'port' | 'hosts';

const IPV4 = /^(?:25[0-5]|2[0-4]\d|1?\d?\d)(?:\.(?:25[0-5]|2[0-4]\d|1?\d?\d)){3}$/;

function utf8Bytes(value: string): number {
  return new TextEncoder().encode(value).length;
}

function charCount(value: string): number {
  return [...value].length;
}

export function validateProvision(config: ProvisionConfig): { ok: true } | { ok: false; error: ProvisionError } {
  const ssidBytes = utf8Bytes(config.ssid);
  const control = [...config.ssid].some((char) => char.charCodeAt(0) < 32);
  if (ssidBytes < 1 || ssidBytes > 32 || control) return { ok: false, error: 'ssid' };
  if (config.pass.length !== 0 && (config.pass.length < 8 || config.pass.length > 63 || /[^\u0020-\u007e]/.test(config.pass))) {
    return { ok: false, error: 'pass' };
  }
  const nameChars = charCount(config.name.trim());
  if (nameChars < 1 || nameChars > 24) return { ok: false, error: 'name' };
  if (!PROVISION_TOKEN_HEX.test(config.token)) return { ok: false, error: 'token' };
  if (!PROVISION_PC_ID_HEX.test(config.pcId)) return { ok: false, error: 'pc_id' };
  if (!Number.isInteger(config.port) || config.port < 1 || config.port > 65535) return { ok: false, error: 'port' };
  if (config.hosts.length > 4 || config.hosts.some((host) => !IPV4.test(host))) return { ok: false, error: 'hosts' };
  return { ok: true };
}

export function buildConfigLine(config: ProvisionConfig): string {
  const check = validateProvision(config);
  if (!check.ok) throw new Error(check.error);
  const body = {
    ssid: config.ssid,
    pass: config.pass,
    name: config.name.trim(),
    token: config.token.toLowerCase(),
    pc_id: config.pcId.toLowerCase(),
    port: config.port,
    hosts: config.hosts,
  };
  return `config ${JSON.stringify(body)}`;
}

/** Le mot de passe disparaît. Le reste de la ligne reste lisible. */
export function redactProvision(line: string): string {
  return line.replace(/("pass"\s*:\s*")([^"]*)(")/g, '$1***$3');
}

export interface JarvisMessage {
  raw: string;
  json: Record<string, unknown>;
}

/** Extrait les lignes `JARVIS> {json}` au milieu d'un journal bruité. */
export function takeJarvisMessages(buffer: string): { messages: JarvisMessage[]; rest: string } {
  const messages: JarvisMessage[] = [];
  const lines = buffer.split('\n');
  const rest = lines.pop() ?? '';
  for (const line of lines) {
    const marker = line.indexOf('JARVIS>');
    if (marker < 0) continue;
    const jsonText = line.slice(marker + 'JARVIS>'.length).trim();
    try {
      const json = JSON.parse(jsonText) as unknown;
      if (!json || typeof json !== 'object' || Array.isArray(json)) continue;
      messages.push({ raw: line.trim(), json: json as Record<string, unknown> });
    } catch {
      continue;
    }
  }
  return { messages, rest };
}

export interface WifiSeen {
  ssid: string;
  rssi: number;
  secure: boolean;
}

export function readWifiScan(json: Record<string, unknown>): WifiSeen[] {
  const list = json.networks;
  if (!Array.isArray(list)) return [];
  const seen = new Set<string>();
  const out: WifiSeen[] = [];
  for (const item of list) {
    if (!item || typeof item !== 'object') continue;
    const row = item as Record<string, unknown>;
    if (typeof row.ssid !== 'string' || !row.ssid.trim()) continue;
    const rssi = typeof row.rssi === 'number' ? row.rssi : -100;
    if (seen.has(row.ssid)) {
      const previous = out.find((item) => item.ssid === row.ssid);
      if (previous && rssi > previous.rssi) previous.rssi = rssi;
      continue;
    }
    seen.add(row.ssid);
    out.push({
      ssid: row.ssid,
      rssi,
      secure: row.secure !== false,
    });
  }
  return out.sort((a, b) => b.rssi - a.rssi);
}

export interface FailureCopy {
  sentence: string;
  button: string;
}

const WIFI_COPY: Record<string, FailureCopy> = {
  wrong_password: { sentence: 'Le mot de passe n’est pas le bon.', button: 'Corriger' },
  not_found: { sentence: 'L’enceinte ne voit pas ce réseau.', button: 'Choisir un autre' },
  no_ip: { sentence: 'La box n’a pas donné d’adresse à l’enceinte.', button: 'Réessayer' },
  timeout: { sentence: 'L’enceinte n’a pas réussi à se connecter.', button: 'Réessayer' },
  pc_not_found: { sentence: 'L’enceinte ne trouve pas ce PC.', button: 'Voir le diagnostic' },
  refused: { sentence: 'Le PC a refusé la connexion.', button: 'Voir le diagnostic' },
  bad_key: { sentence: 'La clé de l’enceinte a été refusée.', button: 'Réessayer' },
  not_private: { sentence: 'Ce réseau empêche l’enceinte de parler au PC.', button: 'Voir le diagnostic' },
  old_bridge: { sentence: 'Ce Jarvis ne connaît pas encore cette enceinte.', button: 'Réessayer' },
};

export function failureCopy(code: string | undefined): FailureCopy {
  if (code && WIFI_COPY[code]) return WIFI_COPY[code]!;
  return { sentence: 'Quelque chose s’est arrêté. Tu peux réessayer.', button: 'Réessayer' };
}

/** Le PC est en 5 GHz et l’enceinte ne voit pas le même nom. */
export function fiveGhzWarning(pcSsid: string | null, pcBand: string | null, scan: readonly WifiSeen[]): string | null {
  if (!pcSsid || !pcBand) return null;
  const band = pcBand.toLowerCase();
  if (!band.includes('5')) return null;
  if (scan.some((network) => network.ssid === pcSsid)) return null;
  return 'Ton PC est sur le Wi-Fi 5 GHz. L’enceinte a besoin du 2,4 GHz. Si ta box a deux noms, choisis celui en 2,4 GHz.';
}
