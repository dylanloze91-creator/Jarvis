import { describe, expect, it } from 'vitest';
import { LIVE_EDITION, TEST_EDITION } from '../edition.js';
import { parseSettings } from '../settings.js';
import { ollamaLoadOptions } from './options.js';

/** 23 novembre 2026 : mêmes `num_ctx` / `num_gpu` que le chat pour chaque modèle. */
describe('options de chargement alignées sur le chat', () => {
  const orchestra = parseSettings({
    provider: 'ollama',
    model: 'qwen2.5:3b',
    orchestra: {
      enabled: true,
      brain: 'qwen2.5:7b',
      teams: {
        musique: { model: 'qwen2.5:3b', place: 'processeur' },
        memoire: { model: 'qwen3.5:4b', place: 'carte' },
      },
    },
  });

  it('cerveau et équipe sur la carte : contexte 8 192, rien sur num_gpu', () => {
    expect(ollamaLoadOptions(orchestra, 'qwen2.5:7b')).toEqual({ num_ctx: 8192 });
    expect(ollamaLoadOptions(orchestra, 'qwen3.5:4b')).toEqual({ num_ctx: 8192 });
  });

  it('équipe sur le processeur : num_gpu 0', () => {
    expect(ollamaLoadOptions(orchestra, 'qwen2.5:3b')).toEqual({ num_ctx: 8192, num_gpu: 0 });
  });

  it('trieur réglé : sa place à lui', () => {
    const withRouter = parseSettings({
      provider: 'ollama',
      orchestra: { enabled: true, brain: 'qwen2.5:7b', router: { model: 'jarvis-trieur', place: 'processeur' } },
    });
    expect(ollamaLoadOptions(withRouter, 'jarvis-trieur')).toEqual({ num_ctx: 8192, num_gpu: 0 });
  });

  it('sans chef d’orchestre : les options du chat (profil de la machine)', () => {
    expect(ollamaLoadOptions(parseSettings({ provider: 'ollama', model: 'qwen2.5:3b' }), 'qwen2.5:3b')).toEqual({ num_ctx: 8192 });
    const modest = parseSettings({
      provider: 'ollama',
      model: 'qwen2.5:1.5b',
      machine: { profile: 'modest', cpuOnly: true, measureFailed: false, detected: 'essai', chosen: 'essai' },
    });
    expect(ollamaLoadOptions(modest, 'qwen2.5:1.5b')).toEqual({ num_ctx: 4096, num_gpu: 0 });
  });

  it('réservé à Jarvis Test', () => {
    expect(TEST_EDITION.alignOllamaOptions).toBe(true);
    expect(LIVE_EDITION.alignOllamaOptions).toBeUndefined();
  });
});
