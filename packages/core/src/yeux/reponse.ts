/**
 * Le tour « montre-moi l'impression / le bureau / la caméra du rover » : photo de l'œil nommé,
 * et, pour l'imprimante, la phrase d'état. Sans modèle.
 * La photo n'est jamais envoyée à l'enceinte : elle va dans la discussion (PC et historique).
 */
import type { PhotoYeux } from './imprimante.js';
import { prendrePhotoOeil, trouverOeil, type Oeil, type PriseDeps } from './contrat.js';
import { heurePhoto, intentionYeux, phraseEnceinte, phraseEtat } from './phrases.js';

export type LieuYeux = 'fenetre' | 'telephone' | 'enceinte';

export interface ReponseYeux {
  texte: string;
  photo: PhotoYeux | null;
  oeil: Oeil;
}

function minuscule(raison: string): string {
  return `${raison.charAt(0).toLowerCase()}${raison.slice(1)}`;
}

/** `null` : la phrase n'est pas pour les yeux (ou ne nomme aucun œil connu), le tour continue. */
export async function repondreYeux(
  input: { texte: string; lieu: LieuYeux; yeux: readonly Oeil[] },
  deps: PriseDeps,
): Promise<ReponseYeux | null> {
  const intention = intentionYeux(input.texte);
  if (!intention) return null;
  const oeil = trouverOeil(intention.cible, input.yeux);
  if (!oeil) return null;
  const imprimante = oeil.genre === 'klipper';
  const [photo, etat] = await Promise.all([
    prendrePhotoOeil(oeil, deps),
    imprimante && deps.klipper
      ? Promise.resolve()
          .then(() => deps.klipper!().etat())
          .catch(() => null)
      : Promise.resolve(null),
  ]);
  const image = photo.ok ? photo.photo : null;
  if (input.lieu === 'enceinte') {
    if (imprimante) {
      if (!image && !etat) return { texte: "L'imprimante et sa caméra ne répondent pas.", photo: null, oeil };
      return { texte: phraseEnceinte(etat, Boolean(image)), photo: image, oeil };
    }
    return { texte: image ? 'La photo est sur le PC.' : photo.ok ? '' : photo.raison, photo: image, oeil };
  }
  const morceaux: string[] = [];
  if (imprimante) morceaux.push(etat ? phraseEtat(etat) : "L'imprimante ne répond pas : je n'ai pas son état.");
  if (image) morceaux.push(imprimante ? `Photo prise à ${heurePhoto(image.prisA)}.` : `${oeil.nom} : photo prise à ${heurePhoto(image.prisA)}.`);
  else if (!photo.ok) morceaux.push(imprimante ? `Pas de photo : ${minuscule(photo.raison)}` : photo.raison);
  return { texte: morceaux.join(' '), photo: image, oeil };
}
