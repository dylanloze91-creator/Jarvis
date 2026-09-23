import {
  SpeechProviderError,
  type SpeechProviderConfig,
  type TextToSpeechController,
  type TextToSpeechDescriptor,
  type TextToSpeechHandlers,
  type TextToSpeechProvider,
  type VoiceDescriptor,
} from './types.js';

export const openAITtsDescriptor: TextToSpeechDescriptor = {
  id: 'openai-tts',
  label: 'OpenAI (synthèse cloud)',
  requiresApiKey: true,
  defaultModel: 'gpt-4o-mini-tts',
};

/** Voix livrées avec l'API de synthèse d'OpenAI, sans appel réseau nécessaire pour les lister. */
export const OPENAI_TTS_VOICES: VoiceDescriptor[] = [
  { id: 'alloy', label: 'Alloy' },
  { id: 'ash', label: 'Ash' },
  { id: 'ballad', label: 'Ballad' },
  { id: 'coral', label: 'Coral' },
  { id: 'echo', label: 'Echo' },
  { id: 'fable', label: 'Fable' },
  { id: 'nova', label: 'Nova' },
  { id: 'onyx', label: 'Onyx' },
  { id: 'sage', label: 'Sage' },
  { id: 'shimmer', label: 'Shimmer' },
];

/**
 * Moteur de synthèse distant : envoie le texte à l'API de synthèse d'OpenAI
 * et renvoie les octets audio via `onAudio`. La lecture reste à la charge de
 * l'appelant — `managesOwnPlayback` est faux.
 */
export class OpenAITtsProvider implements TextToSpeechProvider {
  readonly id = openAITtsDescriptor.id;
  readonly label = openAITtsDescriptor.label;
  readonly requiresApiKey = true;
  readonly managesOwnPlayback = false;

  private readonly apiKey: string;
  private readonly model: string;
  private readonly baseUrl: string;

  constructor(config: SpeechProviderConfig) {
    this.apiKey = config.apiKey ?? '';
    this.model = config.model || openAITtsDescriptor.defaultModel!;
    this.baseUrl = (config.baseUrl || 'https://api.openai.com/v1').replace(/\/+$/, '');
  }

  async listVoices(): Promise<VoiceDescriptor[]> {
    return OPENAI_TTS_VOICES;
  }

  speak(
    text: string,
    handlers: TextToSpeechHandlers,
    options: { voice?: string; signal?: AbortSignal } = {},
  ): TextToSpeechController {
    const controller = new AbortController();
    const signal = options.signal
      ? mergeSignals(options.signal, controller.signal)
      : controller.signal;

    void this.run(text, handlers, options.voice, signal);

    return { stop: () => controller.abort() };
  }

  private async run(
    text: string,
    handlers: TextToSpeechHandlers,
    voice: string | undefined,
    signal: AbortSignal,
  ): Promise<void> {
    if (!this.apiKey) {
      handlers.onError('Clé API manquante pour la synthèse OpenAI.');
      return;
    }

    handlers.onStart?.();
    try {
      const response = await fetch(`${this.baseUrl}/audio/speech`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify({
          model: this.model,
          voice: voice || OPENAI_TTS_VOICES[0]!.id,
          input: text,
          response_format: 'mp3',
        }),
        signal,
      });

      if (!response.ok) {
        throw new SpeechProviderError(await readError(response), response.status);
      }

      const data = new Uint8Array(await response.arrayBuffer());
      handlers.onAudio?.({ data, mimeType: 'audio/mpeg' });
      handlers.onEnd?.();
    } catch (error) {
      if (signal.aborted) {
        handlers.onEnd?.();
        return;
      }
      handlers.onError(describeError(error));
    }
  }
}

function mergeSignals(a: AbortSignal, b: AbortSignal): AbortSignal {
  if (a.aborted) return a;
  if (b.aborted) return b;
  const controller = new AbortController();
  const onAbort = (): void => controller.abort();
  a.addEventListener('abort', onAbort, { once: true });
  b.addEventListener('abort', onAbort, { once: true });
  return controller.signal;
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
