import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { MediaProvider, ToolContext } from '@jarvis/core';
import { parseSettings, youtubeUrlProblem } from '@jarvis/core';
import type { SpotifyBridge } from '../media/SpotifyBridge.js';
import type * as ExecModule from './platform/exec.js';

/**
 * Outils qui rataient d'après le journal d'audit de Live (lu le 19 novembre 2026) : pause, reprise
 * et morceau précédent de Spotify sans lecture en cours, `list_processes`, lien YouTube inventé.
 */
vi.mock('electron', () => ({ app: { getPath: () => '.' } }));
vi.mock('./platform/exec.js', async (importOriginal) => {
  const actual = await importOriginal<typeof ExecModule>();
  return { ...actual, runPowerShell: vi.fn(), run: vi.fn() };
});

const { runPowerShell } = await import('./platform/exec.js');
const { createSpotifyTools } = await import('./spotify.js');
const { listProcessesTool } = await import('./processes.js');

const context = (): ToolContext => ({ requestConfirmation: async () => true });

function spotifyTool(name: string, overrides: Partial<MediaProvider>) {
  const provider: MediaProvider = {
    id: 'spotify',
    searchTrack: vi.fn(async () => null),
    play: vi.fn(async () => undefined),
    pause: vi.fn(async () => undefined),
    next: vi.fn(async () => undefined),
    previous: vi.fn(async () => undefined),
    setVolume: vi.fn(async () => undefined),
    setShuffle: vi.fn(async () => undefined),
    getPlaybackState: vi.fn(async () => null),
    ...overrides,
  };
  const tools = createSpotifyTools({
    spotify: { getProvider: () => provider } as unknown as SpotifyBridge,
    getSettings: () => parseSettings({}),
  });
  const tool = tools.find((item) => item.name === name);
  if (!tool) throw new Error(`outil absent : ${name}`);
  return tool;
}

/** Ce que l'API de Spotify répond quand rien ne joue nulle part. */
const noDevice = async (): Promise<never> => {
  throw new Error(
    'Spotify API 404: { "error" : { "status" : 404, "message" : "Player command failed: No active device found", "reason" : "NO_ACTIVE_DEVICE" } }',
  );
};

describe('Spotify sans lecture en cours', () => {
  it('la pause n’est pas un raté : il n’y a rien à mettre en pause', async () => {
    const result = await spotifyTool('spotify_pause', { pause: noDevice }).run({}, context());
    expect(result.ok).toBe(true);
    expect(result.content).toMatch(/rien à mettre en pause/);
    expect(result.content).not.toMatch(/404|NO_ACTIVE_DEVICE|\{/);
  });

  it('reprise, suivant et précédent le disent en français, sans le texte brut de Spotify', async () => {
    const cases: Array<[string, Partial<MediaProvider>]> = [
      ['spotify_resume', { play: noDevice }],
      ['spotify_next', { next: noDevice }],
      ['spotify_previous', { previous: noDevice }],
    ];
    for (const [name, overrides] of cases) {
      const result = await spotifyTool(name, overrides).run({}, context());
      expect(result.ok, name).toBe(false);
      expect(result.outcome, name).toBe('recoverable');
      expect(result.content, name).toMatch(/aucune lecture en cours/);
      expect(result.content, name).not.toMatch(/404|NO_ACTIVE_DEVICE|\{/);
    }
  });

  it('une autre erreur reste dite telle quelle', async () => {
    const result = await spotifyTool('spotify_pause', {
      pause: async () => {
        throw new Error('Spotify API 403: Premium requis');
      },
    }).run({}, context());
    expect(result.ok).toBe(false);
    expect(result.content).toContain('403');
  });
});

describe('list_processes', () => {
  beforeEach(() => vi.mocked(runPowerShell).mockReset());

  /** Le vrai lanceur coupe la sortie à 8 000 caractères si on ne demande pas plus. */
  function fakePowerShell(count: number): void {
    const rows = Array.from({ length: count }, (_, index) => ({
      Id: 1000 + index,
      ProcessName: `programme-${index}`,
      CPU: index / 10,
      WorkingSet: 50_000_000 + index,
    }));
    vi.mocked(runPowerShell).mockImplementation(async (_script, options) => {
      const max = options?.maxOutputChars ?? 8_000;
      const full = JSON.stringify(rows);
      const truncated = full.length > max;
      return {
        code: 0,
        stdout: truncated ? `${full.slice(0, max)}\n… (sortie tronquée)` : full,
        stderr: '',
        timedOut: false,
        truncated,
      } as Awaited<ReturnType<typeof runPowerShell>>;
    });
  }

  const onWindows = process.platform === 'win32';

  it.runIf(onWindows)('lit la liste entière quand le PC a beaucoup de processus', async () => {
    fakePowerShell(400);
    const result = await listProcessesTool.run({ limit: 5, sortBy: 'name' }, context());
    expect(result.ok).toBe(true);
    expect(result.content).toMatch(/^5 processus/);
  });

  it.runIf(onWindows)('accepte un filtre écrit en objet par le modèle', async () => {
    fakePowerShell(30);
    const result = await listProcessesTool.run(
      { filter: { name: 'programme-7' }, limit: 5, sortBy: 'cpu' } as never,
      context(),
    );
    expect(result.ok).toBe(true);
    expect(result.content).toContain('programme-7');
  });

  it('accepte le filtre en objet et refuse toujours une autre forme', () => {
    expect(listProcessesTool.validate?.({ filter: { name: 'chrome' } })).toBeNull();
    expect(listProcessesTool.validate?.({ filter: { nom: 'chrome' } })).toBeNull();
    expect(listProcessesTool.validate?.({ filter: 'chrome' })).toBeNull();
    expect(listProcessesTool.validate?.({})).toBeNull();
    expect(listProcessesTool.validate?.({ filter: { pid: 4 } })).toMatch(/Arguments invalides/);
    expect(listProcessesTool.validate?.({ filter: ['chrome'] })).toMatch(/Arguments invalides/);
  });
});

describe('youtube_transcript : lien inventé', () => {
  it('dit de demander le lien au lieu d’en inventer un', () => {
    const message = youtubeUrlProblem('https://www.youtube.com/watch?v=your_video_id');
    expect(message).toMatch(/N'invente jamais un lien/);
    expect(message).toMatch(/demande à l'utilisateur/);
    expect(youtubeUrlProblem('https://youtu.be/VIDEO_ID')).toMatch(/N'invente jamais un lien/);
  });

  it('garde la phrase d’avant pour une adresse qui n’est pas YouTube', () => {
    expect(youtubeUrlProblem('https://example.com/video')).toMatch(/pas une adresse YouTube reconnue/);
    expect(youtubeUrlProblem('pas un lien')).toMatch(/pas une adresse YouTube reconnue/);
  });
});
