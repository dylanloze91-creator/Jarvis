import type { Img2ImgPayload, Txt2ImgPayload, Txt2ImgResponse } from '@jarvis/core';

export type ForgeErrorKind = 'unreachable' | 'http' | 'timeout' | 'cancelled' | 'bad_response';

export class ForgeError extends Error {
  constructor(
    public readonly kind: ForgeErrorKind,
    message: string,
    public readonly detail?: string,
  ) {
    super(message);
    this.name = 'ForgeError';
  }
}

export const DEFAULT_FORGE_URL = 'http://127.0.0.1:7860';
/** Une image SDXL sur une RTX 2060 prend 20 à 60 s ; un lot de 4 en 1344×768, quelques minutes. */
export const TXT2IMG_TIMEOUT_MS = 10 * 60_000;

export interface ForgeModel {
  title: string;
  model_name: string;
  filename?: string;
}

export interface ForgeLora {
  name: string;
  alias?: string;
  path?: string;
}

/**
 * Client HTTP de l'API de Forge (compatible AUTOMATIC1111 : `/sdapi/v1/*`).
 * Boucle locale seulement : l'adresse vient des réglages, validée par `checkForgeUrl`.
 */
export class ForgeClient {
  constructor(
    private readonly baseUrl: string = DEFAULT_FORGE_URL,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  get url(): string {
    return this.baseUrl;
  }

  /** Vrai si le serveur répond (sans charger de modèle). */
  async ping(timeoutMs = 3_000): Promise<boolean> {
    try {
      const response = await this.fetchImpl(`${this.baseUrl}/sdapi/v1/progress?skip_current_image=true`, {
        signal: AbortSignal.timeout(timeoutMs),
      });
      return response.ok;
    } catch {
      return false;
    }
  }

  /** Avancement de la génération en cours (0 à 1) et temps restant estimé, pour la barre du panneau direct. */
  async progress(): Promise<{ progress: number; etaSeconds: number }> {
    const body = (await this.get('/sdapi/v1/progress?skip_current_image=true')) as { progress?: number; eta_relative?: number };
    return { progress: Number(body.progress ?? 0), etaSeconds: Number(body.eta_relative ?? 0) };
  }

  async models(): Promise<ForgeModel[]> {
    return (await this.get('/sdapi/v1/sd-models')) as ForgeModel[];
  }

  async loras(): Promise<ForgeLora[]> {
    return (await this.get('/sdapi/v1/loras')) as ForgeLora[];
  }

  async options(): Promise<Record<string, unknown>> {
    return (await this.get('/sdapi/v1/options')) as Record<string, unknown>;
  }

  async setOptions(values: Record<string, unknown>, signal?: AbortSignal): Promise<void> {
    await this.post('/sdapi/v1/options', values, { signal, timeoutMs: 5 * 60_000 });
  }

  async txt2img(payload: Txt2ImgPayload, signal?: AbortSignal): Promise<Txt2ImgResponse> {
    const body = (await this.post('/sdapi/v1/txt2img', payload, { signal, timeoutMs: TXT2IMG_TIMEOUT_MS })) as Txt2ImgResponse;
    if (!body || !Array.isArray(body.images)) throw new ForgeError('bad_response', 'Forge n’a pas renvoyé d’image.', JSON.stringify(body).slice(0, 500));
    return body;
  }

  /** Image vers image : même réponse que `txt2img`. */
  async img2img(payload: Img2ImgPayload, signal?: AbortSignal): Promise<Txt2ImgResponse> {
    const body = (await this.post('/sdapi/v1/img2img', payload, { signal, timeoutMs: TXT2IMG_TIMEOUT_MS })) as Txt2ImgResponse;
    if (!body || !Array.isArray(body.images)) throw new ForgeError('bad_response', 'Forge n’a pas renvoyé d’image.', JSON.stringify(body).slice(0, 500));
    return body;
  }

  /** Scripts disponibles (`adetailer`…), tels que Forge les liste pour txt2img. */
  async scripts(): Promise<string[]> {
    const body = (await this.get('/sdapi/v1/scripts')) as { txt2img?: string[] };
    return (body.txt2img ?? []).map((name) => String(name).toLowerCase());
  }

  /** Agrandisseurs installés (`Lanczos`, `ESRGAN`, `R-ESRGAN 4x+`…). */
  async upscalers(): Promise<string[]> {
    const body = (await this.get('/sdapi/v1/upscalers')) as { name?: string }[];
    return body.map((item) => String(item.name ?? '')).filter((name) => name && name !== 'None');
  }

  /** Agrandit une image (base64 → base64) par l'onglet « Extras » de Forge. */
  async upscale(imageBase64: string, factor: number, upscaler: string, signal?: AbortSignal): Promise<string> {
    const body = (await this.post(
      '/sdapi/v1/extra-single-image',
      { image: imageBase64, resize_mode: 0, upscaling_resize: factor, upscaler_1: upscaler, show_extras_results: true },
      { signal, timeoutMs: 5 * 60_000 },
    )) as { image?: string };
    if (!body.image) throw new ForgeError('bad_response', 'Forge n’a pas renvoyé l’image agrandie.');
    return body.image;
  }

  /** Libère la mémoire vidéo du modèle sans arrêter Forge. */
  async unloadCheckpoint(): Promise<void> {
    await this.post('/sdapi/v1/unload-checkpoint', {}, { timeoutMs: 60_000 });
  }

  private async get(path: string): Promise<unknown> {
    let response: Response;
    try {
      response = await this.fetchImpl(`${this.baseUrl}${path}`, { signal: AbortSignal.timeout(10_000) });
    } catch (error) {
      throw toForgeError(error);
    }
    if (!response.ok) throw new ForgeError('http', `Forge a répondu ${response.status} sur ${path}.`, await safeText(response));
    return response.json();
  }

  private async post(path: string, body: unknown, options: { signal?: AbortSignal; timeoutMs: number }): Promise<unknown> {
    const signals = [AbortSignal.timeout(options.timeoutMs)];
    if (options.signal) signals.push(options.signal);
    let response: Response;
    try {
      response = await this.fetchImpl(`${this.baseUrl}${path}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
        signal: AbortSignal.any(signals),
      });
    } catch (error) {
      throw toForgeError(error, options.signal?.aborted ?? false);
    }
    if (!response.ok) throw new ForgeError('http', `Forge a répondu ${response.status} sur ${path}.`, await safeText(response));
    const text = await response.text();
    if (!text) return {};
    try {
      return JSON.parse(text) as unknown;
    } catch {
      throw new ForgeError('bad_response', 'Réponse de Forge illisible.', text.slice(0, 500));
    }
  }
}

async function safeText(response: Response): Promise<string> {
  try {
    return (await response.text()).slice(0, 800);
  } catch {
    return '';
  }
}

function toForgeError(error: unknown, cancelledByUser = false): ForgeError {
  if (error instanceof ForgeError) return error;
  const name = (error as { name?: string })?.name ?? '';
  const message = error instanceof Error ? error.message : String(error);
  if (cancelledByUser) return new ForgeError('cancelled', 'Génération annulée.', message);
  if (name === 'TimeoutError') return new ForgeError('timeout', 'Forge n’a pas répondu à temps.', message);
  if (name === 'AbortError') return new ForgeError('cancelled', 'Génération annulée.', message);
  return new ForgeError('unreachable', 'Forge ne répond pas.', message);
}

/** Seule la boucle locale est acceptée : Forge tourne sur ce PC. */
export function checkForgeUrl(raw: string): { ok: true; url: string } | { ok: false; reason: string } {
  const text = raw.trim().replace(/\/+$/, '');
  if (!text) return { ok: true, url: DEFAULT_FORGE_URL };
  let parsed: URL;
  try {
    parsed = new URL(text);
  } catch {
    return { ok: false, reason: 'Adresse de Forge invalide (exemple : http://127.0.0.1:7860).' };
  }
  if (parsed.protocol !== 'http:') return { ok: false, reason: 'Forge est joint en http sur ce PC, pas autrement.' };
  if (!['127.0.0.1', 'localhost', '[::1]'].includes(parsed.hostname)) {
    return { ok: false, reason: 'Forge doit tourner sur ce PC (127.0.0.1 ou localhost).' };
  }
  if (parsed.username || parsed.password) return { ok: false, reason: 'Pas d’identifiant dans l’adresse.' };
  return { ok: true, url: `${parsed.protocol}//${parsed.host}` };
}
