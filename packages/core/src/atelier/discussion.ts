/**
 * Atelier 3D dans la discussion : ce que veut dire une phrase, sans modèle et sans rien lancer.
 *
 * L'état de l'atelier vit dans la discussion elle-même : la réponse de Jarvis porte un champ
 * `atelier` (question en cours, ou pièce avec ses versions). La phrase suivante est lue avec ce
 * qui précède : une réponse à la question, « plus haut », « trou de 5 », « imprime la version 2 ».
 * Le rendu (OpenSCAD), le contrôle, le tranchage et l'imprimante sont faits ailleurs, côté PC ;
 * ici, seulement des décisions.
 */
import { estChoix, fabriquer, gabarit, GABARITS, type Gabarit, type Mesure, type MesureNombre, type Valeurs } from './gabarits.js';
import { appliquerDecoupes, avecDecoupes, decoupesAffichees, decoupesDe, lireDecoupes, sePerce } from './decoupes.js';
import { ajoutsAffiches, appliquerAjouts, avecAjouts, lireAjouts } from './ajouts.js';
import { ajouterMesure, composant, composantNomme, lireMesure, questionMesure, type MesuresComposants } from './composants.js';
import { comprendre, lireMesures, lireReponse, plier, prochaineQuestion } from './lecture.js';

/** Une version rendue de la pièce. Les fichiers sont des noms simples, dans le dossier de la pièce. */
export interface AtelierVersionInfo {
  numero: number;
  /**
   * Modèle de cette version, s'il diffère de celui de la pièce (une boîte devenue boîte à couvercle).
   * Absent : celui de la pièce.
   */
  gabarit?: string;
  valeurs: Valeurs;
  /** « Boîte de 80 × 50 × 30 mm. » */
  fiche: string;
  mesures: { nom: string; valeur: string }[];
  /** Taille annoncée par le gabarit (mm), pour le contrôle du STL dans la fenêtre. */
  taille: [number, number, number];
  /** `v2.stl` ; `null` si OpenSCAD n'a pas pu la rendre. */
  stl: string | null;
  /** Vue de trois quarts (`v2.png`). */
  image?: string;
  /** Vue de dessus (`v2-dessus.png`), pour le téléphone. */
  imageDessus?: string;
  /** « Hauteur : 30 → 38 mm. » */
  changement?: string;
  /** Lus dans le fichier tranché, une fois tranchée. */
  temps?: string;
  filament?: string;
}

export type AtelierEtat =
  | { etape: 'question'; gabarit: string; valeurs: Valeurs; mesure: string }
  /**
   * Une mesure de composant demandée (pied à coulisse). `reprise` : la phrase à relire une fois la
   * mesure gardée, avec la pièce qui était à l'écran.
   */
  | { etape: 'mesure'; composant: string; champ: string; reprise: { texte: string; piece: Extract<AtelierEtat, { etape: 'piece' }> | null } }
  /**
   * La pièce demandée ne tenait pas (une carte trop grande pour la boîte) : Jarvis propose d'autres
   * cotes et attend « oui ». `base` : la pièce qui était à l'écran, s'il y en avait une.
   */
  | {
      etape: 'proposition';
      gabarit: string;
      valeurs: Valeurs;
      base: Extract<AtelierEtat, { etape: 'piece' }> | null;
      changement?: string;
    }
  | {
      etape: 'piece';
      gabarit: string;
      nom: string;
      /** Nom du dossier de la pièce, sous le dossier de l'atelier. */
      dossier: string;
      versions: AtelierVersionInfo[];
      versionChoisie: number;
      /** Plateau dessiné et limite de la pièce (mm). */
      plateau: { x: number; y: number };
    };

export type AtelierDecision =
  | { kind: 'rien' }
  /** Réponse sans rendu : question, refus, pièce inconnue. `etat` : la question posée. */
  | { kind: 'dire'; texte: string; etat?: AtelierEtat }
  /** Rendre une pièce : nouvelle (`base` absent) ou nouvelle version de `base`. */
  | {
      kind: 'fabriquer';
      gabarit: Gabarit;
      valeurs: Valeurs;
      base?: Extract<AtelierEtat, { etape: 'piece' }>;
      changement?: string;
    }
  | { kind: 'imprimer'; etat: Extract<AtelierEtat, { etape: 'piece' }>; numero: number }
  /** « mets-la dans la file » : envoyée sans être lancée, ajoutée à la file d'attente de Moonraker. */
  | { kind: 'file'; etat: Extract<AtelierEtat, { etape: 'piece' }>; numero: number }
  /** « le plateau est vide, lance la suivante » : la première pièce de la file. */
  | { kind: 'lancerSuivante' }
  | { kind: 'choisir'; etat: Extract<AtelierEtat, { etape: 'piece' }>; numero: number }
  /**
   * Une mesure donnée : le PC la garde (`composants-mesures.json`), puis relit `reprise.texte` avec
   * `reprise.piece` et les mesures à jour (question suivante, ou la pièce).
   */
  | { kind: 'mesure'; composant: string; champ: string; valeur: number; reprise: { texte: string; piece: Extract<AtelierEtat, { etape: 'piece' }> | null } };

/** Ce que le PC sait en plus de la discussion : les mesures de composants données par l'utilisateur. */
export interface ContexteAtelier {
  mesures?: MesuresComposants;
}

/** Nombre de messages relus pour retrouver la pièce en cours. */
const RECUL = 8;

/** Dernier état de l'atelier dans la discussion (question ou pièce), s'il est récent. */
export function dernierAtelier(messages: readonly { role: string; atelier?: AtelierEtat }[]): AtelierEtat | null {
  const recents = messages.slice(-RECUL);
  let premiere = true;
  for (let i = recents.length - 1; i >= 0; i -= 1) {
    const message = recents[i]!;
    if (message.role !== 'assistant') continue;
    // Une question ne vaut que si c'est la dernière réponse de Jarvis ; une pièce reste
    // à l'écran quelques échanges.
    if (message.atelier && (premiere || message.atelier.etape === 'piece')) return message.atelier;
    premiere = false;
  }
  return null;
}

const VERBES =
  '(?:fais|fait|faire|refais|imprime|imprimer|dessine|dessiner|fabrique|fabriquer|modelise|modeliser|cree|creer|concois|concevoir)';
/** « fais-moi un… », « tu peux m'imprimer une… », « je voudrais une boîte à imprimer ». */
const DEMANDE = new RegExp(
  `^(?:jarvis )?(?:(?:est ce que )?(?:tu peux|peux tu|pourrais tu|tu pourrais) )?(?:me |m )?${VERBES}(?: moi| nous)?(?: en 3d)? (?:un|une|des|deux|trois|quatre|le|la|mon|ma)\\b`,
);
const VOULOIR =
  /^(?:jarvis )?(?:je voudrais|j aimerais|il me faut|il me faudrait|j ai besoin d|j aurais besoin d|je veux|je cherche|on va faire|on fait|on peut faire|on pourrait faire|tu me fais|tu peux me faire|fais nous) (?:un|une|des)\b/;
const EN_3D = /\b(?:en 3d|imprimante 3d|impression 3d|a imprimer|pour l imprimante)\b/;
/**
 * Une pièce nommée sans verbe : « une boîte de 100 par 60 par 30 pour un Raspberry Pi ». Il faut
 * l'article en tête, une pièce connue et une cote (« 100 par 60 », « 12 cm ») : « une boîte de
 * 6 œufs » n'en est pas une.
 */
