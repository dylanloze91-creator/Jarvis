import { describe, expect, it, vi } from 'vitest';
import type { ToolContext } from '@jarvis/core';
import { createYoutubeTranscriptTool } from './youtube.js';

function context(): ToolContext {
  return { requestConfirmation: async () => true };
}

describe('youtube_transcript', () => {
  it('est en lecture seule, risque safe', () => {
    const tool = createYoutubeTranscriptTool({
      summarize: async () => ({ ok: true, content: 'ok' }),
    });
    expect(tool.name).toBe('youtube_transcript');
    expect(tool.risk).toBe('safe');
  });

  it('transmet la progression française et le condensé', async () => {
    const progress: string[] = [];
    const tool = createYoutubeTranscriptTool({
      summarize: async (_url, onProgress) => {
        onProgress('Téléchargement de la piste audio…');
        onProgress('Rédaction du condensé…');
        return { ok: true, content: 'Le CAC est à 7200 points.' };
      },
    });
    const ctx = context();
    ctx.onProgress = (message) => progress.push(message);

    const result = await tool.run({ url: 'https://youtu.be/dQw4w9WgXcQ' }, ctx);
    expect(result.ok).toBe(true);
    expect(result.content).toContain('7200');
    expect(progress).toEqual([
      'Téléchargement de la piste audio…',
      'Rédaction du condensé…',
    ]);
  });

  it('ne télécharge rien lui-même si le résumé est injecté', async () => {
    const summarize = vi.fn(async () => ({
      ok: false,
      content:
        "Je n'ai pas pu écouter cette vidéo, et elle n'a pas de sous-titres : je ne peux pas encore la résumer.",
    }));
    const tool = createYoutubeTranscriptTool({ summarize });
    const result = await tool.run({ url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ' }, context());
    expect(result.ok).toBe(false);
    expect(result.content).toMatch(/pas de sous-titres/);
    expect(summarize).toHaveBeenCalledTimes(1);
  });
});
