/**
 * Phrases d'essai de l'atelier 3D, écrites par Claude dans le style de l'utilisateur (mission de
 * nuit du 25 au 26 novembre) : sans ponctuation, « du coup », « genre », « fais-moi », « rajoute »,
 * suites de phrase (« et en plus grand », « non plus large »), nombres en lettres, fautes de dictée
 * (« rasberry pie », « boite », « mn » pour mm), demandes floues.
 *
 * **Ces phrases servent seulement aux essais** (`phrases-atelier.banc.ts`, `phrasesAtelier.test.ts`).
 * Elles n'entrent jamais dans un jeu d'entraînement. Aucune n'est recopiée d'une conversation de
 * l'utilisateur : elles sont écrites à sa manière.
 */

export type Attendu =
  /** L'atelier rend une pièce : modèle, taille (mm, `null` = libre), numéro de version. */
  | { piece: string; taille?: [number | null, number | null, number | null]; tolerance?: number; version?: number; mesures?: RegExp; dit?: RegExp; pasDit?: RegExp }
  /** L'atelier pose une question ou propose (pas de pièce rendue). */
  | { question: RegExp; dit?: RegExp; pasDit?: RegExp }
  /** L'atelier répond (peu importe quoi), avec ce texte si `dit`. */
  | { dit?: RegExp; pasDit?: RegExp }
  /** La phrase n'est pas pour l'atelier : il ne doit pas la prendre. */
  | { ailleurs: true; dit?: RegExp };

export interface TourEssai {
  dire: string;
  lieu?: 'telephone' | 'enceinte';
  /** Réponse à la carte de confirmation de l'atelier (absent : refus). */
  accord?: boolean;
  attendu: Attendu;
  /** Un appel attendu sur la fausse imprimante (« POST /server/files/upload »). */
  imprimante?: RegExp;
  /** Un appel interdit sur la fausse imprimante. */
  pasImprimante?: RegExp;
}

export interface DiscussionEssai {
  id: string;
  /** Fonction de l'inventaire couverte. */
  fonction: string;
  tours: TourEssai[];
  /** `lent` (plusieurs minutes), `web` (recherche sur Internet). */
  marques?: ('lent' | 'web')[];
  /** Garder les mesures de composants de la discussion d'avant. */
  gardeMesures?: boolean;
  /** La fausse imprimante est en train d'imprimer. */
  imprimanteOccupee?: boolean;
}

const ENVOI = /POST \/server\/files\/upload/;
const LANCER = /POST \/printer\/print\/start/;
const FILE = /POST \/server\/job_queue\/job/;
const QUOI_FAIRE = /bo[iî]te|bac|entretoise|équerre|crochet|socle|cale/i;

