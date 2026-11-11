/** Signal Wi-Fi en 4 barres, et lecture des en-têtes du signe de vie. */

export function rssiToBars(rssi: number): 0 | 1 | 2 | 3 | 4 {
  if (!Number.isFinite(rssi)) return 0;
  if (rssi >= -55) return 4;
  if (rssi >= -67) return 3;
  if (rssi >= -75) return 2;
  if (rssi >= -85) return 1;
  return 0;
}

export interface HelloSigns {
  fw?: string;
  rssi?: number;
  ip?: string;
  mac?: string;
  uptime?: number;
  reset?: string;
}

function header(headers: Readonly<Record<string, string | undefined>>, name: string): string | undefined {
  const value = headers[name] ?? headers[name.toLowerCase()];
  const text = value?.trim();
  return text ? text : undefined;
}

export function readHelloHeaders(headers: Readonly<Record<string, string | undefined>>): HelloSigns {
  const signs: HelloSigns = {};
  const fw = header(headers, 'x-jarvis-fw');
  if (fw) signs.fw = fw.slice(0, 24);
  const rssi = Number(header(headers, 'x-jarvis-rssi'));
  if (Number.isFinite(rssi)) signs.rssi = rssi;
  const ip = header(headers, 'x-jarvis-ip');
  if (ip) signs.ip = ip.slice(0, 40);
  const mac = header(headers, 'x-jarvis-mac');
  if (mac) signs.mac = mac.toLowerCase().slice(0, 20);
  const uptime = Number(header(headers, 'x-jarvis-uptime'));
  if (Number.isFinite(uptime) && uptime >= 0) signs.uptime = uptime;
  const reset = header(headers, 'x-jarvis-reset');
  if (reset) signs.reset = reset.slice(0, 8);
  return signs;
}

/** Une enceinte 5.0.64 n'envoie pas ces en-têtes : c'est une ancienne version. */
export function speakerFreshness(fw: string | undefined, manifest: string | null): 'unknown' | 'current' | 'old' | 'update' {
  if (!fw) return 'old';
  if (!manifest) return 'unknown';
  return fw === manifest ? 'current' : 'update';
}
