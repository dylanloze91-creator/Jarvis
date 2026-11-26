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
import { ajouterMesure, composant, composantNomme, lireMesure, produitsNommes, prochaineMesure, questionMesure, referenceDite, type MesuresComposants } from './composants.js';
import { liensDits } from './rechercheCotes.js';
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
  /**
   * Un ensemble de pièces (boîtier à écran) : chaque pièce a son fichier et s'imprime seule.
   * `stl` est alors le boîtier monté, pour l'écran 3D et les images.
   */
  pieces?: PieceVersionInfo[];
  /** Contrôles complets passés avant de montrer l'ensemble. */
  controles?: { total: number; ok: number };
  /** Le boîtier en vue éclatée (`v2-eclate.stl`). */
  eclate?: string;
}

/** Une pièce d'un ensemble, dans une version. */
export interface PieceVersionInfo {
  /** Nom de fichier court : `Facade`, `Retenue_A`… */
  nom: string;
  /** Nom dit : « façade », « retenue A de l'écran ». */
  titre: string;
  nombre: number;
  /** Sens d'impression. */
  sens: string;
  /** `v1-Facade.stl`. */
  stl: string;
  taille: [number, number, number];
  temps?: string;
  filament?: string;
}

/** Les mots qui désignent une pièce d'un ensemble : « façade », « retenue a », « cache », « bouton ». */
export function motsPiece(titre: string): string {
  return plier(titre)
    .replace(/ (?:de l ecran|de la camera|du cache)\b.*$/, '')
    .trim();
}

/** La pièce d'un ensemble nommée dans la phrase, la plus précise d'abord (« retenue b » avant « retenue »). */
export function pieceDite(t: string, pieces: readonly PieceVersionInfo[]): PieceVersionInfo | null {
  const tries = [...pieces].sort((a, b) => motsPiece(b.titre).length - motsPiece(a.titre).length);
  for (const p of tries) if (new RegExp(`\\b${motsPiece(p.titre)}s?\\b`).test(t)) return p;
  // « la retenue » : la première retenue (A), la B se nomme.
  for (const p of tries) {
    const premier = motsPiece(p.titre).split(' ')[0]!;
    if (new RegExp(`\\b${premier}s?\\b`).test(t)) return p;
  }
  return null;
}

export type AtelierEtat =
  | { etape: 'question'; gabarit: string; valeurs: Valeurs; mesure: string }
  /** Jarvis vient de dire ce qu'il sait dessiner : le nom d'une pièce suffit ensuite (« une boîte alors »). */
  | { etape: 'choix' }
  /**
   * Une mesure de composant demandée (pied à coulisse). `reprise` : la phrase à relire une fois la
   * mesure gardée, avec la pièce qui était à l'écran.
   */
  | { etape: 'mesure'; composant: string; champ: string; reprise: { texte: string; piece: Extract<AtelierEtat, { etape: 'piece' }> | null } }
  /**
   * Les cotes d'un composant manquent : Jarvis a demandé le modèle exact, pour les chercher sur
   * Internet (demande de l'utilisateur, 24 novembre). `reprise` comme pour une mesure.
   */
  | { etape: 'produit'; composant: string; reprise: { texte: string; piece: Extract<AtelierEtat, { etape: 'piece' }> | null } }
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
      /**
       * Le dernier changement refusé (« rajoute un trou de 50 à l'arrière » : il ne tient pas), phrase
       * déjà pliée : « bon alors de 10 » le redemande avec ce nombre, au lieu de changer la longueur.
       */
      refus?: string;
      /** Un nombre dit seul (« mets 50 ») : Jarvis a demandé pour quelle mesure, « en hauteur » le reprend. */
      nombre?: string;
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
  | { kind: 'imprimer'; etat: Extract<AtelierEtat, { etape: 'piece' }>; numero: number; piece?: string }
  /** « mets-la dans la file » : envoyée sans être lancée, ajoutée à la file d'attente de Moonraker. */
  | { kind: 'file'; etat: Extract<AtelierEtat, { etape: 'piece' }>; numero: number; piece?: string }
  /** « le plateau est vide, lance la suivante » : la première pièce de la file. */
  | { kind: 'lancerSuivante' }
  | { kind: 'choisir'; etat: Extract<AtelierEtat, { etape: 'piece' }>; numero: number }
  /**
   * Une mesure donnée : le PC la garde (`composants-mesures.json`), puis relit `reprise.texte` avec
   * `reprise.piece` et les mesures à jour (question suivante, ou la pièce).
   */
  | {
      kind: 'mesure';
      composant: string;
      champ: string;
      valeur: number;
      /** « prends large » : une marge choisie sans la pièce, gardée comme telle (jamais comme une mesure). */
      large?: boolean;
      /** « prends large partout » : toutes les valeurs larges à garder (composants de la demande compris). */
      larges?: { composant: string; champ: string; valeur: number }[];
      reprise: { texte: string; piece: Extract<AtelierEtat, { etape: 'piece' }> | null };
    }
  /**
   * Chercher sur Internet les cotes de `composant`, pour le produit dit par l'utilisateur (référence,
   * ou lien), puis relire `reprise.texte` avec `reprise.piece` et les cotes trouvées.
   */
  | { kind: 'chercherCotes'; recherches: { composant: string; produit: string }[]; reprise: { texte: string; piece: Extract<AtelierEtat, { etape: 'piece' }> | null } };

/** Ce que le PC sait en plus de la discussion : les mesures de composants données par l'utilisateur. */
export interface ContexteAtelier {
  /** Mesures de l'utilisateur, complétées des cotes trouvées. */
  mesures?: MesuresComposants;
  /**
   * Vrai : l'atelier est le seul à parler à l'imprimante (Jarvis Live). « imprime-la » sans pièce dans
   * la discussion reçoit alors sa réponse. Faux ou absent (Jarvis Test) : la phrase suit son chemin,
   * vers l'imprimante du lot B (« imprime le fichier… »).
   */
  sansAutreImprimante?: boolean;
  /** Vrai : le PC sait chercher des cotes sur Internet. Une cote manquante fait alors demander le modèle exact. */
  rechercheCotes?: boolean;
  /** Composants déjà cherchés sur Internet (le pied à coulisse ne sert plus qu'à ce qui manque encore). */
  cherches?: readonly string[];
  /**
   * Le produit cherché pour chaque composant (référence dite par l'utilisateur), et si la recherche
   * a regardé les plans des fabricants. Une autre référence dite, ou une recherche sans plans : on cherche.
   */
  produits?: Readonly<Record<string, { produit: string; plans?: boolean }>>;
}

const pli = (x: string) => plier(x).replace(/[^a-z0-9]+/g, ' ').trim();

/**
 * Avant de poser une question de mesure : les composants nommés avec leur référence précise
 * (« ESP32-S3 DevKitC-1 », « écran OLED 1,3 pouce I2C ») et pas encore cherchés pour cette référence
 * sont cherchés sur Internet tout de suite, tous ensemble (demande du 25 novembre : « il doit chercher
 * seul, me demander seulement ce qu'il n'a pas trouvé »). Sinon, la question.
 */
function chercherOuDemander(text: string, q: { composant: string; champ: string; texte: string }, reprise: Reprise, contexte: ContexteAtelier): AtelierDecision {
  if (contexte.rechercheCotes) {
    const mesures = contexte.mesures ?? {};
    const recherches: { composant: string; produit: string }[] = [];
    for (const n of produitsNommes(plier(text))) {
      const c = n.composant;
      if (!n.precis || c.etat !== 'a_mesurer' || !c.aMesurer || recherches.some((r) => r.composant === c.id)) continue;
      const deja = contexte.produits?.[c.id];
      const produit = referenceDite(text, n.produit);
      const memeProduit = deja && pli(deja.produit) === pli(produit) && deja.plans;
      if (memeProduit || !prochaineMesure(c, mesures)) continue;
      recherches.push({ composant: c.id, produit });
    }
    if (recherches.length) return { kind: 'chercherCotes', recherches, reprise };
  }
  return questionComposant(q, reprise, contexte);
}

/** Réponses « je n'ai pas la pièce » à une question de mesure. */
const SANS_LA_PIECE = /\b(?:prends? (?:large|grand|de la marge)|mets? (?:large|de la marge)|large|je (?:ne )?sais pas|je (?:ne )?l ai pas|j ai pas la piece|aucune idee|pas la piece)\b/;
/** « partout », « pour tout le reste » : la valeur large pour toutes les cotes qui manquent. */
const PARTOUT = /\b(?:partout|pour tout|tout le reste|pour toutes?|a chaque fois|pour le reste)\b/;

/**
 * Les valeurs larges de toutes les cotes qui manquent encore, pour ce composant puis ceux de la
 * demande (seulement les cotes d'encombrement qui en ont une).
 */
function valeursLarges(texte: string, idCourant: string, mesures: MesuresComposants): { composant: string; champ: string; valeur: number }[] {
  const ids = [...new Set([idCourant, ...produitsNommes(` ${plier(texte)} `).map((n) => n.composant.id)])];
  const out: { composant: string; champ: string; valeur: number }[] = [];
  for (const id of ids) {
    const c = composant(id);
    if (!c?.aMesurer || c.etat !== 'a_mesurer') continue;
    for (const q of c.aMesurer) {
      if (q.facultatif || q.large === undefined || typeof mesures[id]?.[q.champ] === 'number') continue;
      out.push({ composant: id, champ: q.champ, valeur: q.large });
    }
  }
  return out;
}

