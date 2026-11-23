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
  | { kind: 'choisir'; etat: Extract<AtelierEtat, { etape: 'piece' }>; numero: number };

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
  return g.mesures.filter((m) => m.id in valeurs).map((m) => ({ nom: majuscule(m.nom), valeur: valeurDite(m, valeurs[m.id]!) }));
}

/** Liste des pièces que l'atelier sait faire, pour une demande hors bibliothèque. */
export function piecesConnues(): string {
  const noms = GABARITS.map((g) => g.nom);
  return `${noms.slice(0, -1).join(', ')} et ${noms[noms.length - 1]}`;
}

/** Nouvelle pièce demandée ? (règles seules). */
export function demandePiece(text: string): { gabarit: Gabarit | null; valeurs: Valeurs } | null {
  const t = plier(text).replace(/^jarvis ,? ?/, '');
  const commande = DEMANDE.test(t) || VOULOIR.test(t);
  if (!commande) return null;
  const demande = comprendre(text);
  if (demande.gabarit) return { gabarit: demande.gabarit, valeurs: demande.valeurs };
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
const CHOISIR = /\b(?:reviens|retourne|revenir|garde|prends|choisis) (?:a )?la (?:version|v) ?(\d+)\b/;

/**
 * Que faire de cette phrase, sachant le dernier état de l'atelier dans la discussion ?
 * `rien` : la phrase n'est pas pour l'atelier, le tour suit son chemin habituel.
 */
export function deciderAtelier(text: string, precedent: AtelierEtat | null): AtelierDecision {
  const t = plier(text).replace(/^jarvis ,? ?/, '');

  // Une pièce à l'écran : « imprime-la », « imprime la boîte » passe avant une nouvelle demande.
  if (precedent?.etape === 'piece') {
    const imprimer = numeroAImprimer(t, precedent);
    if (imprimer !== null) {
      if (!precedent.versions.some((v) => v.numero === imprimer)) {
        return { kind: 'dire', texte: `Il n'y a pas de version ${imprimer}. Les versions sont : ${precedent.versions.map((v) => v.numero).join(', ')}.` };
      }
      return { kind: 'imprimer', etat: precedent, numero: imprimer };
    }
  }

  // Sinon, une nouvelle pièce passe avant tout.
  const nouvelle = demandePiece(text);
  if (nouvelle) {
    if (!nouvelle.gabarit) {
      return {
        kind: 'dire',
        texte: `Je ne sais pas encore dessiner ça. Je sais faire : ${piecesConnues()}. Dis-moi laquelle s'en approche.`,
      };
    }
    return demanderOuFabriquer(nouvelle.gabarit, nouvelle.valeurs, `${majuscule(nouvelle.gabarit.nom)}, d'accord. `);
  }

  if (!precedent) return { kind: 'rien' };
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
  const valeurs: Valeurs = { ...actuelle.valeurs };

  // Mesures dites : « hauteur 40 », « trou de 5 mm ». Seulement dans une phrase courte, pour ne pas
  // prendre « mets le minuteur à 10 minutes » pour une mesure.
  const mots = t.split(' ').filter((m) => m !== ',').length;
  const dites = mots <= 10 ? lireMesures(text, g).valeurs : {};
  Object.assign(valeurs, dites);

  for (const regle of RELATIFS) {
    if (!regle.mots.test(t)) continue;
    const id = regle.ids.find((x) => g.mesures.some((m) => m.id === x && !estChoix(m)) && !(x in dites));
    if (!id) continue;
    const mesure = g.mesures.find((m) => m.id === id) as MesureNombre;
    const courante = Number(valeurs[id] ?? mesure.defaut);
    const plus = !PLUS_PETIT.test(t);
    valeurs[id] = relatif(mesure, courante, plus);
  }

  const changement = changementDe(g, actuelle.valeurs, valeurs);
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

/** Phrase de la carte de confirmation avant l'impression. */
export function phraseConfirmationAtelier(nom: string, numero: number, tempsFilament: string | null): string {
  const detail = tempsFilament ? ` ${tempsFilament}` : '';
  return `Lancer l'impression de « ${nom} », version ${numero}.${detail} Vérifie que le plateau est vide.`;
}
