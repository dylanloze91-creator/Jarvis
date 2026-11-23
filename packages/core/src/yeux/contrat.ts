/**
 * Le contrat d'un œil de Jarvis, le même pour toutes ses caméras (cahier `docs/specs/yeux-etape-1.md`, § 2).
 *
 * Genres :
 * - `klipper`   : la caméra de l'imprimante, adresse lue dans Moonraker (`webcams()`) ;
 * - `pc`        : la webcam du PC, prise par un moyen séparé et à la demande seulement ;
 * - `telephone` : pas de prise à distance ; l'œil garde la photo envoyée depuis l'iPhone ;
 * - `reseau`    : rover, hub, toute caméra qui suit le contrat HTTP :
 *                 `GET /api/oeil/hello` (nom, version) et `GET /api/oeil/photo` (jeton Bearer).
 *                 Rien d'autre. Pas de flux continu.
 *
 * Une seule opération pour tous : `prendrePhotoOeil(œil)` → image en mémoire, heure, taille ;
 * ou une raison en mots simples. Une caméra coupée ne prend rien. Jamais de caméra dans une chambre.
 */
import { z } from 'zod';
import { checkRoverBaseUrl } from '../rover/url.js';
import { lectureSeule, lireImage, YEUX_DELAI_MS, type PhotoYeux, type ResultatPhoto, type YeuxImprimante } from './imprimante.js';

export const OEIL_GENRES = ['klipper', 'pc', 'telephone', 'reseau'] as const;
export type OeilGenre = (typeof OEIL_GENRES)[number];

export const OEIL_GENRE_LABELS: Record<OeilGenre, string> = {
  klipper: 'Caméra de l’imprimante',
  pc: 'Webcam du PC',
  telephone: 'Caméra de l’iPhone',
  reseau: 'Caméra réseau',
};

export const OEIL_MAX = 12;

export interface Oeil {
  /** Identifiant court : `imprimante`, `bureau`, `iphone`, `rover-avant`… */
  id: string;
  nom: string;
  piece: string;
  genre: OeilGenre;
  allume: boolean;
  /** `reseau` : adresse de base sur le réseau local (vide = « pas encore branché »). */
  adresse?: string;
  /** `klipper` : nom de la caméra dans Mainsail ; `pc` : identifiant de l'appareil. */
  camera?: string;
}

export const oeilSchema = z.object({
  id: z.string().regex(/^[a-z0-9][a-z0-9-]{1,39}$/),
  nom: z.string().trim().min(1).max(40),
  piece: z.string().trim().min(1).max(40),
  genre: z.enum(OEIL_GENRES),
  allume: z.boolean(),
  adresse: z.string().max(200).optional(),
  camera: z.string().max(200).optional(),
});

function plier(texte: string): string {
  return texte
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .replace(/['’`-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Règle des caméras : jamais dans une chambre (« chambre », « chambre d'amis », « ma chambre »…). */
export function pieceInterdite(piece: string): boolean {
  return /\bchambres?\b/.test(plier(piece));
}

export type VerificationOeil = { ok: true; oeil: Oeil } | { ok: false; raison: string };

/** Contrôle d'un œil avant de l'ajouter ou de le modifier. */
export function verifierOeil(brut: unknown): VerificationOeil {
  const parsed = oeilSchema.safeParse(brut);
  if (!parsed.success) return { ok: false, raison: 'Œil incomplet : il faut un nom, une pièce et un genre.' };
  const oeil = parsed.data as Oeil;
  if (pieceInterdite(oeil.piece) || pieceInterdite(oeil.nom)) {
    return { ok: false, raison: 'Jamais de caméra dans une chambre : refusé.' };
  }
  if (oeil.genre === 'reseau' && oeil.adresse) {
    const check = checkRoverBaseUrl(oeil.adresse);
    if (!check.ok) return { ok: false, raison: `Adresse de la caméra refusée : réseau local seulement.` };
    oeil.adresse = check.origin;
  }
  return { ok: true, oeil };
}

/** Les yeux prévus, présents dès le départ : le rover et le hub ne sont pas encore branchés. */
/** L'iPhone : jamais de prise à distance, il garde la dernière photo envoyée depuis l'appli. */
export const OEIL_IPHONE: Oeil = { id: 'iphone', nom: 'iPhone', piece: 'mobile', genre: 'telephone', allume: true };

/** La webcam du PC : coupée par défaut (cahier, § 3.2). */
export const OEIL_WEBCAM: Oeil = { id: 'webcam', nom: 'Webcam du PC', piece: 'bureau', genre: 'pc', allume: false };

export const YEUX_PREVUS: readonly Oeil[] = [
  { id: 'rover-avant', nom: 'Rover avant', piece: 'mobile', genre: 'reseau', allume: true },
  { id: 'rover-pince', nom: 'Rover pince', piece: 'mobile', genre: 'reseau', allume: true },
  { id: 'hub', nom: 'Hub', piece: 'bureau', genre: 'reseau', allume: true },
];

export const oeilHelloSchema = z.object({
  nom: z.string().min(1).max(40),
  version: z.string().min(1).max(24),
});
export type OeilHello = z.infer<typeof oeilHelloSchema>;

export class OeilReseauErreur extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'OeilReseauErreur';
  }
}

/** Client du contrat `reseau` : deux GET, rien d'autre. Réseau local, aucune redirection, 5 s. */
export class OeilReseau {
  readonly origin: string;
  private readonly fetchImpl: typeof fetch;

