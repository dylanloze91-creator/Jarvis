import { request as httpRequest, type IncomingMessage } from 'node:http';
import { request as httpsRequest } from 'node:https';
import { Readable } from 'node:stream';

const NO_BODY = new Set([101, 204, 205, 304]);

function toResponse(res: IncomingMessage): Response {
  const headers = new Headers();
  for (const [key, value] of Object.entries(res.headers))
    if (value !== undefined) headers.set(key, Array.isArray(value) ? value.join(', ') : value);
  const status = res.statusCode ?? 0;
  const body = NO_BODY.has(status) ? null : (Readable.toWeb(res) as ReadableStream<Uint8Array>);
  return new Response(body, { status, statusText: res.statusMessage ?? '', headers });
}

/**
 * `fetch` du modèle de code (5.0.1), sans délai d'en-têtes ni de corps. Le
 * `fetch` de Node abandonne une réponse muette au bout de 300 s ; or Ollama
 * n'envoie rien tant qu'un appel d'outil n'est pas complet, et un petit modèle
 * sur processeur peut écrire un fichier entier pendant plus de 5 minutes. La
 * durée reste bornée par le plafond de l'étape (`STEP_LIMITS`) et l'annulation.
 */
export const patientFetch: typeof fetch = (input, init = {}) =>
  new Promise<Response>((resolve, reject) => {
    const url = new URL(
      typeof input === 'string' || input instanceof URL ? input : (input as Request).url,
    );
    const send = url.protocol === 'https:' ? httpsRequest : httpRequest;
    const headers: Record<string, string> = {};
    new Headers(init.headers).forEach((value, key) => {
      headers[key] = value;
    });
    const req = send(
      url,
      { method: init.method ?? 'GET', headers, signal: init.signal ?? undefined },
      (res) => resolve(toResponse(res)),
    );
    req.on('error', reject);
    const body = init.body;
    if (typeof body === 'string') req.write(body);
    else if (body instanceof Uint8Array) req.write(body);
    else if (body !== undefined && body !== null)
      return reject(new TypeError('patientFetch : corps de requête non pris en charge'));
    req.end();
  });
