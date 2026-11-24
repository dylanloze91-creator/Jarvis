/**
 * Une étape de projet (cap « Jarvis chef de projet », docs/specs/chef-de-projet.md § 5) : ce que rend
 * toute fonction de l'atelier appelée sans phrase ni fenêtre — par la discussion aujourd'hui, par le
 * chef de projet demain, ou par une autre équipe.
 *
 * Règles : le résultat dit honnêtement s'il a réussi et pourquoi ; ce qu'il a produit (fichiers) ;
 * d'où viennent ses cotes (sources) ; ce qui n'est pas sûr (incertitudes) ; les questions à poser à
 * l'utilisateur (un seul canal : l'étape rend la question, elle n'attend pas) ; ce qui demande son
 * accord. Jamais « fait » sans contrôle.
 */

/** Une question rendue par une étape. L'appelant la pose (discussion, téléphone) et rappelle l'étape. */
export interface QuestionEtape {
  /** Identifiant stable, pour reconnaître la réponse (« agrandir », « mesure:esp32:longueur »). */
  id: string;
  /** La question, courte, en français simple. */
  texte: string;
  /** Réponses attendues, si elles sont fermées (« oui », « non »). */
  reponses?: string[];
}

export interface ResultatEtape<T> {
  /** Vrai seulement si l'étape a fini et que ses contrôles sont passés. */
  ok: boolean;
  /** Pourquoi elle n'a pas réussi (phrase), quand `ok` est faux. */
  raison?: string;
  /** Ce que l'étape a produit (pièce, état…), même partiel. */
  produit?: T;
  /** Chemins des fichiers produits ou repris. */
  fichiers: string[];
  /** D'où viennent les cotes utilisées (plans, fiches, « mesuré par l'utilisateur »). */
  sources: string[];
  /** Ce qui n'est pas sûr : cotes incertaines, éléments supposés. */
  incertitudes: string[];
  /** Ce qui marche mais mérite d'être dit (support nécessaire, contrôle partiel…). */
  avertissements: string[];
  /** Questions à poser à l'utilisateur ; l'étape n'a rien fait d'irréversible en attendant. */
  questions: QuestionEtape[];
  /** Actions qui demandent son accord (carte) avant d'être faites. */
  accord: string[];
  /** Ce qui a été repris d'un passage précédent au lieu d'être refait. */
  repris: string[];
}

/** Où en est une étape longue (rendu, images, tranchage, recherche), pour l'afficher. */
export interface Avancement {
  /** Nom court de la sous-étape : « dessin », « controle », « images », « tranchage »… */
  etape: string;
  /** Phrase à montrer. */
  message: string;
  /** Part faite, de 0 à 1, quand elle se mesure. */
  part?: number;
}

/** Un résultat vide, à compléter. */
export function resultatEtape<T>(champs: Partial<ResultatEtape<T>> & { ok: boolean }): ResultatEtape<T> {
  return {
    fichiers: [],
    sources: [],
    incertitudes: [],
    avertissements: [],
    questions: [],
    accord: [],
    repris: [],
    ...champs,
  };
}
