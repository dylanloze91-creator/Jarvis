import type { WebContents } from 'electron';
import { summarizeYoutubeVideo, type Settings } from '@jarvis/core';
import { deleteAudioFile, downloadAudioFile } from './downloadAudio.js';
import { completeWithLocalModel } from './localComplete.js';
import { transcribeAudioFile } from './transcribeAudio.js';

export function summarizeYoutubeLink(input: {
  url: string;
  getSettings: () => Settings;
  getWebContents: () => WebContents | null;
  onProgress: (message: string) => void;
  signal?: AbortSignal;
}): Promise<{ ok: boolean; content: string }> {
  const settings = input.getSettings();
  return summarizeYoutubeVideo(input.url, {
    downloadAudio: (url) => downloadAudioFile(url, globalThis.fetch, input.signal),
    deleteAudio: deleteAudioFile,
    transcribeFile: (filePath, onProgress) =>
      transcribeAudioFile({
        webContents: input.getWebContents(),
        filePath,
        onProgress,
        signal: input.signal,
      }),
    complete: (system, user) => completeWithLocalModel(settings, system, user, input.signal),
    onProgress: input.onProgress,
    signal: input.signal,
  });
}
