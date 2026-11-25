/**
 * Les yeux, étape 2, point 4, côté PC : regarder une vidéo (`docs/specs/yeux-etape-2.md`, § 2).
 * La partie pure est dans `@jarvis/core` (`yeux/video.ts`).
 *
 * 1. Les modèles chargés sont déchargés (le 7B et le modèle de vision ne tiennent pas ensemble sur la
 *    carte de 6 Go). Chaque image clé est décrite par le modèle de vision, gardé chargé pendant la
 *    série, puis renvoyé (`keep_alive: 0`) à la dernière.
 * 2. Le son passe par Whisper (dans la fenêtre), par morceaux de 20 s.
 * 3. Le modèle du chat assemble ; s'il ne répond pas, la réponse est faite sans lui.
 * Rien n'est écrit sur le disque.
 */
import {
  consigneImageCle,
  consigneReponseVideo,
  demandeImageCle,
  demandeReponseVideo,
  finirReponseVideo,
  lireReponseVision,
  MODELE_VISION_PROVISOIRE,
  morceauxAudio,
  QUESTION_VIDEO_PAR_DEFAUT,
  reponseVideoSansModele,
  type InstantVu,
  type PassageEntendu,
  type Settings,
  type VideoYeux,
} from '@jarvis/core';
import { OllamaControl } from '../images/OllamaControl.js';
import { modeleDuChat, REPONSE_DELAI_MS, VISION_DELAI_MS } from './regarder.js';

/** Une image clé décrite au plus en ce temps (la première comprend le chargement du modèle). */
export const IMAGE_CLE_DELAI_MS = 60_000;

export interface EntreeRegarderVideo {
  video: VideoYeux;
  question: string;
  oral: boolean;
  avancement?: (message: string) => void;
  signal?: AbortSignal;
}

export interface SortieRegarderVideo {
  texte: string;
  instants: InstantVu[];
  paroles: PassageEntendu[] | null;
  son: 'transcrit' | 'muet' | 'echec';
  modeleVision: string;
  parLeChat: boolean;
}

export type RegarderVideo = (entree: EntreeRegarderVideo) => Promise<SortieRegarderVideo>;

export interface OptionsRegarderVideo {
  getSettings: () => Settings;
  fetchImpl?: typeof fetch;
  /** Whisper (dans la fenêtre). Absent : la vidéo est regardée sans le son, et c'est dit. */
  transcrire?: (pcm: Float32Array, signal?: AbortSignal) => Promise<string>;
}

function signalAvec(delaiMs: number, signal?: AbortSignal): AbortSignal {
  const delai = AbortSignal.timeout(delaiMs);
  return signal ? AbortSignal.any([signal, delai]) : delai;
}

export function creerRegarderVideo(options: OptionsRegarderVideo): RegarderVideo {
  const fetchImpl = options.fetchImpl ?? fetch;

  async function chat(baseUrl: string, body: Record<string, unknown>, delaiMs: number, signal?: AbortSignal): Promise<string> {
    const res = await fetchImpl(`${baseUrl}/api/chat`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ stream: false, ...body }),
      signal: signalAvec(delaiMs, signal),
    });
    if (!res.ok) throw new Error(`Ollama a répondu HTTP ${res.status} (${String(body.model)})`);
    const payload = (await res.json()) as { message?: { content?: string } };
    return payload.message?.content ?? '';
  }

  return async function regarderVideo(entree) {
    const settings = options.getSettings();
    const { model: modeleChat, baseUrl } = modeleDuChat(settings);
    const modeleVision = MODELE_VISION_PROVISOIRE;
    const question = entree.question.trim() || QUESTION_VIDEO_PAR_DEFAUT;
    const avance = entree.avancement ?? (() => undefined);
    const video = entree.video;

    // 1. Les images clés, une par une.
    const ollama = new OllamaControl(baseUrl, fetchImpl);
    for (const m of await ollama.loaded()) {
      if (m.name !== modeleVision) await ollama.unload(m.name);
    }
    const instants: InstantVu[] = [];
    try {
      for (let i = 0; i < video.images.length; i++) {
        if (entree.signal?.aborted) throw entree.signal.reason ?? new Error('annulé');
        const image = video.images[i]!;
        avance(`Je regarde la vidéo : image ${i + 1} sur ${video.images.length}…`);
        const derniere = i === video.images.length - 1;
        const brut = await chat(
          baseUrl,
          {
            model: modeleVision,
            format: 'json',
            keep_alive: derniere ? 0 : '5m',
            messages: [
              { role: 'system', content: consigneImageCle() },
              { role: 'user', content: demandeImageCle(image.t, question), images: [Buffer.from(image.octets).toString('base64')] },
            ],
            options: { temperature: 0, num_ctx: 2048, num_predict: 160 },
          },
          i === 0 ? VISION_DELAI_MS : IMAGE_CLE_DELAI_MS,
          entree.signal,
        );
        const lu = lireReponseVision(brut);
        instants.push({ t: image.t, description: lu.description, texteLu: lu.texteLu.slice(0, 6) });
      }
    } finally {
      // Une série arrêtée en route ne laisse pas le modèle de vision sur la carte.
      if (instants.length < video.images.length) await ollama.unload(modeleVision).catch(() => undefined);
    }

    // 2. Le son.
    let paroles: PassageEntendu[] | null = null;
    let son: SortieRegarderVideo['son'] = 'muet';
    if (video.audio && video.audio.length) {
      if (!options.transcrire) son = 'echec';
      else {
        try {
          const morceaux = morceauxAudio(video.audio);
          paroles = [];
          for (let i = 0; i < morceaux.length; i++) {
            if (entree.signal?.aborted) throw entree.signal.reason ?? new Error('annulé');
            avance(`J’écoute le son : morceau ${i + 1} sur ${morceaux.length}…`);
            const texte = (await options.transcrire(morceaux[i]!.pcm, entree.signal)).trim();
            if (texte) paroles.push({ t: morceaux[i]!.t, texte });
          }
          son = 'transcrit';
        } catch (error) {
          if (entree.signal?.aborted) throw error;
          paroles = null;
          son = 'echec';
        }
      }
    }

    // 3. La réponse.
    avance('J’écris la réponse…');
    let texte: string;
    let parLeChat = true;
    try {
      texte = (
        await chat(
          baseUrl,
          {
            model: modeleChat,
            messages: [
              { role: 'system', content: consigneReponseVideo(entree.oral) },
              { role: 'user', content: demandeReponseVideo({ question, video, instants, paroles }) },
            ],
            options: { temperature: 0.3, num_predict: entree.oral ? 200 : 700, num_ctx: 8192 },
          },
          REPONSE_DELAI_MS,
          entree.signal,
        )
      ).trim();
      if (!texte) throw new Error('réponse vide');
    } catch (error) {
      if (entree.signal?.aborted) throw error;
      parLeChat = false;
      texte = reponseVideoSansModele({ instants, paroles });
    }
    return {
      texte: finirReponseVideo({ texte, video, images: instants.length, son, modeleVision, oral: entree.oral }),
      instants,
      paroles,
      son,
      modeleVision,
      parLeChat,
    };
  };
}
