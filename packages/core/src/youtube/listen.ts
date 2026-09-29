import { pickAudioOnlyFormat, listAudioOnlyFormats } from './audioFormat.js';
import {
  loadYoutubePlayer,
  readBestCaption,
  titleFromPlayer,
  youtubeRefusalReason,
} from './captions.js';
import { parseYoutubeVideoId } from './url.js';
import { condenseTranscript, type TextComplete } from './summarize.js';

export const CAPTION_FALLBACK_NOTICE =
  "Je n'ai pas pu écouter la vidéo : ce condensé vient des sous-titres, pas d'une écoute.";

const LISTEN_AND_CAPTIONS_FAILED =
  "Je n'ai pas pu écouter cette vidéo, et elle n'a pas de sous-titres : je ne peux pas encore la résumer.";

export function youtubeRefusedMessage(reason: string): string {
  return (
    `YouTube a refusé l'accès à cette vidéo depuis ce PC (« ${reason} »). ` +
    "Je n'ai donc pu ni l'écouter ni lire ses sous-titres, et je ne la résume pas. " +
    'Réessaie plus tard, ou avec une autre vidéo.'
  );
}

export interface YoutubeSummaryDeps {
  /** Lecteur YouTube (JSON player). Injectable pour les tests. */
  loadPlayer?: (videoId: string) => Promise<unknown | null>;
  /** Télécharge uniquement l'URL audio déjà choisie, vers un fichier temporaire. */
  downloadAudio: (url: string) => Promise<string>;
  deleteAudio: (path: string) => Promise<void>;
  /** Transcrit le fichier audio avec Whisper local, puis le fichier est effacé. */
  transcribeFile: (path: string, onProgress: (message: string) => void) => Promise<string>;
  /** Sous-titres publics, seulement si l'écoute échoue. */
  readCaptions?: (player: unknown) => Promise<{ text: string; languageCode: string } | null>;
  complete: TextComplete;
  onProgress?: (message: string) => void;
  signal?: AbortSignal;
}

/**
 * Écoute la piste audio, sinon les sous-titres (en le disant), puis un condensé
 * unique. Ne télécharge pas la vidéo.
 */
export async function summarizeYoutubeVideo(
  rawUrl: string,
  deps: YoutubeSummaryDeps,
): Promise<{ ok: boolean; content: string }> {
  const videoId = parseYoutubeVideoId(rawUrl);
  if (!videoId) {
    return {
      ok: false,
      content: "Ce lien n'est pas une adresse YouTube reconnue (watch, youtu.be, Shorts ou live).",
    };
  }

  const progress = (message: string): void => {
    deps.onProgress?.(message);
  };
  progress('Ouverture de la vidéo…');

  let player: unknown = null;
  try {
    player = deps.loadPlayer
      ? await deps.loadPlayer(videoId)
      : await loadYoutubePlayer(videoId);
  } catch (error) {
    return {
      ok: false,
      content: `Impossible d'ouvrir cette vidéo : ${error instanceof Error ? error.message : String(error)}`,
    };
  }
  if (deps.signal?.aborted) return { ok: false, content: 'Lecture interrompue.' };
  if (!player) return { ok: false, content: LISTEN_AND_CAPTIONS_FAILED };

  const title = titleFromPlayer(player);
  const listened = await tryListen(player, deps, progress);
  if (deps.signal?.aborted) return { ok: false, content: 'Lecture interrompue.' };

  let transcript = listened.transcript;
  let usedCaptions = false;
  if (!transcript) {
    progress("L'écoute a échoué, je lis les sous-titres…");
    const captions = deps.readCaptions
      ? await deps.readCaptions(player).catch(() => null)
      : await readBestCaption(player).catch(() => null);
    transcript = captions?.text?.trim() ?? '';
    usedCaptions = transcript.length > 0;
  }

  if (!transcript) {
    const refusal = youtubeRefusalReason(player);
    return {
      ok: false,
      content: refusal ? youtubeRefusedMessage(refusal) : LISTEN_AND_CAPTIONS_FAILED,
    };
  }

  try {
    const condensed = await condenseTranscript({
      transcript,
      complete: deps.complete,
      onProgress: progress,
    });
    const body = title ? `${title}\n\n${condensed}` : condensed;
    const content = usedCaptions ? `${CAPTION_FALLBACK_NOTICE}\n\n${body}` : body;
    return { ok: true, content };
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    return {
      ok: false,
      content:
        detail === 'modèle local indisponible'
          ? "Le modèle local n'a pas pu rédiger le condensé. Vérifie qu'Ollama tourne (qwen2.5:3b par défaut)."
          : `Le condensé n'a pas pu être rédigé : ${detail}`,
    };
  }
}

async function tryListen(
  player: unknown,
  deps: YoutubeSummaryDeps,
  progress: (message: string) => void,
): Promise<{ transcript: string }> {
  const format = pickAudioOnlyFormat(listAudioOnlyFormats(player));
  if (!format) return { transcript: '' };

  progress('Téléchargement de la piste audio…');
  let file: string | null = null;
  try {
    file = await deps.downloadAudio(format.url);
    const transcript = (await deps.transcribeFile(file, progress)).replace(/\s+/g, ' ').trim();
    return { transcript };
  } catch {
    return { transcript: '' };
  } finally {
    if (file) await deps.deleteAudio(file).catch(() => undefined);
  }
}
