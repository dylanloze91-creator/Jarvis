/**
 * Surveillance objet par objet, quand plusieurs pièces s'impriment ensemble. Pur : aucune
 * horloge, aucun réseau.
 *
 * Le PC passe à `stepObjets` les objets connus de Klipper (`exclude_object`) et les
 * comparaisons d'images de `vision.ts`. La fonction rend les phrases à dire, les objets à
 * arrêter seuls (`EXCLUDE_OBJECT`, les autres continuent) et, si le problème touche toute
 * l'impression, une raison que `stepSurveillance` traite comme les autres (pause, alerte,
 * annulation sans réponse).
 *
 * Règles :
 * - une seule image ne déclenche jamais d'alerte ni de geste, au plus un doute (une phrase) ;
 *   un problème après 3 images de suite (matière qui s'accumule à côté) ou 2 (objet qui a bougé) ;
 * - un seul objet raté : alerte avec photo, puis arrêt de CET objet au bout de 2 minutes sans
 *   réponse (réglable, ou seulement prévenir) ; « garde-le » et « arrête-le » sont écoutés ;
 * - plusieurs objets ratés en même temps, ou le dernier objet en cours : c'est toute
 *   l'impression (décalage de couche, plateau qui a bougé, buse bouchée) → pause ;
 * - arrêter un objet n'est jamais lancer, reprendre ni chauffer quoi que ce soit.
 */
import type { SurveillanceLevel } from './surveillance.js';
import type { Comparaison } from './vision.js';

export type StatutObjet = 'ok' | 'doute' | 'probleme' | 'exclusion_demandee' | 'exclu' | 'garde';

export interface EtatObjet {
  statut: StatutObjet;
  dehorsSuite: number;
  basSuite: number;
  figeSuite: number;
  raison: string | null;
  annonceA: number | null;
  demandeA: number | null;
}

export interface EtatObjets {
  objets: Record<string, EtatObjet>;
  sauts: number;
  dit: Record<string, true>;
}

export interface ReglagesObjets {
  /** Arrêter tout seul un objet raté, au bout du délai (sinon : seulement prévenir). */
  exclureSeul: boolean;
  exclureApresMs: number;
}

export const OBJETS_DEFAUT: ReglagesObjets = { exclureSeul: true, exclureApresMs: 120_000 };

export const OBJETS_LIMITES = {
  /** Blocs « dehors » sur une image pour qu'elle compte. */
  seuilDehors: 3,
  /** Blocs « bas » sur une image pour qu'elle compte. */
  seuilBas: 4,
  dehorsDoute: 2,
  dehorsProbleme: 3,
  basProbleme: 2,
  /** Fenêtres longues de suite sans croissance pour un doute, pour un problème (tous les objets). */
  figeDoute: 1,
  figeProbleme: 2,
  /** Images « saut » de suite avant de le dire. */
  sauts: 3,
  /** Délai pour constater un arrêt d'objet demandé. */
  verifMs: 60_000,
} as const;

export interface VueObjets {
  at: number;
  /** Objets déclarés (`exclude_object.objects`), dans l'ordre. */
  objets: readonly string[];
  /** Objets déjà arrêtés (`exclude_object.excluded_objects`). */
  exclus: readonly string[];
  /** Comparaison avec la photo précédente prise au même endroit (objet qui bouge) ; `null` : pas de photo comparable. */
  courte: Comparaison | null;
  /**
   * Comparaison avec la photo du plateau vide prise au début, au même endroit (matière qui reste
   * hors des objets : spaghetti, couches décalées, objet déplacé). `null` : pas de photo de départ.
   */
  reference?: Comparaison | null;
  /** Comparaison avec une photo d'il y a une dizaine de couches, et les objets qui devaient grandir entre les deux. */
  longue?: { comparaison: Comparaison; doitGrandir: readonly string[] } | null;
  /** Le décor s'est déplacé sur l'image (`decalageDecor`) : la caméra a bougé. */
  cameraBougee?: boolean;
}

export type ActionObjet =
  | { kind: 'say'; level: SurveillanceLevel; text: string; photo: boolean }
  | { kind: 'exclude'; nom: string };

