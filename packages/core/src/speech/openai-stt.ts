import { concatFloat32, encodeWav } from './wav.js';
import {
  SpeechProviderError,
  type SpeechProviderConfig,
  type SpeechToTextController,
  type SpeechToTextDescriptor,
  type SpeechToTextHandlers,
  type SpeechToTextProvider,
} from './types.js';

export const openAISttDescriptor: SpeechToTextDescriptor = {
  id: 'openai-whisper',
  label: 'OpenAI Whisper (cloud)',
  requiresApiKey: true,
  defaultModel: 'whisper-1',
};

/**
 * Moteur de transcription distant : reçoit l'audio via `pushAudio`, l'encode
 * en WAV, puis interroge l'API de transcription d'OpenAI une fois la phrase
 * terminée (`stop`). Contrairement à la reconnaissance embarquée du
 * navigateur, il ne capture rien lui-même — `managesOwnCapture` est faux.
 */
export class OpenAISttProvider implements SpeechToTextProvider {
  readonly id = openAISttDescriptor.id;
  readonly label = openAISttDescriptor.label;
  readonly requiresApiKey = true;
  readonly managesOwnCapture = false;

  private readonly apiKey: string;
  private readonly model: string;
  private readonly baseUrl: string;

  constructor(config: SpeechProviderConfig) {
    this.apiKey = config.apiKey ?? '';
    this.model = config.model || openAISttDescriptor.defaultModel!;
    this.baseUrl = (config.baseUrl || 'https://api.openai.com/v1').replace(/\/+$/, '');
  }

  start(
    handlers: SpeechToTextHandlers,
    options: { language?: string; signal?: AbortSignal } = {},
  ): SpeechToTextController {
    const frames: Float32Array[] = [];
    let sampleRate = 16000;
    let settled = false;

    return {
      pushAudio: (frame, rate) => {
        if (settled) return;
        sampleRate = rate;
        frames.push(frame);
      },
      stop: () => {
        if (settled) return;
        settled = true;
        void this.transcribe(frames, sampleRate, handlers, options);
      },
      abort: () => {
        settled = true;
      },
    };
  }

  private async transcribe(
    frames: Float32Array[],
    sampleRate: number,
    handlers: SpeechToTextHandlers,
    options: { language?: string; signal?: AbortSignal },
  ): Promise<void> {
    if (!this.apiKey) {
      handlers.onError('Clé API manquante pour la transcription OpenAI.');
      return;
    }
    if (frames.length === 0) {
      handlers.onError("Aucun son capturé avant la fin de l'écoute.");
      return;
    }

    try {
      const wav = encodeWav(concatFloat32(frames), sampleRate);
      const form = new FormData();
      form.append(
        'file',
        new Blob([wav.buffer as ArrayBuffer], { type: 'audio/wav' }),
        'audio.wav',
      );
      form.append('model', this.model);
      if (options.language) form.append('language', options.language);

      const response = await fetch(`${this.baseUrl}/audio/transcriptions`, {
        method: 'POST',
        headers: { authorization: `Bearer ${this.apiKey}` },
        body: form,
        signal: options.signal,
      });

      if (!response.ok) {
        throw new SpeechProviderError(await readError(response), response.status);
      }

      const payload = (await response.json()) as { text?: string };
      handlers.onFinal((payload.text ?? '').trim());
    } catch (error) {
      if (options.signal?.aborted) return;
      handlers.onError(describeError(error));
    }
  }
}

async function readError(response: Response): Promise<string> {
  const raw = await response.text().catch(() => '');
  const fallback = raw.slice(0, 300) || `HTTP ${response.status}`;
  try {
    const parsed = JSON.parse(raw) as { error?: { message?: string } };
    return parsed.error?.message ?? fallback;
  } catch {
    return fallback;
  }
}

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
