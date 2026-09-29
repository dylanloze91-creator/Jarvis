import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { REQUIRED_VOICE_ASSETS, voiceAssetUrl } from '@jarvis/core';

vi.mock('./onnxRuntime', () => ({ configureOnnxRuntime: vi.fn(async () => ({})), withOrtLock: <T,>(task: () => Promise<T>) => task() }));
const { analyzeRecording, describeAnalysis, formatDiagnosticReport, runVoiceDiagnostic } = await import('./voiceDiagnostic');
const { createWhisperLoader, describeWhisperLoadError } = await import('./whisper/pipelineLoader');
type Deps = Parameters<typeof runVoiceDiagnostic>[0];

const SIZES = new Map(REQUIRED_VOICE_ASSETS.map((asset) => [`${asset.host}/${asset.path}`, asset.minBytes + 10]));

function servedFetch(overrides: Record<string, Response> = {}): typeof fetch {
  return (async (input: RequestInfo | URL) => {
    const url = String(input);
    if (overrides[url]) return overrides[url];
    const asset = REQUIRED_VOICE_ASSETS.find((a) => voiceAssetUrl(a.host, a.path) === url);
    if (!asset) return new Response('', { status: 404 });
    const size = SIZES.get(`${asset.host}/${asset.path}`)!;
    const body = asset.kind === 'json' ? `{"a":"${'x'.repeat(size - 8)}"}` : new Uint8Array(size);
    const type = asset.kind === 'wasm' ? 'application/wasm' : asset.kind === 'json' ? 'application/json' : 'application/octet-stream';
    return new Response(body, { status: 200, headers: { 'content-type': type } });
  }) as typeof fetch;
}

function speech(seconds: number, amplitude = 0.3): Float32Array {
  const pcm = new Float32Array(16000 * seconds);
  for (let i = 0; i < pcm.length; i += 1) pcm[i] = Math.sin(i / 8) * amplitude * (i % 16000 < 9000 ? 1 : 0.02);
  return pcm;
}

function deps(overrides: Partial<Deps> = {}): Deps {
  let clock = 0;
  return {
    assetsReport: async () => ({
      appVersion: '0.4.10',
      platform: 'win32',
      arch: 'x64',
      packaged: true,
      electron: '44.4.5',
      chrome: '146',
      root: 'C:\\Users\\Jean Dupont\\AppData\\Local\\Programs\\Jarvis\\resources',
      files: REQUIRED_VOICE_ASSETS.map((asset) => ({
        host: asset.host,
        path: asset.path,
        exists: true,
        size: SIZES.get(`${asset.host}/${asset.path}`)!,
        minBytes: asset.minBytes,
      })),
    }),
    fetch: servedFetch(),
    runtimeVersion: () => '1.31.0-dev',
    startRuntime: async () => undefined,
    scoreWakeWord: async (pcm) => (pcm.some((v) => Math.abs(v) > 0.1) ? 0.81 : 0.002),
    loadWhisper: async () => undefined,
    transcribe: async (_pcm, language) => (language === 'english' ? 'Jarvis.' : 'Jarvis, quelle heure est-il ?'),
    openMicrophone: async () => ({
      label: 'Micro (Realtek)',
      record: async () => ({ pcm: speech(2), sampleRate: 16000 }),
      close: () => undefined,
    }),
    now: () => (clock += 100),
    stepTimeoutMs: 45_000,
    whisperTimeoutMs: 100_000,
    liveRecordMs: 5_000,
    wakeWord: 'jarvis',
    wakeWordVariants: [],
    sensitivity: 0.7,
    detectorConfig: null,
    ...overrides,
  };
}