/** Source d'une valeur large choisie sans la pièce : jamais confondue avec une mesure. */
export const SOURCE_LARGE = 'valeur large choisie par l’utilisateur, sans la pièce';

type Reprise = { texte: string; piece: Extract<AtelierEtat, { etape: 'piece' }> | null };

/**
 * Une mesure de composant manque. Si le PC sait chercher et que rien n'a encore été cherché (ni
 * mesuré) pour ce composant : le modèle exact est demandé, pour chercher ses cotes. Sinon, la mesure
 * au pied à coulisse, précédée de ce que la recherche n'a pas trouvé.
 */
function questionComposant(q: { composant: string; champ: string; texte: string }, reprise: Reprise, contexte: ContexteAtelier): AtelierDecision {
  const c = composant(q.composant);
  const dejaLa = Object.keys(contexte.mesures?.[q.composant] ?? {}).length > 0;
  const cherche = (contexte.cherches ?? []).includes(q.composant);
  if (c && contexte.rechercheCotes && !cherche && !dejaLa) {
    return { kind: 'dire', texte: questionProduit(c.nom), etat: { etape: 'produit', composant: c.id, reprise } };
  }
  const texte = cherche
    ? `Internet ne m'a pas donné toutes les cotes. Si tu as la pièce, mesure ce qui manque ; sinon colle-moi le lien d'un plan ou d'une fiche (« cherche avec ce lien : … »). ${q.texte}`
    : q.texte;
  return { kind: 'dire', texte, etat: { etape: 'mesure', composant: q.composant, champ: q.champ, reprise } };
}

export function questionProduit(nom: string): string {
  return (
    "Je n'ai pas de cotes fiables pour cette carte. C'est quel modèle exactement ? Donne-moi sa référence " +
    "(celle écrite sur la carte ou sur la page du vendeur), ou colle le lien de la page où tu l'achètes : je cherche ses cotes sur Internet. " +
    `Si c'est celle de ma liste (${nom}), dis « celle de ta liste » ; si tu l'as sous la main et préfères la mesurer, dis « je la mesure ».`
  );
}

const MESURER_SOI_MEME = /\b(?:je (?:la |le |les )?mesure|je vais (?:la |le |les )?mesurer|pied a coulisse|je l ai (?:sous la main|ici|devant moi))\b/;
const CELLE_DE_LA_LISTE = /^(?:oui |ok |bah |ben )?(?:c est )?(?:celle|celui|la meme|le meme) (?:de ta liste|de la liste|que tu as|que t as|de l enceinte|qui est dans ta liste)\b|^(?:oui )?celle la\b/;
/**
 * « cherche avec ce lien : https://… » : le produit cherché reste le composant (ou ce que la phrase
 * en dit), suivi du lien. Sinon la réponse parlait de « cherche avec ce lien : ».
 */
function produitAvecLien(text: string, nom: string): string {
  const liens = liensDits(text);
  let reste = text;
  for (const lien of liens) reste = reste.replace(lien, ' ');
  const dit = plier(reste)
    .replace(/[^a-z0-9 ]+/g, ' ')
    .replace(/(?:^| )(?:cherche|regarde|lis|prends|utilise|essaie|voici|voila|c est|avec|sur|dans|ce|cette|le|la|les|un|une|lien|liens|page|fiche|plan|site|url|ca|celle|la|stp|merci|et|pour|de|du)(?= |$)/g, ' ')
    .replace(/ +/g, ' ')
    .trim();
  return `${dit.length >= 4 ? reste.replace(/[:\s]+$/g, '').trim() : nom} ${liens.join(' ')}`.trim();
}

