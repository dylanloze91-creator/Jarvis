import { afterEach, describe, expect, it, vi } from 'vitest';
import { CODE_MODEL_CATALOG } from '../developer/codeModels.js';
import { OLLAMA_DEFAULT_MODEL, OLLAMA_RECOMMENDED_NUM_CTX, OllamaProvider } from '../providers/ollama.js';
import { defaultSettings, parseSettings } from '../settings.js';
import {
  applyMachineProfile,
  assertChatModelDownload,
  chatOllamaOptions,
  chatProviderConfig,
  modestChatModel,
  offeredCodeModels,
  planStartup,
  selectMachineProfile,
  shouldDownloadChatModel,
  type MachineMeasure,
} from './profile.js';

const GIB = 1024 ** 3;

function measure(partial: Partial<MachineMeasure> & Pick<MachineMeasure, 'totalRamBytes'>): MachineMeasure {
  return {
    failed: false,
    cpuModel: 'Intel Core i7-9700KF',
    logicalCores: 8,
    gpus: [],
    gpuProbe: 'ok',
    freeDiskBytes: 40 * GIB,
    ollamaPresent: true,
    ...partial,
  };
}

function gpu(name: string, totalMiB: number) {
  return measure({
    totalRamBytes: 0,
    gpus: [{ name, totalMiB }],
  });
}

