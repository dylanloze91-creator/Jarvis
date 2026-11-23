/**
 * Atelier 3D dans la discussion : ce que veut dire une phrase, sans modèle et sans rien lancer.
 *
 * L'état de l'atelier vit dans la discussion elle-même : la réponse de Jarvis porte un champ
 * `atelier` (question en cours, ou pièce avec ses versions). La phrase suivante est lue avec ce
 * qui précède : une réponse à la question, « plus haut », « trou de 5 », « imprime la version 2 ».
 * Le rendu (OpenSCAD), le contrôle, le tranchage et l'imprimante sont faits ailleurs, côté PC ;
 * ici, seulement des décisions.
 */
import { estChoix, gabarit, GABARITS, type Gabarit, type Mesure, type MesureNombre, type Valeurs } from './gabarits.js';
import { appliquerDecoupes, avecDecoupes, decoupesAffichees, decoupesDe, lireDecoupes, sePerce } from './decoupes.js';
import { ajoutsAffiches, appliquerAjouts, avecAjouts, lireAjouts } from './ajouts.js';
import { ajouterMesure, composant, lireMesure, questionMesure, type MesuresComposants } from './composants.js';
import { comprendre, lireMesures, lireReponse, plier, prochaineQuestion } from './lecture.js';

/** Une version rendue de la pièce. Les fichiers sont des noms simples, dans le dossier de la pièce. */
export interface AtelierVersionInfo {
  numero: number;
  valeurs: Valeurs;
  /** « Boîte de 80 × 50 × 30 mm. » */
  fiche: string;
  mesures: { nom: string; valeur: string }[];
  /** Taille annoncée par le gabarit (mm), pour le contrôle du STL dans la fenêtre. */
  taille: [number, number, number];
  /** `v2.stl` ; `null` si OpenSCAD n'a pas pu la rendre. */
  stl: string | null;
  image?: string;
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
const VOULOIR = /^(?:jarvis )?(?:je voudrais|j aimerais|il me faut|j ai besoin d) (?:un|une|des)\b/;
const EN_3D = /\b(?:en 3d|imprimante 3d|impression 3d|a imprimer|pour l imprimante)\b/;
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
  const commande = DEMANDE.test(t) || VOULOIR.test(t);
  if (!commande) return null;
  const demande = comprendre(text);
  if (demande.gabarit) {
    // « … avec un trou de 8 à l'arrière » : les découpes sont lues à part, et retirées de la
    // phrase avant de lire les mesures (le 8 n'est pas une longueur).
    const g = demande.gabarit;
    // « … avec quatre bossages à insert M3 » : les ajouts de matière aussi, lus avant les découpes
    // (« l'avant-trou » des plots n'est pas un trou à percer).
    const matiere = lireAjouts(plier(text));
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
  // Verbe d'atelier sans pièce connue : seulement si la phrase parle d'impression 3D
  // (« dessine-moi un chat » reste une image).
  return EN_3D.test(t) ? { gabarit: null, valeurs: {} } : null;
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
  /^(?:mets|met|mettre|ajoute|ajouter|place)(?: (?:la|le|les))?(?: (?:version|v) ?(\d+))? (?:dans|a|en|sur) (?:la )?(?:file|liste) d attente$|^(?:mets|met|mettre|ajoute|ajouter|place)(?: (?:la|le|les))?(?: (?:version|v) ?(\d+))? (?:dans|a|en|sur) la file$/;

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

/**
 * Que faire de cette phrase, sachant le dernier état de l'atelier dans la discussion ?
 * `rien` : la phrase n'est pas pour l'atelier, le tour suit son chemin habituel.
 */
export function deciderAtelier(text: string, precedent: AtelierEtat | null, contexte: ContexteAtelier = {}): AtelierDecision {
  const t = plier(text).replace(/^jarvis ,? ?/, '');
  const mesures = contexte.mesures ?? {};

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
    const imprimer = numeroAImprimer(t, precedent);
    if (imprimer !== null) {
      if (!precedent.versions.some((v) => v.numero === imprimer)) {
        return { kind: 'dire', texte: `Il n'y a pas de version ${imprimer}. Les versions sont : ${precedent.versions.map((v) => v.numero).join(', ')}.` };
      }
      return { kind: 'imprimer', etat: precedent, numero: imprimer };
    }
    const enFile = numeroEnFile(t, precedent);
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
    return demanderOuFabriquer(nouvelle.gabarit, nouvelle.valeurs, `${majuscule(nouvelle.gabarit.nom)}, d'accord. `);
  }

  if (!precedent || precedent.etape === 'mesure') return { kind: 'rien' };
  const g = gabarit(precedent.gabarit);
  if (!g) return { kind: 'rien' };

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
  const choisir = CHOISIR.exec(t);
  if (choisir) {
    const numero = Number(choisir[1]);
    if (!precedent.versions.some((v) => v.numero === numero)) {
      return { kind: 'dire', texte: `Il n'y a pas de version ${numero}.` };
    }
    return { kind: 'choisir', etat: precedent, numero };
  }

  const actuelle = precedent.versions.find((v) => v.numero === precedent.versionChoisie) ?? precedent.versions[precedent.versions.length - 1];
  if (!actuelle) return { kind: 'rien' };
  let valeurs: Valeurs = { ...actuelle.valeurs };

  // Découpes : « ajoute un trou de 8 à l'arrière », « enlève l'encoche », « le trou plus gros ».
  // Dans une phrase de 25 mots au plus (« j'ai un trou dans mon emploi du temps » reste au chat).
  const changementsDecoupes: string[] = [];
  let resteTexte = text;
  const court = t.split(' ').length <= 25;
  // Matière ajoutée d'abord : « ajoute quatre bossages », « le bossage plus haut », « fais que le
  // couvercle s'emboîte ». Les découpes sont lues dans ce qui reste.
  const matiere = court ? lireAjouts(t) : { ops: [], reste: t };
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
  const dites = mots <= 10 ? lireMesures(resteTexte, g).valeurs : {};
  Object.assign(valeurs, dites);

  // « Le trou plus haut » parle de la découpe, pas de la hauteur de la pièce.
  for (const regle of lu.ops.length || matiere.ops.length ? [] : RELATIFS) {
    if (!regle.mots.test(t)) continue;
    const id = regle.ids.find((x) => g.mesures.some((m) => m.id === x && !estChoix(m)) && !(x in dites));
    if (!id) continue;
    const mesure = g.mesures.find((m) => m.id === id) as MesureNombre;
    const courante = Number(valeurs[id] ?? mesure.defaut);
    const plus = !PLUS_PETIT.test(t);
    valeurs[id] = relatif(mesure, courante, plus);
  }

  const changement = [changementDe(g, actuelle.valeurs, valeurs), ...changementsDecoupes].filter(Boolean).join(', ');
  if (!changement) return { kind: 'rien' };
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