export interface ResultatObjets {
  state: EtatObjets;
  actions: ActionObjet[];
  /** Problème qui touche toute l'impression : à passer à `stepSurveillance` (pause). */
  probleme: string | null;
  /** Doute sur toute l'impression : une phrase, aucun geste. */
  doute: string | null;
  /** Ce qui s'est passé, pour le bilan de fin. */
  incidents: string[];
}

/** « cube_id_0_copy_1 » → « l'objet « cube n°2 » ». Klipper met les noms en majuscules. */
export function objetDit(nom: string, majuscule = true): string {
  const copie = /_id_\d+_copy_(\d+)$/i.exec(nom);
  let base = nom.replace(/_id_\d+_copy_\d+$/i, '').replace(/\.(stl|3mf|step|stp|obj)/gi, '');
  base = base.replace(/[_]+/g, ' ').trim().toLowerCase() || 'sans nom';
  if (copie && Number(copie[1]) > 0) base += ` n°${Number(copie[1]) + 1}`;
  return `${majuscule ? 'L' : 'l'}'objet « ${base} »`;
}

/** Nom accepté pour `EXCLUDE_OBJECT NAME=…` : rien qui puisse glisser une autre commande. */
export function nomObjetSur(nom: string): boolean {
  return /^[A-Za-z0-9_.-]{1,120}$/.test(nom);
}

export function etatObjetsInitial(): EtatObjets {
  return { objets: {}, sauts: 0, dit: {} };
}

function neuf(): EtatObjet {
  return { statut: 'ok', dehorsSuite: 0, basSuite: 0, figeSuite: 0, raison: null, annonceA: null, demandeA: null };
}

function copier(e: EtatObjets): EtatObjets {
  const objets: Record<string, EtatObjet> = {};
  for (const [k, v] of Object.entries(e.objets)) objets[k] = { ...v };
  return { objets, sauts: e.sauts, dit: { ...e.dit } };
}

function minutes(ms: number): string {
  if (ms < 60_000) return `${Math.max(1, Math.round(ms / 1000))} secondes`;
  const m = Math.round(ms / 60_000);
  return m === 1 ? '1 minute' : `${m} minutes`;
}

