import { z } from 'zod';
import { defineTool } from '@jarvis/core';

export interface YoutubeToolDeps {
  summarize: (
    url: string,
    onProgress: (message: string) => void,
    signal?: AbortSignal,
  ) => Promise<{ ok: boolean; content: string }>;
}

/**
 * Écoute une vidéo YouTube (piste audio seule, Whisper local, condensé).
 * Lecture seule : rien n'est écrit sur le PC en dehors d'un fichier temporaire
 * effacé après la transcription.
 */
export function createYoutubeTranscriptTool(deps: YoutubeToolDeps) {
  return defineTool({
    name: 'youtube_transcript',
    description:
      "Écoute une vidéo YouTube (lien watch, youtu.be, Shorts ou live) : télécharge seulement la piste audio, la transcrit avec Whisper local, l'efface, puis rédige un condensé en français des points importants. Ne télécharge pas la vidéo. Si l'écoute échoue, les sous-titres servent de repli et la réponse le dit.",
    risk: 'safe',
    schema: z.object({
      url: z
        .string()
        .min(1)
        .max(2000)
        .describe('URL YouTube complète (watch, youtu.be, shorts ou live).'),
    }),
    summarize: ({ url }) => `Écouter et résumer ${url}.`,
    execute: async ({ url }, context) => {
      try {
        return await deps.summarize(
          url,
          (message) => context.onProgress?.(message),
          context.signal,
        );
      } catch (error) {
        return {
          ok: false,
          content: `Impossible de résumer cette vidéo : ${error instanceof Error ? error.message : String(error)}`,
        };
      }
    },
  });
}