function commenceParLaPiece(t: string, g: Gabarit): boolean {
  const debut = t.replace(/^(?:un|une) /, '');
  return [...g.mots, g.nom].some((mot) => debut.startsWith(plier(mot)));
}
const COTE = /\d+(?:\.\d+)? ?(?:mm|millimetres?|cm|centimetres?|x|par|sur|fois)\b/;
/**
 * Objet d'atelier que la bibliothèque n'a pas (encore) : la demande vient quand même à l'atelier,
 * qui dit ce qu'il sait faire, au lieu de partir au cerveau. Le mot doit suivre l'article
 * (« dessine-moi un support ») : « dessine-moi un chat sur un support » reste une image.
 */
const OBJET_ATELIER =
  /^(?:(?:petit|petite|grand|grande|nouveau|nouvelle|autre|vrai|bon|bonne) )?(?:boitiers?|boites?|coffrets?|supports?|caches?|passe cables?|serre cables?|range cables?|guide cables?|socles?|coques?|etuis?|facades?|adaptateurs?|clips?|attaches?|chassis|pieds?|pieces?(?! (?:de theatre|de monnaie|montee|jointe|d identite)))\b/;
/** Questions : « quelle fenêtre est active ? » ne perce pas de fenêtre dans la pièce à l'écran. */
const QUESTION = /^(?:quel|quelle|quels|quelles|qu est ce|qu est ce que|pourquoi|comment|combien|ou est|ou sont|c est quoi|a quoi|qui)\b/;
/**
 * Ordre de changement sur la pièce à l'écran. S'il ne donne rien de lisible, l'atelier répond quand
 * même (ce qu'il sait faire) : la phrase ne part pas au cerveau, qui ne connaît pas la pièce.
 */
const ORDRE =
  /^(?:ajoute|ajouter|rajoute|mets|met|mettre|fais|fait|faire|enleve|retire|supprime|agrandis|agrandir|grandis|retrecis|reduis|elargis|allonge|raccourcis|deplace|decale|perce|change|modifie|augmente|diminue|baisse|remonte|descends|tourne|arrondis|epaissis|affine|creuse|bouche)\b/;
/**
 * Ce qui ne vise jamais la pièce à l'écran, même avec « fenêtre », « écran » ou « câble » dedans :
 * un verbe d'un autre domaine en tête (« ferme la fenêtre », « branche le câble »), ou un sujet
 * d'un autre domaine (« mets l'écran en veille », « ouvre la fenêtre de Spotify »).
 */
const VERBE_AUTRE =
  /^(?:ferme|fermer|ouvre|ouvrir|eteins|allume|lance|joue|affiche|montre|branche|debranche|cherche|lis|envoie|ecris|appelle|redemarre|demarre|arrete|coupe|regarde|dis|explique|traduis|calcule|rappelle|note|enregistre|sauvegarde|copie|colle|installe|telecharge|active|desactive|connecte|deconnecte|mute|baisse le son|monte le son)\b/;
const SUJET_AUTRE =
  /\b(?:en veille|en route|en marche|en pause|en lecture|en sourdine|plein ecran|capture|photo|robot|musique|chanson|morceau|volume|son|minuteur|alarme|reveil|rendez vous|agenda|mail|mails|message|lumiere|lampe|chauffage|spotify|youtube|navigateur|application|appli|programme|fichier|dossier|document|onglet|bloc notes|television|tele|pc|ordinateur|telephone portable)\b/;
/** « agrandis-la », « mets-la plus haute » : le pronom vise la pièce (« mets la musique » non). */
const PRONOM_PIECE = /^\S+ (?:la|le|les|lui)(?: (?:plus|moins|un peu|tres|en|a|au|de|pour|sur|\d)\b|$)/;
/** Ce dont parle une pièce : faces, matière, découpes, composants qu'elle tient. */
const VOCABULAIRE_PIECE =
  /\b(?:pieces?|boites?|boitiers?|couvercles?|parois?|fond|dessus|dessous|devant|avant|arriere|cote|cotes|gauche|droite|bords?|coins?|trous?|fentes?|encoches?|fenetres?|ouvertures?|decoupes?|passages?|aerations?|grilles?|ventilations?|cables?|prises?|ports?|plots?|bossages?|inserts?|vis|nervures?|rebords?|levres?|emboitements?|raspberry|rpi|pi ?5|esp ?32|arduino|cartes?|ecrans?|cameras?|objectifs?|haut parleurs?|micros?|ampli|oled|ventilateurs?|leds?|boutons?|aimants?|pieds?|charnieres?)\b/;
/** Mots qui ne disent rien d'autre que la pièce : « fais-la en 100 par 60 », « mets 50 ». */
const MOTS_NEUTRES = new Set(
  'jarvis mets met mettre fais fait faire la le les l lui a au aux de du des d en et un une plutot stp s il te plait plus moins peu tres change changer modifie passe passer mm cm millimetre millimetres centimetre centimetres x par sur fois ok oui alors bon euh maintenant je veux voudrais prefere qu elle soit fasse pour avec'.split(
    ' ',
  ),
);
/** Accord à une proposition, dit comme on parle : « pas de problème », « ouais vas-y », « nickel ». */
const ACCORD =
  /^(?:(?:bah|ben|alors|bon|eh bien|ah|bien|ouais|oui|ok) )*(?:oui|ouais|ouai|ok|okay|d accord|daccord|vas y|va s y|go|allez|allez y|pas de (?:probleme|souci|soucis)|aucun (?:probleme|souci)|bien sur|evidemment|bien evidemment|parfait|nickel|top|super|ca marche|ca me va|ca roule|c est bon|c est parfait|carrement|exactement|tout a fait|volontiers|je veux bien|avec plaisir|fais le|fais la|fais comme ca|agrandis la|agrandis le|valide|je valide|c est ok|yes|d acc|dac|impec|impeccable|entendu|ca marche|vas y fonce|fonce)\b/;
/** Un simple « ok » (et rien d'autre) : « ouais vas-y », « super merci », « c'est bon ». */
const ACQUIESCEMENT =
  /^(?=.*\b(?:oui|ouais|ok|okay|vas y|go|d accord|d acc|c est bon|ca marche|yes)\b)(?:(?:oui|ouais|ok|okay|d accord|vas y|go|super|parfait|nickel|top|merci|beaucoup|cool|c est bon|c est parfait|ca marche|ca me va|impec|impeccable|bien|tres|genial|yes|d acc|carrement|excellent|parfait|nickel)\s*)+$/;
/** « fais en sorte que ça rentre », « agrandis-la pour que le Pi tienne » : c'est accepter d'agrandir. */
const FAIRE_TENIR = /\b(?:fai[st] en sorte (?:que|qu)|pour que|faut que)\b.*\b(?:rentre|rentrent|tienne|tiennent|tient|passe|passent)\b|^agrandi[st]?\b/;
/** Refus d'une proposition. */
const REFUS = /^(?:non|nan|pas (?:comme ca|d accord|question)|surtout pas|laisse tomber|annule|oublie|stop|non merci)\b/;
/**
 * « ajoute un couvercle », « et un couvercle aussi », « il faudrait un couvercle qui se clipse »
 * (phrase déjà ramenée à un ordre), sur une boîte à l'écran. Pas « sans couvercle », ni une
 * question sur le couvercle.
 */
