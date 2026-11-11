/**
 * 5.0.64 — Enceinte Jarvis. Le cerveau reste sur le PC : une carte ESP32-S3 (micro + haut-parleur)
 * sur le Wi-Fi de la maison entend « Jarvis », enregistre la phrase, l'envoie au PC en WAV et joue
 * la réponse vocale renvoyée. Rien ne passe par Internet. Ce fichier est pur : constantes,
 * adresses privées, validation du WAV reçu, texte à dire, bloc `secrets.h` à copier dans la carte.
 * Le serveur, les jetons et la synthèse vivent dans `apps/desktop/src/main/speaker/`.
 */
import { stripSourcesFooter } from '../agent/citations.js';
import { decodeWav, encodeWav } from '../speech/wav.js';

/** Port fixe du pont (toutes les interfaces, adresses privées seulement). */
export const SPEAKER_PORT = 53131;
/** Audio attendu de l'enceinte et renvoyé à l'enceinte : PCM 16 bits, mono, 16 kHz. */
export const SPEAKER_SAMPLE_RATE = 16_000;
/** Corps d'une phrase au plus (environ 45 s à 16 kHz 16 bits). */
export const SPEAKER_MAX_BODY_BYTES = 1_500_000;
/** Texte dit par l'enceinte, au plus. */
export const SPEAKER_MAX_SPEECH_CHARS = 1_500;
/** Sans phrase pendant ce délai, la prochaine ouvre une nouvelle discussion. */
export const SPEAKER_SESSION_IDLE_MS = 10 * 60_000;
/** Délai accordé au renderer (Whisper) pour transcrire une phrase. */
export const SPEAKER_TRANSCRIBE_TIMEOUT_MS = 60_000;
/**
 * La carte attend la réponse au plus `SPEAKER_CARD_TIMEOUT_MS` (`HTTP_TIMEOUT_MS` dans
 * `firmware/jarvis-speaker/include/config.h`, même valeur). Le PC s'arrête un peu avant : la session
 * est annulée et la carte reçoit une erreur claire plutôt qu'une connexion morte.
 */
export const SPEAKER_CARD_TIMEOUT_MS = 120_000;
export const SPEAKER_TURN_TIMEOUT_MS = 100_000;
export const SPEAKER_MAX_SPEAKERS = 20;

/** Ce que Jarvis dit quand une action demanderait une carte de confirmation. */
export const SPEAKER_CONFIRMATION_REFUSAL = 'Pour ça, il me faut ton accord : demande-le-moi sur le PC ou le téléphone.';
/** Court message joué quand Whisper (la fenêtre) ne répond pas. */
export const SPEAKER_TRANSCRIBE_FAILED = 'Je n’ai pas pu t’écouter. Réessaie dans un instant.';
/** Court message joué quand le modèle n'a rien répondu. */
export const SPEAKER_NO_REPLY = 'Je n’ai pas pu répondre. Réessaie dans un instant.';

/** En-têtes HTTP du protocole enceinte ↔ PC. */
export const SPEAKER_HEADER_FOLLOW_UP = 'x-jarvis-follow-up';
export const SPEAKER_HEADER_CONTINUE = 'x-jarvis-continue';
export const SPEAKER_HEADER_TRANSCRIPT = 'x-jarvis-transcript';

/**
 * Adresse distante privée ? Acceptées : 127/8, 10/8, 172.16/12, 192.168/16, 169.254/16, `::1`,
 * `fc00::/7`, `fe80::/10`, et leurs formes IPv4 mappées (`::ffff:192.168.1.5`). Tout le reste —
 * donc Internet — est refusé.
 */
export function isPrivateAddress(address: string | null | undefined): boolean {
  if (!address) return false;
  let value = address.trim().toLowerCase();
  if (!value) return false;
  // Zone IPv6 (`fe80::1%eth0`) et crochets d'URL.
  value = value.replace(/^\[|\]$/g, '').replace(/%.*$/, '');
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(value);
  if (mapped) value = mapped[1]!;
  const v4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(value);
  if (v4) {
    const parts = v4.slice(1, 5).map(Number);
    if (parts.some((part) => part > 255)) return false;
    const [a, b] = parts as [number, number, number, number];
    if (a === 127 || a === 10) return true;
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 192 && b === 168) return true;
    if (a === 169 && b === 254) return true;
    return false;
  }
  if (value === '::1') return true;
  if (!/^[0-9a-f:]+$/.test(value) || !value.includes(':')) return false;
  const head = value.split(':')[0] ?? '';
  if (head.length === 0) return false; // `::…` autre que `::1` et les mappées : pas privé.
  const first = Number.parseInt(head.padStart(4, '0'), 16);
  if (Number.isNaN(first)) return false;
  if ((first & 0xfe00) === 0xfc00) return true; // fc00::/7
  if ((first & 0xffc0) === 0xfe80) return true; // fe80::/10
  return false;
}

