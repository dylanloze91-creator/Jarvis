import { readFile } from 'node:fs/promises';
import { basename } from 'node:path';
import { z } from 'zod';
import {
  SPEAKER_CANNOT_START,
  defineTool,
  formatPrintStatus,
  startConfirmText,
  type MoonrakerClient,
  type ToolContext,
} from '@jarvis/core';

export interface PrinterToolDeps {
  isAvailable: () => boolean;
  client: () => MoonrakerClient;
}

function speakerBlocked(context: ToolContext): { ok: false; content: string } | null {
  if (!context.fromSpeaker) return null;
  return { ok: false, content: SPEAKER_CANNOT_START };
}

/** Outils absents du catalogue tant que l'adresse locale n'est pas activée. */
export function createPrinterTools(deps: PrinterToolDeps) {
  const gate = { isAvailable: deps.isAvailable, unavailableMessage: "L'imprimante n'est pas activée." };
  return [
    defineTool({
      name: 'imprimante_etat',
      description: "État de l'imprimante 3D : fichier, progression, temps restant estimé, températures.",
      risk: 'safe',
      schema: z.object({}),
      ...gate,
      execute: async () => {
        const status = await deps.client().status();
        return { ok: true, content: formatPrintStatus(status) };
      },
    }),
    defineTool({
      name: 'imprimante_fichiers',
      description: "Liste les fichiers gcode déjà sur l'imprimante.",
      risk: 'safe',
      schema: z.object({}),
      ...gate,
      execute: async () => {
        const files = await deps.client().files();
        if (files.length === 0) return { ok: true, content: 'Aucun fichier sur l’imprimante.' };
        return { ok: true, content: files.map((file) => file.path).join(', ') };
      },
    }),
    defineTool({
      name: 'imprimante_envoyer_et_imprimer',
      description: "Envoie un fichier .gcode du PC et lance l'impression. Confirmation obligatoire.",
      risk: 'confirm',
      category: 'files',
      forceConfirm: true,
      isDestructive: false,
      schema: z.object({ path: z.string().min(1).max(500) }),
      summarize: ({ path }) => startConfirmText(basename(path)),
      describeCommand: ({ path }) => path,
      ...gate,
      execute: async ({ path }, context) => {
        const blocked = speakerBlocked(context);
        if (blocked) return blocked;
        if (!path.toLowerCase().endsWith('.gcode')) return { ok: false, content: 'Je n’envoie qu’un fichier .gcode.' };
        const bytes = new Uint8Array(await readFile(path));
        const printer = deps.client();
        await printer.upload(basename(path), bytes, true);
        const status = await printer.status();
        if (status.state !== 'printing') return { ok: false, content: `Pas lancée : ${status.state}.` };
        return { ok: true, content: `Impression lancée : ${status.filename}.` };
      },
    }),
    defineTool({
      name: 'imprimante_lancer',
      description: "Lance un fichier déjà sur l'imprimante. Confirmation obligatoire.",
      risk: 'confirm',
      category: 'files',
      forceConfirm: true,
      isDestructive: false,
      schema: z.object({ filename: z.string().min(1).max(300) }),
      summarize: ({ filename }) => startConfirmText(filename),
      describeCommand: ({ filename }) => filename,
      ...gate,
      execute: async ({ filename }, context) => {
        const blocked = speakerBlocked(context);
        if (blocked) return blocked;
        const status = await deps.client().start(filename);
        if (status.state !== 'printing') return { ok: false, content: `Pas lancée : ${status.state}.` };
        return { ok: true, content: `Impression lancée : ${filename}.` };
      },
    }),
    defineTool({
      name: 'imprimante_pause',
      description: "Met l'impression en pause. Confirmation demandée.",
      risk: 'confirm',
      category: 'files',
      forceConfirm: true,
      schema: z.object({}),
      summarize: () => "Mettre l'impression en pause.",
      ...gate,
      execute: async () => {
        const status = await deps.client().pause();
        if (status.state !== 'paused') return { ok: false, content: `Pas en pause : ${status.state}.` };
        return { ok: true, content: 'Impression en pause.' };
      },
    }),
    defineTool({
      name: 'imprimante_reprendre',
      description: "Reprend l'impression en pause. Confirmation demandée.",
      risk: 'confirm',
      category: 'files',
      forceConfirm: true,
      schema: z.object({}),
      summarize: () => "Reprendre l'impression.",
      ...gate,
      execute: async (_input, context) => {
        const blocked = speakerBlocked(context);
        if (blocked) return blocked;
        const status = await deps.client().resume();
        if (status.state !== 'printing') return { ok: false, content: `Pas reprise : ${status.state}.` };
        return { ok: true, content: 'Impression reprise.' };
      },
    }),
    defineTool({
      name: 'imprimante_annuler',
      description: "Annule l'impression en cours. Aucune confirmation : un arrêt n'attend pas.",
      risk: 'safe',
      schema: z.object({}),
      ...gate,
      execute: async () => {
        const status = await deps.client().cancel();
        if (status.state !== 'cancelled' && status.state !== 'standby') {
          return { ok: false, content: `Pas annulée : ${status.state}.` };
        }
        return { ok: true, content: 'Impression annulée.' };
      },
    }),
  ];
}