describe('choix du profil matériel', () => {
  it('8 Go et 4 Go de VRAM : profil modeste', () => {
    const decision = selectMachineProfile({
      ...gpu('NVIDIA GeForce GTX 1050 Ti', 4096),
      totalRamBytes: 8 * GIB,
    });
    expect(decision.profile).toBe('modest');
    expect(decision.cpuOnly).toBe(false);
    expect(decision.measureFailed).toBe(false);
    expect(decision.chatModel).toBe(modestChatModel());
    expect(decision.chatModel).toBe('qwen2.5:1.5b');
    expect(decision.detected.endsWith('.')).toBe(true);
    expect(decision.chosen.endsWith('.')).toBe(true);
    expect(decision.detected).toContain('8 Go');
    expect(decision.detected).toContain('4 Go');
    expect(decision.chosen).toContain('modeste');
    const settings = applyMachineProfile(defaultSettings, decision);
    expect(settings.provider).toBe('ollama');
    expect(settings.model).toBe('qwen2.5:1.5b');
    expect(settings.fallbackModel).toBe('qwen2.5:1.5b');
    expect(settings.ollamaNumCtx).toBe(4096);
    expect(settings.voice.enabled).toBe(false);
    expect(settings.voice.sttProvider).toBe('local-whisper');
    expect(settings.voice.ttsProvider).toBe('browser-local');
    expect(settings.voice.wakeLearning).toBe(false);
    expect(settings.developer.enabled).toBe(false);
    expect(settings.developer.codeModel).toBe('');
    expect(settings.videoAnalysis).toBe(false);
    expect(chatOllamaOptions(settings)).toEqual({ numCtx: 4096 });
    expect(offeredCodeModels('modest')).toEqual([]);
  });

  it('16 Go et 6 Go de VRAM : profil standard', () => {
    const decision = selectMachineProfile({
      ...gpu('NVIDIA GeForce GTX 1060', 6144),
      totalRamBytes: 16 * GIB,
    });
    expect(decision.profile).toBe('standard');
    expect(decision.cpuOnly).toBe(false);
    expect(decision.chatModel).toBe('qwen2.5:3b');
    expect(decision.chatModel).toBe(OLLAMA_DEFAULT_MODEL);
    const settings = applyMachineProfile(defaultSettings, decision);
    expect(settings.model).toBe('qwen2.5:3b');
    expect(settings.fallbackModel).toBe('qwen2.5:3b');
    expect(settings.ollamaNumCtx).toBeUndefined();
    expect(settings.voice).toEqual(defaultSettings.voice);
    expect(settings.developer.enabled).toBe(false);
    expect(settings.videoAnalysis).toBeUndefined();
    expect(settings.systemPrompt).toBe(defaultSettings.systemPrompt);
    expect(chatOllamaOptions(settings)).toBeUndefined();
    expect(offeredCodeModels('standard')).toEqual(CODE_MODEL_CATALOG);
  });

  it('64 Go et 6 Go de VRAM : profil complet, sans modèle de code', () => {
    const decision = selectMachineProfile({
      ...gpu('NVIDIA GeForce RTX 2060', 6144),
      totalRamBytes: 64 * GIB,
    });
    expect(decision.profile).toBe('full');
    expect(decision.cpuOnly).toBe(false);
    expect(decision.chatModel).toBe('qwen2.5:3b');
    expect(CODE_MODEL_CATALOG.some((spec) => spec.id === decision.chatModel)).toBe(false);
    const settings = applyMachineProfile(defaultSettings, decision);
    expect(settings.provider).toBe('ollama');
    expect(settings.model).toBe('qwen2.5:3b');
    expect(settings.fallbackModel).toBe('qwen2.5:3b');
    expect(settings.ollamaNumCtx).toBeUndefined();
    expect(settings.voice).toEqual(defaultSettings.voice);
    expect(settings.developer.enabled).toBe(false);
    expect(settings.developer.codeModel).toBe('');
    expect(settings.videoAnalysis).toBeUndefined();
    expect(settings.systemPrompt).toBe(defaultSettings.systemPrompt);
    expect(settings.temperature).toBe(defaultSettings.temperature);
    expect(chatOllamaOptions(settings)).toBeUndefined();
    expect(chatProviderConfig(settings).ollama).toBeUndefined();
    expect(offeredCodeModels('full')).toEqual(CODE_MODEL_CATALOG);
  });

  it('sans carte graphique : réglé pour le processeur', () => {
    const decision = selectMachineProfile(
      measure({ totalRamBytes: 16 * GIB, gpuProbe: 'absent', gpus: [] }),
    );
    expect(decision.cpuOnly).toBe(true);
    expect(decision.profile).toBe('standard');
    expect(decision.detected).toContain('Pas de carte graphique');
    expect(decision.chosen).toContain('processeur');
    const settings = applyMachineProfile(defaultSettings, decision);
    expect(chatOllamaOptions(settings)).toEqual({ numGpu: 0 });
    const big = selectMachineProfile(
      measure({ totalRamBytes: 64 * GIB, gpuProbe: 'absent', gpus: [] }),
    );
    expect(big.profile).not.toBe('full');
    expect(big.cpuOnly).toBe(true);
  });

  it('mesure en échec : profil modeste, et la phrase le dit', () => {
    const decision = selectMachineProfile(
      measure({ totalRamBytes: 64 * GIB, failed: true, gpus: [{ name: 'RTX 2060', totalMiB: 6144 }] }),
    );
    expect(decision.profile).toBe('modest');
    expect(decision.measureFailed).toBe(true);
    expect(decision.detected).toBe('La mesure de la machine a échoué.');
    expect(decision.chosen).toContain('modeste');
    expect(decision.chatModel).toBe('qwen2.5:1.5b');
  });
});

