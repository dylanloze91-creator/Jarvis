/**
 * Les yeux, point 4, dans la fenêtre : lire une vidéo jointe sans dépendance nouvelle
 * (`docs/specs/yeux-etape-2.md`, § 2).
 *
 * - Une petite image par seconde (gris 32 × 18) sert à choisir les images clés (`choisirImagesCles`,
 *   cœur) ; chaque image retenue part en JPEG de 768 px au plus, 1 Mo au plus.
 * - Le son est décodé par la fenêtre, ramené en mono 16 kHz (Whisper), puis en PCM 16 bits.
 * - Trois minutes regardées au plus. Le fichier lui-même ne quitte jamais la fenêtre : seules les images
 *   clés et le son partent au processus principal, qui les garde en mémoire.
 */
import {
  choisirImagesCles,
  flottantsVersPcm16,
  IMAGE_CLE_TAILLE_MAX,
  VIDEO_AUDIO_TAUX,
  VIDEO_DUREE_MAX_S,
  VIDEO_TAILLE_MAX,
  type EchantillonVideo,
  type VideoJointe,
} from '@jarvis/core';

/** Fichiers acceptés comme vidéo (Chromium sait les lire). */
export const VIDEO_TYPES = ['video/mp4', 'video/webm', 'video/quicktime', 'video/x-matroska', 'video/ogg'];
export const estVideo = (file: { type: string; name: string }): boolean =>
  VIDEO_TYPES.includes(file.type) || /\.(mp4|m4v|mov|webm|mkv|ogv)$/i.test(file.name);

const GRIS_L = 32;
const GRIS_H = 18;
const JPEG_COTE_MAX = 768;

export interface VideoLue {
  video: VideoJointe;
  /** Première image clé, en base64 (aperçu de la pièce jointe). */
  apercuBase64: string;
}

/** Instants échantillonnés : une image par seconde, la dernière juste avant la fin regardée. */
export function instantsEchantillons(duree: number): number[] {
  const regarde = Math.min(duree, VIDEO_DUREE_MAX_S);
  const out: number[] = [];
  for (let t = 0; t < regarde - 0.05; t += 1) out.push(t);
  if (!out.length) out.push(0);
  return out;
}

/** Octets → base64, par morceaux (un `btoa` d'une chaîne de plusieurs Mo d'un coup échoue). */
export function versBase64(octets: Uint8Array): string {
  let binaire = '';
  const pas = 0x8000;
  for (let i = 0; i < octets.length; i += pas) binaire += String.fromCharCode(...octets.subarray(i, i + pas));
  return btoa(binaire);
}

function attendre(cible: HTMLMediaElement, evenement: string, delaiMs: number): Promise<void> {
  return new Promise((ok, ko) => {
    const fin = (erreur?: Error): void => {
      window.clearTimeout(minuterie);
      cible.removeEventListener(evenement, surOk);
      cible.removeEventListener('error', surErreur);
      if (erreur) ko(erreur);
      else ok();
    };
    const surOk = (): void => fin();
    const surErreur = (): void => fin(new Error('la fenêtre ne sait pas lire cette vidéo'));
    const minuterie = window.setTimeout(() => fin(new Error('la vidéo ne répond pas')), delaiMs);
    cible.addEventListener(evenement, surOk, { once: true });
    cible.addEventListener('error', surErreur, { once: true });
  });
}

async function jpegDe(canvas: HTMLCanvasElement): Promise<Uint8Array> {
  for (const qualite of [0.75, 0.6, 0.45]) {
    const blob = await new Promise<Blob | null>((ok) => canvas.toBlob(ok, 'image/jpeg', qualite));
    if (blob && blob.size <= IMAGE_CLE_TAILLE_MAX) return new Uint8Array(await blob.arrayBuffer());
  }
  throw new Error('image trop lourde');
}

/** Son de la vidéo en mono 16 kHz, ou `null` (pas de piste son, ou son illisible). */
async function sonDe(fichier: Blob, regarde: number): Promise<Float32Array | null> {
  let contexte: AudioContext | null = null;
  try {
    contexte = new AudioContext();
    const decode = await contexte.decodeAudioData(await fichier.arrayBuffer());
    const longueur = Math.max(1, Math.ceil(Math.min(decode.duration, regarde) * VIDEO_AUDIO_TAUX));
    const horsLigne = new OfflineAudioContext(1, longueur, VIDEO_AUDIO_TAUX);
    const source = horsLigne.createBufferSource();
    source.buffer = decode;
    source.connect(horsLigne.destination); // plusieurs canaux → mono par le mixage du contexte
    source.start(0);
    const rendu = await horsLigne.startRendering();
    const pcm = rendu.getChannelData(0);
    // Une piste son vide (tout à zéro) compte comme pas de son.
    let fort = 0;
    for (let i = 0; i < pcm.length; i += 160) fort = Math.max(fort, Math.abs(pcm[i] ?? 0));
    return fort > 1e-4 ? pcm : null;
  } catch {
    return null;
  } finally {
    void contexte?.close().catch(() => undefined);
  }
}

