import type { GoogleService } from '@jarvis/core';
import type { GoogleApiClient } from './http.js';

export interface GoogleWorkspaceContext {
  api: GoogleApiClient;
  account: {
    ensureRead(service: GoogleService): void;
    ensureWrite(service: GoogleService): void;
  };
  now: () => Date;
  /** Fuseau du PC (« Europe/Paris »), envoyé avec chaque heure d'événement. */
  timeZone: () => string;
}

/** Ce que les outils renvoient au modèle, plus une charge utile pour l'interface. */
export interface GoogleActionResult {
  text: string;
  data?: unknown;
}

export const TEXT_LIMIT = 8_000;

export function truncate(text: string, limit = TEXT_LIMIT): string {
  if (text.length <= limit) return text;
  return `${text.slice(0, limit)}\n… (tronqué : ${text.length - limit} caractères de plus)`;
}

export function sameText(a: string, b: string): boolean {
  return normalize(a) === normalize(b);
}

export function normalize(text: string): string {
  return text
    .normalize('NFC')
    .replace(/\r\n/g, '\n')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}
