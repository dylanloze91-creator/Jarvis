/**
 * Les yeux de Jarvis côté PC (Jarvis Test) : photos de la caméra de l'imprimante gardées EN MÉMOIRE
 * (jamais sur le disque, jamais dans l'historique : la discussion ne garde que leur référence),
 * et le tour « montre-moi l'impression ». Lecture seule sur l'imprimante (`YeuxImprimante`).
 */
import { randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import {
  checkRoverBaseUrl,
  etatCarte,
  type EtatCarte,
  type TravailEnFile,
  repondreYeux,
  YeuxImprimante,
  type LieuYeux,
  type PhotoDiscussion,
  type PhotoYeux,
  type Settings,
} from '@jarvis/core';

/** Au plus 20 photos en mémoire, 30 minutes chacune. */
export const PHOTOS_MAX = 20;
export const PHOTO_DUREE_MS = 30 * 60_000;

export class PhotosEnMemoire {
  private readonly photos = new Map<string, PhotoYeux>();

  constructor(
    private readonly maintenant: () => number = Date.now,
    private readonly max = PHOTOS_MAX,
    private readonly dureeMs = PHOTO_DUREE_MS,
  ) {}

  garder(photo: PhotoYeux): PhotoDiscussion {
    this.nettoyer();
    const photoId = randomUUID();
    this.photos.set(photoId, photo);
    while (this.photos.size > this.max) this.photos.delete(this.photos.keys().next().value!);
    return { photoId, prisA: photo.prisA, camera: photo.camera };
  }

  lire(photoId: string): PhotoYeux | null {
    this.nettoyer();
    return this.photos.get(photoId) ?? null;
  }

  private nettoyer(): void {
    const limite = this.maintenant() - this.dureeMs;
    for (const [id, photo] of this.photos) if (photo.prisA < limite) this.photos.delete(id);
  }
}

/** Yeux actifs : Jarvis Test, réglage `yeux.enabled`, adresse de l'imprimante sur le réseau local. */
export function yeuxActifs(settings: Settings, editionYeux: boolean): boolean {
  const adresse = settings.printer?.baseUrl ?? '';
  return editionYeux && settings.yeux?.enabled === true && Boolean(adresse) && checkRoverBaseUrl(adresse).ok;
}

/** Ce que l'écran « Yeux » reçoit à chaque rafraîchissement (une carte : l'imprimante). */
export interface VueOeil {
  id: 'imprimante';
  nom: string;
  photo: (PhotoDiscussion & { type: string; data: Uint8Array }) | null;
  /** Raison en mots simples quand il n'y a pas de photo. */
  raisonPhoto: string | null;
  etat: EtatCarte | null;
  raisonEtat: string | null;
  file: string[];
}

export type ResultatVue = { ok: true; oeil: VueOeil } | { ok: false; error: string };

export interface YeuxPC {
  photos: PhotosEnMemoire;
  /** Écran « Yeux » visible : la carte d'un œil existe (réglage actif). */
  disponible(): boolean;
  /** Une image + l'état + la file, en lecture seule. Appelé par l'écran seulement quand il est visible. */
  vue(): Promise<ResultatVue>;
  /** « Garder cette photo » : la seule écriture sur le disque, dans `userData/yeux/photos/`. */
  garder(photoId: string): Promise<{ ok: true; chemin: string } | { ok: false; error: string }>;
  /** Crochet de la session : `null` si la phrase n'est pas pour les yeux ou s'ils sont coupés. */
  tour(input: { text: string; place: LieuYeux }): Promise<{ texte: string; photo: PhotoDiscussion | null } | null>;
}

function nomDeFichier(prisA: number, type: string): string {
  const d = new Date(prisA);
  const deux = (n: number) => String(n).padStart(2, '0');
  const ext = type === 'image/png' ? 'png' : 'jpg';
  return `imprimante-${d.getFullYear()}-${deux(d.getMonth() + 1)}-${deux(d.getDate())}_${deux(d.getHours())}-${deux(d.getMinutes())}-${deux(d.getSeconds())}.${ext}`;
}

export function creerYeuxPC(
  getSettings: () => Settings,
  editionYeux: boolean,
  fetchImpl: typeof fetch = fetch,
  dossierPhotos: () => string = () => '',
): YeuxPC {
  const photos = new PhotosEnMemoire();
  // Les images de l'écran « Yeux » (une toutes les 2 s) ne chassent pas celles de la discussion.
  const ecran = new PhotosEnMemoire(Date.now, 3);
  const ouvrir = (settings: Settings) =>
    new YeuxImprimante(settings.printer?.baseUrl ?? '', settings.printer?.apiKey ?? '', fetchImpl);
  return {
    photos,
    disponible: () => yeuxActifs(getSettings(), editionYeux),
    async vue() {
      const settings = getSettings();
      if (!yeuxActifs(settings, editionYeux)) return { ok: false, error: 'Les yeux sont coupés.' };
      let yeux: YeuxImprimante;
      try {
        yeux = ouvrir(settings);
      } catch (error) {
        return { ok: false, error: error instanceof Error ? error.message : "L'imprimante n'est pas réglée." };
      }
      const [photo, etat, file] = await Promise.all([
        yeux.prendrePhoto(settings.yeux?.camera),
        yeux.etat().then(
          (e) => ({ ok: true as const, e }),
          (error: unknown) => ({ ok: false as const, raison: error instanceof Error ? error.message : "L'imprimante ne répond pas." }),
        ),
        yeux.file().catch(() => [] as TravailEnFile[]),
      ]);
      const gardee = photo.ok ? ecran.garder(photo.photo) : null;
      return {
        ok: true,
        oeil: {
          id: 'imprimante',
          nom: 'Imprimante',
          photo: photo.ok && gardee ? { ...gardee, type: photo.photo.type, data: photo.photo.octets } : null,
          raisonPhoto: photo.ok ? null : photo.raison,
          etat: etat.ok ? etatCarte(etat.e) : null,
          raisonEtat: etat.ok ? null : etat.raison,
          file: file.map((travail) => travail.fichier),
        },
      };
    },
    async garder(photoId) {
      const photo = photos.lire(photoId) ?? ecran.lire(photoId);
      if (!photo) return { ok: false, error: 'Photo plus disponible (elle n’est gardée que 30 minutes, en mémoire).' };
      const dossier = dossierPhotos();
      if (!dossier) return { ok: false, error: 'Dossier des photos inconnu.' };
      await mkdir(dossier, { recursive: true });
      const chemin = join(dossier, nomDeFichier(photo.prisA, photo.type));
      await writeFile(chemin, photo.octets);
      return { ok: true, chemin };
    },
    async tour(input) {
      const settings = getSettings();
      if (!yeuxActifs(settings, editionYeux)) return null;
      const reponse = await repondreYeux(
        { texte: input.text, lieu: input.place, ...(settings.yeux?.camera ? { camera: settings.yeux.camera } : {}) },
        () => new YeuxImprimante(settings.printer?.baseUrl ?? '', settings.printer?.apiKey ?? '', fetchImpl),
      );
      if (!reponse) return null;
      return { texte: reponse.texte, photo: reponse.photo ? photos.garder(reponse.photo) : null };
    },
  };
}