/**
 * Lit une vidéo jointe : images clés et son. `avance` reçoit une phrase courte (« image 12 sur 60 »).
 * Lève une erreur lisible si la vidéo est trop lourde ou illisible.
 */
export async function lireVideoPourLesYeux(fichier: File, avance: (message: string) => void = () => undefined): Promise<VideoLue> {
  if (fichier.size > VIDEO_TAILLE_MAX) throw new Error(`« ${fichier.name} » dépasse ${Math.round(VIDEO_TAILLE_MAX / 1024 / 1024)} Mo`);
  const url = URL.createObjectURL(fichier);
  const lecteur = document.createElement('video');
  lecteur.muted = true;
  lecteur.preload = 'auto';
  lecteur.playsInline = true;
  try {
    lecteur.src = url;
    await attendre(lecteur, 'loadeddata', 20_000);
    let duree = lecteur.duration;
    if (!Number.isFinite(duree) || duree <= 0) {
      // Certains WebM n'annoncent pas leur durée : on la trouve en allant tout au bout.
      lecteur.currentTime = 1e7;
      await attendre(lecteur, 'seeked', 20_000).catch(() => undefined);
      duree = Number.isFinite(lecteur.duration) && lecteur.duration > 0 ? lecteur.duration : lecteur.currentTime;
    }
    if (!Number.isFinite(duree) || duree <= 0) throw new Error('durée de la vidéo inconnue');
    const l0 = lecteur.videoWidth || 640;
    const h0 = lecteur.videoHeight || 360;
    const echelle = Math.min(1, JPEG_COTE_MAX / Math.max(l0, h0));
    const grand = document.createElement('canvas');
    grand.width = Math.max(1, Math.round(l0 * echelle));
    grand.height = Math.max(1, Math.round(h0 * echelle));
    const petit = document.createElement('canvas');
    petit.width = GRIS_L;
    petit.height = GRIS_H;
    const cg = grand.getContext('2d');
    const cp = petit.getContext('2d', { willReadFrequently: true });
    if (!cg || !cp) throw new Error('dessin impossible');

    const instants = instantsEchantillons(duree);
    const echantillons: EchantillonVideo[] = [];
    const jpegs: Uint8Array[] = [];
    for (let i = 0; i < instants.length; i++) {
      avance(`Je lis la vidéo : image ${i + 1} sur ${instants.length}…`);
      lecteur.currentTime = instants[i]!;
      await attendre(lecteur, 'seeked', 10_000);
      cp.drawImage(lecteur, 0, 0, GRIS_L, GRIS_H);
      const rgba = cp.getImageData(0, 0, GRIS_L, GRIS_H).data;
      const gris = new Uint8Array(GRIS_L * GRIS_H);
      for (let p = 0; p < gris.length; p++) gris[p] = Math.round(0.299 * rgba[p * 4]! + 0.587 * rgba[p * 4 + 1]! + 0.114 * rgba[p * 4 + 2]!);
      echantillons.push({ t: instants[i]!, gris });
      cg.drawImage(lecteur, 0, 0, grand.width, grand.height);
      jpegs.push(await jpegDe(grand));
    }
    const choisis = choisirImagesCles(echantillons);
    avance('J’écoute le son de la vidéo…');
    const son = await sonDe(fichier, Math.min(duree, VIDEO_DUREE_MAX_S));
    const images = choisis.map((i) => ({ t: echantillons[i]!.t, jpegBase64: versBase64(jpegs[i]!) }));
    return {
      video: {
        nom: fichier.name.slice(0, 120),
        duree,
        tronquee: duree > VIDEO_DUREE_MAX_S,
        images,
        ...(son ? { audioPcm16Base64: versBase64(flottantsVersPcm16(son)) } : {}),
      },
      apercuBase64: images[0]!.jpegBase64,
    };
  } finally {
    lecteur.removeAttribute('src');
    lecteur.load();
    URL.revokeObjectURL(url);
  }
}