function couvercleDemande(tn: string): boolean {
  if (!/\bcouvercles?\b/.test(tn)) return false;
  if (/\b(?:sans|enleve|retire|supprime|vire|pas de|plus de) (?:le |les |de |un |son )?couvercle/.test(tn)) return false;
  if (/\bcouvercle (?:est|sera|fait|tient)\b/.test(tn)) return false;
  return /^(?:ajoute|rajoute|mets|met|fais|fait|un|une|avec|et)\b/.test(tn);
}
/** « remets la version d'avant », « annule le dernier changement », « reviens en arrière ». */
const VERSION_AVANT =
  /\b(?:version (?:d avant|precedente)|annule (?:le |la |mon |ma |ce |cette )?(?:dernier |derniere )?(?:changement|modification)|reviens en arriere|retour en arriere|annule ca|defais (?:le|ca)|comme avant)\b/;
/** Question sur la taille de la pièce. */
const DIMENSIONS = /\b(?:dimensions?|taille|mesures?|cotes|grande|haute?|large|longue?|epaisse|hauteur|largeur|longueur)\b/;
/** Une question, même posée sans mot interrogatif en tête : « elle fait combien de haut ? ». */
const QUESTION_TAILLE = /\bcombien\b|^(?:c est quoi|quelles? sont|donne moi|dis moi)\b/;
/** « plus grande », « agrandis-la », « trop petite » sans dire la mesure. */
const PLUS_GRANDE = /\b(?:plus grande?|plus grosse?|trop petite?|agrandis(?: la| le)?)\b/;
const ANNULER = /^(?:annule|laisse tomber|oublie|stop|arrete|non merci|pas la peine)\b/;
const OUI = /^(?:oui|ok|d accord|ca me va|vas y|va pour ca|parfait|c est bon|ca marche)\b/;

function majuscule(texte: string): string {
  return texte ? `${texte[0]!.toUpperCase()}${texte.slice(1)}` : texte;
}

function nombre(x: number): string {
  return String(Math.round(x * 10) / 10).replace('.', ',');
}

/** « 30 mm », « 60° », « 4 ». */
export function valeurDite(mesure: Mesure, valeur: number | string): string {
  if (estChoix(mesure)) return valeur === 'carre' ? 'carré' : String(valeur);
  const x = nombre(Number(valeur));
  return mesure.unite === 'mm' ? `${x} mm` : mesure.unite === '°' ? `${x}°` : x;
}

/** Les mesures affichées à côté de la pièce. */
export function mesuresAffichees(g: Gabarit, valeurs: Valeurs): { nom: string; valeur: string }[] {
  const mesures = g.mesures.filter((m) => m.id in valeurs).map((m) => ({ nom: majuscule(m.nom), valeur: valeurDite(m, valeurs[m.id]!) }));
  return [...mesures, ...ajoutsAffiches(valeurs), ...decoupesAffichees(g.id, valeurs)];
}

/** La pièce a déjà sa propre mesure « trou » (entretoise, équerre) : un trou sans face, c'est elle. */
function aSonTrou(g: Gabarit): boolean {
  return g.mesures.some((m) => m.id === 'trou' || m.id === 'vis');
}

/** Liste des pièces que l'atelier sait faire, pour une demande hors bibliothèque. */
export function piecesConnues(): string {
  const noms = GABARITS.map((g) => g.nom);
  return `${noms.slice(0, -1).join(', ')} et ${noms[noms.length - 1]}`;
}

/** Nouvelle pièce demandée ? (règles seules). */
export function demandePiece(
  text: string,
  mesures: MesuresComposants = {},
): { gabarit: Gabarit | null; valeurs: Valeurs; erreurs?: string[]; question?: { composant: string; champ: string; texte: string } } | null {
  const t = plier(text).replace(/^jarvis ,? ?/, '');
  const verbe = DEMANDE.exec(t) ?? VOULOIR.exec(t);
  const demande = comprendre(text);
  const sansVerbe = !verbe && demande.gabarit !== null && commenceParLaPiece(t, demande.gabarit) && COTE.test(t);
  if (!verbe && !sansVerbe) return null;
  if (demande.gabarit) {
    // « … avec un trou de 8 à l'arrière » : les découpes sont lues à part, et retirées de la
    // phrase avant de lire les mesures (le 8 n'est pas une longueur).
    const g = demande.gabarit;
    // « … avec quatre bossages à insert M3 » : les ajouts de matière aussi, lus avant les découpes
    // (« l'avant-trou » des plots n'est pas un trou à percer).
    // « un boîtier pour mon Raspberry Pi 5 » : la carte nommée va sur ses plots, même sans le mot.
    const nommee = ['boite', 'boite_couvercle'].includes(g.id) ? composantNomme(` ${plier(text)} `) : null;
    const carteSansPlots = nommee && composant(nommee.id)?.carte && !/\bplots?\b/.test(plier(text));
    const matiere = lireAjouts(carteSansPlots ? `${plier(text)} plots` : plier(text));
    const opsMatiere = matiere.ops.filter((op) => op.action !== 'enlever');
    const lu = lireDecoupes(matiere.reste, { exigerFace: aSonTrou(g) });
    const ajouts = lu.ops.filter((op) => op.action !== 'enlever');
    if (!ajouts.length && !opsMatiere.length) return { gabarit: g, valeurs: demande.valeurs };
    let valeurs = lireMesures(lu.reste, g).valeurs;
    if (opsMatiere.length) {
      const m = appliquerAjouts(g, valeurs, opsMatiere, mesures);
      if (m.question) return { gabarit: g, valeurs, question: m.question };
      if (m.erreurs.length) return { gabarit: g, valeurs, erreurs: m.erreurs };
      valeurs = avecAjouts(valeurs, m.ajouts);
    }
    if (!ajouts.length) return { gabarit: g, valeurs };
    const r = appliquerDecoupes(g, [], ajouts);
    if (r.erreurs.length) return { gabarit: g, valeurs, erreurs: r.erreurs };
    return { gabarit: g, valeurs: avecDecoupes(valeurs, r.decoupes) };
  }
  // Verbe d'atelier sans pièce connue : seulement si la phrase parle d'impression 3D, ou si l'objet
  // demandé est un objet d'atelier (« imprime-moi un support pour mon écran », « un passe-câble »).
  // « Dessine-moi un chat » reste une image.
  // `DEMANDE` et `VOULOIR` s'arrêtent après l'article : ce qui suit est l'objet demandé.
  const objet = verbe ? t.slice(verbe[0].length).trim() : '';
  return EN_3D.test(t) || OBJET_ATELIER.test(objet) ? { gabarit: null, valeurs: {} } : null;
}

function horsBornes(mesure: Mesure, valeur: number | string): string | null {
  if (estChoix(mesure) || typeof valeur !== 'number') return null;
  if (valeur < mesure.min || valeur > mesure.max) {
    return `${majuscule(mesure.nom)} : ${valeurDite(mesure, valeur)}, hors des limites (de ${valeurDite(mesure, mesure.min)} à ${valeurDite(mesure, mesure.max)}).`;
  }
  if (mesure.entier && !Number.isInteger(valeur)) return `${majuscule(mesure.nom)} : un nombre entier, s'il te plaît.`;
  return null;
}

function demanderOuFabriquer(g: Gabarit, valeurs: Valeurs, avant = ''): AtelierDecision {
  const question = prochaineQuestion(g, valeurs);
  if (!question) return { kind: 'fabriquer', gabarit: g, valeurs };
  return {
    kind: 'dire',
    texte: `${avant}${question.texte}`,
    etat: { etape: 'question', gabarit: g.id, valeurs, mesure: question.mesure },
  };
}

