/**
 * Les yeux de Jarvis côté PC (Jarvis Test). Cahier `docs/specs/yeux-etape-1.md`.
 *
 * - Registre des yeux : l'imprimante (si son adresse est réglée), les yeux prévus (rover, hub :
 *   « pas encore branché » tant que leur adresse n'est pas réglée), et ceux ajoutés (`yeux.json`).
 * - Photos gardées EN MÉMOIRE (jamais sur le disque sauf « Garder cette photo », jamais dans
 *   l'historique : la discussion ne garde que leur référence).
 * - Le tour « montre-moi l'impression / le bureau / le rover avant ». Lecture seule partout :
 *   vers l'imprimante comme vers une caméra réseau, seules des requêtes GET peuvent partir.
 */
import { randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import {
  checkRoverBaseUrl,
  etatCarte,
  intentionYeux,
  OEIL_IPHONE,
  OEIL_WEBCAM,
  OeilReseau,
  prendrePhotoOeil,
  repondreYeux,
  verifierOeil,
  YEUX_PREVUS,
  YeuxImprimante,
  type EtatCarte,
  type LieuYeux,
  type Oeil,
  type PhotoDiscussion,
  type PhotoYeux,
  type PriseDeps,
  type ResultatPhoto,
  type Settings,
  type TravailEnFile,
} from '@jarvis/core';
import type { Regarder } from './regarder.js';
import type { YeuxStore } from './store.js';
import type { WebcamApi } from './webcam.js';

/** Au plus 20 photos en mémoire, 30 minutes chacune. */
export const PHOTOS_MAX = 20;
export const PHOTO_DUREE_MS = 30 * 60_000;
/** Une photo de l'iPhone sert à la question qui suit, si elle arrive dans les 5 minutes. */
export const PHOTO_QUESTION_MS = 5 * 60_000;

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

/** Yeux actifs : Jarvis Test et réglage `yeux.enabled`. */
export function yeuxActifs(settings: Settings, editionYeux: boolean): boolean {
  return editionYeux && settings.yeux?.enabled === true;
}

/** L'œil de l'imprimante existe quand l'adresse de Moonraker est sur le réseau local. */
function imprimanteReglee(settings: Settings): boolean {
  const adresse = settings.printer?.baseUrl ?? '';
  return Boolean(adresse) && checkRoverBaseUrl(adresse).ok;
}

/** Chiffrement du système (`safeStorage`), injecté. */
export interface Chiffre {
  available(): boolean;
  seal(plain: string): string;
  open(sealed: string): string;
}

/** Ce que l'écran « Yeux » reçoit pour une carte. */
export interface VueOeil {
  oeil: Oeil;
  /** Rover et hub : « pas encore branché » tant que leur adresse n'est pas réglée. */
  branche: boolean;
  photo: (PhotoDiscussion & { type: string; data: Uint8Array }) | null;
  raisonPhoto: string | null;
  /** Imprimante seulement. */
  etat: EtatCarte | null;
  raisonEtat: string | null;
  file: string[];
}

export type ResultatVue = { ok: true; vue: VueOeil } | { ok: false; error: string };
export type Resultat = { ok: true } | { ok: false; error: string };

export interface YeuxPC {
  photos: PhotosEnMemoire;
  /** Écran « Yeux » visible : au moins un œil existe (réglage actif). */
  disponible(): boolean;
  /** Tous les yeux, sans jeton. */
  yeux(): Promise<Oeil[]>;
  /** Une image (si l'œil est allumé) + l'état et la file pour l'imprimante. Lecture seule. */
  vue(id: string): Promise<ResultatVue>;
  /** Interrupteur de l'écran « Yeux » : coupé = aucune prise, plus jamais d'image montrée. */
  allumer(id: string, allume: boolean): Promise<Resultat>;
  /** Pièce (webcam : bureau ou salon) et appareil choisi. Une chambre est refusée. */
  regler(id: string, reglage: { piece?: string; camera?: string }): Promise<Resultat>;
  /** Webcams du PC (identifiant, nom), pour choisir l'appareil. */
  webcams(): Promise<{ id: string; nom: string }[]>;
  /** Photo envoyée depuis l'appli du téléphone (« Montrer à Jarvis »), gardée en mémoire. */
  recevoirPhotoTelephone(photo: { octets: Uint8Array; type: 'image/jpeg' | 'image/png'; appareil: string }): Promise<Resultat>;
  /** Brancher une caméra réseau (rover, hub…) : son « hello » doit répondre avant d'être gardée. */
  brancher(id: string, adresse: string, jeton: string): Promise<Resultat>;
  /** « Garder cette photo » : la seule écriture sur le disque, dans `userData/yeux/photos/`. */
  garder(photoId: string): Promise<{ ok: true; chemin: string } | { ok: false; error: string }>;
  /** Crochet de la session : `null` si la phrase n'est pas pour les yeux ou s'ils sont coupés. */
  tour(input: { text: string; place: LieuYeux }): Promise<{ texte: string; photo: PhotoDiscussion | null } | null>;
  /**
   * Étape 2 : une photo jointe dans la fenêtre, gardée en mémoire seulement (jamais écrite sur le
   * disque). `null` : yeux coupés, ou regard absent.
   */
  garderPhotoJointe(photo: { octets: Uint8Array; type: 'image/jpeg' | 'image/png' }): PhotoDiscussion | null;
  /**
   * Étape 2 : regarder une photo et répondre à la question. La photo jointe (`photoId`), sinon, sur le
   * téléphone, la dernière photo de l'iPhone pas encore regardée (5 minutes au plus). `null` : pas de
   * photo pour cette question, ou yeux coupés.
   */
  regarder(input: {
    text: string;
    place: LieuYeux;
    photoId: string | null;
    avancement?: (message: string) => void;
    signal?: AbortSignal;
  }): Promise<{ texte: string; photo: PhotoDiscussion } | null>;
}

function nomDeFichier(oeil: string, prisA: number, type: string): string {
  const d = new Date(prisA);
  const deux = (n: number) => String(n).padStart(2, '0');
  const ext = type === 'image/png' ? 'png' : 'jpg';
  const nom = oeil.toLowerCase().normalize('NFD').replace(/\p{M}/gu, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'oeil';
  return `${nom}-${d.getFullYear()}-${deux(d.getMonth() + 1)}-${deux(d.getDate())}_${deux(d.getHours())}-${deux(d.getMinutes())}-${deux(d.getSeconds())}.${ext}`;
}

export interface YeuxPCOptions {
  getSettings: () => Settings;
  editionYeux: boolean;
  store: YeuxStore;
  chiffre?: Chiffre;
  fetchImpl?: typeof fetch;
  dossierPhotos?: () => string;
  /** Webcam du PC (fenêtre cachée dédiée). Absente : pas d'œil « Webcam du PC ». */
  webcam?: WebcamApi;
  /** Téléphone relié possible : l'œil « iPhone » existe (photos envoyées depuis l'appli). */
  telephone?: boolean;
  /** Étape 2 : regarder une photo et répondre (modèle de vision, recherche web, modèle du chat). */
  regarder?: Regarder;
  maintenant?: () => number;
}

export function creerYeuxPC(options: YeuxPCOptions): YeuxPC {
  const { getSettings, editionYeux, store } = options;
  const fetchImpl = options.fetchImpl ?? fetch;
  const photos = new PhotosEnMemoire();
  // Les images de l'écran « Yeux » (une toutes les 2 s par œil) ne chassent pas celles de la discussion.
  const ecran = new PhotosEnMemoire(Date.now, 6);
  // Sans chiffrement du système, le jeton reste en mémoire seulement (à redonner après un redémarrage).
  const jetonsEnMemoire = new Map<string, string>();
  const maintenant = options.maintenant ?? Date.now;
  // Dernière photo de l'iPhone : en mémoire seulement, 30 minutes au plus.
  let photoTelephone: PhotoYeux | null = null;
  // Elle sert une fois à la question qui suit (« Montrer à Jarvis » puis la question).
  let photoTelephoneRegardee = false;
  const telephoneRecente = (): PhotoYeux | null =>
    photoTelephone && maintenant() - photoTelephone.prisA <= PHOTO_DUREE_MS ? photoTelephone : null;

  const klipper = () => {
    const settings = getSettings();
    return new YeuxImprimante(settings.printer?.baseUrl ?? '', settings.printer?.apiKey ?? '', fetchImpl);
  };

  async function enregistres() {
    await store.load();
    return store.liste();
  }

  async function tousLesYeux(): Promise<Oeil[]> {
    const settings = getSettings();
    const parId = new Map<string, Oeil>();
    if (imprimanteReglee(settings)) {
      parId.set('imprimante', {
        id: 'imprimante',
        nom: 'Imprimante',
        piece: 'atelier',
        genre: 'klipper',
        allume: true,
        ...(settings.yeux?.camera ? { camera: settings.yeux.camera } : {}),
      });
    }
    if (options.webcam) parId.set(OEIL_WEBCAM.id, { ...OEIL_WEBCAM });
    if (options.telephone) parId.set(OEIL_IPHONE.id, { ...OEIL_IPHONE });
    for (const prevu of YEUX_PREVUS) parId.set(prevu.id, { ...prevu });
    for (const { jetonScelle: _jeton, ...oeil } of await enregistres()) {
      if (oeil.id === 'imprimante' && !parId.has('imprimante')) continue;
      parId.set(oeil.id, oeil);
    }
    return [...parId.values()];
  }

  async function jeton(id: string): Promise<string> {
    const enMemoire = jetonsEnMemoire.get(id);
    if (enMemoire) return enMemoire;
    const scelle = (await enregistres()).find((o) => o.id === id)?.jetonScelle;
    if (!scelle || !options.chiffre?.available()) return '';
    try {
      return options.chiffre.open(scelle);
    } catch {
      return '';
    }
  }

  async function deps(): Promise<PriseDeps> {
    const jetons = new Map<string, string>();
    for (const oeil of await tousLesYeux()) if (oeil.genre === 'reseau' && oeil.adresse) jetons.set(oeil.id, await jeton(oeil.id));
    return {
      ...(imprimanteReglee(getSettings()) ? { klipper } : {}),
      ...(options.webcam ? { pc: (oeil: Oeil) => options.webcam!.photo(oeil.camera, oeil.nom) } : {}),
      telephone: () => telephoneRecente(),
      reseau: (oeil) => new OeilReseau(oeil.adresse ?? '', jetons.get(oeil.id) ?? '', fetchImpl),
    };
  }

  async function trouver(id: string): Promise<Oeil | null> {
    return (await tousLesYeux()).find((o) => o.id === id) ?? null;
  }

  return {
    photos,
    disponible: () => yeuxActifs(getSettings(), editionYeux),
    async yeux() {
      if (!yeuxActifs(getSettings(), editionYeux)) return [];
      return tousLesYeux();
    },
    async vue(id) {
      if (!yeuxActifs(getSettings(), editionYeux)) return { ok: false, error: 'Les yeux sont coupés.' };
      const oeil = await trouver(id);
      if (!oeil) return { ok: false, error: 'Œil inconnu.' };
      const branche = oeil.genre !== 'reseau' || Boolean(oeil.adresse);
      const d = await deps();
      const imprimante = oeil.genre === 'klipper' && d.klipper;
      const [photo, etat, file]: [ResultatPhoto | null, { ok: true; e: Awaited<ReturnType<YeuxImprimante['etat']>> } | { ok: false; raison: string } | null, TravailEnFile[]] =
        await Promise.all([
          branche ? prendrePhotoOeil(oeil, d) : Promise.resolve(null),
          imprimante
            ? klipper()
                .etat()
                .then(
                  (e) => ({ ok: true as const, e }),
                  (error: unknown) => ({ ok: false as const, raison: error instanceof Error ? error.message : "L'imprimante ne répond pas." }),
                )
            : Promise.resolve(null),
          imprimante ? klipper().file().catch(() => [] as TravailEnFile[]) : Promise.resolve([] as TravailEnFile[]),
        ]);
      const gardee = photo?.ok ? ecran.garder(photo.photo) : null;
      return {
        ok: true,
        vue: {
          oeil,
          branche,
          photo: photo?.ok && gardee ? { ...gardee, type: photo.photo.type, data: photo.photo.octets } : null,
          raisonPhoto: !branche ? `« ${oeil.nom} » n'est pas encore branché.` : photo && !photo.ok ? photo.raison : null,
          etat: etat?.ok ? etatCarte(etat.e) : null,
          raisonEtat: etat && !etat.ok ? etat.raison : null,
          file: file.map((travail) => travail.fichier),
        },
      };
    },
    async allumer(id, allume) {
      const oeil = await trouver(id);
      if (!oeil) return { ok: false, error: 'Œil inconnu.' };
      const deja = (await enregistres()).find((o) => o.id === id);
      const r = await store.mettre({ ...(deja ?? oeil), allume });
      // Webcam coupée : le flux s'arrête tout de suite, le voyant s'éteint.
      if (!allume && oeil.genre === 'pc') options.webcam?.fermer();
      return r.ok ? { ok: true } : { ok: false, error: r.raison };
    },
    async regler(id, reglage) {
      const oeil = await trouver(id);
      if (!oeil) return { ok: false, error: 'Œil inconnu.' };
      const deja = (await enregistres()).find((o) => o.id === id);
      const { camera: _camera, ...base } = deja ?? oeil;
      const camera = reglage.camera !== undefined ? reglage.camera : oeil.camera;
      const r = await store.mettre({
        ...base,
        ...(reglage.piece !== undefined ? { piece: reglage.piece } : {}),
        ...(camera ? { camera } : {}),
      });
      return r.ok ? { ok: true } : { ok: false, error: r.raison };
    },
    async recevoirPhotoTelephone(photo) {
      if (!yeuxActifs(getSettings(), editionYeux) || !options.telephone) return { ok: false, error: 'Les yeux sont coupés sur le PC.' };
      const oeil = await trouver(OEIL_IPHONE.id);
      if (!oeil?.allume) return { ok: false, error: 'La caméra « iPhone » est coupée dans l’écran « Yeux » du PC.' };
      photoTelephone = { octets: photo.octets, type: photo.type, prisA: maintenant(), taille: photo.octets.byteLength, camera: oeil.nom };
      photoTelephoneRegardee = false;
      return { ok: true };
    },
    async webcams() {
      return options.webcam ? options.webcam.appareils() : [];
    },
    async brancher(id, adresse, jetonClair) {
      const oeil = await trouver(id);
      if (!oeil || oeil.genre !== 'reseau') return { ok: false, error: 'Seule une caméra réseau se branche par son adresse.' };
      const verif = verifierOeil({ ...oeil, adresse });
      if (!verif.ok) return { ok: false, error: verif.raison };
      try {
        await new OeilReseau(verif.oeil.adresse!, jetonClair, fetchImpl).hello();
      } catch (error) {
        return { ok: false, error: error instanceof Error ? error.message : 'La caméra ne répond pas.' };
      }
      const scelle = jetonClair && options.chiffre?.available() ? options.chiffre.seal(jetonClair) : undefined;
      if (jetonClair && !scelle) jetonsEnMemoire.set(id, jetonClair);
      else jetonsEnMemoire.delete(id);
      const r = await store.mettre({ ...verif.oeil, ...(scelle ? { jetonScelle: scelle } : {}) });
      return r.ok ? { ok: true } : { ok: false, error: r.raison };
    },
    async garder(photoId) {
      const photo = photos.lire(photoId) ?? ecran.lire(photoId);
      if (!photo) return { ok: false, error: 'Photo plus disponible (elle n’est gardée que 30 minutes, en mémoire).' };
      const dossier = options.dossierPhotos?.() ?? '';
      if (!dossier) return { ok: false, error: 'Dossier des photos inconnu.' };
      await mkdir(dossier, { recursive: true });
      const chemin = join(dossier, nomDeFichier(photo.camera, photo.prisA, photo.type));
      await writeFile(chemin, photo.octets);
      return { ok: true, chemin };
    },
    async tour(input) {
      if (!yeuxActifs(getSettings(), editionYeux)) return null;
      const reponse = await repondreYeux({ texte: input.text, lieu: input.place, yeux: await tousLesYeux() }, await deps());
      if (!reponse) return null;
      return { texte: reponse.texte, photo: reponse.photo ? photos.garder(reponse.photo) : null };
    },
    garderPhotoJointe(photo) {
      if (!yeuxActifs(getSettings(), editionYeux) || !options.regarder) return null;
      return photos.garder({ octets: photo.octets, type: photo.type, prisA: maintenant(), taille: photo.octets.byteLength, camera: 'Photo jointe' });
    },
    async regarder(input) {
      if (!yeuxActifs(getSettings(), editionYeux) || !options.regarder) return null;
      let photo: PhotoYeux | null = null;
      let ref: PhotoDiscussion | null = null;
      if (input.photoId) {
        photo = photos.lire(input.photoId);
        if (!photo) return { texte: 'Je n’ai plus cette photo (elle n’est gardée que 30 minutes, en mémoire). Renvoie-la.', photo: { photoId: input.photoId, prisA: maintenant(), camera: 'Photo jointe' } };
        ref = { photoId: input.photoId, prisA: photo.prisA, camera: photo.camera };
      } else if (input.place === 'telephone') {
        const recente = telephoneRecente();
        // « montre-moi l'impression » reste à l'étape 1 ; sinon la question qui suit la photo est pour elle.
        if (!recente || photoTelephoneRegardee || maintenant() - recente.prisA > PHOTO_QUESTION_MS || intentionYeux(input.text)) return null;
        photoTelephoneRegardee = true;
        photo = recente;
        ref = photos.garder(recente);
      }
      if (!photo || !ref) return null;
      const r = await options.regarder({
        photo,
        question: input.text,
        oral: input.place === 'enceinte',
        ...(input.avancement ? { avancement: input.avancement } : {}),
        ...(input.signal ? { signal: input.signal } : {}),
      });
      return { texte: r.texte, photo: ref };
    },
  };
}
