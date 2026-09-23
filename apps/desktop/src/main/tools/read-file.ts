import { open, stat } from 'node:fs/promises';
import { z } from 'zod';
import { defineTool } from '@jarvis/core';

const DEFAULT_MAX_CHARS = 8_000;

export const readFileTool = defineTool({
  name: 'read_file',
  description:
    "Lit le contenu texte d'un fichier (chemin absolu) et le renvoie, tronqué au besoin. Ne convient pas aux fichiers binaires.",
  risk: 'safe',
  schema: z.object({
    path: z.string().min(1).describe('Chemin absolu du fichier à lire.'),
    maxChars: z
      .number()
      .int()
      .min(200)
      .max(100_000)
      .default(DEFAULT_MAX_CHARS)
      .describe('Nombre maximum de caractères renvoyés.'),
  }),
  execute: async ({ path, maxChars }) => {
    let size: number;
    try {
      const info = await stat(path);
      if (info.isDirectory()) {
        return { ok: false, content: `« ${path} » est un dossier, pas un fichier.` };
      }
      size = info.size;
    } catch (error) {
      return { ok: false, content: `Fichier introuvable : ${path} (${describeError(error)})` };
    }

    // Lecture bornée en octets, indépendante de la taille réelle du fichier :
    // un fichier de plusieurs gigaoctets ne doit jamais être chargé en entier.
    const maxBytes = maxChars * 4; // marge large pour l'UTF-8 multioctet
    const handle = await open(path, 'r');
    try {
      const buffer = Buffer.alloc(Math.min(maxBytes, size));
      const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
      const text = buffer.subarray(0, bytesRead).toString('utf8');
      const truncatedText = text.length > maxChars ? text.slice(0, maxChars) : text;
      const truncated = truncatedText.length < size || bytesRead < size;

      if (containsBinaryMarkers(truncatedText)) {
        return {
          ok: false,
          content: `« ${path} » semble être un fichier binaire : lecture refusée.`,
        };
      }

      return {
        ok: true,
        content: truncated
          ? `${truncatedText}\n\n… (fichier tronqué, ${size} octets au total)`
          : truncatedText,
        data: { path, size, truncated },
      };
    } finally {
      await handle.close();
    }
  },
});

function containsBinaryMarkers(text: string): boolean {
  // Présence de caractères de contrôle en dehors des retours à la ligne/tabulations usuels.
  // eslint-disable-next-line no-control-regex
  return /[\x00-\x08\x0e-\x1f]/.test(text);
}

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
