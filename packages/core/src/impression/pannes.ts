/**
 * Tout ce qui peut mal tourner autour d'une impression 3D, et ce que Jarvis en voit.
 * Liste tenue à la main, vérifiée par les essais : chaque panne marquée « simulée » est rejouée
 * par le simulateur (`simulateur.testkit.ts`, `pannes.test.ts`), les autres renvoient à l'essai
 * qui la couvre. Les pannes que Jarvis ne sait pas voir sont dites telles quelles.
 */

export type MomentPanne = 'avant' | 'pendant';
export type SourcePanne = 'fichier' | 'klipper' | 'camera' | 'prise' | 'capteur';
/** sûre : règle exacte ; probable : vue sur image, réglée par simulation, à confirmer sur de vraies photos ; difficile : parfois ; non : Jarvis ne la voit pas. */
export type FiabilitePanne = 'sure' | 'probable' | 'difficile' | 'non';

export interface Panne {
  id: string;
  nom: string;
  moment: MomentPanne;
  sources: readonly SourcePanne[];
  fiabilite: FiabilitePanne;
  /** Ce que Jarvis fait. */
  action: string;
  /** Scénario du simulateur, ou essai existant qui la couvre ; `null` si non détectée. */
  essai: { simulation: string } | { test: string } | null;
}

