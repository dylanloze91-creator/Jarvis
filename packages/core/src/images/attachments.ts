/**
 * Photos jointes à la discussion (module images). Fichier pur.
 *
 * La photo n'est jamais envoyée au modèle de langage (le 7B ne voit pas les images) : le
 * processus principal l'enregistre dans le dossier des images, et le modèle reçoit une note
 * avec son chemin, qu'il passe à `generer_image` (`photoDeBase`).
 */

import type { ChatAttachment, ChatMessage } from '../types.js';
import { FORMAT_SIZES, IMAGE_FORMATS, type ImageFormat } from './presets.js';

export const IMAGE_ATTACHMENT_EXTENSIONS = ['.png', '.jpg', '.jpeg', '.webp'] as const;
export const MAX_ATTACHMENTS_PER_MESSAGE = 3;
export const MAX_ATTACHMENT_BYTES = 20 * 1024 * 1024;

const MIME_EXTENSIONS: Record<string, string> = {
  'image/png': '.png',
  'image/jpeg': '.jpg',
  'image/jpg': '.jpg',
  'image/webp': '.webp',
};

/** Extension à donner à la copie, d'après le type MIME puis le nom ; `null` si ce n'est pas une image acceptée. */
export function imageAttachmentExtension(name: string, mime: string): string | null {
  const fromMime = MIME_EXTENSIONS[mime.toLowerCase().trim()];
  if (fromMime) return fromMime;
  const match = /\.([a-z0-9]+)$/i.exec(name.trim());
  const ext = match ? `.${match[1]!.toLowerCase()}` : '';
  return (IMAGE_ATTACHMENT_EXTENSIONS as readonly string[]).includes(ext) ? ext : null;
}

export function isImageAttachmentPath(path: string): boolean {
  const match = /\.([a-z0-9]+)$/i.exec(path.trim());
  return match ? (IMAGE_ATTACHMENT_EXTENSIONS as readonly string[]).includes(`.${match[1]!.toLowerCase()}`) : false;
}

/** Note lue par le modèle à la place de la photo. */
export function attachmentNote(attachment: ChatAttachment): string {
  return `[Photo jointe par l’utilisateur : ${attachment.path} — pour créer une image à partir de cette photo, appelle generer_image avec photoDeBase="${attachment.path}".]`;
}

/**
 * Copie des messages pour le modèle : les photos jointes deviennent des notes dans le texte.
 * Les messages d'origine (affichés, enregistrés) ne changent pas.
 */
export function withAttachmentNotes(messages: readonly ChatMessage[]): ChatMessage[] {
  return messages.map((message) => {
    if (message.role !== 'user' || !message.attachments?.length) return message;
    const notes = message.attachments.map(attachmentNote).join('\n');
    return { ...message, content: message.content.trim() ? `${message.content}\n\n${notes}` : notes };
  });
}

/** Vrai si le dernier message utilisateur porte une photo. */
export function lastUserHasImageAttachment(messages: readonly ChatMessage[]): boolean {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index]!;
    if (message.role === 'user') return Boolean(message.attachments?.some((attachment) => attachment.kind === 'image'));
  }
  return false;
}

/** Format SDXL dont le rapport largeur/hauteur est le plus proche de la photo. */
export function closestFormatForAspect(width: number, height: number): ImageFormat {
  if (!(width > 0) || !(height > 0)) return 'carre';
  const target = width / height;
  let best: ImageFormat = 'carre';
  let bestDistance = Number.POSITIVE_INFINITY;
  for (const format of IMAGE_FORMATS) {
    const size = FORMAT_SIZES[format];
    const distance = Math.abs(Math.log(size.width / size.height) - Math.log(target));
    if (distance < bestDistance) {
      bestDistance = distance;
      best = format;
    }
  }
  return best;
}

export const DEFAULT_FIDELITY = 0.45;

/**
 * Fidélité à la photo (0 = tout réinventer, 1 = presque copier) → `denoising_strength` de Forge
 * (l'inverse), borné entre 0,2 et 0,95 pour que l'image change toujours un peu et garde toujours
 * quelque chose de la photo.
 */
export function denoisingForFidelity(fidelity: number | undefined): number {
  const value = Number.isFinite(fidelity ?? NaN) ? (fidelity as number) : DEFAULT_FIDELITY;
  const denoising = 1 - Math.min(1, Math.max(0, value));
  return Math.round(Math.min(0.95, Math.max(0.2, denoising)) * 100) / 100;
}
