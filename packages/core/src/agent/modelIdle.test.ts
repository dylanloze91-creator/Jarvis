import { describe, expect, it } from 'vitest';
import { MODEL_IDLE_RELEASE_MS, discussionModels, idleLongEnough, modelsToRelease } from './modelIdle.js';

const orchestre = {
  provider: 'ollama',
  model: 'qwen2.5:3b',
  orchestra: {
    enabled: true,
    brain: 'qwen2.5:7b',
    teams: { musique: { model: 'qwen2.5:3b', place: 'processeur' as const }, code: { model: 'qwen2.5-coder:7b', place: 'carte' as const } },
  },
};

describe('modèles libérés après usage', () => {
  it('les modèles de la discussion : le chat, le cerveau et chaque équipe, sans doublon', () => {
    expect(discussionModels(orchestre)).toEqual(['qwen2.5:3b', 'qwen2.5:7b', 'qwen2.5-coder:7b']);
  });

  it('sans chef d’orchestre : seulement le modèle du chat', () => {
    expect(discussionModels({ provider: 'ollama', model: 'qwen2.5:3b' })).toEqual(['qwen2.5:3b']);
    expect(discussionModels({ provider: 'ollama', model: 'qwen2.5:3b', orchestra: { enabled: false, brain: 'qwen2.5:7b' } })).toEqual(['qwen2.5:3b']);
  });

  it('un autre fournisseur qu’Ollama : rien à libérer', () => {
    expect(discussionModels({ ...orchestre, provider: 'openai' })).toEqual([]);
  });

  it('ne libère que ses modèles : jamais celui d’une mission, de la vision ou d’un autre programme', () => {
    const charges = ['qwen2.5:7b', 'hf.co/deepreinforce-ai/Ornith-1.0-9B-GGUF:Q4_K_M', 'qwen2.5vl:3b', 'qwen3.5:4b'];
    expect(modelsToRelease(orchestre, charges)).toEqual(['qwen2.5:7b']);
  });

  it('reconnaît un modèle avec ou sans « :latest »', () => {
    expect(modelsToRelease({ provider: 'ollama', model: 'jarvis-coder' }, ['jarvis-coder:latest'])).toEqual(['jarvis-coder:latest']);
  });

  it('libère après dix minutes sans usage, jamais pendant un tour, une mission ou une image', () => {
    const lastUse = 1_000_000;
    expect(idleLongEnough({ now: lastUse + MODEL_IDLE_RELEASE_MS - 1, lastUse, busy: false })).toBe(false);
    expect(idleLongEnough({ now: lastUse + MODEL_IDLE_RELEASE_MS, lastUse, busy: false })).toBe(true);
    expect(idleLongEnough({ now: lastUse + 10 * MODEL_IDLE_RELEASE_MS, lastUse, busy: true })).toBe(false);
    expect(MODEL_IDLE_RELEASE_MS).toBe(10 * 60_000);
  });
});
