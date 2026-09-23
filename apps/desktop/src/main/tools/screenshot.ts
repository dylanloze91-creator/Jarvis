import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { app, desktopCapturer, screen } from 'electron';
import { z } from 'zod';
import { defineTool } from '@jarvis/core';

export const takeScreenshotTool = defineTool({
  name: 'take_screenshot',
  description:
    "Capture l'écran (ou un écran précis en multi-écrans) et enregistre l'image sur disque. Le chemin renvoyé peut être relu avec `read_file` si besoin d'en discuter le contenu textuel, ou ouvert manuellement pour l'inspecter.",
  risk: 'confirm',
  category: 'capture',
  isDestructive: false,
  schema: z.object({
    display: z
      .number()
      .int()
      .min(0)
      .default(0)
      .describe('Index de l’écran à capturer (0 = principal).'),
  }),
  summarize: ({ display }) =>
    `Capturer l'écran ${display === 0 ? 'principal' : `n°${display + 1}`}.`,
  execute: async ({ display }) => {
    const displays = screen.getAllDisplays();
    const target = displays[display] ?? displays[0];
    if (!target) {
      return { ok: false, content: 'Aucun écran détecté sur cette machine.' };
    }

    const scaleFactor = target.scaleFactor || 1;
    const thumbnailSize = {
      width: Math.round(target.size.width * scaleFactor),
      height: Math.round(target.size.height * scaleFactor),
    };

    let sources;
    try {
      sources = await desktopCapturer.getSources({ types: ['screen'], thumbnailSize });
    } catch (error) {
      return { ok: false, content: `Capture d'écran indisponible : ${describeError(error)}` };
    }

    const source = sources[display] ?? sources[0];
    if (!source || source.thumbnail.isEmpty()) {
      return {
        ok: false,
        content:
          "Capture d'écran indisponible sur ce système (permissions d'enregistrement d'écran manquantes, ou serveur d'affichage sans compositeur).",
      };
    }

    const dir = join(app.getPath('pictures'), 'Jarvis');
    await mkdir(dir, { recursive: true });
    const fileName = `capture-${new Date().toISOString().replace(/[:.]/g, '-')}.png`;
    const filePath = join(dir, fileName);

    await writeFile(filePath, source.thumbnail.toPNG());

    return {
      ok: true,
      content: `Capture enregistrée : ${filePath}`,
      data: { path: filePath, width: thumbnailSize.width, height: thumbnailSize.height },
    };
  },
});

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