/** Changements relatifs : « plus haut », « trou plus gros », « moins large ». */
const RELATIFS: { mots: RegExp; ids: string[] }[] = [
  { mots: /\btrou(?:s)? (?:un peu )?(?:plus|moins) (?:gros|grand|large|petit)|\b(?:plus|moins) (?:gros|grand|petit) (?:le |les )?trou/, ids: ['trou', 'vis'] },
  { mots: /\b(?:plus|moins) (?:haut|haute|bas|basse)\b/, ids: ['hauteur', 'dos', 'haut', 'branche1'] },
  { mots: /\b(?:plus|moins) (?:large|etroit)\b/, ids: ['largeur'] },
  { mots: /\b(?:plus|moins) (?:long|longue|court|courte)\b/, ids: ['longueur', 'branche1'] },
  { mots: /\b(?:plus|moins) (?:profond|profonde)\b/, ids: ['profondeur', 'base'] },
  { mots: /\b(?:plus|moins) (?:epais|epaisse|fin|fine)\b/, ids: ['paroi', 'epaisseur'] },
  { mots: /\b(?:plus|moins) (?:incline|inclinee|penche)\b/, ids: ['angle'] },
];
const PLUS_PETIT = /\b(?:moins (?:gros|grand|large|long|longue|haut|haute|profond|profonde|epais|epaisse|incline|inclinee|penche)|plus (?:petit|bas|basse|etroit|court|courte|fin|fine))\b/;

function arrondi(x: number): number {
  return x >= 10 ? Math.round(x) : Math.round(x * 10) / 10;
}

/** Nouvelle valeur d'une mesure : +25 % (au moins 2 mm, 1 mm pour un trou), ou −20 %. */
function relatif(mesure: MesureNombre, actuelle: number, plus: boolean): number {
  if (mesure.unite === '°') return actuelle + (plus ? -10 : 10); // « plus incliné » : dossier plus couché
  if (mesure.entier) return actuelle + (plus ? 1 : -1);
  const pas = mesure.id === 'trou' || mesure.id === 'vis' ? 1 : 2;
  return plus ? arrondi(Math.max(actuelle * 1.25, actuelle + pas)) : arrondi(Math.min(actuelle * 0.8, actuelle - pas / 2));
}

function changementDe(g: Gabarit, avant: Valeurs, apres: Valeurs): string {
  return g.mesures
    .filter((m) => m.id in apres && avant[m.id] !== apres[m.id])
    .map((m) => `${majuscule(m.nom)} : ${avant[m.id] === undefined ? '—' : valeurDite(m, avant[m.id]!)} → ${valeurDite(m, apres[m.id]!)}`)
    .join(', ');
}

const IMPRIMER =
  /^(?:imprime|imprimes|lance)(?: (?:la|le|les))?(?: (?:version|v) ?(\d+))?(?: (?:du|de la|de l|de|des) ([a-z0-9 ]+))?$|^(?:lance|lancer) l impression(?: de la (?:version|v) ?(\d+))?$|^(?:imprime|lance l impression d(?:e|u)) (?:la |le |l )?([a-z0-9 ]+)$/;

/** Numéro de la version à imprimer, ou `null` si la phrase n'est pas « imprime-la ». */
function numeroAImprimer(t: string, etat: Extract<AtelierEtat, { etape: 'piece' }>): number | null {
  const m = IMPRIMER.exec(t);
  if (!m) return null;
  const nom = m[2] ?? m[4];
  // « imprime la boîte » : seulement le nom de la pièce à l'écran (« imprime le fichier x.gcode » reste au lot B).
  if (nom && !plier(etat.nom).startsWith(nom.trim()) && !/^(?:version|v) ?\d+$/.test(nom.trim())) return null;
  return Number(m[1] ?? m[3] ?? etat.versionChoisie);
}
const FILE =
  /^(?:mets|met|mettre|ajoute|ajouter|rajoute|place|envoie|envoyer|balance)(?: (?:la|le|les))?(?: (?:version|v) ?(\d+))? (?:dans|a|en|sur) (?:la )?(?:file|liste) d attente$|^(?:mets|met|mettre|ajoute|ajouter|rajoute|place|envoie|envoyer|balance)(?: (?:la|le|les))?(?: (?:version|v) ?(\d+))? (?:dans|a|en|sur) la file$/;

/** Numéro de la version à mettre dans la file, ou `null`. */
function numeroEnFile(t: string, etat: Extract<AtelierEtat, { etape: 'piece' }>): number | null {
  const m = FILE.exec(t);
  if (!m) return null;
  return Number(m[1] ?? m[2] ?? etat.versionChoisie);
}

/**
 * « le plateau est vide, lance la suivante » : la phrase doit dire que le plateau est vide **et**
 * demander la pièce suivante de la file. Sans « plateau vide », la file n'est jamais relancée.
 */
export function plateauVideLanceSuivante(text: string): boolean {
  const t = plier(text);
  const vide = /\bplateau (?:est )?(?:bien |maintenant )?(?:vide|libre|degage)\b/.test(t);
  const lance = /\b(?:lance|lances|lancer|imprime|demarre|demarrer)\b.*\b(?:suivante|suivant|prochaine|prochain|file|piece d apres)\b/.test(t);
  return vide && lance;
}

const CHOISIR = /\b(?:reviens|retourne|revenir|garde|prends|choisis) (?:a )?la (?:version|v) ?(\d+)\b/;

const INFINITIFS: Record<string, string> = {
  ajouter: 'ajoute', rajouter: 'rajoute', mettre: 'mets', remettre: 'remets', faire: 'fais', percer: 'perce',
  agrandir: 'agrandis', elargir: 'elargis', allonger: 'allonge', rallonger: 'rallonge', augmenter: 'augmente',
  diminuer: 'diminue', reduire: 'reduis', baisser: 'baisse', retirer: 'retire', enlever: 'enleve', supprimer: 'supprime',
  imprimer: 'imprime', deplacer: 'deplace', creuser: 'creuse', rehausser: 'rehausse', raccourcir: 'raccourcis',
};

/**
 * Une demande dite comme on parle, ramenée à l'ordre que lisent les règles :
 * « tu peux ajouter un couvercle ? » → « ajoute un couvercle », « il faudrait un trou… » →
 * « ajoute un trou… », « elle est trop basse » → « plus haute », « envoie-la à l'imprimante » →
 * « imprime la ». Texte déjà plié ; rien d'autre ne change.
 */