describe('fichier de réglages déjà présent', () => {
  it('n’est pas réécrit et garde le modèle, la voix et le mode développeur', () => {
    const raw = JSON.stringify({
      provider: 'ollama',
      model: 'qwen2.5:7b',
      fallbackModel: 'qwen2.5:3b',
      voice: { enabled: true, sttProvider: 'local-whisper', ttsProvider: 'browser-local', ttsVoice: 'Hortense' },
      developer: { enabled: true, repoPath: 'C:\\dev\\Jarvis', codeModel: 'qwen3.5:4b', worktreeRoot: '' },
    });
    const decision = selectMachineProfile({
      ...gpu('NVIDIA GeForce RTX 2060', 6144),
      totalRamBytes: 64 * GIB,
    });
    const plan = planStartup(raw, decision);
    expect(plan.rawToWrite).toBeNull();
    expect(plan.settings.model).toBe('qwen2.5:7b');
    expect(plan.settings.voice.enabled).toBe(true);
    expect(plan.settings.voice.ttsVoice).toBe('Hortense');
    expect(plan.settings.developer.enabled).toBe(true);
    expect(plan.settings.developer.codeModel).toBe('qwen3.5:4b');
    expect(plan.settings.developer.repoPath).toBe('C:\\dev\\Jarvis');
    expect(plan.settings.machine).toBeUndefined();
    expect(JSON.stringify(parseSettings(JSON.parse(raw)))).toBe(JSON.stringify(plan.settings));
  });

  it('les défauts lus sans fichier ne gagnent pas de clé de profil', () => {
    const parsed = JSON.parse(JSON.stringify(parseSettings({}))) as Record<string, unknown>;
    expect(parsed.machine).toBeUndefined();
    expect(parsed.ollamaNumCtx).toBeUndefined();
    expect(parsed.videoAnalysis).toBeUndefined();
  });
});

describe('téléchargement', () => {
  it('refuse un modèle de code et ne télécharge pas si un profil est déjà là', () => {
    expect(() => assertChatModelDownload('qwen3.6:35b-a3b-coding')).toThrow(/code/);
    expect(
      shouldDownloadChatModel({
        firstLaunch: false,
        ollamaPresent: true,
        installed: false,
        model: 'qwen2.5:3b',
      }),
    ).toBe(false);
    expect(
      shouldDownloadChatModel({
        firstLaunch: true,
        ollamaPresent: true,
        installed: false,
        model: 'qwen3.6:35b-a3b-coding',
      }),
    ).toBe(false);
    expect(
      shouldDownloadChatModel({
        firstLaunch: true,
        ollamaPresent: true,
        installed: false,
        model: 'qwen2.5:1.5b',
      }),
    ).toBe(true);
  });

  it('le corps Ollama du chat complet reste sans options, le modeste fixe num_ctx', async () => {
    const bodies: unknown[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_url: string, init?: RequestInit) => {
        bodies.push(JSON.parse(String(init?.body)));
        return new Response(`${JSON.stringify({ message: { content: 'ok' }, done: true })}\n`);
      }),
    );
    const full = applyMachineProfile(
      defaultSettings,
      selectMachineProfile({ ...gpu('NVIDIA GeForce RTX 2060', 6144), totalRamBytes: 64 * GIB }),
    );
    const legacy = parseSettings({ provider: 'ollama', model: 'qwen2.5:3b' });
    for (const settings of [full, legacy]) {
      const provider = new OllamaProvider(chatProviderConfig(settings));
      for await (const _event of provider.streamChat({ messages: [{ role: 'user', content: 'Bonjour' }] })) {
        // on ne garde que le corps
      }
    }
    const modest = applyMachineProfile(
      defaultSettings,
      selectMachineProfile({ ...gpu('NVIDIA GeForce GTX 1050 Ti', 4096), totalRamBytes: 8 * GIB }),
    );
    const modestProvider = new OllamaProvider(chatProviderConfig(modest));
    for await (const _event of modestProvider.streamChat({ messages: [{ role: 'user', content: 'Bonjour' }] })) {
      // corps
    }
    const [fullBody, legacyBody, modestBody] = bodies as Array<{ options: { num_ctx: number; num_gpu?: number } }>;
    expect(fullBody?.options).toEqual({ temperature: 0.25, num_ctx: OLLAMA_RECOMMENDED_NUM_CTX });
    expect(legacyBody?.options).toEqual(fullBody?.options);
    expect(modestBody?.options.num_ctx).toBe(4096);
    expect(modestBody?.options.num_gpu).toBeUndefined();
    expect(JSON.stringify(bodies)).not.toContain('qwen3.6:35b-a3b-coding');
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});
