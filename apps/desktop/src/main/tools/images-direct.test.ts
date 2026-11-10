import { describe, expect, it } from 'vitest';
import { ToolManager, type ChatAttachment } from '@jarvis/core';
import { createImagesTools } from './images.js';

/**
 * `generer_image` (étape 2 quater du mode direct) : l'outil ne reçoit plus de prompt rédigé par le
 * modèle de langage. Il lit le message de l'utilisateur mot pour mot (`currentTurn`) et le confie à
 * Imager (mode direct, règles seules) ; avec une photo jointe, au chemin image vers image.
 */
interface Calls {
  direct: unknown[];
  classic: unknown[];
}

function fakeService(calls: Calls) {
  return {
    isEnabled: () => true,
    settings: () => ({ openAfterGeneration: true }),
    generateDirect: async (request: unknown) => {
      calls.direct.push(request);
      return {
        project: 'perso',
        folder: 'C:\\x',
        files: [{ png: 'C:\\x\\a-1.png', txt: 'C:\\x\\a-1.txt', seed: 1, preview: 'data:image/png;base64,AA==' }],
        width: 1024,
        height: 1024,
        durationMs: 100,
        warnings: [],
        finalPrompt: 'final',
        finalNegative: '',
        improved: true,
        checkpoint: { id: 'realvisxl', label: 'RealVisXL V5.0' },
        subjectType: 'personne',
        adetailer: true,
        forgeHeld: false,
        brainReloaded: 'qwen2.5:7b',
      };
    },
    generate: async (request: unknown) => {
      calls.classic.push(request);
      return {
        project: 'perso',
        folder: 'C:\\x',
        files: [{ png: 'C:\\x\\b-1.png', txt: 'C:\\x\\b-1.txt', seed: 2 }],
        width: 1024,
        height: 1024,
        durationMs: 100,
        forgeStartedByJarvis: false,
        brainReloaded: 'qwen2.5:7b',
        warnings: [],
        finalPrompt: 'final photo',
        refined: null,
        checkpoint: null,
        subjectType: 'personne',
        render: 'auto',
        renderHonored: true,
        adetailer: false,
        upscaled: null,
      };
    },
  };
}

function manager(calls: Calls, turn: { text: string; attachments?: ChatAttachment[] } | null, opened: string[] = []) {
  return new ToolManager().registerAll(
    createImagesTools(fakeService(calls) as never, {
      currentTurn: () => turn,
      openPath: async (path) => {
        opened.push(path);
      },
    }),
  );
}

const context = { requestConfirmation: async () => true };

describe('generer_image en mode direct', () => {
  it('le modèle ne passe que le projet : la demande vient du message en cours, mot pour mot', async () => {
    const calls: Calls = { direct: [], classic: [] };
    const opened: string[] = [];
    const tools = manager(calls, { text: 'Génère une image de Hinata de Naruto, en bikini sur la plage' }, opened);
    const schema = tools.schemas().find((tool) => tool.name === 'generer_image')!;
    expect(Object.keys((schema.parameters as { properties: Record<string, unknown> }).properties)).toEqual(['projet', 'photoDeBase', 'fidelite']);
    expect(schema.description).toContain('Tu n’as pas à rédiger de prompt');
    const outcome = await tools.execute({ id: '1', name: 'generer_image', arguments: { projet: 'jarvis' } }, context);
    expect(outcome.status).toBe('ok');
    expect(calls.direct).toEqual([{ prompt: 'Génère une image de Hinata de Naruto, en bikini sur la plage', negative: '', project: 'jarvis' }]);
    expect(calls.classic).toEqual([]);
    expect(outcome.content).toContain('a-1.png');
    expect(outcome.content).toContain('Consigne envoyée à Stable Diffusion : final');
    expect(opened).toEqual(['C:\\x\\a-1.png']);
  });

  it('photo jointe au message : chemin image vers image, type et rendu devinés par mots', async () => {
    const calls: Calls = { direct: [], classic: [] };
    const tools = manager(calls, {
      text: 'la même personne en style anime',
      attachments: [{ kind: 'image', name: 'moi.jpg', path: 'C:\\dev\\Jarvis_images\\_references\\2026-11-10\\moi.jpg', mime: 'image/jpeg' }],
    });
    const outcome = await tools.execute({ id: '2', name: 'generer_image', arguments: {} }, context);
    expect(outcome.status).toBe('ok');
    expect(calls.direct).toEqual([]);
    expect(calls.classic).toEqual([
      {
        prompt: 'la même personne en style anime',
        project: 'perso',
        subjectType: 'personne',
        render: 'anime',
        initImage: { path: 'C:\\dev\\Jarvis_images\\_references\\2026-11-10\\moi.jpg' },
      },
    ]);
  });

  it('sans message en cours : refus clair, rien n’est généré', async () => {
    const calls: Calls = { direct: [], classic: [] };
    const tools = manager(calls, null);
    const outcome = await tools.execute({ id: '3', name: 'generer_image', arguments: { projet: 'perso' } }, context);
    expect(outcome.status).toBe('error');
    expect(outcome.content).toContain('n’a pas reçu la demande');
    expect(calls.direct).toEqual([]);
  });
});