export function normaliserOrdre(t: string): string {
  let s = t.replace(/\s*,\s*$/, '').trim();
  s = s.replace(/^(?:(?:bon|alors|ok|euh|et|aussi|maintenant|du coup|ensuite|puis|bah|ben|stp|jarvis)\s*,?\s+)+/, '');
  s = s.replace(/\s*,?\s*(?:s il te plait|s il vous plait|stp|svp|merci|aussi)\s*$/, '');
  s = s.replace(/^(?:est ce que |est ce qu )?(?:tu (?:peux|pourrais|veux bien|voudrais bien)|peux tu|pourrais tu|tu me|tu lui|tu nous)\s+(?:me |m |lui |nous )?/, '');
  // « l imprimer » → « imprimer » (le pronom vise la pièce).
  s = s.replace(/^(?:l |la |le )(?=[a-z]+er\b)/, '');
  s = s.replace(
    /^(?:il (?:me |nous |lui |y )?(?:faudrait|faut|manque)|j aimerais|je voudrais|je veux|ce serait bien d avoir|on pourrait (?:avoir|mettre|ajouter)|on peut (?:avoir|mettre|ajouter)|rajoute moi|ajoute moi|mets moi|mets lui|rajoute lui|ajoute lui)\s+(?=(?:un|une|des|deux|trois|quatre|le|la|les|l)\b)/,
    'ajoute ',
  );
  s = s.replace(/^([a-z]+)\b/, (mot) => INFINITIFS[mot] ?? mot);
  // « envoie-la à l'imprimante », « lance-la » : imprimer (« lance la suivante » reste à part).
  s = s.replace(/^(?:envoie|envoyer|balance|lance)(?: la| le)? (?:a |vers |sur |dans )?l imprimante$/, 'imprime la');
  // « (elle est) trop basse » → « plus haute », etc.
  const trop: [RegExp, string][] = [
    [/\btrop (?:basse|bas)\b/, 'plus haute'],
    [/\btrop (?:haute|haut)\b/, 'moins haute'],
    [/\btrop (?:etroite|etroit)\b/, 'plus large'],
    [/\btrop large\b/, 'moins large'],
    [/\btrop (?:courte|court)\b/, 'plus longue'],
    [/\btrop (?:longue|long)\b/, 'moins longue'],
    [/\btrop (?:fine|fin|mince)s?\b/, 'plus epaisse'],
  ];
  for (const [re, ordre] of trop) {
    if (re.test(s) && /^(?:(?:elle|il|la boite|le boitier|la piece|c|ca) (?:est|fait) )?(?:un peu |beaucoup )?trop\b/.test(s)) return ordre;
  }
  // « aérations », « ventilation » : des trous d'aération.
  if (!/\btrous?\b/.test(s)) s = s.replace(/\b(?:des |les )?(?:aerations?|ventilations?|grilles? d aeration)\b/, 'des trous d aeration');
  return s.replace(/\s+/g, ' ').trim();
}

/** « augmente la hauteur de 10 mm », « 10 mm de plus en largeur », « plus haute de 5 » : ± N sur une mesure. */
function lireDelta(t: string, g: Gabarit, valeurs: Valeurs): { id: string; avant: number; apres: number } | null {
  const N = String.raw`(\d+(?:\.\d+)?) ?(mm|millimetres?|cm|centimetres?)?`;
  const MOTS: Record<string, RegExp> = {
    hauteur: /hauteur|haut|haute|profondeur|profond|profonde/,
    largeur: /largeur|large/,
    longueur: /longueur|long|longue/,
  };
  const PLUS = 'augmente|rallonge|allonge|elargis|rehausse|monte|agrandis|ajoute|rajoute|gagne|grandis';
  const MOINS = 'diminue|baisse|reduis|raccourcis|retrecis|enleve|retire|descends|abaisse';
  for (const [id, mot] of Object.entries(MOTS)) {
    const m = g.mesures.find((x) => x.id === id);
    if (!m || estChoix(m)) continue;
    const w = mot.source;
    const essais: [RegExp, 1 | -1][] = [
      [new RegExp(String.raw`\b(?:${PLUS})\b(?: (?:la|le|l|sa|son))? (?:${w})\b(?: de la piece| de la boite)? de ${N}`), 1],
      [new RegExp(String.raw`\b(?:${MOINS})\b(?: (?:la|le|l|sa|son))? (?:${w})\b(?: de la piece| de la boite)? de ${N}`), -1],
      [new RegExp(String.raw`\bplus (?:${w})\b de ${N}`), 1],
      [new RegExp(String.raw`\bmoins (?:${w})\b de ${N}`), -1],
      [new RegExp(String.raw`${N} de plus (?:en |de |sur la |sur le )?(?:${w})\b`), 1],
      [new RegExp(String.raw`${N} de moins (?:en |de |sur la |sur le )?(?:${w})\b`), -1],
      // « agrandis de 2 cm en hauteur », « baisse de 5 en hauteur ».
      [new RegExp(String.raw`\b(?:${PLUS})\b(?: (?:la|le|l))? de ${N} (?:en |de |sur la |sur le |dans la )(?:${w})\b`), 1],
      [new RegExp(String.raw`\b(?:${MOINS})\b(?: (?:la|le|l))? de ${N} (?:en |de |sur la |sur le |dans la )(?:${w})\b`), -1],
    ];
    for (const [re, sens] of essais) {
      const r = re.exec(t);
      if (!r) continue;
      const pas = Number(r[1]) * (r[2]?.startsWith('c') ? 10 : 1);
      const avant = Number(valeurs[id] ?? m.defaut);
      return { id, avant, apres: arrondi(avant + sens * pas) };
    }
  }
  return null;
}

/** Une seule mesure nommée et un seul nombre dans la phrase : ce nombre est pour elle. */
function mesureSeule(t: string, g: Gabarit): Valeurs | null {
  const nombres = [...t.matchAll(/(\d+(?:\.\d+)?) ?(cm|centimetres?)?\b/g)];
  if (nombres.length !== 1) return null;
  const dits = ` ${t} `;
  const nommees = new Set(
    g.mesures.filter((m) => !estChoix(m) && m.mots.some((mot) => dits.includes(` ${plier(mot)} `))).map((m) => m.id),
  );
  if (nommees.size !== 1) return null;
  const [id] = [...nommees];
  const n = nombres[0]!;
  return { [id!]: Number(n[1]) * (n[2] ? 10 : 1) };
}

/** Les mots de la pièce et de ses mesures, pliés et coupés en mots. */
function motsDeLaPiece(g: Gabarit): Set<string> {
  const mots = [...g.mots, g.nom, ...g.mesures.flatMap((m) => [m.nom, ...(estChoix(m) ? m.options.flatMap((o) => o.mots) : m.mots)])];
  return new Set(mots.flatMap((m) => plier(m).split(' ')));
}

/** La phrase nomme autre chose que la pièce (« le volume », « le minuteur ») ? */
function parleDAutreChose(t: string, g: Gabarit): boolean {
  const piece = motsDeLaPiece(g);
  return t
    .split(' ')
    .filter((mot) => /^[a-z]{2,}$/.test(mot))
    .some((mot) => !MOTS_NEUTRES.has(mot) && !piece.has(mot) && !VOCABULAIRE_PIECE.test(mot));
}

/** Seulement les mesures dont le nom est dit dans la phrase (« hauteur 50 », « 80 de long »). */
function nommees(valeurs: Valeurs, t: string, g: Gabarit): Valeurs {
  const dits = new Set(t.split(' '));
  const garde: Valeurs = {};
  for (const [id, valeur] of Object.entries(valeurs)) {
    const mesure = g.mesures.find((m) => m.id === id);
    // Une mesure à choix (« carré ») se dit toujours par son nom : elle est gardée telle quelle.
    if (!mesure || estChoix(mesure)) {
      garde[id] = valeur;
      continue;
    }
    if (mesure.mots.some((mot) => plier(mot).split(' ').every((x) => dits.has(x)))) garde[id] = valeur;
  }
  return garde;
}

/** « ajoute des aérations », « agrandis-la pour que le Pi rentre » : un ordre qui vise la pièce. */
function ordreSurPiece(t: string): boolean {
  return ORDRE.test(t) && (PRONOM_PIECE.test(t) || VOCABULAIRE_PIECE.test(t));
}

function lireMm(x: string): number {
  return Number(x.replace(',', '.'));
}

/**
 * Une carte ne tenait pas dans la boîte : les cotes qui la feraient tenir, prises dans le refus de
 * `poserCarte` (« il faut 61 × 93,5 mm au moins », « il faut 31 mm au-dessus du fond, il y en a 25 »),
 * arrondies au millimètre au-dessus. Rien n'est rétréci. `null` : refus d'un autre genre.
 */
