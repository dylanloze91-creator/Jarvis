/**
 * Le tour « montre-moi l'impression » : photo + phrase d'état, sans modèle.
 * La photo n'est jamais envoyée à l'enceinte : elle va dans la discussion (PC et historique).
 */
import type { PhotoYeux, YeuxImprimante } from './imprimante.js';
import { heurePhoto, intentionYeux, phraseEnceinte, phraseEtat } from './phrases.js';

export type LieuYeux = 'fenetre' | 'telephone' | 'enceinte';

export interface ReponseYeux {
  texte: string;
  photo: PhotoYeux | null;
}

/** `null` : la phrase n'est pas pour les yeux. */
export async function repondreYeux(
  input: { texte: string; lieu: LieuYeux; camera?: string },
  ouvrir: () => YeuxImprimante,
): Promise<ReponseYeux | null> {
  const intention = intentionYeux(input.texte);
  if (!intention) return null;
  let yeux: YeuxImprimante;
  try {
    yeux = ouvrir();
  } catch (error) {
    return { texte: error instanceof Error ? error.message : "L'imprimante n'est pas réglée.", photo: null };
  }
  const [photo, etat] = await Promise.all([
    yeux.prendrePhoto(input.camera),
    yeux.etat().catch(() => null),
  ]);
  const image = photo.ok ? photo.photo : null;
  if (input.lieu === 'enceinte') {
    if (!image && !etat) return { texte: "L'imprimante et sa caméra ne répondent pas.", photo: null };
    return { texte: phraseEnceinte(etat, Boolean(image)), photo: image };
  }
  const morceaux: string[] = [];
  if (etat) morceaux.push(phraseEtat(etat));
  else morceaux.push("L'imprimante ne répond pas : je n'ai pas son état.");
  if (image) morceaux.push(`Photo prise à ${heurePhoto(image.prisA)}.`);
  else if (!photo.ok) morceaux.push(`Pas de photo : ${photo.raison.charAt(0).toLowerCase()}${photo.raison.slice(1)}`);
  return { texte: morceaux.join(' '), photo: image };
}