  constructor(
    adresse: string,
    private readonly jeton: string,
    fetchImpl: typeof fetch = fetch,
    private readonly delaiMs = YEUX_DELAI_MS,
    private readonly maintenant: () => number = Date.now,
  ) {
    const check = checkRoverBaseUrl(adresse);
    if (!check.ok) throw new OeilReseauErreur('Adresse de la caméra refusée : réseau local seulement.');
    this.origin = check.origin;
    this.fetchImpl = lectureSeule(fetchImpl);
  }

  private entetes(): Record<string, string> {
    return this.jeton ? { Authorization: `Bearer ${this.jeton}` } : {};
  }

  async hello(): Promise<OeilHello> {
    let response: Response;
    try {
      response = await this.fetchImpl(`${this.origin}/api/oeil/hello`, {
        method: 'GET',
        headers: this.entetes(),
        redirect: 'error',
        signal: AbortSignal.timeout(this.delaiMs),
      });
    } catch {
      throw new OeilReseauErreur('La caméra ne répond pas.');
    }
    if (!response.ok) throw new OeilReseauErreur(`La caméra a répondu ${response.status}.`);
    const parsed = oeilHelloSchema.safeParse(await response.json().catch(() => null));
    if (!parsed.success) throw new OeilReseauErreur('Ce n’est pas un œil de Jarvis (réponse « hello » illisible).');
    return parsed.data;
  }

  photo(nom: string): Promise<ResultatPhoto> {
    return lireImage(this.fetchImpl, `${this.origin}/api/oeil/photo`, this.entetes(), this.delaiMs, this.maintenant, nom);
  }
}

/** Ce qu'il faut pour prendre une photo, selon le genre. Injecté : le cœur ne dépend de rien d'autre. */
export interface PriseDeps {
  klipper?: () => YeuxImprimante;
  /** Webcam du PC : un moyen séparé, à la demande (absent = pas encore disponible). */
  pc?: (oeil: Oeil) => Promise<ResultatPhoto>;
  /** Dernière photo envoyée par le téléphone, si elle est encore en mémoire. */
  telephone?: (oeil: Oeil) => PhotoYeux | null;
  reseau?: (oeil: Oeil) => OeilReseau;
}

/** La seule opération commune : une photo de cet œil, ou une raison en mots simples. */
export async function prendrePhotoOeil(oeil: Oeil, deps: PriseDeps): Promise<ResultatPhoto> {
  if (!oeil.allume) return { ok: false, raison: `La caméra « ${oeil.nom} » est coupée.` };
  const avecNom = (r: ResultatPhoto): ResultatPhoto => (r.ok ? { ok: true, photo: { ...r.photo, camera: oeil.nom } } : r);
  switch (oeil.genre) {
    case 'klipper': {
      if (!deps.klipper) return { ok: false, raison: "L'imprimante n'est pas réglée." };
      try {
        return avecNom(await deps.klipper().prendrePhoto(oeil.camera));
      } catch (error) {
        return { ok: false, raison: error instanceof Error ? error.message : "L'imprimante n'est pas réglée." };
      }
    }
    case 'pc':
      if (!deps.pc) return { ok: false, raison: 'La webcam du PC n’est pas encore branchée.' };
      return avecNom(await deps.pc(oeil));
    case 'telephone': {
      const photo = deps.telephone?.(oeil) ?? null;
      if (!photo) return { ok: false, raison: 'Pas de photo du téléphone : prends-en une avec « Montrer à Jarvis » dans l’appli.' };
      return { ok: true, photo: { ...photo, camera: oeil.nom } };
    }
    case 'reseau': {
      if (!oeil.adresse) return { ok: false, raison: `« ${oeil.nom} » n'est pas encore branché.` };
      if (!deps.reseau) return { ok: false, raison: `« ${oeil.nom} » n'est pas encore branché.` };
      try {
        return avecNom(await deps.reseau(oeil).photo(oeil.nom));
      } catch (error) {
        return { ok: false, raison: error instanceof Error ? error.message : 'La caméra ne répond pas.' };
      }
    }
  }
}

/** L'œil désigné dans une phrase : par son nom, sa pièce, ou « l'impression / l'imprimante ». */
export function trouverOeil(cible: string, yeux: readonly Oeil[]): Oeil | null {
  const c = plier(cible).replace(/^(?:la |le |les |l |du |de la |de l |des |de )/, '').trim();
  if (!c) return null;
  if (/^(?:impression|imprimante|impression en cours)$/.test(c)) return yeux.find((o) => o.genre === 'klipper') ?? null;
  if (/^(?:iphone|telephone|portable)$/.test(c)) return yeux.find((o) => o.genre === 'telephone') ?? null;
  if (/^(?:webcam|webcam du pc|pc)$/.test(c)) return yeux.find((o) => o.genre === 'pc') ?? null;
  const parNom = yeux.find((o) => plier(o.nom) === c);
  if (parNom) return parNom;
  // Par la pièce : d'abord un œil allumé et branché (« le bureau » = la webcam, pas le hub prévu).
  const parPiece = yeux.filter((o) => plier(o.piece) === c);
  return parPiece.find((o) => o.allume && (o.genre !== 'reseau' || Boolean(o.adresse))) ?? parPiece[0] ?? null;
}
