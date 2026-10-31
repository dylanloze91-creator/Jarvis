import { isPrivateIpAddress } from '../web/urlSafety.js';

/** Adresse par défaut du service du robot (Raspberry Pi annoncé en mDNS). */
export const DEFAULT_ROVER_BASE_URL = 'http://jarvis-rover.local:8765';

export type RoverUrlCheck = { ok: true; origin: string } | { ok: false; reason: string };

const LOCAL_SUFFIXES = ['.local', '.lan', '.home', '.home.arpa', '.internal'];

/**
 * Le robot vit sur le réseau de la maison : HTTP(S) vers localhost, une IP
 * privée (192.168.x.x, 10.x…), un nom mDNS `.local` ou un nom court sans
 * point (« jarvis-rover »). Une adresse Internet est refusée : le jeton du
 * robot ne part jamais hors du réseau local.
 */
export function checkRoverBaseUrl(raw: string): RoverUrlCheck {
  const trimmed = raw.trim();
  if (!trimmed) return { ok: false, reason: 'Adresse du robot manquante.' };

  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    return { ok: false, reason: 'Adresse du robot invalide (exemple : http://jarvis-rover.local:8765).' };
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    return { ok: false, reason: `Protocole non autorisé pour le robot : ${url.protocol}` };
  }
  if (url.username || url.password) {
    return { ok: false, reason: 'L’adresse du robot ne doit pas contenir d’identifiants.' };
  }

  const hostname = url.hostname.toLowerCase().replace(/^\[/, '').replace(/\]$/, '');
  const isIp = /^\d{1,3}(?:\.\d{1,3}){3}$/.test(hostname) || hostname.includes(':');
  const local = isIp
    ? isPrivateIpAddress(hostname)
    : hostname === 'localhost' ||
      !hostname.includes('.') ||
      LOCAL_SUFFIXES.some((suffix) => hostname.endsWith(suffix));
  if (!local) {
    return {
      ok: false,
      reason:
        'Le robot doit être sur le réseau local (IP privée, nom en .local ou localhost). Les adresses Internet sont refusées.',
    };
  }
  return { ok: true, origin: url.origin };
}
