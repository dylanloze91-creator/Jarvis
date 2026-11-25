/**
 * La webcam du PC, un œil de genre `pc` (cahier des yeux, § 3.2).
 *
 * Choix : une **fenêtre cachée dédiée**, avec sa propre session (`partition: yeux-webcam`), seule
 * autorisée à la caméra (vidéo seulement, jamais le micro). La fenêtre principale de Jarvis garde
 * sa règle : caméra refusée (`mediaPermissions.ts`, session par défaut, non touchée).
 * - ouverte à la demande seulement (une photo, ou l'écran « Yeux » ouvert sur cet œil) ;
 * - fermée 5 s après la dernière photo : le flux s'arrête, le voyant de la webcam s'éteint ;
 * - chaque photo bornée (5 s pour l'ouverture + 5 s pour l'image) ; JPEG vérifié, 5 Mo au plus ;
 * - aucun texte venu d'ailleurs n'entre dans le script, sauf l'identifiant de l'appareil passé par
 *   `JSON.stringify` (jamais collé tel quel).
 * Pas de programme séparé ni de dépendance native.
 */
import { typeDesOctets, YEUX_IMAGE_MAX, type ResultatPhoto } from '@jarvis/core';

export const WEBCAM_PARTITION = 'yeux-webcam';
export const WEBCAM_DELAI_MS = 5_000;
export const WEBCAM_REPOS_MS = 5_000;

/** Ce que le service attend d'une fenêtre de capture (Electron en vrai, un faux en essai). */
export interface FenetreCapture {
  executer(script: string): Promise<unknown>;
  fermer(): void;
}

export interface WebcamApi {
  photo(deviceId: string | undefined, nom: string): Promise<ResultatPhoto>;
  /** Vrai pendant qu'un flux est ouvert (témoin « la webcam regarde »). */
  regarde(): boolean;
  /** Appareils vidéo du PC (identifiant, nom). Ouvre la fenêtre sans démarrer de flux. */
  appareils(): Promise<{ id: string; nom: string }[]>;
  fermer(): void;
}

/** Script d'ouverture du flux, dans la fenêtre cachée. */
export function scriptOuverture(deviceId: string | undefined): string {
  const contraintes = JSON.stringify({
    audio: false,
    video: {
      ...(deviceId ? { deviceId: { exact: deviceId } } : {}),
      width: { ideal: 1280 },
      height: { ideal: 720 },
    },
  });
  return `(async () => {
  if (window.__yeux && window.__yeux.cle === ${JSON.stringify(deviceId ?? '')}) return 'deja';
  if (window.__yeux) window.__yeux.flux.getTracks().forEach((t) => t.stop());
  const flux = await navigator.mediaDevices.getUserMedia(${contraintes});
  const video = document.createElement('video');
  video.muted = true;
  video.playsInline = true;
  video.srcObject = flux;
  await video.play();
  await new Promise((r) => setTimeout(r, 700));
  window.__yeux = { cle: ${JSON.stringify(deviceId ?? '')}, flux, video };
  return 'ouvert';
})()`;
}

/** Une image du flux ouvert, en JPEG (base64 sans en-tête). */
export const SCRIPT_IMAGE = `(async () => {
  const y = window.__yeux;
  if (!y) throw new Error('flux fermé');
  const c = document.createElement('canvas');
  c.width = y.video.videoWidth || 1280;
  c.height = y.video.videoHeight || 720;
  c.getContext('2d').drawImage(y.video, 0, 0, c.width, c.height);
  const url = c.toDataURL('image/jpeg', 0.85);
  return url.slice(url.indexOf(',') + 1);
})()`;

export const SCRIPT_APPAREILS = `(async () => (await navigator.mediaDevices.enumerateDevices())
  .filter((d) => d.kind === 'videoinput')
  .map((d, i) => ({ id: d.deviceId, nom: d.label || ('Caméra ' + (i + 1)) })))()`;

function borne<T>(promesse: Promise<T>, ms: number, message: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const minuteur = setTimeout(() => reject(new Error(message)), ms);
    promesse.then(
      (valeur) => {
        clearTimeout(minuteur);
        resolve(valeur);
      },
      (erreur: unknown) => {
        clearTimeout(minuteur);
        reject(erreur instanceof Error ? erreur : new Error(String(erreur)));
      },
    );
  });
}