/** Type MIME d'un WAV, dans ses graphies courantes. */
export function isWavContentType(type: string | undefined): boolean {
  if (!type) return false;
  const base = type.split(';')[0]!.trim().toLowerCase();
  return base === 'audio/wav' || base === 'audio/x-wav' || base === 'audio/wave' || base === 'audio/vnd.wave';
}

export type TurnWavCheck = { ok: true; pcm: Float32Array } | { ok: false; error: string };

/**
 * Lit le WAV envoyé par l'enceinte : PCM 16 bits, mono, 16 kHz obligatoires (c'est ce que la carte
 * produit ; aucun rééchantillonnage côté PC, la carte sait le faire). Vide ou trop court : refusé.
 */
export function checkTurnWav(bytes: Uint8Array): TurnWavCheck {
  if (bytes.byteLength < 44) return { ok: false, error: 'WAV vide ou tronqué.' };
  let decoded;
  try {
    decoded = decodeWavStrict(bytes);
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
  if (decoded.sampleRate !== SPEAKER_SAMPLE_RATE) {
    return { ok: false, error: `Fréquence ${decoded.sampleRate} Hz : ${SPEAKER_SAMPLE_RATE} Hz attendus.` };
  }
  if (decoded.channels !== 1) return { ok: false, error: `${decoded.channels} canaux : mono attendu.` };
  if (decoded.samples.length < SPEAKER_SAMPLE_RATE / 10) return { ok: false, error: 'Audio trop court (moins de 0,1 s).' };
  return { ok: true, pcm: decoded.samples };
}

/** `decodeWav` du cœur, plus le nombre de canaux (lu dans le bloc `fmt `). */
function decodeWavStrict(bytes: Uint8Array): { samples: Float32Array; sampleRate: number; channels: number } {
  const decoded = decodeWav(bytes);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let channels = 1;
  let offset = 12;
  while (offset + 8 <= view.byteLength) {
    const id = String.fromCharCode(view.getUint8(offset), view.getUint8(offset + 1), view.getUint8(offset + 2), view.getUint8(offset + 3));
    const size = view.getUint32(offset + 4, true);
    if (id === 'fmt ') {
      channels = view.getUint16(offset + 10, true);
      break;
    }
    offset += 8 + size + (size % 2);
  }
  return { ...decoded, channels };
}

/** WAV de silence, pour les tests et les secours. */
export function silenceWav(durationMs: number, sampleRate = SPEAKER_SAMPLE_RATE): Uint8Array {
  const samples = new Float32Array(Math.max(1, Math.round((durationMs / 1000) * sampleRate)));
  return encodeWav(samples, sampleRate);
}

/** Rééchantillonnage linéaire (assez pour une voix de synthèse 24 kHz → 16 kHz). */
export function resampleLinear(samples: Float32Array, from: number, to: number): Float32Array {
  if (from === to || samples.length === 0) return samples;
  const ratio = from / to;
  const length = Math.max(1, Math.floor(samples.length / ratio));
  const out = new Float32Array(length);
  for (let index = 0; index < length; index += 1) {
    const position = index * ratio;
    const left = Math.floor(position);
    const right = Math.min(samples.length - 1, left + 1);
    const fraction = position - left;
    out[index] = samples[left]! * (1 - fraction) + samples[right]! * fraction;
  }
  return out;
}

/** Un WAV quelconque (16 bits) ramené au format de l'enceinte : 16 kHz, mono, 16 bits. */
export function toSpeakerWav(bytes: Uint8Array): Uint8Array {
  const decoded = decodeWav(bytes);
  const samples = resampleLinear(decoded.samples, decoded.sampleRate, SPEAKER_SAMPLE_RATE);
  return encodeWav(samples, SPEAKER_SAMPLE_RATE);
}

/**
 * Texte à dire à l'enceinte : sans le bloc des sources, sans blocs de code, sans balisage Markdown
 * visible, 1 500 caractères au plus (coupé à une fin de phrase si possible).
 */
/** 5.0.68 — une proposition de mission se valide sur PC ou téléphone, jamais depuis l'enceinte. */
export const SPEAKER_MISSION_PROPOSAL =
  'Je peux lancer une mission pour ça, valide-la sur le PC ou le téléphone.';

export function speechTextForSpeaker(text: string, limit = SPEAKER_MAX_SPEECH_CHARS): string {
  let out = stripSourcesFooter(text);
  out = out.replace(/```[\s\S]*?```/g, ' ');
  out = out.replace(/```[\s\S]*$/g, ' ');
  out = out.replace(/`([^`\n]*)`/g, '$1');
  out = out.replace(/!\[[^\]]*\]\([^)]*\)/g, ' ');
  out = out.replace(/\[([^\]]+)\]\([^)]*\)/g, '$1');
  out = out.replace(/^\s{0,3}#{1,6}\s+/gm, '');
  out = out.replace(/^\s*[-*+]\s+/gm, '');
  out = out.replace(/^\s*>\s?/gm, '');
  out = out.replace(/(\*\*|__)(.*?)\1/g, '$2');
  out = out.replace(/(^|[\s(])[*_]([^*_\n]+)[*_](?=[\s).,;:!?]|$)/g, '$1$2');
  out = out.replace(/[ \t]+/g, ' ').replace(/\s*\n\s*/g, '\n').trim();
  if (out.length <= limit) return out;
  const cut = out.slice(0, limit);
  const end = Math.max(cut.lastIndexOf('. '), cut.lastIndexOf('! '), cut.lastIndexOf('? '), cut.lastIndexOf('.\n'));
  return (end > limit / 2 ? cut.slice(0, end + 1) : cut).trim();
}