/** Ce que dit l'utilisateur après la question du modèle exact. */
function lireProduit(text: string, t: string, nom: string): string | null {
  // Un lien d'abord : « celle-là : https://… » vise la page donnée, pas la carte de la liste.
  if (liensDits(text).length) return produitAvecLien(text, nom);
  if (CELLE_DE_LA_LISTE.test(t)) return nom;
  const mots = t.split(' ').filter(Boolean);
  if (mots.length === 0 || mots.length > 16) return null;
  // « c'est une ESP32 DevKit V1 » → « ESP32 DevKit V1 ».
  return text
    .trim()
    .replace(/^(?:jarvis\s*,?\s*)?(?:euh\s+)?(?:(?:c'?est|c’est|ce sera|il s'?agit d'?)\s*)?(?:une?|la|le|l'|l’)?\s*(?:carte\s+|module\s+)?/i, '')
    .replace(/[.!?]+$/, '')
    .trim() || null;
}

/**
 * Nombre de demandes de l'utilisateur pendant lesquelles la pièce reste « à l'écran ». Compté en
 * demandes, pas en messages : un tour du modèle avec un outil fait trois messages, et la pièce se
 * perdait après deux échanges sans rapport (nuit du 25 novembre).
 */
const RECUL_DEMANDES = 6;

/** Dernier état de l'atelier dans la discussion (question ou pièce), s'il est récent. */
export function dernierAtelier(messages: readonly { role: string; atelier?: AtelierEtat }[]): AtelierEtat | null {
  const recents = messages.slice(-80);
  let premiere = true;
  let demandes = 0;
  for (let i = recents.length - 1; i >= 0; i -= 1) {
    const message = recents[i]!;
    if (message.role === 'user') {
      demandes += 1;
      if (demandes >= RECUL_DEMANDES) break;
    }
    if (message.role !== 'assistant') continue;
    // Une question ne vaut que si c'est la dernière réponse de Jarvis ; une pièce reste
    // à l'écran quelques échanges.
    if (message.atelier && (premiere || message.atelier.etape === 'piece')) {
      // Ce qui attendait une suite immédiate (un changement refusé, un nombre dit seul) est oublié dès
      // qu'un autre échange est passé.
      if (!premiere && message.atelier.etape === 'piece' && (message.atelier.refus !== undefined || message.atelier.nombre !== undefined)) {
        const { refus: _refus, nombre: _nombre, ...piece } = message.atelier;
        return piece;
      }
      return message.atelier;
    }
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
const COTE = /\d+(?:\.\d+)? ?(?:mm|millimetres?|cm|centimetres?|x|par|sur|fois|de long|de large|de haut|de diametre|de cote|de profondeur)\b/;
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
  /^(?=.*\b(?:oui|ouais|ok|okay|vas y|go|d accord|d acc|c est bon|c est parfait|ca marche|ca me va|nickel|parfait|super|top|impec|impeccable|genial|excellent|yes)\b)(?:(?:oui|ouais|ok|okay|d accord|vas y|go|super|parfait|nickel|top|merci|beaucoup|cool|c est bon|c est parfait|ca marche|ca me va|impec|impeccable|bien|tres|genial|yes|d acc|carrement|excellent|parfait|nickel)\s*)+$/;
/**
 * Accepter ce que Jarvis propose pour une mesure, dit comme on parle : « ouais vas-y », « fais comme
 * tu veux », « je sais pas trop », « peu importe ».
 */
const ACCEPTE_DEFAUT =
  /^(?:(?:alors|bon|eh bien|ah|bien|oui|ouais|ok) )*(?:oui|ouais|ouai|ok|okay|d accord|daccord|d acc|vas y|va s y|go|allez|parfait|nickel|impec(?:cable)?|super|top|ca marche|ca me va|ca ira|c est bon|c est parfait|tres bien|pas de (?:probleme|souci)s?|aucun (?:probleme|souci)|comme tu (?:veux|le sens|penses|preferes)|fais comme tu (?:veux|le sens|penses)|peu importe|je (?:ne )?sais pas(?: trop)?|j en sais rien|aucune idee|ce que tu (?:veux|proposes|penses)|ta proposition|par defaut|garde ca|va pour ca|yes)\b/;
/** « c'est quoi déjà la question », « répète », « pardon ? » : la question est redite. */
const REPETER =
  /^(?:(?:c est|c etait) quoi (?:deja )?(?:la|ta) question|quelle (?:est|etait) (?:deja )?(?:la|ta) question|(?:tu peux )?(?:repete|repeter|redis|redire)\b.*|pardon|comment|quoi|hein|j ai pas (?:compris|entendu)|je n ai pas (?:compris|entendu)|tu (?:me )?demandais quoi|tu disais(?: quoi)?)(?: deja)?$/;
/**
 * « bon dessine-le avec ce que t'as », « vas-y modélise », « d'accord dessine tout ça » pendant une
 * question de mesure : faire la pièce sans attendre les mesures qui manquent (avec de la marge, dite).
 */
const FAIS_QUAND_MEME =
  /^(?:(?:bon|ok|oui|ouais|d accord|daccord|allez|vas y|alors) )*(?:(?:tu peux )?(?:me |m )?(?:le |la |les )?(?:dess?inn?e\w*|modelis\w*|fabriqu\w*|fai[st]|imprim\w*|continue|avance|lance)\b|vas y\b|go\b)|\bavec ce que (?:tu as|t as)\b|\bsans (?:ca|cette mesure|ces mesures)\b|\btant pis\b|\bfais sans\b/;
/** Cartes souvent demandées que la bibliothèque n'a pas : la boîte est faite sans plots, et c'est dit. */
const CARTE_INCONNUE = /\b(?:arduino(?: (?:uno|nano|mega|micro|leonardo))?|esp8266|nodemcu|wemos(?: d1)?|raspberry pi (?:pico|zero|0|3|4)|pi (?:pico|zero|0)|pico|jetson(?: nano)?|stm32|teensy|orange pi|banana pi|micro ?bit|beaglebone)\b/;
/** « un truc pour ranger… », « une pièce pour tenir… » : l'objet est quand même précisé. */
const OBJET_PRECIS = /\b(?:pour|qui|avec|comme)\b/;
/** Ce qu'on demande avec « fais-moi un… » et qui n'est pas une pièce à imprimer. */
const PAS_UNE_PIECE =
  /\b(?:images?|photos?|dessins?|logos?|stickers?|resumes?|listes?|mails?|messages?|playlists?|recherches?|notes?|rappels?|cafes?|blagues?|histoires?|poemes?|points?|bilans?|recap\w*|calculs?|programmes?|scripts?|applis?|applications?|sites?|codes?|tableaux?|textes?|lettres?|plannings?|comptes? rendus?|tours?|pauses?|exemples?|tests?|essais?|copies?|sauvegardes?|captures?)\b/;
/** Un ordre sans ses mots de liaison : « vas y imprime » → « imprime », « mets la plutot en file d attente » → « mets la en file d attente ». */
function sansLiaisons(t: string): string {
  return t
    .replace(/^(?:(?:vas y|va s y|allez|go|bon|ok|oui|ouais|du coup|alors|donc|ben|bah) )+/, '')
    .replace(/\b(?:plutot|du coup|alors|donc|maintenant|stp|svp|deja|vite|direct|directement)\b/g, ' ')
    .replace(/ +/g, ' ')
    .trim();
}
/** « et le même à droite », « pareil à l'arrière », « un autre à gauche » : la dernière découpe, ailleurs. */
const LE_MEME = /^(?:et )?(?:(?:le|la|les) memes?(?: chose| trou| ouverture)?|pareil|idem|un autre|une autre|aussi)(?: aussi)? (.+)$/;
/** « encore », « encore un peu » : le dernier changement relatif, une fois de plus. */
const ENCORE = /^(?:encore(?: un peu| plus| une fois| pareil)?|un peu plus|pareil|continue)$/;
/** Phrases très courtes qui ne répondent à aucune question de l'atelier. */
const HORS_SUJET_COURT =
  /^(?:(?:mets?|met) (?:sur |en |la |le )?(?:pause|play|lecture)|pause|play|lecture|stop la musique|coupe (?:le son|la musique)|monte (?:le son|le volume)|baisse (?:le son|le volume)|plus fort|moins fort|suivant|suivante|precedent|(?:morceau|chanson|titre) (?:suivante?|precedente?)|merci(?: beaucoup)?|salut|bonjour|bonsoir|bonne nuit|au revoir|a plus)$/;
/** « attends », « je reviens », « deux secondes » pendant une question : l'atelier attend, sans dire qu'il n'a pas compris. */
const ATTENDS = /^(?:attends?|att|deux secondes|une seconde|un instant|une minute|je reviens|bouge pas|deux minutes)\b/;
/** « je sais pas », « aucune idée », « c'est quoi comme modèle » à la question du modèle exact : pas une référence. */
const NE_SAIT_PAS = /\b(?:je (?:ne )?sais pas|j en sais rien|aucune idee|pas sur|je (?:ne )?connais pas|c est quoi|ca veut dire quoi|comment je (?:sais|fais|trouve)|ou (?:je|ca) (?:trouve|se trouve))\b/;
/** « tu sais faire quoi comme pièces en 3D », « qu'est-ce que tu peux m'imprimer » : ce que l'atelier sait faire. */
const CAPACITES =
  /^(?:et )?(?:(?:tu (?:sais|peux|saurais)|sais tu|peux tu) (?:me |m )?(?:faire|imprimer|dessiner|modeliser|fabriquer) quoi\b.*\b(?:3d|pieces?|imprim\w*|atelier)\b|(?:tu (?:sais|peux|saurais)|sais tu|peux tu) (?:me |m )?(?:imprimer|modeliser) quoi\b|qu est ce que tu (?:sais|peux|saurais) (?:me |m )?(?:imprimer|modeliser|fabriquer|(?:faire|dessiner) (?:en 3d|comme pieces?|avec l imprimante))|quelles? pieces? (?:tu (?:sais|peux)|sais tu|peux tu)\b|(?:c est quoi|quelles sont) les pieces que tu (?:sais|peux)\b|tu (?:sais|peux) (?:faire|imprimer|dessiner|modeliser) quelles? pieces?)/;
/** Une demande d'impression 3D sans objet connu : « j'aimerais imprimer un truc en 3D », « modélise-moi ça ». */
const ENVIE_3D =
  /^(?:(?:est ce que )?(?:tu peux|peux tu|tu pourrais|pourrais tu|on peut|je peux) )?(?:me |m )?modelis\w*\b|^(?:je (?:veux|voudrais)|j aimerais|j ai envie d|on pourrait|tu peux|peux tu) (?:m |me )?(?:imprimer|modeliser|fabriquer) (?:un truc|quelque chose|un objet|une piece|ca|un machin)\b|^(?:imprime|fabrique)(?: moi| nous)? (?:un|une|des) /;

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
  /\b(?:version (?:d avant|precedente)|annule (?:le |la |mon |ma |ce |cette )?(?:dernier |derniere )?(?:changement|modification)|reviens en arriere|retour en arriere|annule ca|defais (?:le|ca)|comme avant|c etait mieux avant)\b|^(?:non ,? ?)?remets (?:le|la|les|ca)(?: comme (?:avant|c etait))?$|^(?:(?:ouais|oui|bon|en fait) )?(?:non ,? ?)?remets comme avant$|^non ,? ?(?:enleve|retire|vire|supprime) (?:le|la|les|ca)$/;
/** Revoir la pièce à l'écran : « réessaie », « remontre-la », « renvoie les images », « je ne la vois pas ». */
const REMONTRER =
  /^(?:re ?essa(?:ie|ye|yer)|recommence|remontre(?: la| le| moi)*|montre(?: la| le| moi)+|renvoie(?: la| le| moi)*(?: les)?(?: images?| photos?)?|envoie(?: moi)? (?:les |l |une |des )?(?:images?|photos?|vues?)|redonne(?: moi)?(?: les)? images?|je (?:ne )?(?:la |le )?vois (?:pas|rien)|(?:les )?images? (?:ne )?(?:s affiche(?:nt)? pas|n arrive(?:nt)? pas))\b/;
/** Question sur la taille de la pièce. */
const DIMENSIONS = /\b(?:dimensions?|taille|mesures?|cotes|grande|haute?|large|longue?|epaisse|hauteur|largeur|longueur)\b/;
/** Une question, même posée sans mot interrogatif en tête : « elle fait combien de haut ? ». */
const QUESTION_TAILLE = /\bcombien\b|^(?:c est quoi|quelles? sont|donne moi|dis moi)\b/;
/** « plus grande », « agrandis-la », « trop petite » sans dire la mesure. */
const PLUS_GRANDE = /\b(?:plus grande?|plus grosse?|trop petite?|agrandis(?: la| le)?)\b/;
const ANNULER = /^(?:annule|laisse tomber|oublie|stop|arrete|non merci|pas la peine)\b/;
const OUI = /^(?:oui|ok|d accord|ca me va|vas y|va pour ca|parfait|c est bon|ca marche)\b/;

/** Les ajouts de matière et composants déjà posés dans ces valeurs (chaîne JSON `ajouts`). */
function lireAjoutsPoses(valeurs: Valeurs): { genre?: string; composant?: string }[] {
  try {
    const brut: unknown = JSON.parse(typeof valeurs.ajouts === 'string' ? valeurs.ajouts : '[]');
    return Array.isArray(brut) ? (brut as { genre?: string; composant?: string }[]) : [];
  } catch {
    return [];
  }
}

function majuscule(texte: string): string {
  return texte ? `${texte[0]!.toUpperCase()}${texte.slice(1)}` : texte;
}

function nombre(x: number): string {
  return String(Math.round(x * 10) / 10).replace('.', ',');
}

/** « 30 mm », « 60° », « 4 ». */
const CHOIX_DITS: Record<string, string> = { carre: 'carré', arriere: 'à l’arrière', cote: 'sur le côté' };

export function valeurDite(mesure: Mesure, valeur: number | string): string {
  if (estChoix(mesure)) return CHOIX_DITS[String(valeur)] ?? String(valeur);
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
  /** La référence cherchée pour chaque composant (« ESP32-S3 DevKitC-1 »), pour la dire dans la fiche. */
  produits: Readonly<Record<string, string>> = {},
): { gabarit: Gabarit | null; valeurs: Valeurs; erreurs?: string[]; question?: { composant: string; champ: string; texte: string } } | null {
  // « Et un boîtier pour un ESP32 », « aussi une boîte… » : la suite d'une discussion (essai du 24 novembre).
  const t = plier(text)
    .replace(/^jarvis ,? ?/, '')
    .replace(/^(?:et maintenant|et puis|et aussi|et|puis|aussi|maintenant|alors|bon) /, '');
  // « imprime le fichier boite.gcode », « imprime ce document » : un fichier, pas une pièce à dessiner.
  if (/\b(?:gcode|fichiers?|documents?|pdf)\b/.test(t)) return null;
  const verbe = DEMANDE.exec(t) ?? VOULOIR.exec(t);
  const demande = comprendre(text);
  const carte = composantNomme(` ${plier(text)} `);
  // Sans verbe, il faut une cote (« une boîte de 100 par 60 ») ou une carte connue (« un boîtier
  // pour un ESP32 ») : « une boîte de 6 œufs » n'est pas une demande.
  // « un boîtier pour un pi zero » : une carte que la bibliothèque n'a pas (son nom est déjà remplacé
  // par « ma carte ») compte comme une carte connue. « une boîte pour mes bijoux » reste hors de l'atelier.
  const pourQuelqueChose = /\bpour (?:un |une |mon |ma |le |la )?ma carte\b/.test(t);
  const sansVerbe =
    !verbe &&
    demande.gabarit !== null &&
    commenceParLaPiece(t, demande.gabarit) &&
    (COTE.test(t) || pourQuelqueChose || Boolean(carte && (composant(carte.id)?.carte || composant(carte.id)?.ecran)));
  if (!verbe && !sansVerbe) return null;
  // « Dessine une version adaptée à l'ESP32 », « fais la même pour un Arduino » : une boîte pour
  // cette carte (essai du 24 novembre : la phrase partait à l'équipe Code, qui refusait de dessiner).
  const objetDemande = verbe ? t.slice(verbe[0].length).trim() : '';
  const versionPourCarte =
    verbe && carte && composant(carte.id)?.carte && /^(?:version|variante|copie|autre|meme|pareille)\b/.test(objetDemande.replace(/^(?:une |la |l )/, ''));
  const gDemande = demande.gabarit ?? (versionPourCarte ? gabarit('boite') : undefined);
  // « un boîtier pour un Raspberry Pi 5 avec l'écran tactile 7 pouces (et la caméra grand angle) » :
  // le boîtier à écran (socle + écran incliné), dessiné par règles, sans question sur ces composants.
  const nommes = produitsNommes(` ${plier(text)} `).map((n) => n.composant);
  const gEcran = gabarit('boitier_ecran');
  if (gEcran && nommes.some((c) => c.id === 'touch_display_2_7') && (!gDemande || ['boite', 'boite_couvercle', 'boitier_ecran'].includes(gDemande.id))) {
    const autres = nommes.filter((c) => (c.carte || c.ecran) && !BOITIER_ECRAN_COMPOSANTS.includes(c.id));
    if (autres.length) {
      return {
        gabarit: gEcran,
        valeurs: {},
        erreurs: [`Le boîtier à écran est dessiné pour un Raspberry Pi 5 avec l’écran tactile 7 pouces : je ne sais pas encore y mettre ${autres.map((c) => c.nom).join(', ')}.`],
      };
    }
    const valeurs = lireMesures(text, gEcran).valeurs;
    valeurs.camera = valeurs.camera !== 'non' && nommes.some((c) => c.id === 'camera_module_3_wide') ? 'oui' : 'non';
    return { gabarit: gEcran, valeurs };
  }
  if (gDemande) {
    // « … avec un trou de 8 à l'arrière » : les découpes sont lues à part, et retirées de la
    // phrase avant de lire les mesures (le 8 n'est pas une longueur).
    // « … avec quatre bossages à insert M3 » : les ajouts de matière aussi, lus avant les découpes
    // (« l'avant-trou » des plots n'est pas un trou à percer).
    // « un boîtier pour mon Raspberry Pi 5 » : la carte nommée va sur ses plots, même sans le mot.
    const posables = ['boite', 'boite_couvercle'].includes(gDemande.id) ? produitsNommes(` ${plier(text)} `).map((n) => n.composant).filter((c) => c.carte || c.ecran) : [];
    // Un écran se pose sous un couvercle : la boîte en prend un.
    const g = gDemande.id === 'boite' && posables.some((c) => c.ecran) ? (gabarit('boite_couvercle') ?? gDemande) : gDemande;
    const carteSansPlots = posables.length > 0 && !/\bplots?\b/.test(plier(text));
    const matiere = lireAjouts(carteSansPlots ? `${plier(text)} plots` : plier(text));
    const opsMatiere = matiere.ops.filter((op) => op.action !== 'enlever');
    const lu = lireDecoupes(matiere.reste, { exigerFace: aSonTrou(g) });
    const ajouts = lu.ops.filter((op) => op.action !== 'enlever');
    if (!ajouts.length && !opsMatiere.length) return { gabarit: g, valeurs: demande.valeurs };
    let valeurs = lireMesures(lu.reste, g).valeurs;
    if (opsMatiere.length) {
      const m = appliquerAjouts(g, valeurs, opsMatiere, mesures, produits);
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

/** Les composants que le boîtier à écran sait tenir. */
const BOITIER_ECRAN_COMPOSANTS: readonly string[] = ['touch_display_2_7', 'raspberry_pi_5', 'camera_module_3_wide'];

/** Changements relatifs : « plus haut », « trou plus gros », « moins large ». */
const RELATIFS: { mots: RegExp; ids: string[] }[] = [
  { mots: /\btrou(?:s)? (?:un peu )?(?:plus|moins) (?:gros|grand|large|petit)|\b(?:plus|moins) (?:gros|grand|petit) (?:le |les )?trou/, ids: ['trou', 'vis'] },
  { mots: /\b(?:plus|moins) (?:haut|haute|bas|basse)\b/, ids: ['hauteur', 'dos', 'haut', 'branche1'] },
  { mots: /\b(?:plus|moins) (?:large|etroit)\b/, ids: ['largeur'] },
  { mots: /\b(?:plus|moins) (?:long|longue|court|courte)\b/, ids: ['longueur', 'branche1'] },
  { mots: /\b(?:plus|moins) (?:profond|profonde)\b/, ids: ['profondeur', 'base'] },
  { mots: /\b(?:plus|moins) (?:epais|epaisses?|fins?|fines?)\b/, ids: ['paroi', 'epaisseur'] },
  { mots: /\b(?:plus|moins) (?:incline|inclinee|penche|penchee)\b/, ids: ['angle', 'inclinaison'] },
];
const PLUS_PETIT = /\b(?:moins (?:gros|grand|large|long|longue|haut|haute|profond|profonde|epais|epaisse|incline|inclinee|penche)|plus (?:petit|bas|basse|etroit|court|courte|fin|fine))\b/;

function arrondi(x: number): number {
  return x >= 10 ? Math.round(x) : Math.round(x * 10) / 10;
}

/** Nouvelle valeur d'une mesure : +25 % (au moins 2 mm, 1 mm pour un trou), ou −20 %. */
function relatif(mesure: MesureNombre, actuelle: number, plus: boolean): number {
  // Écran du boîtier : « plus incliné » = plus couché vers l'arrière, de 5° en 5°.
  if (mesure.id === 'inclinaison') return actuelle + (plus ? 5 : -5);
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

const CHOISIR = /\b(?:reviens|retourne|revenir|garde|prends|reprends|choisis|remets|repasse|montre(?: moi)?|affiche) (?:a |sur )?la (?:version|v) ?(\d+|une?)\b|^(?:la |plutot la )?(?:version|v) ?(\d+|une?)$/;

const INFINITIFS: Record<string, string> = {
  ajouter: 'ajoute', rajouter: 'rajoute', mettre: 'mets', remettre: 'remets', faire: 'fais', percer: 'perce',
  agrandir: 'agrandis', elargir: 'elargis', allonger: 'allonge', rallonger: 'rallonge', augmenter: 'augmente',
  diminuer: 'diminue', reduire: 'reduis', baisser: 'baisse', retirer: 'retire', enlever: 'enleve', supprimer: 'supprime',
  imprimer: 'imprime', lancer: 'lance', deplacer: 'deplace', creuser: 'creuse', rehausser: 'rehausse', raccourcir: 'raccourcis',
};

/**
 * Une demande dite comme on parle, ramenée à l'ordre que lisent les règles :
 * « tu peux ajouter un couvercle ? » → « ajoute un couvercle », « il faudrait un trou… » →
 * « ajoute un trou… », « elle est trop basse » → « plus haute », « envoie-la à l'imprimante » →
 * « imprime la ». Texte déjà plié ; rien d'autre ne change.
 */
export function normaliserOrdre(t: string): string {
  let s = t.replace(/\s*,\s*$/, '').trim();
  s = s.replace(/^(?:(?:bon|alors|ok|euh|et|aussi|maintenant|du coup|ensuite|puis|bah|ben|stp|jarvis|ah|oh|tiens|au fait|sinon|apres)\s*,?\s+)+/, '');
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
  // « un trou … à 20 mm de hauteur » : la place du trou (à 20 mm du bas), pas la hauteur de la pièce.
  if (/\b(?:trous?|ouvertures?|fenetres?|encoches?|passages?|fentes?)\b/.test(s)) s = s.replace(/\ba (\d+(?:\.\d+)? ?(?:mm|cm)?) ?de (?:hauteur|haut)\b/, 'a $1 du bas');
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
    const fond = /ne tient pas (?:dans le fond|sous le couvercle) : il faut ([\d,.]+) × ([\d,.]+) mm au moins/.exec(erreur);
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
  for (let i = 0; i < 6; i += 1) {
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
  const decision = decider(text, precedentDonne, contexte);
  // Un écran d'une taille que la bibliothèque n'a pas (« un écran de 5 pouces ») : la réponse le dit,
  // au lieu de l'oublier sans rien dire (essai du 25 novembre).
  const oublie = decision.kind === 'dire' && decision.etat && decision.etat.etape !== 'piece' ? ecranInconnu(text) : null;
  if (decision.kind === 'dire' && oublie && !decision.texte.includes(oublie)) {
    return {
      ...decision,
      texte: `Je n'ai pas d'${oublie} dans ma bibliothèque : je ne lui fais pas de place tout seul. Quand la boîte sera là, dis-moi sa fenêtre (« une fenêtre de 110 par 65 sur le dessus »), ou donne-moi sa référence. ${decision.texte}`,
    };
  }
  return decision;
}

/** « un écran de 5 pouces », « écran tactile 3,5 pouces » : un écran nommé par sa taille, que la bibliothèque n'a pas. */
function ecranInconnu(text: string): string | null {
  const t = ` ${plier(text)} `;
  const m = /\becrans?(?: tactiles?| lcd| tft| ips| hdmi)?(?: de)? (\d+(?:\.\d+)?) ?pouces?\b/.exec(t);
  if (!m) return null;
  // Ceux que la bibliothèque connaît : l'écran officiel de 7 pouces, l'OLED de 1,3 pouce.
  const connus = produitsNommes(t).some((n) => n.composant.ecran || n.composant.id === 'touch_display_2_7');
  return connus ? null : `écran de ${m[1]!.replace('.', ',')} pouces`;
}

function decider(text: string, precedentDonne: AtelierEtat | null, contexte: ContexteAtelier = {}): AtelierDecision {
  const t = plier(text).replace(/^jarvis ,? ?/, '');
  const mesures = contexte.mesures ?? {};
  let depart = precedentDonne;
  // La même phrase ramenée à un ordre (« tu peux l'imprimer ? » → « imprime »), pour la pièce à l'écran.
  const tn = normaliserOrdre(t);
  // Un changement vient d'être refusé (« un trou de 50 : il ne tient pas ») : « bon alors de 10 »
  // le redemande avec ce nombre. Toute autre phrase oublie le refus.
  if (depart?.etape === 'piece' && depart.refus) {
    const refuse = depart.refus;
    const { refus: _refus, ...sansRefus } = depart;
    depart = sansRefus;
    const autre = /^(?:(?:bon|alors|ben|ok|et|non|plutot|du coup|sinon) )*(?:de |en |a )?(\d+(?:\.\d+)?)(?: ?(?:mm|cm))?(?: (?:alors|plutot|du coup|seulement|ca ira))*$/.exec(tn);
    if (autre && /\d/.test(refuse)) {
      return deciderAtelier(refuse.replace(/\d+(?:\.\d+)?/, autre[1]!), depart, contexte);
    }
  }
  // « mets 50 » puis « en hauteur » : le nombre gardé va à la mesure nommée.
  if (depart?.etape === 'piece' && depart.nombre) {
    const nombre = depart.nombre;
    const { nombre: _nombre, ...sansNombre } = depart;
    depart = sansNombre;
    if (!/\d/.test(tn) && tn.split(' ').length <= 5 && /\b(?:haut\w*|larg\w*|long\w*|profond\w*|epais\w*|parois?|fond|diametre|trous?)\b/.test(tn)) {
      const suite = deciderAtelier(`${tn.replace(/^(?:en|pour|sur|a|c est|de) (?:la |le |l )?/, '')} ${nombre}`, depart, contexte);
      if (suite.kind !== 'rien') return suite;
    }
  }
  // « non plus large » juste après « plus haute » : la correction part de la version d'avant (on ne
  // garde pas le changement qu'il vient de refuser).
  if (depart?.etape === 'piece' && /^non ,? ?(?:pas (?:ca|comme ca) ,? ?)?(?:plutot )?(?:un peu )?(?:plus|moins) [a-z]+$/.test(t)) {
    const piece = depart;
    const courante = piece.versions.find((v) => v.numero === piece.versionChoisie);
    const avant = piece.versions.filter((v) => v.numero < piece.versionChoisie).at(-1);
    if (courante?.changement && avant) {
      const suite = deciderAtelier(t.replace(/^non ,? ?(?:pas (?:ca|comme ca) ,? ?)?/, ''), { ...piece, versionChoisie: avant.numero }, contexte);
      if (suite.kind === 'fabriquer') return { ...suite, base: piece, changement: `${suite.changement ?? ''} (à partir de la version ${avant.numero})` };
    }
  }
  const precedent = depart;

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
    // Une réponse courte illisible aussi (« prends large partout », « bof ») : sinon un modèle
    // répondait à la place, avec un boîtier et des cotes inventés.
    const courteIllisible = t.split(' ').length <= 6 && !QUESTION.test(t) && !VERBE_AUTRE.test(t) && !SUJET_AUTRE.test(t) && !HORS_SUJET_COURT.test(t);
    if (suite.kind !== 'rien' || !(VOCABULAIRE_PIECE.test(t) || /\b(?:imprim\w*|3d)\b/.test(t) || courteIllisible)) return suite;
    const v = proposition.valeurs;
    return {
      kind: 'dire',
      texte: `Je n'ai pas compris. Pour la ${g?.nom ?? 'pièce'} de ${nombre(Number(v.longueur))} × ${nombre(Number(v.largeur))} × ${nombre(Number(v.hauteur))} mm, dis « oui » ; sinon redis-moi la pièce autrement.`,
      etat: proposition,
    };
  }

  // Le modèle exact demandé : la réponse est le produit à chercher, « je la mesure » passe au pied à
  // coulisse, « laisse tomber » arrête.
  if (precedent?.etape === 'produit') {
    const c = composant(precedent.composant);
    if (ANNULER.test(t)) return { kind: 'dire', texte: "D'accord, je laisse tomber." };
    if (c && MESURER_SOI_MEME.test(t)) {
      const q = prochaineMesure(c, mesures);
      if (q) return { kind: 'dire', texte: questionMesure(c, q, mesures), etat: { etape: 'mesure', composant: c.id, champ: q.champ, reprise: precedent.reprise } };
    }
    if (c && (NE_SAIT_PAS.test(t) || ATTENDS.test(t)) && !liensDits(text).length) {
      return {
        kind: 'dire',
        texte: ATTENDS.test(t)
          ? "Pas de souci, je t'attends. Donne-moi la référence de la carte quand tu l'as, ou dis « je la mesure »."
          : `Pas grave. La référence est souvent écrite sur la carte, ou sur la page où tu l'as achetée. Sinon : « je la mesure » si tu l'as sous la main, « celle de ta liste » si c'est ${c.nom}, ou « laisse tomber ».`,
        etat: precedent,
      };
    }
    // « d'accord dessine tout ça », « vas-y » : pas une référence à chercher. Avec de la marge si
    // c'est possible, sinon la question est reposée.
    const ordreDeDessiner = (FAIS_QUAND_MEME.test(t) || (ACCEPTE_DEFAUT.test(t) && t.split(' ').length <= 4)) && !/\d/.test(t) && !liensDits(text).length;
    if (c && ordreDeDessiner) {
      const larges = valeursLarges(precedent.reprise.texte, c.id, mesures);
      const premiere = larges[0];
      if (premiere) return { kind: 'mesure', composant: premiere.composant, champ: premiere.champ, valeur: premiere.valeur, large: true, larges, reprise: precedent.reprise };
      return {
        kind: 'dire',
        texte: `Je ne peux pas encore la dessiner : il me manque les cotes de ${c.nom}. Donne-moi sa référence ou un lien, dis « celle de ta liste » pour que je cherche ses cotes, « je la mesure » si tu l'as sous la main, ou « laisse tomber ».`,
        etat: precedent,
      };
    }
    const produit = c && !ordreDeDessiner ? lireProduit(text, t, c.nom) : null;
    if (c && produit) return { kind: 'chercherCotes', recherches: [{ composant: c.id, produit }], reprise: precedent.reprise };
    // Autre chose : la phrase suit son chemin (la question reste posée une fois).
  }

  // Une mesure de composant demandée : un nombre est la réponse, « laisse tomber » arrête.
  if (precedent?.etape === 'mesure') {
    const c = composant(precedent.composant);
    if (ANNULER.test(t)) return { kind: 'dire', texte: "D'accord, je laisse tomber. Les mesures déjà données sont gardées." };
    // « cherche avec ce lien : https://… » : la page ou le plan donné est lu pour ce composant.
    if (c && liensDits(text).length) {
      return { kind: 'chercherCotes', recherches: [{ composant: c.id, produit: produitAvecLien(text, contexte.produits?.[c.id]?.produit ?? c.nom) }], reprise: precedent.reprise };
    }
    const q = c?.aMesurer?.find((x) => x.champ === precedent.champ);
    // « prends large », « je ne sais pas » : une marge annoncée, seulement pour l'encombrement.
    if (c && q && SANS_LA_PIECE.test(t) && !/\d/.test(t)) {
      if (PARTOUT.test(t)) {
        const larges = valeursLarges(precedent.reprise.texte, c.id, mesures);
        const premiere = larges[0];
        if (premiere) return { kind: 'mesure', composant: premiere.composant, champ: premiere.champ, valeur: premiere.valeur, large: true, larges, reprise: precedent.reprise };
      }
      if (q.large !== undefined) return { kind: 'mesure', composant: c.id, champ: q.champ, valeur: q.large, large: true, reprise: precedent.reprise };
      return {
        kind: 'dire',
        texte: `Pour ${q.nom}, je ne peux pas prendre de marge : la pièce serait fausse. Regarde le plan ou la photo cotée du vendeur, ou colle-moi le lien d'un plan (« cherche avec ce lien : … »).`,
        etat: precedent,
      };
    }
    if (c && q && (MESURER_SOI_MEME.test(t) || ATTENDS.test(t)) && !/\d/.test(t)) {
      return { kind: 'dire', texte: `${ATTENDS.test(t) ? "Pas de souci, je t'attends. " : ''}${questionMesure(c, q, mesures)}`, etat: precedent };
    }
    if (c && q && FAIS_QUAND_MEME.test(t) && !/\d/.test(t) && t.split(' ').length <= 12) {
      const larges = valeursLarges(precedent.reprise.texte, c.id, mesures);
      const premiere = larges[0];
      if (premiere) return { kind: 'mesure', composant: premiere.composant, champ: premiere.champ, valeur: premiere.valeur, large: true, larges, reprise: precedent.reprise };
      return {
        kind: 'dire',
        texte: `Je ne peux pas encore la dessiner : il me manque ${q.nom}, et là je ne peux pas prendre de marge, la pièce serait fausse. ${questionMesure(c, q, mesures)}`,
        etat: precedent,
      };
    }
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
    // « vas-y imprime », « bon mets-la plutôt en file d'attente » : l'ordre, sans ses mots de liaison.
    const to = sansLiaisons(tn);
    // Un ensemble (boîtier à écran) s'imprime pièce par pièce : « imprime la façade », « mets le
    // socle dans la file ». Sans pièce nommée, Jarvis demande laquelle.
    const ensemble = precedent.versions.find((v) => v.numero === precedent.versionChoisie)?.pieces;
    if (ensemble?.length) {
      const versFile = /\b(?:file|liste) d attente\b|\bdans la file\b/.test(to);
      const ordre = /^(?:imprime|imprimes|lance|mets|met|ajoute|rajoute|envoie|place)\b/.test(to) && (versFile || /^(?:imprime|imprimes|lance)\b/.test(to));
      if (ordre) {
        const piece = pieceDite(to, ensemble);
        if (piece) return { kind: versFile ? 'file' : 'imprimer', etat: precedent, numero: precedent.versionChoisie, piece: piece.nom };
        if (numeroAImprimer(to, precedent) !== null || numeroEnFile(to, precedent) !== null) {
          return {
            kind: 'dire',
            texte: `Le boîtier a ${ensemble.length} pièces à imprimer une par une : ${ensemble.map((p) => (p.nombre > 1 ? `${p.titre} (× ${p.nombre})` : p.titre)).join(', ')}. Dis-moi laquelle, par exemple « imprime la façade ».`,
            etat: precedent,
          };
        }
      }
    }
    const imprimer = numeroAImprimer(to, precedent);
    if (imprimer !== null) {
      if (!precedent.versions.some((v) => v.numero === imprimer)) {
        return { kind: 'dire', texte: `Il n'y a pas de version ${imprimer}. Les versions sont : ${precedent.versions.map((v) => v.numero).join(', ')}.` };
      }
      return { kind: 'imprimer', etat: precedent, numero: imprimer };
    }
    const enFile = numeroEnFile(to, precedent);
    if (enFile !== null) {
      if (!precedent.versions.some((v) => v.numero === enFile)) {
        return { kind: 'dire', texte: `Il n'y a pas de version ${enFile}. Les versions sont : ${precedent.versions.map((v) => v.numero).join(', ')}.` };
      }
      return { kind: 'file', etat: precedent, numero: enFile };
    }
  }

  if (plateauVideLanceSuivante(text)) return { kind: 'lancerSuivante' };
  // « lance la suivante » avec une pièce de l'atelier dans la discussion, sans dire que le plateau est
  // vide : on le demande (sinon la phrase partait à la musique, « morceau suivant »).
  if (precedent?.etape === 'piece' && /^(?:lance|lances|lancer|imprime|demarre) (?:la |le )?(?:suivante?|prochaine?)(?: piece)?$/.test(tn)) {
    return { kind: 'dire', texte: 'Pour lancer la pièce suivante de la file, dis-moi d’abord que le plateau est vide : « le plateau est vide, lance la suivante ».', etat: precedent };
  }
  // « imprime-la », « mets-la dans la file » sans aucune pièce dans la discussion.
  // « imprime-la », « mets-la dans la file » visent une pièce (le pronom) : l'atelier répond. « imprime »
  // et « lance l'impression » seuls sont à l'imprimante du lot B dans Jarvis Test ; dans la Live, où
  // l'atelier est seul, il répond aussi.
  const sansPiece =
    /^(?:imprime|imprimes) (?:la|le|les)$|^(?:mets|met|ajoute|rajoute|envoie) (?:la|le|les) (?:dans|a|en|sur) (?:la )?(?:file|liste)(?: d attente)?$/.test(tn) ||
    (contexte.sansAutreImprimante === true && /^(?:imprime|imprimes|lance l impression)$/.test(tn));
  if (precedent?.etape !== 'piece' && sansPiece) {
    return { kind: 'dire', texte: "Je n'ai pas de pièce à imprimer dans cette discussion. Demande-moi d'abord une pièce, par exemple « fais-moi une boîte de 80 par 50 par 30 »." };
  }

  // Sinon, une nouvelle pièce passe avant tout.
  const produits = Object.fromEntries(Object.entries(contexte.produits ?? {}).map(([id, p]) => [id, p.produit]));
  // « une boîte pour mon raspberry pi 4 » : le « 4 » n'est pas une longueur. Le nom d'une carte que
  // la bibliothèque n'a pas est retiré avant de lire les mesures.
  const carteInconnue = composantNomme(` ${plier(text)} `) ? null : CARTE_INCONNUE.exec(plier(text));
  const nouvelle = demandePiece(carteInconnue ? plier(text).replace(carteInconnue[0], 'ma carte') : text, mesures, produits);
  if (nouvelle) {
    if (nouvelle.question) {
      return chercherOuDemander(text, nouvelle.question, { texte: text, piece: null }, contexte);
    }
    if (!nouvelle.gabarit && /\b(?:une piece|un truc|quelque chose|un objet|un machin|une chose)\b/.test(tn) && !OBJET_PRECIS.test(tn)) {
      return { kind: 'dire', texte: `En 3D, je sais dessiner et préparer pour l'imprimante : ${piecesConnues()}, et un boîtier pour une carte électronique (Raspberry Pi 5, ESP32). Dis-moi laquelle, avec ses mesures si tu les as : « fais-moi une boîte de 80 par 50 par 30 ».`, etat: { etape: 'choix' } };
    }
    if (!nouvelle.gabarit) {
      return {
        kind: 'dire',
        texte: `Je ne sais pas encore dessiner ça. Je sais faire : ${piecesConnues()}. Dis-moi laquelle s'en approche.`,
        etat: { etape: 'choix' },
      };
    }
    if (nouvelle.erreurs?.length) {
      if (nouvelle.gabarit.id === 'boitier_ecran') return { kind: 'dire', texte: nouvelle.erreurs.join(' ') };
      return { kind: 'dire', texte: `${nouvelle.erreurs.join(' ')} Redis-moi la pièce sans cette découpe, ou ailleurs.` };
    }
    const pourCarte = taillePourCarte(nouvelle.gabarit, nouvelle.valeurs);
    if (pourCarte) return pourCarte;
    const inconnue = ['boite', 'boite_couvercle'].includes(nouvelle.gabarit.id) ? carteInconnue : null;
    const avant = inconnue
      ? `Je n'ai pas les cotes de « ${inconnue[0]} » dans ma bibliothèque : je te fais une ${nouvelle.gabarit.nom} simple à tes mesures, sans plots ni ouvertures pour ses prises. `
      : `${majuscule(nouvelle.gabarit.nom)}, d'accord. `;
    return demanderOuFabriquer(nouvelle.gabarit, nouvelle.valeurs, avant);
  }

  // « tu sais faire quoi comme pièces en 3D », « j'aimerais imprimer un truc », « modélise-moi ça » :
  // l'atelier dit ce qu'il sait faire (aucune équipe du chef d'orchestre ne le sait).
  const envie = ENVIE_3D.test(tn) || ENVIE_3D.test(t) || /^(?:imprime|modelise|fabrique)(?: moi| nous)? (?:un truc|quelque chose|un objet|une piece|ca|un machin)\b/.test(tn);
  if (CAPACITES.test(tn) || CAPACITES.test(t) || (envie && !SUJET_AUTRE.test(tn) && !/\b(?:document|page|pdf|fichier|photo|image|texte|mail|facture|feuille)s?\b/.test(tn))) {
    return { kind: 'dire', texte: `En 3D, je sais dessiner et préparer pour l'imprimante : ${piecesConnues()}, et un boîtier pour une carte électronique (Raspberry Pi 5, ESP32). Dis-moi laquelle, avec ses mesures si tu les as : « fais-moi une boîte de 80 par 50 par 30 ».`, etat: { etape: 'choix' } };
  }
  // Dans une discussion d'atelier (une pièce, une question), « fais-moi un pot de fleurs » demande une
  // autre pièce : l'atelier dit qu'il ne sait pas la dessiner, au lieu de laisser un modèle répondre.
  if (precedent && DEMANDE.test(tn) && !/\bdessin\w*\b/.test(tn) && /^(?:[a-z]+ ){1,4}?(?:un|une|des) /.test(tn) && !VOCABULAIRE_PIECE.test(tn) && !SUJET_AUTRE.test(tn) && !PAS_UNE_PIECE.test(tn) && tn.split(' ').length <= 12) {
    return {
      kind: 'dire',
      texte: `Je ne sais pas encore dessiner ça. Je sais faire : ${piecesConnues()}. Dis-moi laquelle s'en approche.`,
      etat: { etape: 'choix' },
    };
  }
  // « rajoute un écran tactile avec une caméra » sans aucune pièce dans la discussion.
  if (!precedent && /^(?:ajoute|rajoute)\b/.test(tn) && composantNomme(` ${tn} `)) {
    return {
      kind: 'dire',
      texte: "Je n'ai pas de pièce à l'écran où le mettre. Demande-moi le boîtier en entier, par exemple « fais-moi un boîtier pour mon Raspberry Pi 5 avec l'écran tactile 7 pouces et la caméra ».",
    };
  }
  // Jarvis vient de dire ce qu'il sait faire : le nom d'une pièce suffit (« bah une boîte alors »).
  if (precedent?.etape === 'choix') {
    if (ANNULER.test(t)) return { kind: 'dire', texte: "D'accord, je laisse tomber." };
    const choisie = t.split(' ').length <= 14 ? comprendre(text) : null;
    if (choisie?.gabarit) {
      const pourCarte = taillePourCarte(choisie.gabarit, choisie.valeurs);
      if (pourCarte) return pourCarte;
      return demanderOuFabriquer(choisie.gabarit, choisie.valeurs, `${majuscule(choisie.gabarit.nom)}, d'accord. `);
    }
    if (/\b(?:rang\w+|tri(?:er)?|vis|ecrous?|composants?|resistances?|bazar|bordel|outils?|forets?)\b/.test(t)) {
      return { kind: 'dire', texte: 'Pour ranger, je peux faire une boîte, une boîte avec couvercle ou un bac à compartiments. Laquelle ?', etat: precedent };
    }
    return { kind: 'rien' };
  }
  // Une question de mesure ou de modèle en attente, et une réponse courte que je ne sais pas lire :
  // la question est reposée (sinon la phrase part à un modèle qui ne connaît pas la pièce).
  if (precedent?.etape === 'mesure' || precedent?.etape === 'produit') {
    const c = composant(precedent.composant);
    const court = t.split(' ').length <= 6 && !QUESTION.test(t) && !VERBE_AUTRE.test(t) && !SUJET_AUTRE.test(t) && !HORS_SUJET_COURT.test(t);
    if (c && court) {
      if (precedent.etape === 'mesure') {
        const q = c.aMesurer?.find((x) => x.champ === precedent.champ);
        if (q) return { kind: 'dire', texte: `Je n'ai pas compris ta réponse. ${questionMesure(c, q, mesures)} Ou dis « prends large », ou « laisse tomber ».`, etat: precedent };
      } else {
        return { kind: 'dire', texte: "Je n'ai pas compris ta réponse. Donne-moi la référence de la carte, colle un lien, ou dis « celle de ta liste », « je la mesure » ou « laisse tomber ».", etat: precedent };
      }
    }
  }
  if (!precedent || precedent.etape === 'mesure' || precedent.etape === 'produit') return { kind: 'rien' };
  const g0 = gabarit(precedent.gabarit);
  if (!g0) return { kind: 'rien' };
  let g: Gabarit = g0;

  if (precedent.etape === 'question') {
    if (ANNULER.test(t)) return { kind: 'dire', texte: "D'accord, je laisse tomber cette pièce." };
    const mesure = g.mesures.find((m) => m.id === precedent.mesure);
    if (!mesure) return { kind: 'rien' };
    const question = prochaineQuestion(g, precedent.valeurs)?.texte ?? '';
    // « c'est quoi déjà la question », « répète » : la question est redite.
    if (REPETER.test(t)) return { kind: 'dire', texte: question, etat: precedent };
    if (ATTENDS.test(t) && !/\d/.test(t)) return { kind: 'dire', texte: `Pas de souci, je t'attends. ${question}`, etat: precedent };
    const nombreDeMots = t.split(' ').filter((m) => m !== ',').length;
    // « 10 par 6 par 3 centimètres » : plusieurs cotes d'un coup, celle demandée d'abord puis les suivantes.
    if (!estChoix(mesure) && (t.match(/\d+(?:\.\d+)?/g) ?? []).length >= 2 && nombreDeMots <= 14) {
      const ordre = [mesure.id, ...g.suite.filter((id) => id !== mesure.id && !(id in precedent.valeurs))];
      const plusieurs = lireMesures(text, { ...g, suite: ordre }).valeurs;
      if (Object.keys(plusieurs).length >= 2) {
        for (const m of g.mesures) {
          if (!(m.id in plusieurs)) continue;
          const refus = horsBornes(m, plusieurs[m.id]!);
          if (refus) return { kind: 'dire', texte: `${refus} ${question}`.trim(), etat: precedent };
        }
        return demanderOuFabriquer(g, { ...precedent.valeurs, ...plusieurs });
      }
    }
    const accepte = ACCEPTE_DEFAUT.test(t) && !/\d/.test(t);
    const reponse = accepte ? mesure.defaut : lireReponse(g, mesure.id, text);
    const longue = nombreDeMots > 8 && !OUI.test(t) && !accepte;
    if (reponse === null || longue) {
      // « non » : la valeur proposée ne va pas, on demande laquelle.
      if (REFUS.test(t) && nombreDeMots <= 3) {
        return { kind: 'dire', texte: `D'accord. Dis-moi la valeur que tu veux pour ${mesure.nom}, ou « laisse tomber ».`, etat: precedent };
      }
      // Une réponse courte que je ne sais pas lire : la question est reposée, au lieu de partir à un
      // modèle qui ne connaît pas la pièce. Une vraie autre demande (« quelle heure est-il ? »,
      // « mets la musique ») suit son chemin.
      if (!longue && nombreDeMots <= 6 && !QUESTION.test(t) && !VERBE_AUTRE.test(t) && !SUJET_AUTRE.test(t) && !HORS_SUJET_COURT.test(t)) {
        return { kind: 'dire', texte: `Je n'ai pas compris ta réponse. ${question}`.trim(), etat: precedent };
      }
      return { kind: 'rien' };
    }
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
    const dite = choisir[1] ?? choisir[2] ?? '';
    const numero = /^une?$/.test(dite) ? 1 : Number(dite);
    if (!precedent.versions.some((v) => v.numero === numero)) {
      return { kind: 'dire', texte: `Il n'y a pas de version ${numero}.` };
    }
    return { kind: 'choisir', etat: precedent, numero };
  }
  // « réessaie », « remontre-la », « renvoie les images » : la même version, renvoyée telle quelle
  // (nouvelles images sur le téléphone), sans rien redessiner.
  if (REMONTRER.test(tn) && !/\b(?:file|imprimante|camera|ecran du pc)\b/.test(tn)) return { kind: 'choisir', etat: precedent, numero: precedent.versionChoisie };
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
    // « elle fait combien de haut » : la hauteur seule ; « c'est quoi les dimensions » : tout.
    const une = /\b(?:haute?|hauteur)\b/.test(tn) ? 'hauteur' : /\b(?:large|largeur)\b/.test(tn) ? 'largeur' : /\b(?:longue?|longueur)\b/.test(tn) ? 'longueur' : null;
    const mesureDite = une ? g.mesures.find((m) => m.id === une) : undefined;
    if (une && mesureDite && actuelle.valeurs[une] !== undefined) {
      const toutes = actuelle.mesures.map((m) => `${m.nom.toLowerCase()} ${m.valeur}`).join(', ');
      return {
        kind: 'dire',
        texte: `Version ${actuelle.numero} : ${valeurDite(mesureDite, actuelle.valeurs[une]!)} de ${une === 'hauteur' ? 'haut' : une === 'largeur' ? 'large' : 'long'}. Toutes les cotes : ${toutes}.`,
        etat: precedent,
      };
    }
    const cotes = actuelle.mesures.map((m) => `${m.nom.toLowerCase()} ${m.valeur}`).join(', ');
    return { kind: 'dire', texte: `Version ${actuelle.numero} : ${cotes}.`, etat: precedent };
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
  if (PLUS_GRANDE.test(tn) && !lireDelta(tn, g, valeurs) && !/\b(?:longueur|largeur|hauteur|long|large|haut|profond)\w*\b/.test(tn) && !/\b(?:trous?|fenetres?|ouvertures?|encoches?|fentes?|passages?|decoupes?|aerations?)\b/.test(tn)) {
    return { kind: 'dire', texte: 'Plus longue, plus large ou plus haute ? Dis-moi aussi de combien, par exemple « 10 mm plus haute ».', etat: precedent };
  }
  // « fais passer le câble par le côté gauche » = un passage de câble sur ce côté.
  let tPiece = tn.replace(/^(?:fais|fait|faire) (?:passer|sortir) (?:le |les |un |des )?(cables?)\b (?:par|sur|a|au|vers|de) /, 'ajoute un passage de $1 sur ');
  // « les ports à gauche plutôt », « mets les prises à droite » sans nommer la carte : la boîte n'en
  // tient qu'une, c'est elle qu'on retourne (sinon la phrase partait à un modèle, qui inventait une
  // « version 2 »).
  if (/\b(?:ports?|prises?|connecteurs?|sorties?|usb)\b/.test(tPiece) && !composantNomme(` ${tPiece} `)) {
    const cartes = lireAjoutsPoses(valeurs).filter((a) => a.genre === 'composant' && a.composant && composant(a.composant)?.carte);
    const seule = cartes.length === 1 ? composant(cartes[0]!.composant!) : null;
    const nomCarte = seule ? plier(seule.nom) : '';
    if (seule && composantNomme(` ${nomCarte} `)?.id === seule.id) {
      tPiece = `mets le ${nomCarte} ${tPiece.replace(/^(?:mets|met|tourne|place|deplace|bouge|change) /, '').replace(/\bsorties?\b/, 'ports').replace(/\b(?:plutot|stp)\b/g, '').trim()}`;
    }
  }
  // Matière ajoutée d'abord : « ajoute quatre bossages », « le bossage plus haut », « fais que le
  // couvercle s'emboîte ». Les découpes sont lues dans ce qui reste.
  const matiere = court ? lireAjouts(tPiece) : { ops: [], reste: tPiece };
  if (matiere.ops.length) {
    // Un écran se pose sous un couvercle : une boîte ouverte en prend un.
    const ecran = matiere.ops.some((op) => op.action === 'ajouter' && op.champs.composant && composant(op.champs.composant)?.ecran);
    if (g.id === 'boite' && ecran) {
      const avecCouvercle = gabarit('boite_couvercle');
      if (avecCouvercle) {
        g = avecCouvercle;
        changementsDecoupes.push('Couvercle ajouté (l’écran se pose dessous)');
      }
    }
    const r = appliquerAjouts(g, valeurs, matiere.ops, mesures, Object.fromEntries(Object.entries(contexte.produits ?? {}).map(([id, p]) => [id, p.produit])));
    if (r.question) {
      return chercherOuDemander(text, r.question, { texte: text, piece: precedent }, contexte);
    }
    if (r.erreurs.length) return { kind: 'dire', texte: `${r.erreurs.join(' ')} La version ${actuelle.numero} reste à l'écran.`, etat: { ...precedent, refus: tn } };
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
    if (r.erreurs.length) return { kind: 'dire', texte: `${r.erreurs.join(' ')} La version ${actuelle.numero} reste à l'écran.`, etat: { ...precedent, refus: tn } };
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
  // « bon alors 10 », « mets 50 » : un nombre seul, sans dire quelle mesure. On demande laquelle, au
  // lieu de changer la longueur (essai de la nuit : la boîte de 60 était passée à 10 mm de long).
  const nombresDits = tReste.match(/\d+(?:\.\d+)?/g) ?? [];
  if (!delta && !seule && !lu.ops.length && !matiere.ops.length && nombresDits.length === 1 && Object.keys(dites).length === 1 && !Object.keys(nommees(lues, tReste, g)).length && !ENCORE.test(tn)) {
    const n = nombresDits[0]!.replace('.', ',');
    return {
      kind: 'dire',
      texte: `${n} pour quelle mesure ? Dis par exemple « hauteur ${n} », « largeur ${n} », ou « un trou de ${n} à l'arrière ».`,
      etat: { ...precedent, nombre: nombresDits[0]! },
    };
  }
  Object.assign(valeurs, dites);

  // « et le même à droite » : la découpe ajoutée par la version à l'écran, refaite là où il dit.
  const meme = !lu.ops.length && !matiere.ops.length ? LE_MEME.exec(tn) : null;
  if (meme && actuelle.changement) {
    const rond = /Ajout : (?:\d+ )?trous? de ([\d,]+) mm/.exec(actuelle.changement);
    const rect = /Ajout : ouverture de ([\d,]+) × ([\d,]+) mm/.exec(actuelle.changement);
    const phrase = rond ? `ajoute un trou de ${rond[1]!.replace(',', '.')} ${meme[1]}` : rect ? `ajoute une ouverture de ${rect[1]!.replace(',', '.')} par ${rect[2]!.replace(',', '.')} ${meme[1]}` : null;
    if (phrase) {
      const suite = deciderAtelier(phrase, precedent, contexte);
      if (suite.kind !== 'rien') return suite;
    }
  }
  // « encore un peu » : la mesure changée par la version à l'écran, une fois de plus dans le même sens.
  if (ENCORE.test(tn) && actuelle.changement) {
    const dernier = /^([^:,]+) : ([\d,.]+)[^→]*→ ([\d,.]+)/.exec(actuelle.changement);
    const mesure = dernier ? g.mesures.find((m) => !estChoix(m) && majuscule(m.nom) === dernier[1]!.trim()) : undefined;
    if (dernier && mesure && !estChoix(mesure)) {
      const avant = Number(dernier[2]!.replace(',', '.'));
      const apres = Number(dernier[3]!.replace(',', '.'));
      const courante = Number(valeurs[mesure.id] ?? mesure.defaut);
      if (apres !== avant) valeurs[mesure.id] = arrondi(courante + (apres - avant));
    }
  }

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
    // Sans verbe aussi (« les parois en plus fin », « le couvercle à charnière ») : une phrase courte
    // qui ne parle que de la pièce ne part pas à un modèle, qui inventerait une nouvelle version.
    const sansVerbe =
      tn.split(' ').length <= 8 &&
      VOCABULAIRE_PIECE.test(tn) &&
      /^(?:le|la|les|l|un|une|des|du|au|aux|en|avec|sans|plus|moins|pareil|et|plutot)\b/.test(tn) &&
      !/\b(?:ne|n|pas|marche|marchent|fonctionne|fonctionnent|est|sont|ont|etait|sera|fait|font)\b/.test(tn);
    if (ordreSurPiece(tn) || sansVerbe) {
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

/**
 * Note ajoutée aux consignes des équipes du chef d'orchestre quand l'atelier existe (jamais au
 * cerveau qui trie, jamais au chat sans orchestre). Sans elle, un modèle qui reçoit une phrase
 * d'atelier mal lue répond « je ne peux pas imprimer », ou imite les réponses de l'atelier et invente
 * une « version 2 » avec des cotes (nuit du 25 novembre).
 */
export const ATELIER_NOTE_EQUIPES =
  "ATELIER 3D : Jarvis a un atelier qui dessine et prépare pour l'imprimante 3D des pièces simples (boîte, boîte avec couvercle, bac à compartiments, entretoise, équerre, crochet, support de téléphone, socle, porte-étiquette, cale, boîtier pour Raspberry Pi 5 ou ESP32). Ce n'est pas toi qui le fais : tu ne dessines, ne modifies et n'imprimes aucune pièce, tu n'annonces jamais de « version » ni de cotes de pièce, et tu ne dis jamais que Jarvis ne peut pas imprimer en 3D. Les images, photos et dessins ne concernent pas l'atelier : pour eux, fais comme d'habitude. Si l'utilisateur veut une pièce ou un changement sur sa pièce, réponds en une phrase qu'il le redise simplement à l'atelier, par exemple « fais-moi une boîte de 80 par 50 par 30 » ou « hauteur 40 ».";

/** Ce qu'un modèle de langage voit à la place d'une réponse de l'atelier. */
export const ATELIER_REPONSE_MASQUEE = "(Réponse de l'atelier 3D, déjà montrée à l'utilisateur. Tu ne la connais pas : ne l'imite pas, n'invente ni version ni cotes.)";

/**
 * La discussion telle qu'un modèle de langage la reçoit : les réponses de l'atelier (celles qui
 * portent son état) sont masquées. Sans cela, un modèle qui reçoit une phrase d'atelier mal lue
 * imite ces réponses et annonce une « Version 5 » avec des cotes inventées (nuit du 25 novembre).
 * Sans réponse d'atelier, la liste est rendue telle quelle.
 */
export function masquerAtelier<T extends { role: string; content: string; atelier?: AtelierEtat }>(messages: readonly T[]): readonly T[] {
  if (!messages.some((m) => m.role === 'assistant' && m.atelier)) return messages;
  return messages.map((m) => (m.role === 'assistant' && m.atelier ? { ...m, content: ATELIER_REPONSE_MASQUEE } : m));
}
