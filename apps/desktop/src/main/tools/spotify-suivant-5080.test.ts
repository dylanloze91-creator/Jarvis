import { describe, expect, it, vi } from 'vitest';
import type { MediaProvider, PlaybackState, ToolContext } from '@jarvis/core';
import { parseSettings } from '@jarvis/core';
import type { SpotifyBridge } from '../media/SpotifyBridge.js';

/**
 * Essais du 20 novembre 2026 (rapports/2026-11-19-live-5080-a-verifier.md, § 7, point 3) : sur un
 * morceau lancé seul, Spotify refuse « précédent » (403 « Restriction violated », dit en anglais),
 * « suivant » arrête la lecture alors que l'outil disait « Morceau suivant. », et « pause » sur une
 * lecture déjà en pause affichait l'erreur anglaise.
 */
vi.mock('electron', () => ({ app: { getPath: () => '.' } }));

const { createSpotifyTools } = await import('./spotify.js');

const context = (): ToolContext => ({ requestConfirmation: async () => true });

const restriction = async (): Promise<never> => {
  throw new Error(
    'Spotify API 403: { "error" : { "status" : 403, "message" : "Player command failed: Restriction violated", "reason" : "UNKNOWN" } }',
  );
};

const playing = (title: string): PlaybackState => ({
  isPlaying: true,
  track: { uri: `spotify:track:${title}`, title, artists: ['Artiste'], provider: 'spotify' },
});

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
  const waits: number[] = [];
  const tools = createSpotifyTools({
    spotify: { getProvider: () => provider } as unknown as SpotifyBridge,
    getSettings: () => parseSettings({}),
    wait: async (ms) => {
      waits.push(ms);
    },
  });
  const tool = tools.find((item) => item.name === name);
  if (!tool) throw new Error(`outil absent : ${name}`);
  return { tool, waits };
}

describe('Spotify : suivant et précédent vérifiés', () => {
  it('« suivant » dit le vrai morceau qui joue après le changement', async () => {
    const { tool, waits } = spotifyTool('spotify_next', { getPlaybackState: async () => playing('Deuxième') });
    const result = await tool.run({}, context());
    expect(result.ok).toBe(true);
    expect(result.content).toBe('Morceau suivant : Deuxième — Artiste.');
    expect(waits).toEqual([800]);
  });

  it('« suivant » sur un morceau seul : la lecture s’arrête, Jarvis le dit au lieu de « Morceau suivant »', async () => {
    const { tool } = spotifyTool('spotify_next', { getPlaybackState: async () => ({ isPlaying: false }) });
    const result = await tool.run({}, context());
    expect(result.ok).toBe(false);
    expect(result.content).toMatch(/pas de morceau suivant/);
    expect(result.content).toMatch(/album ou une playlist/);
  });

  it('« précédent » refusé par Spotify (403 en anglais) : une phrase en français', async () => {
    const { tool } = spotifyTool('spotify_previous', { previous: restriction });
    const result = await tool.run({}, context());
    expect(result.ok).toBe(false);
    expect(result.content).toMatch(/pas de morceau précédent/);
    expect(result.content).not.toMatch(/403|Restriction|\{/);
  });

  it('« précédent » qui marche dit le morceau', async () => {
    const { tool } = spotifyTool('spotify_previous', { getPlaybackState: async () => playing('Premier') });
    expect((await tool.run({}, context())).content).toBe('Morceau précédent : Premier — Artiste.');
  });

  it('état illisible après « suivant » : demandé, sans prétendre savoir ce qui joue', async () => {
    const { tool } = spotifyTool('spotify_next', {
      getPlaybackState: async () => {
        throw new Error('réseau');
      },
    });
    const result = await tool.run({}, context());
    expect(result.ok).toBe(true);
    expect(result.content).toMatch(/je n'ai pas pu vérifier/);
  });
});

describe('Spotify : pause et reprise en double', () => {
  it('« pause » alors que c’est déjà en pause', async () => {
    const { tool } = spotifyTool('spotify_pause', { pause: restriction, getPlaybackState: async () => ({ isPlaying: false }) });
    const result = await tool.run({}, context());
    expect(result.ok).toBe(true);
    expect(result.content).toBe('Spotify était déjà en pause.');
  });

  it('« reprends » alors que ça joue déjà', async () => {
    const { tool } = spotifyTool('spotify_resume', { play: restriction, getPlaybackState: async () => playing('Un') });
    const result = await tool.run({}, context());
    expect(result.ok).toBe(true);
    expect(result.content).toBe('Spotify joue déjà.');
  });

  it('un autre refus de Spotify reste un raté, sans le texte anglais', async () => {
    const { tool } = spotifyTool('spotify_pause', { pause: restriction, getPlaybackState: async () => playing('Un') });
    const result = await tool.run({}, context());
    expect(result.ok).toBe(false);
    expect(result.content).not.toMatch(/403|Restriction/);
  });
});