export const DISCUSSIONS: DiscussionEssai[] = [
  // ───────────── Les pièces de base, les mesures, les versions ─────────────
  {
    id: 'base-boite',
    fonction: 'pièces de base et versions',
    tours: [
      { dire: 'fais moi une boite de 80 par 50 par 30', attendu: { piece: 'boite', taille: [80, 50, 30], version: 1 } },
      { dire: 'plus haute', attendu: { piece: 'boite', taille: [80, 50, null], version: 2, mesures: /Hauteur : (3[1-9]|[4-9]\d)/ } },
      // « non » : la correction repart de la version d'avant (la hauteur revient à 30).
      { dire: 'non plus large', attendu: { piece: 'boite', taille: [80, null, 30], version: 3, mesures: /Largeur : (5[1-9]|[6-9]\d)/ } },
      { dire: 'elle fait combien de haut la', attendu: { dit: /30 mm de haut/ } },
      { dire: 'et en plus grand', attendu: { dit: /Plus longue, plus large ou plus haute/ } },
      { dire: 'reviens a la version 1', attendu: { piece: 'boite', taille: [80, 50, 30], version: 1 } },
      { dire: 'hauteur 45', attendu: { piece: 'boite', taille: [80, 50, 45] } },
    ],
  },
  {
    id: 'base-lettres',
    fonction: 'pièces de base et versions',
    tours: [
      { dire: 'euh jarvis fais moi une boite de cent vingt par quatre vingts par quarante', attendu: { piece: 'boite', taille: [120, 80, 40] } },
      { dire: 'du coup hauteur soixante', attendu: { piece: 'boite', taille: [120, 80, 60], version: 2 } },
      { dire: 'largeur 100mn', attendu: { piece: 'boite', taille: [120, 100, 60], version: 3 } },
      { dire: 'un peu moins longue', attendu: { piece: 'boite', taille: [null, 100, 60], version: 4, mesures: /Longueur : (\d\d|10\d|11\d)\b/ } },
      { dire: 'remets la version d avant', attendu: { piece: 'boite', taille: [120, 100, 60] } },
    ],
  },
  {
    id: 'base-cm',
    fonction: 'pièces de base et versions',
    tours: [
      { dire: 'du coup il me faudrait une boite de douze centimetres par huit par quatre', attendu: { piece: 'boite', taille: [120, 80, 40] } },
      { dire: 'genre deux centimetres de plus en hauteur', attendu: { piece: 'boite', taille: [120, 80, 60], version: 2 } },
      { dire: 'tu peux me la faire en 15 cm de long', attendu: { piece: 'boite', taille: [150, 80, 60], version: 3 } },
    ],
  },
  {
    id: 'base-questions',
    fonction: 'mesures et questions',
    tours: [
      { dire: 'fais moi une boite', attendu: { question: /longueur/i } },
      { dire: 'cent', attendu: { question: /largeur/i } },
      { dire: 'c est quoi deja la question', attendu: { question: /largeur/i } },
      { dire: 'soixante', attendu: { question: /hauteur/i } },
      { dire: 'trente', attendu: { piece: 'boite', taille: [100, 60, 30] } },
    ],
  },
  {
    id: 'base-questions-annule',
    fonction: 'mesures et questions',
    tours: [
      { dire: 'il me faut une boite pour ranger mes vis', attendu: { question: /longueur/i } },
      { dire: 'quelle heure il est', attendu: { ailleurs: true } },
      { dire: 'bon fais moi une boite', attendu: { question: /longueur/i } },
      { dire: 'laisse tomber', attendu: { dit: /laisse tomber/i } },
    ],
  },
  {
    id: 'base-couvercle',
    fonction: 'pièces de base et versions',
    tours: [
      { dire: 'je voudrais une boite avec couvercle de 100 par 60 par 40', attendu: { piece: 'boite_couvercle', taille: [null, null, null], mesures: /Longueur : 100.*Largeur : 60.*Hauteur : 40/, dit: /de 100 × 60 × 40 mm/ } },
      { dire: 'plus large de 2 cm', attendu: { piece: 'boite_couvercle', version: 2, mesures: /Largeur : 80/ } },
    ],
  },
  {
    id: 'base-bac',
    fonction: 'pièces de base et versions',
    tours: [
      { dire: 'fais moi un bac a compartiments de 150 par 100 par 30 avec 3 cases par 2', attendu: { piece: 'bac', taille: [150, 100, 30] } },
      { dire: 'plutot 4 cases en longueur', attendu: { piece: 'bac', taille: [150, 100, 30], version: 2, mesures: /4/ } },
    ],
  },
  {
    id: 'base-bac-flou',
    fonction: 'mesures et questions',
    tours: [
      { dire: 'il me faudrait un organiseur pour mes resistances', attendu: { question: /longueur|cases|compartiments/i } },
      { dire: 'je sais pas trop fais comme tu veux', attendu: { dit: /./ } },
    ],
  },
  {
    id: 'base-entretoise',
    fonction: 'pièces de base et versions',
    tours: [
      { dire: 'il me faut une entretoise de 10 de haut pour une vis m3', attendu: { dit: /./ } },
      { dire: 'ouais vas y', attendu: { dit: /./ } },
    ],
  },
  {
    id: 'base-entretoise-cotes',
    fonction: 'pièces de base et versions',
    tours: [
      { dire: 'fais moi une entretoise de 8 de diametre 12 de haut avec un trou de 3', attendu: { piece: 'entretoise', taille: [8, 8, 12] } },
      { dire: 'le trou plus gros', attendu: { piece: 'entretoise', version: 2 } },
    ],
  },
  {
    id: 'base-equerre',
    fonction: 'pièces de base et versions',
    tours: [
      { dire: 'fais moi une equerre', attendu: { question: /./ } },
      { dire: 'oui', attendu: { dit: /./ } },
      { dire: 'oui', attendu: { dit: /./ } },
    ],
  },
  {
    id: 'base-crochet',
    fonction: 'pièces de base et versions',
    tours: [
      { dire: 'imprime moi un crochet pour accrocher mon casque', attendu: { dit: /crochet/i } },
      { dire: 'ouais', attendu: { dit: /./ } },
    ],
  },
  {
    id: 'base-support-telephone',
    fonction: 'pièces de base et versions',
    tours: [
      { dire: 'jarvis fais moi un support de telephone', attendu: { question: /inclinaison/i } },
      { dire: 'ouais vas y', attendu: { piece: 'support_telephone' } },
      { dire: 'largeur 100mn', attendu: { piece: 'support_telephone', version: 2, mesures: /Largeur : 100/ } },
      { dire: 'plus incline', attendu: { piece: 'support_telephone', version: 3 } },
    ],
  },
  {
    id: 'base-support-45',
    fonction: 'mesures et questions',
    tours: [
      { dire: 'fais moi un support pour mon portable', attendu: { question: /inclinaison/i } },
      { dire: 'quarante cinq degres', attendu: { piece: 'support_telephone', mesures: /45/ } },
    ],
  },
  {
    id: 'base-socle',
    fonction: 'pièces de base et versions',
    tours: [
      { dire: 'fais moi un socle rond de 80 de diametre', attendu: { dit: /socle/i } },
      { dire: 'plutot carre', attendu: { dit: /./ } },
    ],
  },
  {
    id: 'base-etiquette',
    fonction: 'pièces de base et versions',
    tours: [
      { dire: 'il me faudrait un porte etiquette pour mes bacs', attendu: { dit: /étiquette/i } },
      { dire: 'oui', attendu: { dit: /./ } },
    ],
  },
  {
    id: 'base-cale',
    fonction: 'pièces de base et versions',
    tours: [
      { dire: 'fais moi une cale de porte', attendu: { dit: /cale/i } },
      { dire: 'ok', attendu: { dit: /./ } },
    ],
  },
  {
    id: 'base-deux-pieces',
    fonction: 'pièces de base et versions',
    tours: [
      { dire: 'fais moi une boite de 60 par 40 par 20', attendu: { piece: 'boite', taille: [60, 40, 20] } },
      { dire: 'et aussi une cale de 60 de long 30 de large et 20 de haut', attendu: { piece: 'cale', taille: [60, 30, 20] } },
      { dire: 'plus haute', attendu: { piece: 'cale', version: 2 } },
    ],
  },
  {
    id: 'base-trop-grand',
    fonction: 'mesures et questions',
    tours: [
      { dire: 'fais moi une boite de 500 par 400 par 300', attendu: { dit: /300|trop|plateau|maximum|au plus/i } },
      { dire: 'bon alors 250 par 200 par 100', attendu: { piece: 'boite', taille: [250, 200, 100] } },
    ],
  },

  // ───────────── Pièces inconnues, demandes floues, ce que l'atelier sait faire ─────────────
  {
    id: 'flou-inconnu',
    fonction: 'demandes floues',
    tours: [
      // Sans rien d'atelier avant, « fais-moi un… » reste au modèle, qui sait que l'atelier existe et le dit.
      { dire: 'fais moi un pot de fleurs', attendu: { ailleurs: true, dit: /atelier|fais-moi|boîte/i } },
      { dire: 'imprime moi un support pour mon ecran', attendu: { dit: QUOI_FAIRE } },
      { dire: 'bah une boite alors', attendu: { question: /longueur/i } },
    ],
  },
  {
    id: 'flou-quoi',
    fonction: 'demandes floues',
    tours: [
      { dire: 'tu sais faire quoi comme pieces en 3d', attendu: { dit: QUOI_FAIRE } },
      { dire: 'qu est ce que tu peux m imprimer', attendu: { dit: QUOI_FAIRE } },
    ],
  },
  {
    id: 'flou-truc',
    fonction: 'demandes floues',
    tours: [
      { dire: 'j aimerais imprimer un truc en 3d', attendu: { dit: QUOI_FAIRE } },
      { dire: 'genre un truc pour ranger mes vis', attendu: { dit: /bo[iî]te|bac|longueur/i } },
    ],
  },
  {
    id: 'flou-modelise',
    fonction: 'demandes floues',
    tours: [
      { dire: 'modelise moi ca en 3d', attendu: { dit: QUOI_FAIRE } },
      { dire: 'tu peux me dessiner une piece', attendu: { dit: QUOI_FAIRE } },
    ],
  },
  {
    id: 'flou-boitier-seul',
    fonction: 'demandes floues',
    tours: [
      { dire: 'du coup il me faut un boitier', attendu: { question: /longueur|pour quoi|quelle carte/i } },
      { dire: 'genre 10 par 6 par 3 centimetres', attendu: { piece: 'boite', taille: [100, 60, 30] } },
    ],
  },

  // ───────────── Ce qui n'est pas pour l'atelier ─────────────
  {
    id: 'ailleurs-seuls',
    fonction: 'routage (pas pour l’atelier)',
    tours: [
      { dire: 'dessine moi un chat', attendu: { ailleurs: true } },
      { dire: 'quelle fenetre est active', attendu: { ailleurs: true } },
      { dire: 'une boite de 6 oeufs ca coute combien', attendu: { ailleurs: true } },
      { dire: 'mets le volume a 40', attendu: { ailleurs: true } },
      { dire: 'c est quoi une entretoise', attendu: { ailleurs: true } },
    ],
  },
  {
    id: 'ailleurs-avec-piece',
    fonction: 'routage (pas pour l’atelier)',
    tours: [
      { dire: 'fais moi une boite de 70 par 50 par 25', attendu: { piece: 'boite', taille: [70, 50, 25] } },
      { dire: 'ferme la fenetre', attendu: { ailleurs: true } },
      { dire: 'mets la musique', attendu: { ailleurs: true } },
      { dire: 'quelle heure il est', attendu: { ailleurs: true } },
      { dire: 'rajoute un trou de 5 a gauche', attendu: { piece: 'boite', taille: [70, 50, 25], version: 2, mesures: /trou|Trou/ } },
    ],
  },

  // ───────────── Trous, encadrements, encoches ─────────────
  {
    id: 'decoupes-trou',
    fonction: 'trous, encadrements, encoches',
    tours: [
      { dire: 'fais moi une boite de 80 par 50 par 30 avec un trou de 8 mm a l arriere pour le cable', attendu: { piece: 'boite', taille: [80, 50, 30], mesures: /8 mm/ } },
      { dire: 'le trou plus gros', attendu: { piece: 'boite', version: 2, pasDit: /8 mm →? ?8 mm/ } },
      { dire: 'rajoute un passage de cable de 15 par 10 sur la face avant en bas', attendu: { piece: 'boite', version: 3, mesures: /15/ } },
      { dire: 'enleve le trou a l arriere', attendu: { piece: 'boite', version: 4 } },
      { dire: 'non remets le', attendu: { piece: 'boite' } },
    ],
  },
  {
    id: 'decoupes-dictee',
    fonction: 'trous, encadrements, encoches',
    tours: [
      { dire: 'fais moi une boite de 80 par 50 par 30', attendu: { piece: 'boite', taille: [80, 50, 30] } },
      { dire: 'fait un trou de 15mn par 5mn a 20mn de hauteur sur la paroi la plus large', attendu: { piece: 'boite', taille: [80, 50, 30], version: 2, mesures: /15 × 5 mm/ } },
      { dire: 'met un trou de cinq a droite pour le cable', attendu: { piece: 'boite', version: 3, mesures: /5 mm/ } },
      { dire: 'joute une encoche de 10 sur le bord avant', attendu: { piece: 'boite', version: 4, mesures: /ncoche/ } },
      { dire: 'fais passer le cable par le cote gauche', attendu: { piece: 'boite', version: 5 } },
    ],
  },
  {
    id: 'decoupes-aerations',
    fonction: 'trous, encadrements, encoches',
    tours: [
      { dire: 'fais moi une boite avec couvercle de 100 par 70 par 40', attendu: { piece: 'boite_couvercle' } },
      { dire: 'ajoute des aerations sur les cotes', attendu: { piece: 'boite_couvercle', version: 2 } },
      { dire: 'fais une fenetre de 40 par 20 sur le dessus', attendu: { piece: 'boite_couvercle', version: 3, mesures: /40/ } },
      { dire: 'la fenetre plus grande', attendu: { piece: 'boite_couvercle', version: 4 } },
    ],
  },
  {
    id: 'decoupes-refus',
    fonction: 'trous, encadrements, encoches',
    tours: [
      { dire: 'fais moi une boite de 60 par 40 par 20', attendu: { piece: 'boite', taille: [60, 40, 20] } },
      { dire: 'rajoute un trou de 50 a l arriere', attendu: { dit: /trop|ne tient pas|dépasse|plus petit|au plus|maximum/i } },
      { dire: 'bon alors de 10', attendu: { piece: 'boite', taille: [60, 40, 20], version: 2, mesures: /10 mm/ } },
      { dire: 'et deux trous de 3 sur le fond', attendu: { piece: 'boite', taille: [60, 40, 20], version: 3, mesures: /3 mm/ } },
      { dire: 'bon alors 25', attendu: { dit: /pour quelle mesure/ } },
      { dire: 'hauteur 25', attendu: { piece: 'boite', taille: [60, 40, 25], version: 4 } },
    ],
  },

  // ───────────── Ajouts de matière, couvercle ─────────────
  {
    id: 'ajouts-bossages',
    fonction: 'boîtiers électroniques',
    tours: [
      { dire: 'fais moi une boite avec couvercle de 120 par 80 par 40 avec quatre bossages avec insert m3 a 7 mm des coins', attendu: { piece: 'boite_couvercle', mesures: /ossage/ } },
      { dire: 'rajoute une nervure au milieu', attendu: { piece: 'boite_couvercle', version: 2, mesures: /ervure/ } },
      { dire: 'enleve la nervure', attendu: { piece: 'boite_couvercle', version: 3 } },
    ],
  },
  {
    id: 'ajouts-couvercle',
    fonction: 'boîtiers électroniques',
    tours: [
      { dire: 'fais moi une boite de 90 par 60 par 35', attendu: { piece: 'boite', taille: [90, 60, 35] } },
      { dire: 'tu peux ajouter un couvercle', attendu: { piece: 'boite_couvercle', version: 2 } },
      { dire: 'un couvercle qui s emboite plutot', attendu: { piece: 'boite_couvercle' } },
      { dire: 'rajoute un rebord a l interieur', attendu: { dit: /./ } },
    ],
  },

  // ───────────── Composants : Raspberry Pi 5 ─────────────
  {
    id: 'pi5-trop-petit',
    fonction: 'boîtiers électroniques',
    tours: [
      { dire: 'fais moi une boite de 120 par 80 par 40 avec des plots pour un raspberry pi 5 ports vers l arriere', attendu: { question: /\d+ × \d+/ } },
      { dire: 'pas de probleme', attendu: { piece: 'boite', mesures: /Raspberry Pi 5/ } },
      { dire: 'rajoute un couvercle qui s emboite', attendu: { piece: 'boite_couvercle', version: 2 } },
      { dire: 'fais un trou de 8 a droite pour un cable', attendu: { piece: 'boite_couvercle', version: 3 } },
    ],
  },
  {
    id: 'pi5-sans-cotes',
    fonction: 'boîtiers électroniques',
    tours: [
      { dire: 'je voudrais un boitier pour mon rasberry pie 5', attendu: { question: /je propose/i } },
      { dire: 'ouais vas y', attendu: { piece: 'boite', mesures: /Raspberry Pi 5/ } },
      { dire: 'elle fait combien de haut la', attendu: { dit: /\d+ mm/ } },
      { dire: 'les ports a gauche plutot', attendu: { dit: /./ } },
    ],
  },
  {
    id: 'pi5-dictee',
    fonction: 'boîtiers électroniques',
    tours: [
      { dire: 'euh jarvis fais moi une boite de cent vingt par cent par quarante pour mon rasberry pie cinq', attendu: { dit: /Raspberry Pi 5/ } },
      { dire: 'du coup rajoute des aerations sur le dessus', attendu: { dit: /./ } },
    ],
  },
  {
    id: 'pi5-sorties',
    fonction: 'boîtiers électroniques',
    tours: [
      { dire: 'je veux un boitier pour mon raspberry pi 5 avec les sorties pour les cable', attendu: { question: /je propose/i } },
      { dire: 'oui', attendu: { piece: 'boite', mesures: /Raspberry Pi 5/ } },
      { dire: 'hauteur 70', attendu: { piece: 'boite', version: 2, mesures: /Hauteur : 70/ } },
    ],
  },
  {
    id: 'carte-inconnue',
    fonction: 'boîtiers électroniques',
    tours: [
      { dire: 'fais moi un boitier pour mon arduino uno', attendu: { dit: /arduino/i } },
      { dire: 'une boite de 100 par 60 par 30 pour un raspberry pi', attendu: { dit: /Raspberry Pi/ } },
    ],
  },

  // ───────────── Composants à mesurer : ESP32, écran, micro, haut-parleur ─────────────
  {
    id: 'esp32-mesure',
    fonction: 'bibliothèque de composants',
    tours: [
      { dire: 'et un boitier pour esp32', attendu: { question: /modèle|référence|mesure/i } },
      { dire: 'je la mesure', attendu: { question: /Mesure 1 sur/ } },
      { dire: '8,3 cm de long', attendu: { question: /Mesure 2 sur/ } },
      { dire: '7,3 cm de large', attendu: { question: /Mesure 3 sur/ } },
      { dire: 'bon dessine le avec ce que t as', attendu: { dit: /large|marge|mesure/i } },
      { dire: 'prends large partout', attendu: { dit: /./ } },
    ],
  },
  {
    id: 'esp32-ordre-de-dessiner',
    fonction: 'bibliothèque de composants',
    tours: [
      { dire: 'du coup je veux un boitier pour mon esp32', attendu: { question: /modèle|référence|mesure/i } },
      { dire: 'celle de ta liste', attendu: { question: /mesure/i } },
      { dire: 'vas y modelise', attendu: { dit: /large|marge|mesure/i } },
      { dire: 'ok prends large', attendu: { dit: /./ } },
    ],
  },
  {
    id: 'esp32-ecran-inconnu',
    fonction: 'bibliothèque de composants',
    tours: [
      {
        dire: 'je voudrais un boitier pour mon esp32 avec un ecran de 5 pouces un micro et un haut parleur',
        attendu: { dit: /5 pouces/i, pasDit: /53,7|4,6 mm/ },
      },
      { dire: 'laisse tomber', attendu: { dit: /laisse tomber/i } },
    ],
  },
  {
    id: 'esp32-absurde',
    fonction: 'bibliothèque de composants',
    tours: [
      { dire: 'fais moi un boitier pour un esp32', attendu: { question: /modèle|référence|mesure/i } },
      { dire: 'je la mesure', attendu: { question: /Mesure 1 sur/ } },
      { dire: '9000', attendu: { question: /Mesure 1 sur/ } },
      { dire: 'soixante trois', attendu: { question: /Mesure 2 sur/ } },
      { dire: 'stop', attendu: { dit: /laisse tomber|gardées/i } },
    ],
  },

  // ───────────── Recherche des cotes sur Internet, plans ─────────────
  {
    id: 'web-esp32-devkit',
    fonction: 'recherche des cotes',
    marques: ['web', 'lent'],
    tours: [
      {
        dire: 'fais moi un boitier pour un esp32 s3 devkitc 1 avec la prise usb a l arriere',
        attendu: { dit: /cote|trouv|Internet/i, pasDit: /53,7|: 4,6 mm/ },
      },
      { dire: 'prends large partout', attendu: { dit: /./ } },
      { dire: 'oui', attendu: { dit: /./ } },
    ],
  },
  {
    id: 'web-lien',
    fonction: 'recherche des cotes',
    marques: ['web', 'lent'],
    tours: [
      { dire: 'un boitier pour mon esp32', attendu: { question: /modèle|référence|mesure/i } },
      {
        dire: 'cherche avec ce lien : https://docs.espressif.com/projects/esp-dev-kits/en/latest/esp32s3/esp32-s3-devkitc-1/user_guide.html',
        attendu: { dit: /cote|trouv|mesure|plan|lien/i },
      },
    ],
  },
  {
    id: 'web-oled',
    fonction: 'recherche des cotes',
    marques: ['web', 'lent'],
    tours: [
      {
        dire: 'boitier pour un esp32 s3 devkitc 1 avec un ecran oled 1,3 pouce prise usb a l arriere',
        attendu: { dit: /cote|trouv|Internet/i },
      },
      { dire: 'prends large partout', attendu: { dit: /./ } },
    ],
  },

  // ───────────── Le boîtier à écran (le hub) ─────────────
  {
    id: 'hub',
    fonction: 'boîtier à écran (hub)',
    marques: ['lent'],
    tours: [
      {
        dire: 'dessine moi un boitier pour un raspberry pi 5 avec l ecran tactile 7 pouces et la camera grand angle les ports a l arriere',
        attendu: { piece: 'boitier_ecran', dit: /contrôles/ },
      },
      { dire: 'imprime la', attendu: { dit: /laquelle|quelle pièce/i }, pasImprimante: ENVOI },
      { dire: 'imprime la facade', accord: false, attendu: { dit: /./ }, pasImprimante: ENVOI },
      { dire: 'mets le socle dans la file', accord: true, attendu: { dit: /file/i }, imprimante: FILE, pasImprimante: LANCER },
      { dire: 'l ecran plus incline', attendu: { piece: 'boitier_ecran', version: 2 } },
    ],
  },
  {
    id: 'hub-refus',
    fonction: 'boîtier à écran (hub)',
    tours: [
      { dire: 'rajoute un ecran tactile avec une camera', attendu: { dit: /pas de pièce/ } },
      { dire: 'dessine moi un boitier pour un esp32 avec l ecran tactile 7 pouces', attendu: { dit: /Raspberry Pi 5/ } },
    ],
  },

  // ───────────── OrcaSlicer, impression, file d'attente (fausse imprimante) ─────────────
  {
    id: 'imprimer-oui',
    fonction: 'préparation et impression',
    tours: [
      { dire: 'fais moi une boite de 40 par 30 par 15', attendu: { piece: 'boite', taille: [40, 30, 15] } },
      { dire: 'imprime la', accord: true, attendu: { dit: /lancée|imprime/i }, imprimante: ENVOI },
    ],
  },
  {
    id: 'imprimer-non',
    fonction: 'préparation et impression',
    tours: [
      { dire: 'fais moi une boite de 40 par 30 par 15', attendu: { piece: 'boite', taille: [40, 30, 15] } },
      { dire: 'du coup tu peux l imprimer', accord: false, attendu: { dit: /./ }, pasImprimante: ENVOI },
      { dire: 'plus haute', attendu: { piece: 'boite', version: 2 } },
      { dire: 'imprime la version 1', accord: true, attendu: { dit: /v1\.gcode/ }, imprimante: ENVOI },
    ],
  },
  {
    id: 'imprimer-rien',
    fonction: 'préparation et impression',
    tours: [
      // Avec le pronom, la phrase vise une pièce : l'atelier répond qu'il n'y en a pas.
      { dire: 'imprime la', attendu: { dit: /pas de pièce/ }, pasImprimante: ENVOI },
      { dire: 'bon bah mets la dans la file', attendu: { dit: /pas de pièce/ }, pasImprimante: ENVOI },
    ],
  },
  {
    id: 'file-occupee',
    fonction: 'file d’attente',
    imprimanteOccupee: true,
    tours: [
      { dire: 'fais moi une boite de 40 par 30 par 15', attendu: { piece: 'boite', taille: [40, 30, 15] } },
      { dire: 'mets la dans la file', accord: true, attendu: { dit: /file d.attente/i }, imprimante: FILE, pasImprimante: LANCER },
      { dire: 'imprime la', accord: true, attendu: { dit: /file|occupée/i }, pasImprimante: LANCER },
      { dire: 'le plateau est vide lance la suivante', accord: true, attendu: { dit: /./ }, pasImprimante: LANCER },
    ],
  },
  {
    id: 'file-libre',
    fonction: 'file d’attente',
    tours: [
      { dire: 'fais moi une cale de 50 de long 30 de large et 15 de haut', attendu: { piece: 'cale' } },
      { dire: 'rajoute la a la file d attente', accord: true, attendu: { dit: /file d.attente/i }, imprimante: FILE, pasImprimante: LANCER },
      { dire: 'lance la suivante', accord: true, attendu: { dit: /plateau/i }, pasImprimante: LANCER },
      { dire: 'le plateau est vide lance la suivante', accord: true, attendu: { dit: /lancée|imprime/i }, imprimante: LANCER },
    ],
  },
  {
    id: 'file-refus',
    fonction: 'file d’attente',
    tours: [
      { dire: 'fais moi une boite de 40 par 30 par 15', attendu: { piece: 'boite' } },
      { dire: 'mets la en file d attente', accord: false, attendu: { dit: /./ }, pasImprimante: ENVOI },
    ],
  },

  // ───────────── Depuis une enceinte ─────────────
  {
    id: 'enceinte',
    fonction: 'depuis une enceinte',
    tours: [
      { dire: 'Fais-moi une boîte de 80 par 50 par 30.', lieu: 'enceinte', attendu: { piece: 'boite', taille: [80, 50, 30] } },
      { dire: 'Plus haute.', lieu: 'enceinte', attendu: { piece: 'boite', version: 2 } },
      { dire: 'Elle fait combien de haut ?', lieu: 'enceinte', attendu: { dit: /\d+/ } },
      { dire: 'Imprime-la.', lieu: 'enceinte', accord: true, attendu: { dit: /PC ou le téléphone/ }, pasImprimante: ENVOI },
      { dire: 'Mets-la dans la file.', lieu: 'enceinte', accord: true, attendu: { dit: /./ }, pasImprimante: LANCER },
      { dire: 'Le plateau est vide, lance la suivante.', lieu: 'enceinte', accord: true, attendu: { dit: /PC ou le téléphone/ }, pasImprimante: LANCER },
    ],
  },
  {
    id: 'enceinte-dictee',
    fonction: 'depuis une enceinte',
    tours: [
      { dire: 'Fais-moi un boîtier pour mon Rasberry Pie 5.', lieu: 'enceinte', attendu: { question: /je propose/i } },
      { dire: 'Oui.', lieu: 'enceinte', attendu: { piece: 'boite', dit: /^C'est prêt : Boîte de 61 × 94 × 28 mm\. Regarde/, pasDit: /Ventilateur|M2,5/ } },
      { dire: 'Rajoute un trou de huit à l’arrière.', lieu: 'enceinte', attendu: { piece: 'boite', version: 2, dit: /trou de 8 mm à l’arrière/ } },
      { dire: 'Fais-moi un support de téléphone.', lieu: 'enceinte', attendu: { question: /inclinaison/i } },
      { dire: 'Soixante.', lieu: 'enceinte', attendu: { piece: 'support_telephone' } },
    ],
  },
  {
    id: 'enceinte-ailleurs',
    fonction: 'depuis une enceinte',
    tours: [
      { dire: 'Fais-moi une boîte de 60 par 40 par 20.', lieu: 'enceinte', attendu: { piece: 'boite' } },
      { dire: 'Mets de la musique.', lieu: 'enceinte', attendu: { ailleurs: true } },
      { dire: 'Largeur 50.', lieu: 'enceinte', attendu: { piece: 'boite', version: 2, mesures: /Largeur : 50/ } },
    ],
  },

  // ───────────── Depuis le téléphone (images au lieu de l'écran 3D) ─────────────
  {
    id: 'telephone',
    fonction: 'écran 3D et téléphone',
    tours: [
      { dire: 'Fais-moi une boîte de 100 par 70 par 35', lieu: 'telephone', attendu: { piece: 'boite', taille: [100, 70, 35] } },
      { dire: 'Montre la moi', lieu: 'telephone', attendu: { piece: 'boite' } },
      { dire: 'Reessaye', lieu: 'telephone', attendu: { piece: 'boite' } },
      { dire: 'ajoute un couvercle qui s’emboîte', lieu: 'telephone', attendu: { piece: 'boite_couvercle', version: 2, dit: /de 100 × 70 × 35 mm/ } },
      { dire: 'imprime-la', lieu: 'telephone', accord: true, attendu: { dit: /lancée|imprime/i }, imprimante: ENVOI },
    ],
  },
  {
    id: 'telephone-suite',
    fonction: 'écran 3D et téléphone',
    tours: [
      { dire: 'Je voudrais un boîtier pour mon Raspberry Pi 5', lieu: 'telephone', attendu: { question: /je propose/i } },
      { dire: 'Pas de problème', lieu: 'telephone', attendu: { piece: 'boite' } },
      // Le couvercle demande plus de hauteur au-dessus de la carte : l'atelier propose, on dit oui.
      { dire: 'Tu peux ajouter un couvercle ?', lieu: 'telephone', attendu: { question: /agrandis/ } },
      { dire: 'ouais vas-y', lieu: 'telephone', attendu: { piece: 'boite_couvercle', version: 2 } },
      { dire: 'je la vois pas', lieu: 'telephone', attendu: { piece: 'boite_couvercle' } },
      { dire: 'c est quoi les dimensions', lieu: 'telephone', attendu: { dit: /longueur \d+ mm/ } },
    ],
  },

  {
    id: 'corrections',
    fonction: 'demandes floues',
    tours: [
      { dire: 'fais moi une boite de 100 par 80 par 40', attendu: { piece: 'boite', taille: [100, 80, 40] } },
      { dire: 'mets 50', attendu: { dit: /pour quelle mesure/ } },
      { dire: 'en hauteur', attendu: { piece: 'boite', taille: [100, 80, 50], version: 2 } },
      { dire: 'plus longue', attendu: { piece: 'boite', taille: [null, 80, 50], mesures: /Longueur : 1[1-9]\d/ } },
      { dire: 'non moins longue', attendu: { piece: 'boite', taille: [null, 80, 50], mesures: /Longueur : [89]\d\b/ } },
      { dire: 'le couvercle a charniere', attendu: { dit: /pas su faire ce changement/ } },
      { dire: 'fais moi un pot de fleurs', attendu: { dit: QUOI_FAIRE } },
    ],
  },
  {
    id: 'cartes-inconnues',
    fonction: 'boîtiers électroniques',
    tours: [
      { dire: 'fais moi une boite pour mon raspberry pi 4', attendu: { question: /Je n'ai pas les cotes de « raspberry pi 4 »/, pasDit: /Raspberry Pi 5/ } },
      { dire: '100 par 70 par 30', attendu: { piece: 'boite', taille: [100, 70, 30] } },
      { dire: 'et un boitier pour un pi zero', attendu: { question: /Je n'ai pas les cotes/, pasDit: /Raspberry Pi 5/ } },
      { dire: 'laisse tomber', attendu: { dit: /laisse tomber/i } },
    ],
  },

  // ───────────── Versions ─────────────
  {
    id: 'versions',
    fonction: 'pièces de base et versions',
    tours: [
      { dire: 'fais moi une boite de 50 par 50 par 50', attendu: { piece: 'boite', taille: [50, 50, 50] } },
      { dire: 'moins haute', attendu: { piece: 'boite', version: 2 } },
      { dire: 'encore un peu', attendu: { piece: 'boite', version: 3 } },
      { dire: 'annule ca', attendu: { piece: 'boite', version: 2 } },
      { dire: 'reprends la version une', attendu: { piece: 'boite', version: 1, taille: [50, 50, 50] } },
      { dire: 'la version 7', attendu: { dit: /pas de version 7/i } },
      { dire: 'fais la en 60 par 60', attendu: { piece: 'boite', taille: [60, 60, null] } },
    ],
  },
  {
    id: 'suite-floue',
    fonction: 'demandes floues',
    tours: [
      { dire: 'fais moi une boite de 80 par 60 par 40', attendu: { piece: 'boite', taille: [80, 60, 40] } },
      { dire: 'elle est trop petite', attendu: { dit: /longueur|largeur|hauteur|quelle|combien/i } },
      { dire: 'bah en longueur genre 100', attendu: { piece: 'boite', taille: [100, 60, 40] } },
      { dire: 'nickel merci', attendu: { dit: /est faite/ } },
      { dire: 'ah et les parois plus epaisses', attendu: { piece: 'boite', taille: [100, 60, 40] } },
    ],
  },
];

/**
 * Série « examen » : phrases écrites après les corrections de la nuit, jamais regardées pendant
 * qu'elles se faisaient. Elles mesurent si l'atelier tient sur des phrases qu'il n'a pas vues.
 * Passées à part : `JARVIS_ATELIER_SEULEMENT=examen`.
 */
export const DISCUSSIONS_EXAMEN: DiscussionEssai[] = [
  {
    id: 'examen-boite',
    fonction: 'examen',
    tours: [
      { dire: 'tu peux me faire une boite de 9 cm par 6 par 4', attendu: { piece: 'boite', taille: [90, 60, 40] } },
      { dire: 'un peu plus haute stp', attendu: { piece: 'boite', version: 2, taille: [90, 60, null] } },
      { dire: 'ouais non remets comme avant', attendu: { piece: 'boite', version: 1 } },
      { dire: 'largeur soixante dix', attendu: { piece: 'boite', taille: [90, 70, 40] } },
      { dire: 'elle fait combien de large maintenant', attendu: { dit: /70 mm de large/ } },
      { dire: 'ok c est bon merci', attendu: { dit: /./ } },
    ],
  },
  {
    id: 'examen-questions',
    fonction: 'examen',
    tours: [
      { dire: 'j ai besoin d une cale', attendu: { question: /longueur/i } },
      { dire: 'bah je sais pas moi', attendu: { question: /./ } },
      { dire: 'vas y continue', attendu: { dit: /./ } },
      { dire: 'ca me va', attendu: { dit: /./ } },
    ],
  },
  {
    id: 'examen-couvercle',
    fonction: 'examen',
    tours: [
      { dire: 'fais moi un boitier avec couvercle de 80 par 80 par 50', attendu: { piece: 'boite_couvercle', dit: /de 80 × 80 × 50 mm/ } },
      { dire: 'rajoute moi un trou de 12 sur le cote gauche', attendu: { piece: 'boite_couvercle', version: 2, mesures: /12 mm/ } },
      { dire: 'et le meme a droite', attendu: { dit: /./ } },
      { dire: 'le trou de gauche plus petit', attendu: { piece: 'boite_couvercle' } },
    ],
  },
  {
    id: 'examen-pi',
    fonction: 'examen',
    tours: [
      { dire: 'il me faudrait un boitier pour le raspberry pi 5', attendu: { question: /je propose/i } },
      { dire: 'ok ca marche', attendu: { piece: 'boite', mesures: /Raspberry Pi 5/ } },
      { dire: 'mets les prises a droite', attendu: { dit: /droite|agrandis/ } },
      { dire: 'oui', attendu: { dit: /./ } },
      { dire: 'c est quoi ses dimensions', attendu: { dit: /longueur \d+ mm/ } },
    ],
  },
  {
    id: 'examen-flou',
    fonction: 'examen',
    tours: [
      { dire: 'jarvis tu peux m imprimer quelque chose', attendu: { dit: QUOI_FAIRE } },
      { dire: 'un bac pour trier mes vis', attendu: { question: /longueur/i } },
      { dire: '20 par 15 par 4 cm', attendu: { question: /colonnes|cases|compartiments/i } },
      { dire: 'quatre', attendu: { piece: 'bac', taille: [200, 150, 40] } },
      { dire: 'mets en six plutot', attendu: { dit: /./ } },
    ],
  },
  {
    id: 'examen-ailleurs',
    fonction: 'examen',
    tours: [
      { dire: 'fais moi une boite de 50 par 40 par 30', attendu: { piece: 'boite', taille: [50, 40, 30] } },
      { dire: 'c est quoi la meteo demain', attendu: { ailleurs: true } },
      { dire: 'ouvre le bloc notes', attendu: { ailleurs: true } },
      { dire: 'hauteur 35', attendu: { piece: 'boite', taille: [50, 40, 35], version: 2 } },
      { dire: 'genere moi une image d un chat dans une boite', attendu: { ailleurs: true } },
      { dire: 'et un trou de 6 devant', attendu: { piece: 'boite', version: 3, mesures: /6 mm/ } },
    ],
  },
  {
    id: 'examen-impression',
    fonction: 'examen',
    tours: [
      { dire: 'fais moi une entretoise de 10 de diametre et 8 de haut avec un trou de 4', attendu: { piece: 'entretoise', taille: [10, 10, 8] } },
      { dire: 'vas y imprime', accord: false, attendu: { dit: /./ }, pasImprimante: ENVOI },
      { dire: 'bon mets la plutot en file d attente', accord: true, attendu: { dit: /file d.attente/i }, imprimante: FILE, pasImprimante: LANCER },
      { dire: 'le plateau est libre tu peux lancer la suivante', accord: true, attendu: { dit: /lancée|imprime/i }, imprimante: LANCER },
    ],
  },
  {
    id: 'examen-enceinte',
    fonction: 'examen',
    tours: [
      { dire: 'Tu peux me faire un socle carré de 60 ?', lieu: 'enceinte', attendu: { dit: /socle/i } },
      { dire: 'Oui.', lieu: 'enceinte', attendu: { dit: /./ } },
      { dire: 'Elle est trop basse.', lieu: 'enceinte', attendu: { dit: /./ } },
      { dire: 'Lance l’impression.', lieu: 'enceinte', accord: true, attendu: { dit: /PC ou le téléphone/ }, pasImprimante: ENVOI },
    ],
  },
];

/**
 * Deuxième série « examen », écrite après les corrections tirées de la première, et passée une
 * seule fois : `JARVIS_ATELIER_SEULEMENT=examen2`.
 */
export const DISCUSSIONS_EXAMEN_2: DiscussionEssai[] = [
  {
    id: 'examen2-bac',
    fonction: 'examen 2',
    tours: [
      { dire: 'bon jarvis il me faut un casier pour mes forets', attendu: { question: /longueur/i } },
      { dire: 'vingt centimetres', attendu: { question: /largeur/i } },
      { dire: 'dix', attendu: { question: /hauteur/i } },
      { dire: 'la meme chose que la largeur', attendu: { dit: /./ } },
      { dire: 'bah 5 cm alors', attendu: { dit: /./ } },
    ],
  },
  {
    id: 'examen2-boite',
    fonction: 'examen 2',
    tours: [
      { dire: 'dessine moi une boite de 7 par 7 par 3 cm', attendu: { piece: 'boite', taille: [70, 70, 30] } },
      { dire: 'en fait fais la plus longue de 2 cm', attendu: { piece: 'boite', taille: [90, 70, 30], version: 2 } },
      { dire: 'perce un trou de 10 au milieu du fond', attendu: { piece: 'boite', version: 3, mesures: /10 mm/ } },
      { dire: 'non enleve le', attendu: { piece: 'boite', taille: [90, 70, 30] } },
      { dire: 'tu peux la lancer', accord: true, attendu: { dit: /lancée|imprime/i }, imprimante: ENVOI },
    ],
  },
  {
    id: 'examen2-equerre',
    fonction: 'examen 2',
    tours: [
      { dire: 'j aurais besoin d une equerre de 50 par 50', attendu: { dit: /équerre/i } },
      { dire: 'ouais ouais', attendu: { dit: /./ } },
      { dire: 'plus epaisse', attendu: { dit: /./ } },
    ],
  },
  {
    id: 'examen2-pi',
    fonction: 'examen 2',
    tours: [
      { dire: 'fais moi un boitier pour mon pi 5 avec un couvercle', attendu: { dit: /Raspberry Pi 5/ } },
      { dire: 'vas y', attendu: { dit: /./ } },
      { dire: 'rajoute un trou pour le cable a gauche', attendu: { dit: /./ } },
      { dire: 'c est quoi la hauteur', attendu: { dit: /\d+ mm de haut/ } },
    ],
  },
  {
    id: 'examen2-esp',
    fonction: 'examen 2',
    tours: [
      { dire: 'il me faut un boitier pour une esp32', attendu: { question: /modèle|référence|mesure/i } },
      { dire: 'je sais pas c est quoi comme modele', attendu: { dit: /./ } },
      { dire: 'bon je la mesure', attendu: { question: /Mesure 1 sur/ } },
      { dire: 'six centimetres', attendu: { question: /Mesure 2 sur/ } },
      { dire: 'attends je reviens', attendu: { dit: /./ } },
      { dire: 'trois centimetres', attendu: { dit: /./ } },
    ],
  },
  {
    id: 'examen2-ailleurs',
    fonction: 'examen 2',
    tours: [
      { dire: 'fais moi un crochet', attendu: { question: /./ } },
      { dire: 'mets pause', attendu: { ailleurs: true } },
      { dire: 'fais moi un crochet', attendu: { question: /./ } },
      { dire: 'ok', attendu: { dit: /./ } },
      { dire: 'tu peux me rappeler d acheter du filament', attendu: { ailleurs: true } },
    ],
  },
  {
    id: 'examen2-telephone',
    fonction: 'examen 2',
    tours: [
      { dire: 'Fais-moi une cale de 40 par 20', lieu: 'telephone', attendu: { dit: /cale/i } },
      { dire: 'Oui', lieu: 'telephone', attendu: { dit: /./ } },
      { dire: 'Envoie moi les images', lieu: 'telephone', attendu: { dit: /./ } },
      { dire: 'Mets la dans la file', lieu: 'telephone', accord: true, attendu: { dit: /file d.attente/i }, imprimante: FILE, pasImprimante: LANCER },
    ],
  },
];

/** Nombre de phrases (tours) du jeu d'essai. */
export const NOMBRE_DE_PHRASES = DISCUSSIONS.reduce((n, d) => n + d.tours.length, 0);