function raison(erreur: unknown): string {
  const texte = erreur instanceof Error ? `${erreur.name} ${erreur.message}` : String(erreur);
  if (/NotAllowed|Permission/i.test(texte)) return 'Windows refuse la webcam à Jarvis (Confidentialité → Caméra).';
  if (/NotFound|Overconstrained|DevicesNotFound/i.test(texte)) return 'Webcam introuvable : elle est débranchée, ou une autre a été choisie.';
  if (/NotReadable|TrackStart|in use/i.test(texte)) return 'La webcam est déjà prise par une autre application.';
  if (/délai|timeout/i.test(texte)) return 'La webcam ne répond pas (plus de 5 secondes).';
  const nom = erreur instanceof Error ? erreur.name : '';
  return nom && nom !== 'Error' ? `La webcam ne répond pas (${nom}).` : 'La webcam ne répond pas.';
}

export function creerWebcam(
  ouvrirFenetre: () => FenetreCapture,
  options: { delaiMs?: number; reposMs?: number; maintenant?: () => number } = {},
): WebcamApi {
  const delai = options.delaiMs ?? WEBCAM_DELAI_MS;
  const repos = options.reposMs ?? WEBCAM_REPOS_MS;
  const maintenant = options.maintenant ?? Date.now;
  let fenetre: FenetreCapture | null = null;
  let fluxOuvert = false;
  let minuteurRepos: ReturnType<typeof setTimeout> | null = null;
  let file: Promise<unknown> = Promise.resolve();

  const fermer = () => {
    if (minuteurRepos) clearTimeout(minuteurRepos);
    minuteurRepos = null;
    fluxOuvert = false;
    const f = fenetre;
    fenetre = null;
    f?.fermer();
  };
  const reposer = () => {
    if (minuteurRepos) clearTimeout(minuteurRepos);
    minuteurRepos = setTimeout(fermer, repos);
  };
  // Une seule capture à la fois (deux demandes ne se marchent pas dessus).
  const enFile = <T>(travail: () => Promise<T>): Promise<T> => {
    const suite = file.then(travail, travail);
    file = suite.catch(() => undefined);
    return suite;
  };

  return {
    regarde: () => fluxOuvert,
    fermer,
    appareils: () =>
      enFile(async () => {
        try {
          fenetre ??= ouvrirFenetre();
          const liste = await borne(fenetre.executer(SCRIPT_APPAREILS), delai, 'délai');
          reposer();
          return Array.isArray(liste)
            ? liste
                .filter((a): a is { id: string; nom: string } => typeof a?.id === 'string' && typeof a?.nom === 'string')
                .map((a) => ({ id: a.id.slice(0, 200), nom: a.nom.slice(0, 80) }))
            : [];
        } catch {
          fermer();
          return [];
        }
      }),
    photo: (deviceId, nom) =>
      enFile(async (): Promise<ResultatPhoto> => {
        try {
          fenetre ??= ouvrirFenetre();
          await borne(fenetre.executer(scriptOuverture(deviceId)), delai, 'délai');
          fluxOuvert = true;
          const base64 = await borne(fenetre.executer(SCRIPT_IMAGE), delai, 'délai');
          reposer();
          if (typeof base64 !== 'string' || base64.length > Math.ceil((YEUX_IMAGE_MAX * 4) / 3) + 4) {
            return { ok: false, raison: "L'image de la webcam est trop grande ou illisible." };
          }
          const octets = new Uint8Array(Buffer.from(base64, 'base64'));
          if (octets.byteLength > YEUX_IMAGE_MAX) return { ok: false, raison: "L'image de la webcam est trop grande (plus de 5 Mo)." };
          if (typeDesOctets(octets) !== 'image/jpeg') return { ok: false, raison: "La webcam n'a pas donné une image." };
          return { ok: true, photo: { octets, type: 'image/jpeg', prisA: maintenant(), taille: octets.byteLength, camera: nom } };
        } catch (erreur) {
          fermer();
          return { ok: false, raison: raison(erreur) };
        }
      }),
  };
}