function liste(noms: string[]): string {
  const dits = noms.map((n) => objetDit(n, false).replace(/^l'objet /, ''));
  return dits.length <= 1 ? dits.join('') : `${dits.slice(0, -1).join(', ')} et ${dits[dits.length - 1]}`;
}

export function stepObjets(prev: EtatObjets, vue: VueObjets, reglages: ReglagesObjets = OBJETS_DEFAUT): ResultatObjets {
  const state = copier(prev);
  const actions: ActionObjet[] = [];
  const incidents: string[] = [];
  let probleme: string | null = null;
  let doute: string | null = null;
  const L = OBJETS_LIMITES;
  const say = (level: SurveillanceLevel, text: string, photo = false, incident?: string) => {
    actions.push({ kind: 'say', level, text, photo });
    if (incident) incidents.push(incident);
  };
  const once = (cle: string, level: SurveillanceLevel, text: string, photo = false, incident?: string) => {
    if (state.dit[cle]) return;
    state.dit[cle] = true;
    say(level, text, photo, incident);
  };

  for (const nom of vue.objets) if (!state.objets[nom]) state.objets[nom] = neuf();
  const exclus = new Set(vue.exclus);

  // 1. Arrêts constatés.
  for (const nom of vue.objets) {
    const o = state.objets[nom]!;
    if (exclus.has(nom) && o.statut !== 'exclu') {
      if (o.statut === 'exclusion_demandee') say('alerte', `${objetDit(nom)} est arrêté, vérifié. Les autres continuent.`, true);
      else say('info', `${objetDit(nom)} a été arrêté (pas par moi). Je surveille les autres.`);
      o.statut = 'exclu';
    } else if (o.statut === 'exclusion_demandee' && o.demandeA !== null && vue.at - o.demandeA >= L.verifMs) {
      probleme = `j'ai demandé l'arrêt de ${objetDit(nom, false)}, mais Klipper ne l'a pas fait.`;
    }
  }
  const actifs = vue.objets.filter((n) => !['exclu', 'exclusion_demandee'].includes(state.objets[n]!.statut));

  // 2. Image inutilisable (lumière, caméra bougée).
  if (vue.cameraBougee) {
    state.sauts = Math.max(state.sauts, L.sauts);
    doute = "La caméra a bougé : je ne peux plus suivre objet par objet. Remets-la en place ou refais son calage. Je continue à surveiller les températures et Klipper.";
    if (!state.dit['camera']) {
      state.dit['camera'] = true;
      incidents.push('caméra bougée');
    }
    return { state, actions, probleme, doute, incidents };
  }
  if (vue.courte?.saut || vue.reference?.saut) {
    state.sauts++;
    if (state.sauts >= L.sauts) {
      doute = "L'image de la caméra a changé d'un coup (lumière ou caméra bougée) : je ne peux plus suivre objet par objet. Si la caméra a bougé, il faut refaire son calage.";
    }
    return { state, actions, probleme, doute, incidents };
  }
  if (vue.courte || vue.reference) state.sauts = 0;

  // 3. Mesures objet par objet.
  for (const nom of actifs) {
    const o = state.objets[nom]!;
    const court = vue.courte?.parObjet[nom];
    const ref = vue.reference?.parObjet[nom] ?? (vue.reference === undefined ? court : undefined);
    if (ref) o.dehorsSuite = ref.dehors >= L.seuilDehors ? o.dehorsSuite + 1 : 0;
    if (court) o.basSuite = court.bas >= L.seuilBas ? o.basSuite + 1 : 0;
    if (vue.longue && vue.longue.doitGrandir.includes(nom)) {
      const g = vue.longue.comparaison.parObjet[nom];
      o.figeSuite = g && g.attendu === 0 && !vue.longue.comparaison.saut ? o.figeSuite + 1 : 0;
    }
  }

  const rate = (o: EtatObjet) => o.dehorsSuite >= L.dehorsProbleme || o.basSuite >= L.basProbleme || (o.basSuite >= 1 && o.dehorsSuite >= L.dehorsDoute);
  const raisonDe = (o: EtatObjet) =>
    o.basSuite >= 1 && o.dehorsSuite >= 1
      ? "il s'est décollé ou a été poussé, et de la matière part à côté"
      : o.basSuite >= 1
        ? 'il a bougé sur le plateau'
        : 'de la matière s’accumule à côté de lui (fils emmêlés, « spaghetti »)';

  const rates = actifs.filter((n) => rate(state.objets[n]!));
  const pourLaPiece = (t: string) =>
    t.replace("il s'est décollé ou a été poussé", "la pièce s'est décollée ou a été poussée").replace('il a bougé', 'la pièce a bougé').replace('à côté de lui', 'à côté de la pièce');
  const figes = actifs.filter((n) => vue.longue?.doitGrandir.includes(n));
  const tousFiges = figes.length > 0 && figes.length === actifs.length;

  // 4. Toute l'impression.
  if (rates.length >= 2) {
    probleme ??= `${liste(rates)} ratent en même temps : décalage de couche, plateau qui a bougé ou buse qui accroche.`;
  } else if (rates.length === 1 && actifs.length === 1) {
    const o = state.objets[rates[0]!]!;
    probleme ??= vue.objets.length > 1 ? `${objetDit(rates[0]!)}, le dernier en cours, rate : ${raisonDe(o)}.` : `${pourLaPiece(raisonDe(o))}.`;
  }
  if (tousFiges && figes.every((n) => state.objets[n]!.figeSuite >= L.figeProbleme)) {
    probleme ??= 'plus rien ne grandit depuis une vingtaine de couches : bobine vide ou buse bouchée ?';
  } else if (tousFiges && figes.every((n) => state.objets[n]!.figeSuite >= L.figeDoute)) {
    doute = 'Je ne vois plus les objets grandir depuis une dizaine de couches. Bobine vide ou buse bouchée ? Je regarde encore.';
  }
  if (probleme) {
    if (!state.dit['global']) {
      state.dit['global'] = true;
      incidents.push(`plusieurs objets ou toute l'impression : ${probleme}`);
    }
    return { state, actions, probleme, doute, incidents };
  }

  // 5. Un seul objet raté : les autres continuent.
  for (const nom of rates) {
    const o = state.objets[nom]!;
    if (o.statut === 'garde') continue;
    if (o.statut !== 'probleme') {
      o.statut = 'probleme';
      o.raison = raisonDe(o);
      o.annonceA = vue.at;
      const autres = actifs.length - 1;
      const suite = reglages.exclureSeul
        ? `Je l'arrête dans ${minutes(reglages.exclureApresMs)}, lui seul, sauf si tu me dis de le garder.`
        : `Dis « arrête cet objet » pour l'arrêter seul.`;
      say(
        'alerte',
        `${objetDit(nom)} rate : ${o.raison}. ${autres === 1 ? "L'autre va bien" : `Les ${autres} autres vont bien`}. ${suite}`,
        true,
        `${objetDit(nom, false)} : ${o.raison}`,
      );
    }
  }
  for (const nom of actifs) {
    const o = state.objets[nom]!;
    if (o.statut === 'probleme' && reglages.exclureSeul && o.annonceA !== null && vue.at - o.annonceA >= reglages.exclureApresMs) {
      o.statut = 'exclusion_demandee';
      o.demandeA = vue.at;
      actions.push({ kind: 'exclude', nom });
      say('alerte', `J'arrête ${objetDit(nom, false)}. Les autres continuent.`, true, `${objetDit(nom, false)} arrêté`);
    }
  }

  // 6. Doutes (une phrase, aucun geste) et retour au calme.
  // Un objet seul qui ne grandit plus n'est pas dit : il peut être caché par un autre.
  const nouveaux = actifs.filter((n) => {
    const o = state.objets[n]!;
    return o.statut === 'ok' && (o.dehorsSuite >= L.dehorsDoute || o.basSuite >= 1);
  });
  if (nouveaux.length >= 2) {
    for (const n of nouveaux) state.objets[n]!.statut = 'doute';
    doute = `${liste(nouveaux).replace(/^./, (c) => c.toUpperCase())} changent en même temps à côté de leur place. Je regarde encore avant de conclure.`;
    once(`doutes:${nouveaux.join(',')}`, 'doute', doute, true, 'plusieurs objets ont bougé en même temps');
    doute = null;
  }
  for (const nom of actifs) {
    const o = state.objets[nom]!;
    if (o.statut === 'probleme' || o.statut === 'garde') continue;
    const douteux = o.dehorsSuite >= L.dehorsDoute || o.basSuite >= 1;
    if (douteux && o.statut === 'ok') {
      o.statut = 'doute';
      const quoi = raisonDe(o);
      once(`doute:${nom}`, 'doute', `Je surveille ${objetDit(nom, false)} de près : ${quoi}.`, true, `doute sur ${objetDit(nom, false)} (${quoi})`);
    } else if (!douteux && o.statut === 'doute' && o.dehorsSuite === 0 && o.basSuite === 0) {
      o.statut = 'ok';
    }
  }
  return { state, actions, probleme, doute, incidents };
}

/** Réponse de l'utilisateur sur un objet : « arrête-le » ou « garde-le ». */
export function repondreObjet(
  prev: EtatObjets,
  nom: string,
  reponse: 'arreter' | 'garder',
  at: number,
): { state: EtatObjets; actions: ActionObjet[] } {
  const state = copier(prev);
  const o = state.objets[nom];
  if (!o || o.statut === 'exclu' || o.statut === 'exclusion_demandee') return { state, actions: [] };
  if (reponse === 'garder') {
    o.statut = 'garde';
    return { state, actions: [{ kind: 'say', level: 'info', text: `D'accord, je laisse ${objetDit(nom, false)} continuer. Je préviens seulement si toute l'impression part en vrille.`, photo: false }] };
  }
  o.statut = 'exclusion_demandee';
  o.demandeA = at;
  return {
    state,
    actions: [
      { kind: 'exclude', nom },
      { kind: 'say', level: 'info', text: `J'arrête ${objetDit(nom, false)}. Les autres continuent.`, photo: false },
    ],
  };
}