/* ------------------------------------------------------------------ */
/* Réponse en flux : phrase par phrase, pendant que le cerveau écrit  */
/* ------------------------------------------------------------------ */

/** Entête WAV (44 octets) dont les tailles sont inconnues : la carte joue jusqu'à la fin de la réponse (`wav_stream.c`, « unbounded »). */
export function streamingWavHeader(sampleRate = SPEAKER_SAMPLE_RATE): Uint8Array {
  const buffer = new ArrayBuffer(44);
  const view = new DataView(buffer);
  const ascii = (offset: number, text: string): void => {
    for (let index = 0; index < text.length; index += 1) view.setUint8(offset + index, text.charCodeAt(index));
  };
  ascii(0, 'RIFF');
  view.setUint32(4, 0xffffffff, true);
  ascii(8, 'WAVE');
  ascii(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  ascii(36, 'data');
  view.setUint32(40, 0xffffffff, true);
  return new Uint8Array(buffer);
}

/** Les octets PCM du bloc `data` d'un WAV (16 bits) ; tailles inconnues acceptées (jusqu'à la fin du fichier). */
export function wavPcmBytes(wav: Uint8Array): Uint8Array {
  const view = new DataView(wav.buffer, wav.byteOffset, wav.byteLength);
  if (wav.byteLength < 12) return new Uint8Array(0);
  let offset = 12;
  while (offset + 8 <= wav.byteLength) {
    const id = String.fromCharCode(view.getUint8(offset), view.getUint8(offset + 1), view.getUint8(offset + 2), view.getUint8(offset + 3));
    const size = view.getUint32(offset + 4, true);
    const start = offset + 8;
    if (id === 'data') {
      const end = size === 0 || size >= 0xfffffff0 ? wav.byteLength : Math.min(wav.byteLength, start + size);
      return wav.subarray(start, end);
    }
    if (size >= 0xfffffff0) break;
    offset = start + size + (size % 2);
  }
  return new Uint8Array(0);
}

/** Un WAV reçu en flux (tailles inconnues) rendu lisible par n'importe quel lecteur : tailles réécrites d'après la longueur réelle. */
export function boundedWav(wav: Uint8Array): Uint8Array {
  const out = new Uint8Array(wav);
  if (out.byteLength < 44) return out;
  const view = new DataView(out.buffer, out.byteOffset, out.byteLength);
  const pcm = wavPcmBytes(out);
  const dataOffset = pcm.byteOffset - out.byteOffset;
  view.setUint32(4, out.byteLength - 8, true);
  if (dataOffset >= 8) view.setUint32(dataOffset - 4, pcm.byteLength, true);
  return out;
}

const SOURCES_FOOTER = /\n\s*Sources \(recherche web/u;

/**
 * Découpe la réponse du modèle en phrases au fur et à mesure (deltas), nettoyées pour l'oreille
 * (`speechTextForSpeaker`), sans le bloc des sources ni les blocs de code, dans la limite de
 * `SPEAKER_MAX_SPEECH_CHARS`. `push` rend les phrases finies ; `flush` ce qui reste.
 */
export class SentenceStreamer {
  private pending = '';
  private spokenChars = 0;
  private closed = false;

  constructor(private readonly limit = SPEAKER_MAX_SPEECH_CHARS) {}

  push(delta: string): string[] {
    if (this.closed) return [];
    this.pending += delta;
    const footer = SOURCES_FOOTER.exec(this.pending);
    if (footer) {
      const ready = this.pending.slice(0, footer.index);
      this.pending = '';
      this.closed = true;
      return this.take(ready, true);
    }
    // Un bloc de code ouvert : ce qui le précède est prêt, lui attend sa fin (il sera retiré en entier).
    const fenceOpen = (this.pending.match(/```/g) ?? []).length % 2 === 1;
    const scan = fenceOpen ? this.pending.slice(0, this.pending.lastIndexOf("```")) : this.pending;
    const boundary = this.lastBoundary(scan);
    if (boundary < 0) return [];
    const ready = this.pending.slice(0, boundary);
    this.pending = this.pending.slice(boundary);
    return this.take(ready, false);
  }

  flush(): string[] {
    const rest = this.pending;
    this.pending = '';
    this.closed = true;
    return this.take(rest, true);
  }

  /** Dernière fin de phrase suivie d'un blanc (ou d'un retour à la ligne) : tout ce qui précède est prêt. */
  private lastBoundary(text: string): number {
    const pattern = /[.!?…](?=\s)|\n(?=\s*\S)/gu;
    let last = -1;
    for (const match of text.matchAll(pattern)) last = match.index + match[0].length;
    return last;
  }

  private take(text: string, final: boolean): string[] {
    void final;
    const cleaned = speechTextForSpeaker(text, Number.MAX_SAFE_INTEGER);
    if (!cleaned) return [];
    const out: string[] = [];
    for (const sentence of cleaned.split(/\n+|(?<=[.!?…])\s+/u)) {
      const trimmed = sentence.trim();
      if (!trimmed) continue;
      if (this.spokenChars >= this.limit) {
        this.closed = true;
        break;
      }
      const room = this.limit - this.spokenChars;
      const piece = trimmed.length > room ? trimmed.slice(0, room).trim() : trimmed;
      this.spokenChars += piece.length;
      out.push(piece);
    }
    return out;
  }
}

/** Nom d'enceinte affiché et envoyé à la carte : lettres, chiffres, espaces et ponctuation simple. */
/** Phrase dite à la fin de l'installation. */
export function speakerGreeting(name: string): string {
  const room = cleanSpeakerName(name);
  return `Bonjour, je suis l'enceinte du ${room}. Dis « Jarvis » quand tu veux me parler.`;
}

export function cleanSpeakerName(name: string | undefined): string {
  const cleaned = (name ?? '')
    .replace(/[^\p{L}\p{N} '’._-]/gu, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 40);
  return cleaned || 'Enceinte';
}

export interface SpeakerSecrets {
  /** Adresse IP locale du PC (la plus sûre pour la carte). */
  host: string;
  /** Nom `<pc>.local`, si connu (mDNS ; pas toujours résolu par la carte). */
  hostName?: string | null;
  port: number;
  token: string;
  name: string;
}

/** Dans une chaîne C : guillemets et barres obliques échappés, pas de retour à la ligne. */
export function cString(value: string): string {
  return `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/[\r\n]+/g, ' ')}"`;
}

/**
 * Bloc à copier dans `include/secrets.h` du programme de la carte. Le Wi-Fi reste à remplir par
 * l'utilisateur (le PC ne le connaît pas). Le jeton n'est montré qu'ici, une fois.
 */
export function speakerSecretsBlock(secrets: SpeakerSecrets): string {
  const lines = [
    '// Enceinte Jarvis — copié depuis Réglages → Enceintes. Ne pas partager : contient le jeton.',
    '#pragma once',
    '',
    '// Ton Wi-Fi (2,4 GHz) :',
    '#define WIFI_SSID        "A_REMPLIR"',
    '#define WIFI_PASSWORD    "A_REMPLIR"',
    '',
    '// Le PC où tourne Jarvis :',
    `#define JARVIS_HOST      ${cString(secrets.host)}`,
  ];
  if (secrets.hostName) lines.push(`// Autre possibilité, si ton PC garde la même adresse : ${cString(secrets.hostName)}`);
  lines.push(
    `#define JARVIS_PORT      ${secrets.port}`,
    `#define JARVIS_TOKEN     ${cString(secrets.token)}`,
    `#define SPEAKER_NAME     ${cString(secrets.name)}`,
    '',
  );
  return lines.join('\n');
}

/** Adresses IPv4 locales du PC, les plus utiles d'abord (192.168 avant 10, 172 ; jamais 169.254 ni 127). */
export function sortLocalAddresses(addresses: readonly string[]): string[] {
  const rank = (address: string): number => {
    if (address.startsWith('192.168.')) return 0;
    if (address.startsWith('10.')) return 1;
    if (/^172\.(1[6-9]|2\d|3[01])\./.test(address)) return 2;
    return 3;
  };
  return [...new Set(addresses)]
    .filter((address) => isPrivateAddress(address) && !address.startsWith('127.') && !address.startsWith('169.254.'))
    .sort((a, b) => rank(a) - rank(b) || a.localeCompare(b));
}
