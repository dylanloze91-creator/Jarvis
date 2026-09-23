import { mkdir, stat } from 'node:fs/promises';
import { isAbsolute, join, relative, resolve } from 'node:path';
import { app } from 'electron';
import { z } from 'zod';
import { defineTool } from '@jarvis/core';

const locationSchema = z.enum(['documents', 'desktop', 'downloads', 'home']);
type Location = z.infer<typeof locationSchema>;

const locationLabels: Record<Location, string> = {
  documents: 'Documents',
  desktop: 'Bureau',
  downloads: 'Téléchargements',
  home: 'Dossier personnel',
};

/**
 * Outil d'écriture : classé `confirm`, donc le Tool Manager exige l'accord de
 * l'utilisateur avant de l'exécuter. Le chemin est en plus contraint aux
 * dossiers personnels pour qu'un modèle ne puisse pas viser le système.
 */
export const createFolderTool = defineTool({
  name: 'create_folder',
  description:
    "Crée un dossier dans un emplacement personnel de l'utilisateur (Documents, Bureau, Téléchargements ou dossier personnel).",
  risk: 'confirm',
  category: 'files',
  isDestructive: false,
  schema: z.object({
    name: z.string().min(1).max(120).describe('Nom du dossier à créer.'),
    location: locationSchema
      .default('documents')
      .describe('Emplacement parent du nouveau dossier.'),
    subPath: z
      .string()
      .max(200)
      .optional()
      .describe("Sous-chemin relatif optionnel à l'intérieur de l'emplacement."),
  }),
  summarize: ({ name, location, subPath }) => {
    const parent = subPath ? `${locationLabels[location]} / ${subPath}` : locationLabels[location];
    return `Créer le dossier « ${name} » dans ${parent}.`;
  },
  execute: async ({ name, location, subPath }) => {
    const root = app.getPath(location);
    const target = resolve(join(root, subPath ?? '', name));

    if (!isInside(root, target)) {
      return {
        ok: false,
        content: `Chemin refusé : « ${name} » sortirait de ${locationLabels[location]}.`,
      };
    }

    if (await exists(target)) {
      return { ok: false, content: `Le dossier existe déjà : ${target}` };
    }

    await mkdir(target, { recursive: true });
    return { ok: true, content: `Dossier créé : ${target}`, data: { path: target } };
  },
});

function isInside(root: string, target: string): boolean {
  const rel = relative(resolve(root), target);
  return rel.length > 0 && !rel.startsWith('..') && !isAbsolute(rel);
}

async function exists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}
