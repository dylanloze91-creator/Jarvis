import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { app, desktopCapturer, screen } from 'electron';
import { z } from 'zod';
import { defineTool, type ToolResult } from '@jarvis/core';

/** `desktopCapturer.getSources` peut ne jamais répondre (pilote, multi-écrans) : on borne. */
export const SCREENSHOT_TIMEOUT_MS = 15_000;

export const takeScreenshotTool = defineTool({
  name: 'take_screenshot',
  description:
    "Capture l'écran principal et enregistre l'image sur disque. Appelle-le directement sans demander à l'utilisateur quel écran : sans `display`, c'est l'écran principal. Le chemin renvoyé peut être ouvert manuellement pour l'inspecter.",
  risk: 'confirm',
  category: 'capture',
  isDestructive: false,
  schema: z.object({
    display: z
      .number()
      .int()
      .min(0)
      .max(15)
      .default(0)
      .describe('Optionnel. 0 ou absent = écran principal ; 1, 2… = autres écrans.'),
  }),
  summarize: ({ display }) =>
    `Capturer l'écran ${display === 0 ? 'principal' : `n°${display + 1}`}.`,
  execute: ({ display }) => captureScreen(display),
});

export async function captureScreen(
  display: number,
  timeoutMs = SCREENSHOT_TIMEOUT_MS,
): Promise<ToolResult> {
  const displays = screen.getAllDisplays();
  const primary = screen.getPrimaryDisplay();
  const target = display === 0 ? primary : (displays[display] ?? primary);
  if (!target) {
    return { ok: false, content: 'Aucun écran détecté sur cette machine.' };
  }

  const scaleFactor = target.scaleFactor || 1;
  const thumbnailSize = {
    width: Math.round(target.size.width * scaleFactor),
    height: Math.round(target.size.height * scaleFactor),
  };

  let sources: Electron.DesktopCapturerSource[];
  try {
    sources = await withTimeout(
      desktopCapturer.getSources({ types: ['screen'], thumbnailSize }),
      timeoutMs,
    );
  } catch (error) {
    if (error instanceof CaptureTimeoutError) {
      return {
        ok: false,
        content: `La capture d'écran n'a pas répondu en ${Math.round(timeoutMs / 1000)} s : aucune image n'a été enregistrée. Réessaie dans un instant.`,
      };
    }
    return { ok: false, content: `Capture d'écran indisponible : ${describeError(error)}` };
  }

  const source = sources.find((item) => item.display_id === String(target.id)) ?? sources[0];
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
}

class CaptureTimeoutError extends Error {}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new CaptureTimeoutError()), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error: unknown) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