export function agrandirPourTenir(
  g: Gabarit,
  valeurs: Valeurs,
  erreurs: readonly string[],
  /** Boîte provisoire trop petite : les autres refus (prise qui sort de la paroi) en découlent, on les passe. */
  ignorerAutres = false,
): { valeurs: Valeurs; texte: string } | null {
  if (!['boite', 'boite_couvercle'].includes(g.id)) return null;
  const nouvelles: Valeurs = { ...valeurs };
  const L = Number(valeurs.longueur ?? 80);
  const W = Number(valeurs.largeur ?? 50);
  const H = Number(valeurs.hauteur ?? 30);
  let change = false;
  for (const erreur of erreurs) {
    const fond = /ne tient pas dans le fond : il faut ([\d,.]+) × ([\d,.]+) mm au moins/.exec(erreur);
    if (fond) {
      nouvelles.longueur = Math.max(L, Math.ceil(lireMm(fond[1]!)));
      nouvelles.largeur = Math.max(W, Math.ceil(lireMm(fond[2]!)));
      change = true;
      continue;
    }
    const haut = /trop basse\. Il faut ([\d,.]+) mm au-dessus du fond .*, il y en a ([\d,.]+)\./.exec(erreur);
    if (haut) {
      nouvelles.hauteur = Math.max(H, Math.ceil(H + lireMm(haut[1]!) - lireMm(haut[2]!)));
      change = true;
      continue;
    }
    // Un autre refus (découpe, mesure hors bornes) : rien à proposer.
    if (!ignorerAutres) return null;
  }
  if (!change) return null;
  const cotes = `${nombre(Number(nouvelles.longueur))} × ${nombre(Number(nouvelles.largeur))} × ${nombre(Number(nouvelles.hauteur ?? H))} mm`;
  return { valeurs: nouvelles, texte: cotes };
}

const COTES_BOITE = ['longueur', 'largeur', 'hauteur'] as const;

/**
 * « un boîtier pour mon Raspberry Pi 5 », sans toutes les cotes : au lieu de demander longueur,
 * largeur et hauteur une à une (et de proposer des cotes où la carte ne tient pas), Jarvis propose
 * la plus petite boîte qui la tient (cotes dites gardées) et attend « oui ». `null` : pas de carte,
 * toutes les cotes dites, ou rien de sûr à proposer.
 */
function taillePourCarte(g: Gabarit, valeurs: Valeurs): AtelierDecision | null {
  if (!['boite', 'boite_couvercle'].includes(g.id)) return null;
  const carte = (JSON.parse(typeof valeurs.ajouts === 'string' ? valeurs.ajouts : '[]') as { genre?: string }[]).some((a) => a.genre === 'composant');
  if (!carte || COTES_BOITE.every((id) => id in valeurs)) return null;
  // Petites cotes provisoires pour ce qui n'a pas été dit : le refus dit ce qu'il faut au moins.
  const essai: Valeurs = { ...valeurs };
  for (const id of COTES_BOITE) if (!(id in essai)) essai[id] = 20;
  let v = essai;
  for (let i = 0; i < 3; i += 1) {
    const p = fabriquer(g, v);
    if (p.ok) break;
    const plus = agrandirPourTenir(g, v, p.erreurs, true);
    if (!plus) return null;
    v = plus.valeurs;
  }
  if (!fabriquer(g, v).ok) return null;
  const cotes = `${nombre(Number(v.longueur))} × ${nombre(Number(v.largeur))} × ${nombre(Number(v.hauteur))} mm`;
  const avec = ajoutsAffiches(v).map((a) => a.valeur).join(', ');
  return {
    kind: 'dire',
    texte: `${majuscule(g.nom)} avec ${avec} : je propose ${cotes}, la plus petite qui la tient. Dis « oui », ou donne-moi d'autres cotes.`,
    etat: { etape: 'proposition', gabarit: g.id, valeurs: v, base: null },
  };
}

/**
 * La phrase est-elle pour l'atelier, vu la discussion ? Sert à la faire passer avant les autres
 * règles sans modèle (le mode direct d'Imager prendrait « dessine-moi un boîtier »).
 */
export function pourAtelier(text: string, messages: readonly { role: string; atelier?: AtelierEtat }[], contexte: ContexteAtelier = {}): boolean {
  return deciderAtelier(text, dernierAtelier(messages), contexte).kind !== 'rien';
}

/**
 * Que faire de cette phrase, sachant le dernier état de l'atelier dans la discussion ?
 * `rien` : la phrase n'est pas pour l'atelier, le tour suit son chemin habituel.
 */
