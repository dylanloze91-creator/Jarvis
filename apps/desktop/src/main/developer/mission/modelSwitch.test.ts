/**
 * Ces tests simulent Ollama. Ce n’est pas une exécution réelle du modèle.
 */
import { describe, expect, it } from 'vitest';
import type { OllamaStatusResult } from '@jarvis/core';
import { ModelSwitchError, createModelSwitch, type ModelSwitchApi } from './modelSwitch.js';

const detected = (names: string[]): OllamaStatusResult => ({
  status: 'detected',
  baseUrl: 'http://127.0.0.1:9',
  version: 'test',
  models: names.map((name) => ({
    name,
    sizeBytes: 1,
    parameterSize: 'test',
    quantizationLevel: 'Q4',
    supportsTools: true,
  })),
  message: 'ok',
});

describe('préparation du modèle (Ollama simulé, pas un vrai passage)', () => {
  it('ne marque le modèle prêt qu’après avoir libéré les autres', async () => {
    const unloaded: string[] = [];
    let listed = 0;
    const api: ModelSwitchApi = {
      status: async () => detected(['coder']),
      running: async () => {
        listed += 1;
        return listed === 1 ? [{ name: 'chat', sizeBytes: 2, sizeVramBytes: 2 }] : [];
      },
      unload: async (model) => {
        unloaded.push(model);
        return true;
      },
    };
    const lines: string[] = [];
    await createModelSwitch().switchTo({
      api,
      model: 'coder',
      timeoutMs: 200,
      log: (line) => lines.push(line),
    });
    expect(unloaded).toEqual(['chat']);
    expect(lines[0]).toBe('Préparation du modèle coder');
    expect(lines.at(-1)).toMatch(/Modèle prêt coder/);
  });

  it('un modèle absent est une erreur de chargement, pas une génération', async () => {
    const api: ModelSwitchApi = {
      status: async () => detected(['autre']),
      running: async () => [],
      unload: async () => true,
    };
    const error = await createModelSwitch()
      .switchTo({ api, model: 'coder', timeoutMs: 200, log: () => undefined })
      .catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(ModelSwitchError);
    expect((error as ModelSwitchError).kind).toBe('load');
    expect((error as ModelSwitchError).message).toMatch(/non installé : coder/);
  });

  it('Ollama injoignable est une erreur d’appel, retentable, distincte du délai', async () => {
    const api: ModelSwitchApi = {
      status: async () => ({
        status: 'unreachable',
        baseUrl: 'http://127.0.0.1:9',
        models: [],
        message: 'rien n’écoute',
      }),
      running: async () => [],
      unload: async () => true,
    };
    const error = await createModelSwitch()
      .switchTo({ api, model: 'coder', timeoutMs: 200, log: () => undefined })
      .catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(ModelSwitchError);
    expect((error as ModelSwitchError).kind).toBe('call');
  });

  it('un délai annule l’appel et n’enchaîne pas un second déchargement incompatible', async () => {
    let unloads = 0;
    let release: (() => void) | undefined;
    const api: ModelSwitchApi = {
      status: async () => detected(['coder']),
      running: async () => [{ name: 'lourd', sizeBytes: 1, sizeVramBytes: 1 }],
      unload: () => {
        unloads += 1;
        if (unloads === 1) {
          return new Promise((resolve) => {
            release = () => resolve(true);
          });
        }
        return Promise.resolve(true);
      },
    };
    const gate = createModelSwitch();
    const first = gate.switchTo({ api, model: 'coder', timeoutMs: 30, log: () => undefined });
    const error = await first.catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(ModelSwitchError);
    expect((error as ModelSwitchError).kind).toBe('timeout');
    expect(unloads).toBe(1);
    let secondStarted = false;
    const second = gate
      .switchTo({
        api: {
          ...api,
          running: async () => {
            secondStarted = true;
            return [];
          },
        },
        model: 'coder',
        timeoutMs: 200,
        log: () => undefined,
      })
      .then(() => 'ok');
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(secondStarted).toBe(false);
    expect(unloads).toBe(1);
    release?.();
    await expect(second).resolves.toBe('ok');
    expect(secondStarted).toBe(true);
  });
});
