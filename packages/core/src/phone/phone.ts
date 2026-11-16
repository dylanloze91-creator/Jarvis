/**
 * 5.0.63 — Jarvis sur le téléphone. Le cerveau reste sur le PC : le téléphone ouvre une petite
 * appli web servie par Jarvis, à travers Tailscale (réseau privé entre les appareils de
 * l'utilisateur, HTTPS fourni par `tailscale serve`). Ce fichier est pur : constantes, lecture de
 * `tailscale status --json` / `tailscale serve status --json`, adresses et validation des
 * requêtes du téléphone. Le serveur, les jetons et la commande `tailscale` vivent dans
 * `apps/desktop/src/main/phone/`.
 */
import { z } from 'zod';
import { LIVE_EDITION } from '../edition.js';

/** Port local du téléphone pour Live. L'application en cours utilise `edition().ports.phone`. */
export const PHONE_PORT = LIVE_EDITION.ports.phone;
/** Code de jumelage : 6 chiffres, 10 minutes, 5 essais. */
export const PHONE_PAIRING_TTL_MS = 10 * 60_000;
export const PHONE_PAIRING_MAX_ATTEMPTS = 5;
export const PHONE_MAX_DEVICES = 10;
/** Longueur maximale d'un message envoyé depuis le téléphone. */
export const PHONE_MAX_TEXT = 4_000;
/** Texte maximal pour la synthèse vocale du téléphone (identique à l'enceinte). */
export const PHONE_MAX_SPEAK_CHARS = 1_500;

export const phoneSpeakRequestSchema = z.object({
  text: z.string().trim().min(1).max(PHONE_MAX_SPEAK_CHARS),
});

/** Commande à taper une fois dans PowerShell pour publier Jarvis sur le réseau Tailscale. */
export function tailscaleServeCommand(port = PHONE_PORT): string {
  return `tailscale serve --bg ${port}`;
}

export interface TailscaleSelf {
  /** Nom complet sur le réseau Tailscale, sans point final (ex. `pc-de-dylan.tail1a2b.ts.net`). */
  dnsName: string | null;
  online: boolean;
  /** `Running` quand Tailscale est connecté. */
  backendState: string | null;
}

/** Lit la sortie de `tailscale status --json`. Une sortie illisible donne un état vide. */
export function parseTailscaleStatus(raw: string): TailscaleSelf {
  try {
    const data = JSON.parse(raw) as {
      BackendState?: unknown;
      Self?: { DNSName?: unknown; Online?: unknown };
    };
    const dns = typeof data.Self?.DNSName === 'string' ? data.Self.DNSName.replace(/\.$/, '').trim() : '';
    const backendState = typeof data.BackendState === 'string' ? data.BackendState : null;
    return {
      dnsName: dns || null,
      online: data.Self?.Online === true || backendState === 'Running',
      backendState,
    };
  } catch {
    return { dnsName: null, online: false, backendState: null };
  }
}

/**
 * `tailscale serve status --json` publie-t-il ce port local ? On cherche un relais vers
 * `127.0.0.1:<port>` ou `localhost:<port>` (formats de 2023 à 2026).
 */
export function tailscaleServesPort(raw: string, port = PHONE_PORT): boolean {
  if (!raw.trim()) return false;
  const pattern = new RegExp(`(?:127\\.0\\.0\\.1|localhost):${port}(?![0-9])`);
  try {
    return pattern.test(JSON.stringify(JSON.parse(raw)));
  } catch {
    return pattern.test(raw);
  }
}

/** Adresse de l'appli sur le téléphone ; avec un code, il est mis après `#` (jamais envoyé au serveur). */
export function phoneAppUrl(dnsName: string, code?: string): string {
  const base = `https://${dnsName.replace(/\.$/, '')}/`;
  return code ? `${base}#code=${code}` : base;
}

export const phonePairRequestSchema = z.object({
  code: z.string().regex(/^\d{6}$/),
  name: z.string().trim().min(1).max(40).optional(),
});

export const phoneChatRequestSchema = z.object({
  text: z.string().trim().min(1).max(PHONE_MAX_TEXT),
  conversationId: z
    .string()
    .regex(/^[\w-]{1,80}$/)
    .nullable()
    .optional(),
  source: z.enum(['text', 'voice']).optional(),
});

export const phoneConfirmRequestSchema = z.object({
  requestId: z.string().min(1).max(100),
  approved: z.boolean(),
});

export const phoneTeamValidationSchema = z.object({
  phrase: z.string().min(1).max(PHONE_MAX_TEXT),
  context: z.string().max(16_000),
  proposedTeam: z.string().min(1).max(40),
  chosenTeam: z.string().min(1).max(40),
  path: z.enum(['express', 'cerveau', 'trieur']),
});

/** Nom d'appareil affiché dans les réglages : lettres, chiffres, espaces et ponctuation simple. */
export function cleanDeviceName(name: string | undefined): string {
  const cleaned = (name ?? '')
    .replace(/[^\p{L}\p{N} '’._-]/gu, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 40);
  return cleaned || 'Téléphone';
}