describe('Tester la voix', () => {
  it('passe toutes les étapes et rend la transcription et le score', async () => {
    const updates: string[][] = [];
    const result = await runVoiceDiagnostic(deps(), (steps) => updates.push(steps.map((s) => s.status)));
    expect(result.firstFailure).toBeNull();
    expect(result.steps.map((step) => step.status)).toEqual(['ok', 'ok', 'ok', 'ok', 'ok', 'ok', 'ok', 'ok']);
    expect(result.analysis).toMatchObject({ detected: true, command: 'quelle heure est-il ?' });
    expect(updates.length).toBeGreaterThan(8);
    const report = formatDiagnosticReport(result);
    expect(report).toMatch(/Jarvis 0\.4\.10 · win32 x64 · Electron 44\.4\.5/);
    expect(report).toMatch(/Aucune étape en échec/);
    expect(report).toMatch(/jarvis-oww:\/\/ort\/ort-wasm-simd-threaded\.wasm → HTTP 200, application\/wasm/);
    expect(report).toMatch(/Score openWakeWord max : 0\.810/);
    expect(report).toMatch(/Transcription : « Jarvis, quelle heure est-il \? »/);
    const withFile = formatDiagnosticReport(result, [
      { name: 'jarvis.mp3', durationS: 3.8, analysis: result.analysis! },
    ]);
    expect(withFile).toMatch(/Fichier « jarvis\.mp3 » \(3\.8 s\)\n   Score openWakeWord max : 0\.810/);
  });

  it('attrape le « Chargement… 100 % » infini : Whisper bloqué après la lecture des fichiers', async () => {
    vi.useFakeTimers();
    try {
      const loader = createWhisperLoader({
        importTransformers: async () =>
          ({
            env: {},
            pipeline: async (_t: string, _m: string, opts: { progress_callback: (i: unknown) => void }) => {
              opts.progress_callback({ status: 'progress_total', progress: 100 });
              return new Promise(() => undefined);
            },
          }) as never,
        configureRuntime: async () => undefined,
        runExclusive: (task) => task(),
        now: () => Date.now(),
        loadTimeoutMs: 90_000,
        retryAfterMs: 30_000,
        transcribeTimeoutMs: 60_000,
      });
      const pending = runVoiceDiagnostic(
        deps({
          loadWhisper: async () => {
            try {
              await loader.getPipeline({ force: true });
            } catch (error) {
              throw new Error(describeWhisperLoadError(error));
            }
          },
        }),
      );
      await vi.advanceTimersByTimeAsync(95_000);
      const result = await pending;
      expect(result.firstFailure?.id).toBe('whisper');
      expect(result.firstFailure?.summary).toMatch(
        /Whisper ne s'est pas chargé en 90 s \(bloqué à l'étape : création des sessions ONNX du modèle\)/,
      );
      const status = Object.fromEntries(result.steps.map((step) => [step.id, step.status]));
      expect(status).toMatchObject({ runtime: 'ok', wakeword: 'ok', inference: 'skipped', microphone: 'ok', live: 'skipped' });
      expect(formatDiagnosticReport(result)).toMatch(/Première étape en échec : Chargement de Whisper/);
    } finally {
      vi.useRealTimers();
    }
  });

  describe('avec des minuteries simulées', () => {
    beforeEach(() => vi.useFakeTimers());
    afterEach(() => vi.useRealTimers());

    it('une étape qui ne répond jamais est déclarée bloquée au lieu de figer le test', async () => {
      const pending = runVoiceDiagnostic(deps({ startRuntime: () => new Promise(() => undefined) }));
      await vi.advanceTimersByTimeAsync(46_000);
      const result = await pending;
      expect(result.firstFailure?.id).toBe('runtime');
      expect(result.firstFailure?.summary).toMatch(/Bloquée : aucune réponse après 45 s/);
    });
  });

  it('nomme le fichier que jarvis-oww ne sert pas (404)', async () => {
    const url = voiceAssetUrl('whisper', 'Xenova/whisper-base/tokenizer_config.json');
    const result = await runVoiceDiagnostic(
      deps({ fetch: servedFetch({ [url]: new Response('Fichier introuvable', { status: 404 }) }) }),
    );
    expect(result.firstFailure?.id).toBe('protocol');
    expect(result.firstFailure?.summary).toBe(
      'whisper/Xenova/whisper-base/tokenizer_config.json : HTTP 404 par jarvis-oww.',
    );
    expect(result.steps.find((s) => s.id === 'whisper')?.status).toBe('skipped');
  });

  it('refuse un .wasm servi sans le type application/wasm', async () => {
    const url = voiceAssetUrl('ort', 'ort-wasm-simd-threaded.wasm');
    const size = SIZES.get('ort/ort-wasm-simd-threaded.wasm')!;
    const result = await runVoiceDiagnostic(
      deps({
        fetch: servedFetch({
          [url]: new Response(new Uint8Array(size), { headers: { 'content-type': 'application/octet-stream' } }),
        }),
      }),
    );
    expect(result.firstFailure?.summary).toMatch(/servi en « application\/octet-stream » au lieu de application\/wasm/);
  });

  it('signale un fichier absent du dossier d’installation', async () => {
    const base = deps();
    const result = await runVoiceDiagnostic(
      deps({
        assetsReport: async () => {
          const report = await base.assetsReport();
          report.files[5] = { ...report.files[5]!, exists: false, size: 0 };
          return report;
        },
      }),
    );
    expect(result.firstFailure?.id).toBe('disk');
    expect(result.firstFailure?.summary).toMatch(/tokenizer\.json.*Réinstalle Jarvis/);
  });

  it('teste le micro même quand Whisper échoue, et traduit un refus d’accès', async () => {
    const result = await runVoiceDiagnostic(
      deps({
        loadWhisper: async () => {
          throw new Error('Fichier Whisper introuvable dans l’application (HTTP 404). Réinstalle Jarvis.');
        },
        openMicrophone: async () => {
          throw new Error('Accès au microphone refusé. Autorise-le dans les réglages de Windows, puis réessaie.');
        },
      }),
    );
    expect(result.firstFailure?.id).toBe('whisper');
    expect(result.steps.find((s) => s.id === 'microphone')).toMatchObject({
      status: 'failed',
      summary: expect.stringMatching(/Accès au microphone refusé/),
    });
  });
});

describe('analyzeRecording', () => {
  it('ne réveille pas Jarvis sur du silence et ne lance pas Whisper', async () => {
    const transcribe = vi.fn(async () => 'hallucination');
    const analysis = await analyzeRecording(
      { pcm: new Float32Array(16000 * 3), sampleRate: 16000 },
      { ...deps(), transcribe, scoreWakeWord: async () => 0.001 },
    );
    expect(analysis).toMatchObject({ detected: false, transcript: '', command: '' });
    expect(transcribe).not.toHaveBeenCalled();
  });

  it('refuse une autre phrase même si elle déclenche le gabarit d’énergie', async () => {
    const analysis = await analyzeRecording(
      { pcm: speech(3), sampleRate: 16000 },
      {
        ...deps(),
        scoreWakeWord: async () => 0.05,
        transcribe: async (_pcm, language) =>
          language === 'english' ? 'Good morning.' : 'Bonjour, je voudrais réserver une table.',
      },
    );
    expect(analysis.detected).toBe(false);
    expect(analysis.bareJarvisConfirmed).toBe(false);
    expect(describeAnalysis(analysis).at(-1)).toBe('Commande envoyée : aucune (pas de réveil)');
  });
});