export function deciderAtelier(text: string, precedentDonne: AtelierEtat | null, contexte: ContexteAtelier = {}): AtelierDecision {
  const t = plier(text).replace(/^jarvis ,? ?/, '');
  const mesures = contexte.mesures ?? {};
  const precedent = precedentDonne;
  // La même phrase ramenée à un ordre (« tu peux l'imprimer ? » → « imprime »), pour la pièce à l'écran.
  const tn = normaliserOrdre(t);

  // D'autres cotes proposées (la carte ne tenait pas) : « oui » les prend, « non » garde la pièce
  // d'avant. Autre chose : la phrase est lue avec la pièce d'avant, la proposition est oubliée.
  if (precedent?.etape === 'proposition') {
    const proposition = precedent;
    const g = gabarit(proposition.gabarit);
    if (g && !REFUS.test(t) && (ACCORD.test(t) || FAIRE_TENIR.test(t))) {
      // « oui mais 100 de large » : les cotes nommées dans la même phrase comptent aussi.
      const dites = /\d/.test(t) ? nommees(lireMesures(text, g).valeurs, t, g) : {};
      return {
        kind: 'fabriquer',
        gabarit: g,
        valeurs: { ...proposition.valeurs, ...dites },
        ...(proposition.base ? { base: proposition.base } : {}),
        ...(proposition.changement ? { changement: proposition.changement } : {}),
      };
    }
    if (REFUS.test(t)) {
      const suite = ' Redis-moi la pièce comme tu la veux : d’autres cotes, ou les prises d’un autre côté.';
      return proposition.base
        ? { kind: 'dire', texte: `D'accord, je n'y touche pas. La version ${proposition.base.versionChoisie} reste à l'écran.${suite}`, etat: proposition.base }
        : { kind: 'dire', texte: `D'accord, je ne la fais pas comme ça.${suite}` };
    }
    // Autre chose : la phrase est lue avec la pièce d'avant. Si elle parle encore de la pièce sans
    // qu'aucune règle ne la comprenne, la proposition est redite plutôt que partir au cerveau.
    const suite = deciderAtelier(text, proposition.base, contexte);
    if (suite.kind !== 'rien' || !(VOCABULAIRE_PIECE.test(t) || /\b(?:imprim\w*|3d)\b/.test(t))) return suite;
    const v = proposition.valeurs;
    return {
      kind: 'dire',
      texte: `Je n'ai pas compris. Pour la ${g?.nom ?? 'pièce'} de ${nombre(Number(v.longueur))} × ${nombre(Number(v.largeur))} × ${nombre(Number(v.hauteur))} mm, dis « oui » ; sinon redis-moi la pièce autrement.`,
      etat: proposition,
    };
  }

  // Une mesure de composant demandée : un nombre est la réponse, « laisse tomber » arrête.
  if (precedent?.etape === 'mesure') {
    const c = composant(precedent.composant);
    if (ANNULER.test(t)) return { kind: 'dire', texte: "D'accord, je laisse tomber. Les mesures déjà données sont gardées." };
    const valeur = t.split(' ').length <= 6 ? lireMesure(t) : null;
    if (c && valeur !== null) {
      const essai = ajouterMesure(mesures, c.id, precedent.champ, valeur);
      if (essai.erreur) {
        const q = c.aMesurer?.find((x) => x.champ === precedent.champ);
        return { kind: 'dire', texte: `${essai.erreur} ${q ? questionMesure(c, q, mesures) : ''}`.trim(), etat: precedent };
      }
      return { kind: 'mesure', composant: c.id, champ: precedent.champ, valeur, reprise: precedent.reprise };
    }
    // Pas une mesure : la phrase suit son chemin (la question reste posée une fois).
  }

  // Une pièce à l'écran : « imprime-la », « imprime la boîte » passe avant une nouvelle demande.
  if (precedent?.etape === 'piece') {
    const imprimer = numeroAImprimer(tn, precedent);
    if (imprimer !== null) {
      if (!precedent.versions.some((v) => v.numero === imprimer)) {
        return { kind: 'dire', texte: `Il n'y a pas de version ${imprimer}. Les versions sont : ${precedent.versions.map((v) => v.numero).join(', ')}.` };
      }
      return { kind: 'imprimer', etat: precedent, numero: imprimer };
    }
    const enFile = numeroEnFile(tn, precedent);
    if (enFile !== null) {
      if (!precedent.versions.some((v) => v.numero === enFile)) {
        return { kind: 'dire', texte: `Il n'y a pas de version ${enFile}. Les versions sont : ${precedent.versions.map((v) => v.numero).join(', ')}.` };
      }
      return { kind: 'file', etat: precedent, numero: enFile };
    }
  }

  if (plateauVideLanceSuivante(text)) return { kind: 'lancerSuivante' };

  // Sinon, une nouvelle pièce passe avant tout.
  const nouvelle = demandePiece(text, mesures);
  if (nouvelle) {
    if (nouvelle.question) {
      const q = nouvelle.question;
      return { kind: 'dire', texte: q.texte, etat: { etape: 'mesure', composant: q.composant, champ: q.champ, reprise: { texte: text, piece: null } } };
    }
    if (!nouvelle.gabarit) {
      return {
        kind: 'dire',
        texte: `Je ne sais pas encore dessiner ça. Je sais faire : ${piecesConnues()}. Dis-moi laquelle s'en approche.`,
      };
    }
    if (nouvelle.erreurs?.length) {
      return { kind: 'dire', texte: `${nouvelle.erreurs.join(' ')} Redis-moi la pièce sans cette découpe, ou ailleurs.` };
    }
    const pourCarte = taillePourCarte(nouvelle.gabarit, nouvelle.valeurs);
    if (pourCarte) return pourCarte;
    return demanderOuFabriquer(nouvelle.gabarit, nouvelle.valeurs, `${majuscule(nouvelle.gabarit.nom)}, d'accord. `);
  }

  if (!precedent || precedent.etape === 'mesure') return { kind: 'rien' };
  const g0 = gabarit(precedent.gabarit);
  if (!g0) return { kind: 'rien' };
  let g: Gabarit = g0;

  if (precedent.etape === 'question') {
    if (ANNULER.test(t)) return { kind: 'dire', texte: "D'accord, je laisse tomber cette pièce." };
    const mesure = g.mesures.find((m) => m.id === precedent.mesure);
    if (!mesure) return { kind: 'rien' };
    const reponse = lireReponse(g, mesure.id, text);
    const longue = t.split(' ').filter((m) => m !== ',').length > 8 && !OUI.test(t);
    // Rien de lisible : ce n'est pas une réponse (« quelle heure est-il ? »), le tour suit son chemin.
    if (reponse === null || longue) return { kind: 'rien' };
    const erreur = horsBornes(mesure, reponse);
    if (erreur) {
      return { kind: 'dire', texte: `${erreur} ${prochaineQuestion(g, precedent.valeurs)?.texte ?? ''}`.trim(), etat: precedent };
    }
    // « oui, et 40 de haut » : les autres mesures dites dans la même phrase comptent aussi.
    const autres = OUI.test(t) ? lireMesures(text, g).valeurs : {};
    return demanderOuFabriquer(g, { ...precedent.valeurs, ...autres, [mesure.id]: reponse });
  }

  // Une pièce est à l'écran.
  const choisir = CHOISIR.exec(tn);
  if (choisir) {
    const numero = Number(choisir[1]);
    if (!precedent.versions.some((v) => v.numero === numero)) {
      return { kind: 'dire', texte: `Il n'y a pas de version ${numero}.` };
    }
    return { kind: 'choisir', etat: precedent, numero };
  }
  // « remets la version d'avant », « annule le dernier changement » : la version précédente.
  if (VERSION_AVANT.test(tn)) {
    const avant = precedent.versions.filter((v) => v.numero < precedent.versionChoisie).at(-1);
    if (!avant) return { kind: 'dire', texte: `La version ${precedent.versionChoisie} est la première : il n'y a rien avant.`, etat: precedent };
    return { kind: 'choisir', etat: precedent, numero: avant.numero };
  }

  const actuelle = precedent.versions.find((v) => v.numero === precedent.versionChoisie) ?? precedent.versions[precedent.versions.length - 1];
  if (!actuelle) return { kind: 'rien' };
  // « ouais vas-y », « ok super » juste après une pièce : rien à valider, l'atelier le dit (sinon la
  // phrase partirait au cerveau, qui ne connaît pas la pièce).
  if (ACQUIESCEMENT.test(t.replace(/\s*,\s*/g, ' ').trim())) {
    return {
      kind: 'dire',
      texte: `La version ${actuelle.numero} est faite. Dis-moi ce qu'il faut changer, ou « mets-la dans la file ».`,
    };
  }
  // « elle fait combien de haut ? », « c'est quoi les dimensions ? » : les cotes de la version à l'écran.
  if ((QUESTION.test(tn) || QUESTION_TAILLE.test(tn)) && DIMENSIONS.test(tn) && !SUJET_AUTRE.test(tn) && !/\d/.test(tn)) {
    const cotes = actuelle.mesures.map((m) => `${m.nom.toLowerCase()} ${m.valeur}`).join(', ');
    return { kind: 'dire', texte: `Version ${actuelle.numero} : ${cotes}.` };
  }
  // Une question (« quelle fenêtre est active ? ») ne change pas la pièce : elle suit son chemin.
  // Un ordre pour un autre domaine (« ferme la fenêtre », « mets l'écran en veille ») non plus.
  if (QUESTION.test(tn) || VERBE_AUTRE.test(tn) || SUJET_AUTRE.test(tn)) return { kind: 'rien' };
  let valeurs: Valeurs = { ...actuelle.valeurs };
  // La version à l'écran peut être d'un autre modèle que la pièce (boîte devenue boîte à couvercle).
  g = (actuelle.gabarit ? gabarit(actuelle.gabarit) : undefined) ?? g;

  // Découpes : « ajoute un trou de 8 à l'arrière », « enlève l'encoche », « le trou plus gros ».
  // Dans une phrase de 25 mots au plus (« j'ai un trou dans mon emploi du temps » reste au chat).
  const changementsDecoupes: string[] = [];
  // « ajoute un couvercle (qui s'emboîte) » sur une boîte : elle devient une boîte à couvercle, aux
  // mêmes cotes, avec ses trous et ses ajouts. L'emboîtement, s'il est dit, est lu ensuite.
  if (g.id === 'boite' && couvercleDemande(tn)) {
    const avecCouvercle = gabarit('boite_couvercle');
    if (avecCouvercle) {
      g = avecCouvercle;
      changementsDecoupes.push('Couvercle ajouté');
    }
  }
  let resteTexte = tn;
  const court = t.split(' ').length <= 25;
  // « rends-la plus grande », « agrandis-la » sans dire dans quel sens : on demande.
  if (PLUS_GRANDE.test(tn) && !lireDelta(tn, g, valeurs) && !/\b(?:longueur|largeur|hauteur|long|large|haut|profond)\w*\b/.test(tn)) {
    return { kind: 'dire', texte: 'Plus longue, plus large ou plus haute ? Dis-moi aussi de combien, par exemple « 10 mm plus haute ».', etat: precedent };
  }
  // « fais passer le câble par le côté gauche » = un passage de câble sur ce côté.
  const tPiece = tn.replace(/^(?:fais|fait|faire) (?:passer|sortir) (?:le |les |un |des )?(cables?)\b (?:par|sur|a|au|vers|de) /, 'ajoute un passage de $1 sur ');
  // Matière ajoutée d'abord : « ajoute quatre bossages », « le bossage plus haut », « fais que le
  // couvercle s'emboîte ». Les découpes sont lues dans ce qui reste.
  const matiere = court ? lireAjouts(tPiece) : { ops: [], reste: tPiece };
  if (matiere.ops.length) {
    const r = appliquerAjouts(g, valeurs, matiere.ops, mesures);
    if (r.question) {
      const q = r.question;
      return { kind: 'dire', texte: q.texte, etat: { etape: 'mesure', composant: q.composant, champ: q.champ, reprise: { texte: text, piece: precedent } } };
    }
    if (r.erreurs.length) return { kind: 'dire', texte: `${r.erreurs.join(' ')} La version ${actuelle.numero} reste à l'écran.` };
    valeurs = avecAjouts(valeurs, r.ajouts);
    changementsDecoupes.push(...r.changements);
    resteTexte = matiere.reste;
  }
  const lu = court ? lireDecoupes(matiere.reste, { exigerFace: aSonTrou(g) }) : { ops: [], reste: t };
  if (lu.ops.length) {
    if (!sePerce(g.id)) {
      const r = appliquerDecoupes(g, [], lu.ops);
      return { kind: 'dire', texte: `${r.erreurs.join(' ')} La version ${actuelle.numero} reste à l'écran.` };
    }
    const r = appliquerDecoupes(g, decoupesDe(valeurs), lu.ops);
    if (r.erreurs.length) return { kind: 'dire', texte: `${r.erreurs.join(' ')} La version ${actuelle.numero} reste à l'écran.` };
    valeurs = avecDecoupes(valeurs, r.decoupes);
    changementsDecoupes.push(...r.changements);
    resteTexte = lu.reste;
  }

  // Mesures dites : « hauteur 40 », « trou de 5 mm ». Seulement dans une phrase courte, pour ne pas
  // prendre « mets le minuteur à 10 minutes » pour une mesure.
  const tReste = plier(resteTexte).replace(/^jarvis ,? ?/, '');
  const mots = tReste.split(' ').filter((m) => m !== ',').length;
  // « augmente la hauteur de 10 mm » : 10 de plus, pas une hauteur de 10.
  const delta = lu.ops.length || matiere.ops.length ? null : lireDelta(tReste, g, valeurs);
  // « mets la hauteur à 50 », « la hauteur mets-la à 50 » : une seule mesure nommée, un seul nombre.
  const seule = delta || lu.ops.length || matiere.ops.length ? null : mesureSeule(tReste, g);
  const lues = delta ? { [delta.id]: delta.apres } : seule ? seule : mots <= 16 ? lireMesures(resteTexte, g).valeurs : {};
  // Un nombre sans le nom de sa mesure ne vaut que si la phrase ne parle que de la pièce :
  // « mets le volume à 90 » ne change pas la longueur, « fais-la en 100 par 60 » oui.
  const dites = delta ? lues : parleDAutreChose(tReste, g) ? nommees(lues, tReste, g) : lues;
  Object.assign(valeurs, dites);

  // « Le trou plus haut » parle de la découpe, pas de la hauteur de la pièce.
  for (const regle of lu.ops.length || matiere.ops.length || delta ? [] : RELATIFS) {
    if (!regle.mots.test(tn)) continue;
    const id = regle.ids.find((x) => g.mesures.some((m) => m.id === x && !estChoix(m)) && !(x in dites));
    if (!id) continue;
    const mesure = g.mesures.find((m) => m.id === id) as MesureNombre;
    const courante = Number(valeurs[id] ?? mesure.defaut);
    const plus = !PLUS_PETIT.test(tn);
    valeurs[id] = relatif(mesure, courante, plus);
  }

  const changement = [changementDe(g, actuelle.valeurs, valeurs), ...changementsDecoupes].filter(Boolean).join(', ');
  if (!changement) {
    // Un ordre sur la pièce que l'atelier ne sait pas lire : il le dit, la pièce reste à l'écran.
    if (ordreSurPiece(tn)) {
      return {
        kind: 'dire',
        texte: `Je n'ai pas su faire ce changement sur la pièce. Sur la pièce à l'écran, je sais : changer une mesure (« hauteur 50 », « plus haut »), percer (« un trou de 8 à l'arrière », « une fenêtre sur le dessus », « un passage de câble à gauche ») et ajouter des plots pour une carte, des bossages, une nervure ou un rebord. La version ${actuelle.numero} reste à l'écran.`,
        etat: precedent,
      };
    }
    return { kind: 'rien' };
  }
  for (const m of g.mesures) {
    if (!(m.id in valeurs) || valeurs[m.id] === actuelle.valeurs[m.id]) continue;
    const erreur = horsBornes(m, valeurs[m.id]!);
    if (erreur) return { kind: 'dire', texte: `${erreur} La version ${actuelle.numero} reste à l'écran.` };
  }
  return { kind: 'fabriquer', gabarit: g, valeurs, base: precedent, changement };
}