export const PANNES: readonly Panne[] = [
  // --- Avant de lancer : placement sur le plateau ---
  { id: 'hors_feuille', nom: 'Objet en partie hors de la feuille (il imprimerait dans le vide)', moment: 'avant', sources: ['fichier', 'camera'], fiabilite: 'sure', action: 'Déconseille de lancer, dit de combien et de quel côté.', essai: { simulation: 'hors_feuille' } },
  { id: 'feuille_decalee', nom: 'Feuille aimantée mal posée sur le plateau', moment: 'avant', sources: ['camera'], fiabilite: 'probable', action: 'Mesure le décalage au demi-millimètre, puis recontrôle chaque objet avec la feuille à sa vraie place.', essai: { simulation: 'feuille_decalee' } },
  { id: 'feuille_absente', nom: 'Feuille oubliée ou bords invisibles', moment: 'avant', sources: ['camera'], fiabilite: 'probable', action: 'Dit qu’il ne voit pas les bords de la feuille : à vérifier avant de lancer.', essai: { simulation: 'feuille_absente' } },
  { id: 'restes_plateau', nom: 'Une pièce ou des restes encore sur le plateau', moment: 'avant', sources: ['camera'], fiabilite: 'probable', action: 'Compare avec la photo du plateau vide et dit où il voit quelque chose.', essai: { simulation: 'restes_plateau' } },
  { id: 'ilot_vide', nom: 'Partie posée sur rien (supports manquants, pièce mal orientée)', moment: 'avant', sources: ['fichier'], fiabilite: 'sure', action: 'Déconseille de lancer, dit à quelle hauteur et quel objet.', essai: { simulation: 'ilot_vide' } },
  { id: 'ne_touche_pas', nom: 'Objet qui ne touche pas le plateau', moment: 'avant', sources: ['fichier'], fiabilite: 'sure', action: 'Déconseille de lancer.', essai: { simulation: 'ne_touche_pas' } },
  { id: 'hors_volume', nom: 'Matière hors du volume de l’imprimante', moment: 'avant', sources: ['fichier'], fiabilite: 'sure', action: 'Déconseille de lancer.', essai: { simulation: 'hors_volume' } },
  { id: 'bord', nom: 'Objet collé au bord de la feuille', moment: 'avant', sources: ['fichier'], fiabilite: 'sure', action: 'À vérifier.', essai: { simulation: 'bord' } },
  { id: 'colles', nom: 'Deux objets qui se touchent', moment: 'avant', sources: ['fichier'], fiabilite: 'sure', action: 'À vérifier : si l’un rate, il emporte l’autre.', essai: { simulation: 'colles' } },
  { id: 'bascule', nom: 'Objet haut sur une petite base (risque de bascule)', moment: 'avant', sources: ['fichier'], fiabilite: 'probable', action: 'À vérifier, conseille une bordure (brim).', essai: { simulation: 'bascule' } },
  { id: 'hors_maillage', nom: 'Objet hors de la zone palpée du plateau', moment: 'avant', sources: ['fichier', 'klipper'], fiabilite: 'sure', action: 'À vérifier : première couche moins sûre.', essai: { simulation: 'hors_maillage' } },

  // --- Pendant : ce que Klipper et la prise disent ---
  { id: 'temperature_buse', nom: 'Température de la buse qui dérive ou chute', moment: 'pendant', sources: ['klipper'], fiabilite: 'sure', action: 'Doute à 90 s, pause à 3 min, annulation sans réponse.', essai: { test: 'température qui dérive : doute à 90 s, pause à 3 min' } },
  { id: 'temperature_plateau', nom: 'Plateau qui ne tient plus sa température', moment: 'pendant', sources: ['klipper'], fiabilite: 'sure', action: 'Comme la buse.', essai: { test: 'température qui dérive : doute à 90 s, pause à 3 min' } },
  { id: 'klipper_arret', nom: 'Klipper s’arrête sur une erreur (emballement thermique, carte, fil)', moment: 'pendant', sources: ['klipper'], fiabilite: 'sure', action: 'Alerte avec photo ; Klipper a déjà coupé ses chauffes.', essai: { test: 'Klipper arrêté sur une erreur : une alerte, aucun geste' } },
  { id: 'bloquee', nom: 'Impression qui n’avance plus', moment: 'pendant', sources: ['klipper'], fiabilite: 'sure', action: 'Pause après 10 minutes sans progrès.', essai: { test: 'impression qui n’avance plus depuis 10 minutes : pause' } },
  { id: 'injoignable', nom: 'Klipper ou le Pi ne répond plus pendant une chauffe', moment: 'pendant', sources: ['klipper', 'prise'], fiabilite: 'sure', action: 'Annonce, puis coupe la prise une minute après (option à cocher).', essai: { test: 'injoignable et chauffe mesurée : annonce à 2 min, coupure 1 min après, puis vérifiée' } },
  { id: 'camera_aveugle', nom: 'Caméra noire, figée ou muette', moment: 'pendant', sources: ['camera'], fiabilite: 'sure', action: 'Doute ; ne dit plus jamais « tout va bien ».', essai: { test: 'caméra noire ou figée : un doute, jamais un geste' } },
  { id: 'bobine_vide', nom: 'Bobine vide ou fil cassé', moment: 'pendant', sources: ['capteur', 'camera'], fiabilite: 'probable', action: 'Le capteur de l’Ender met en pause (vu comme une pause) ; sans capteur, la caméra voit que plus rien ne grandit : doute, puis pause.', essai: { simulation: 'buse_bouchee' } },
  { id: 'buse_bouchee', nom: 'Buse bouchée (plus rien ne sort)', moment: 'pendant', sources: ['camera'], fiabilite: 'probable', action: 'Doute après une dizaine de couches sans croissance, pause après une vingtaine.', essai: { simulation: 'buse_bouchee' } },

  // --- Pendant : la caméra, objet par objet ---
  { id: 'spaghetti_un_objet', nom: 'Un objet part en « spaghetti » (les autres vont bien)', moment: 'pendant', sources: ['camera'], fiabilite: 'probable', action: 'Alerte avec photo, puis arrête CET objet seul au bout de 2 minutes sans réponse.', essai: { simulation: 'spaghetti_un_objet' } },
  { id: 'objet_decolle', nom: 'Un objet se décolle ou est poussé par la buse', moment: 'pendant', sources: ['camera'], fiabilite: 'probable', action: 'Comme le spaghetti : cet objet seul.', essai: { simulation: 'objet_decolle' } },
  { id: 'vide_bord', nom: 'Un objet imprime au-dessus du vide au bord de la feuille', moment: 'pendant', sources: ['fichier', 'camera'], fiabilite: 'difficile', action: 'Vu avant de lancer (contrôle du plateau, sûr). Pendant, les fils qui pendent hors de la feuille se voient mal : seulement s’ils retombent sur la feuille.', essai: { simulation: 'hors_feuille' } },
  { id: 'spaghetti_seul_objet', nom: 'L’unique objet part en spaghetti', moment: 'pendant', sources: ['camera'], fiabilite: 'probable', action: 'Pause de toute l’impression, annulation sans réponse.', essai: { simulation: 'spaghetti_seul_objet' } },
  { id: 'decalage_couche', nom: 'Décalage de couche (tous les objets se décalent)', moment: 'pendant', sources: ['camera'], fiabilite: 'probable', action: 'Pause de toute l’impression.', essai: { simulation: 'decalage_couche' } },
  { id: 'plateau_bouge', nom: 'La feuille glisse pendant l’impression (tout bouge)', moment: 'pendant', sources: ['camera'], fiabilite: 'probable', action: 'Pause de toute l’impression.', essai: { simulation: 'plateau_bouge' } },
  { id: 'camera_bougee', nom: 'Caméra bougée ou lumière qui change', moment: 'pendant', sources: ['camera'], fiabilite: 'sure', action: 'Ne conclut rien sur un coup de lumière ; si ça dure, dit qu’il faut refaire le calage.', essai: { simulation: 'camera_bougee' } },
  { id: 'fausse_alerte_normale', nom: 'Impression normale (tête qui passe, petits fils, lumière qui varie)', moment: 'pendant', sources: ['camera'], fiabilite: 'sure', action: 'Aucune alerte.', essai: { simulation: 'normale' } },

  // --- Ce que Jarvis ne voit pas (ou pas encore) ---
  { id: 'warping_leger', nom: 'Coins qui se soulèvent d’un millimètre (warping)', moment: 'pendant', sources: ['camera'], fiabilite: 'difficile', action: 'Vu seulement quand l’objet finit par se décoller.', essai: null },
  { id: 'premiere_couche_fine', nom: 'Première couche trop écrasée ou pas assez', moment: 'pendant', sources: ['camera'], fiabilite: 'non', action: 'Pas visible de loin : il faudrait une caméra près de la buse ou un modèle entraîné.', essai: null },
  { id: 'sous_extrusion_legere', nom: 'Sous-extrusion légère, couches poreuses', moment: 'pendant', sources: [], fiabilite: 'non', action: 'Vérifie la pièce à la fin.', essai: null },
  { id: 'qualite', nom: 'Défauts d’aspect (vagues, pied d’éléphant, fils fins)', moment: 'pendant', sources: [], fiabilite: 'non', action: 'Pas une panne : rien n’est dit.', essai: null },
  { id: 'ventilateur', nom: 'Ventilateur de la tête en panne', moment: 'pendant', sources: [], fiabilite: 'non', action: 'Klipper ne le mesure pas sur l’Ender ; vu seulement s’il bouche la buse.', essai: null },
  { id: 'fuite_tete', nom: 'Plastique qui s’accumule autour de la buse (« blob »)', moment: 'pendant', sources: ['camera'], fiabilite: 'difficile', action: 'La tête est retirée de l’image : vu seulement s’il tombe sur le plateau.', essai: null },
  { id: 'filament_humide', nom: 'Filament humide ou mauvais réglage de matière', moment: 'pendant', sources: [], fiabilite: 'non', action: 'Non détecté.', essai: null },
];

export function panne(id: string): Panne | undefined {
  return PANNES.find((p) => p.id === id);
}