/** Nom de dossier sûr pour une pièce : « boite-couvercle-2026-11-23-1 ». */
export function nomDossierPiece(g: Gabarit, jour: string, numero: number): string {
  const base = plier(g.nom).replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  return `${base}-${jour}-${numero}`;
}

/** Carte avant l'ajout à la file d'attente. `occupee` : la demande était « imprime-la ». */
export function phraseConfirmationFile(nom: string, numero: number, tempsFilament: string | null, occupee: boolean): string {
  const avant = occupee ? "L'imprimante est occupée. " : '';
  const detail = tempsFilament ? ` ${tempsFilament}` : '';
  return `${avant}Ajouter à la file d'attente « ${nom} », version ${numero}.${detail} Rien ne sera lancé : l'impression en cours continue, et la file reste en pause jusqu'à ce que tu me dises que le plateau est vide.`;
}

/** Carte avant de lancer la première pièce de la file. */
export function phraseConfirmationSuivante(fichier: string): string {
  return `Lancer la première pièce de la file : ${fichier}. Tu m'as dit que le plateau est vide : vérifie-le une dernière fois.`;
}

/** Phrase de la carte de confirmation avant l'impression. */
export function phraseConfirmationAtelier(nom: string, numero: number, tempsFilament: string | null): string {
  const detail = tempsFilament ? ` ${tempsFilament}` : '';
  return `Lancer l'impression de « ${nom} », version ${numero}.${detail} Vérifie que le plateau est vide.`;
}
