/**
 * Les veilleurs : des règles permanentes que Jarvis surveille tout seul.
 *
 * Idée reprise des « operators » d'OpenJarvis (Stanford, Apache 2.0) : un agent qui tourne à
 * intervalles réguliers, garde son état d'une fois sur l'autre, et que l'on surveille lui-même
 * (battement de cœur, limite d'actions par heure, mise en pause après des échecs répétés,
 * nouvel essai avec attente qui grandit). OpenJarvis laisse un modèle décider à chaque passage ;
 * ici **aucun modèle** : un veilleur lit une valeur avec un outil de lecture, la compare à un
 * seuil, et n'a le droit qu'à une action **dans le sens de la sécurité** (feuille de route,
 * « Jarvis autonome », étape 2). Tout ce qui démarre, chauffe ou fait bouger est refusé ici,
 * quoi qu'écrive le fichier : la liste des actions permises est dans le code (comme la table des
 * risques d'OpenJarvis, que le modèle ne peut pas changer).
 *
 * Module pur : l'horloge, la lecture, l'action et l'envoi des messages sont fournis par l'appelant.
 */

/** Seules actions qu'un veilleur peut faire seul. Chacune arrête ou met en pause. */
export const ACTIONS_SURES = [
  'aucune',
  'pause_impression',
  'annuler_impression',
  'arreter_robot',
  'arret_urgence_robot',
  'couper_prise',
] as const;
export type ActionSure = (typeof ACTIONS_SURES)[number];

export const CANAUX = ['ecran', 'enceinte', 'telephone'] as const;
export type Canal = (typeof CANAUX)[number];

export type Planning =
  | { type: 'intervalle'; secondes: number }
  /** Heures fixes « HH:MM », heure du PC ; `jours` : 0 = dimanche … 6 = samedi (absent : tous). */
  | { type: 'heures'; heures: string[]; jours?: number[] };

export type Comparaison = '>' | '>=' | '<' | '<=' | '==' | '!=';

export interface Condition {
  /** Nom de la valeur lue (« temperature_buse », « progression », « en_ligne »…). */
  champ: string;
  op: Comparaison;
  valeur: number | string | boolean;
  /** La condition doit être vraie à ce nombre de passages de suite (défaut 1). */
  passages?: number;
}

export interface ManifesteVeilleur {
  id: string;
  nom: string;
  actif: boolean;
  planning: Planning;
  /** Nom de l'outil de lecture appelé à chaque passage. */
  regarder: string;
  si: Condition;
  alors: ActionSure;
  prevenir: Canal[];
  /** Phrase dite ou affichée. `{valeur}` est remplacé par la valeur lue. */
  message: string;
  /** Pas deux alertes pour la même chose avant ce délai (minutes, défaut 30). */
  silenceMinutes?: number;
  /** Au plus ce nombre d'actions par heure (défaut 3). Au-delà : on prévient seulement. */
  actionsParHeure?: number;
}

export const INTERVALLE_MIN_SECONDES = 30;
export const SILENCE_DEFAUT_MINUTES = 30;
export const ACTIONS_PAR_HEURE_DEFAUT = 3;
/** Échecs de lecture de suite avant de mettre le veilleur en pause (et de le dire). */
export const ECHECS_AVANT_PAUSE = 3;
/** Attente avant un nouvel essai : 10 s × 2^n, 300 s au plus (même règle qu'OpenJarvis). */
export function attenteApresEchec(echecs: number): number {
  return Math.min(10 * 2 ** Math.max(0, echecs - 1), 300) * 1000;
}
/** Un veilleur qui n'a pas tourné depuis 3 périodes est « en retard » (pour le bilan de santé). */
export const RETARD_PERIODES = 3;
export const JOURNAL_MAX = 200;

/** Ce qui ne va pas dans un manifeste. Liste vide : il est en ordre. */
export function verifierManifeste(manifeste: ManifesteVeilleur): string[] {
  const problemes: string[] = [];
  if (!/^[a-z0-9][a-z0-9-]{0,47}$/.test(manifeste.id)) problemes.push('nom court invalide (minuscules, chiffres, tirets)');
  if (!manifeste.nom.trim()) problemes.push('il manque un nom');
  if (!manifeste.regarder.trim()) problemes.push('il manque l’outil de lecture');
  if (!(ACTIONS_SURES as readonly string[]).includes(manifeste.alors)) {
    problemes.push(`action refusée : « ${manifeste.alors} » (seules les actions qui arrêtent ou mettent en pause sont permises)`);
  }
  if (manifeste.prevenir.length === 0) problemes.push('il faut au moins un endroit où prévenir');
  for (const canal of manifeste.prevenir) {
    if (!(CANAUX as readonly string[]).includes(canal)) problemes.push(`endroit inconnu : ${canal}`);
  }
  if (!manifeste.message.trim()) problemes.push('il manque le message');
  if (!manifeste.si.champ.trim()) problemes.push('il manque la valeur à surveiller');
  const planning = manifeste.planning;
  if (planning.type === 'intervalle') {
    if (!Number.isFinite(planning.secondes) || planning.secondes < INTERVALLE_MIN_SECONDES) {
      problemes.push(`intervalle trop court (${INTERVALLE_MIN_SECONDES} s au moins)`);
    }
  } else {
    if (planning.heures.length === 0) problemes.push('il faut au moins une heure');
    for (const heure of planning.heures) if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(heure)) problemes.push(`heure invalide : ${heure}`);
    for (const jour of planning.jours ?? []) if (!Number.isInteger(jour) || jour < 0 || jour > 6) problemes.push(`jour invalide : ${jour}`);
  }
  if (manifeste.silenceMinutes !== undefined && !(manifeste.silenceMinutes >= 0)) problemes.push('silence négatif');
  if (manifeste.actionsParHeure !== undefined && !(manifeste.actionsParHeure >= 0)) problemes.push('limite d’actions négative');
  return problemes;
}

/** Prochain passage strictement après `apres` (millisecondes). */
export function prochainPassage(planning: Planning, apres: number): number {
  if (planning.type === 'intervalle') return apres + Math.max(INTERVALLE_MIN_SECONDES, planning.secondes) * 1000;
  const minutes = planning.heures
    .map((heure) => {
      const [h, m] = heure.split(':').map(Number);
      return h! * 60 + m!;
    })
    .sort((a, b) => a - b);
  const jours = planning.jours?.length ? new Set(planning.jours) : null;
  const depart = new Date(apres);
  for (let decalage = 0; decalage <= 7; decalage += 1) {
    const jour = new Date(depart.getFullYear(), depart.getMonth(), depart.getDate() + decalage);
    if (jours && !jours.has(jour.getDay())) continue;
    for (const minute of minutes) {
      const quand = new Date(jour.getFullYear(), jour.getMonth(), jour.getDate(), Math.floor(minute / 60), minute % 60).getTime();
      if (quand > apres) return quand;
    }
  }
  // Planning sans jour possible : ne jamais tourner (vérifié par `verifierManifeste`).
  return Number.POSITIVE_INFINITY;
}

function periodeMs(planning: Planning): number {
  if (planning.type === 'intervalle') return Math.max(INTERVALLE_MIN_SECONDES, planning.secondes) * 1000;
  const parJour = Math.max(1, planning.heures.length);
  const jours = planning.jours?.length ?? 7;
  return Math.round((7 * 24 * 3600 * 1000) / (parJour * jours));
}

export interface EntreeJournal {
  at: number;
  /** lu, condition, action, alerte, silence, limite, echec, pause */
  quoi: string;
  detail: string;
}

export interface EtatVeilleur {
  id: string;
  prochain: number;
  dernierPassage: number | null;
  echecsDeSuite: number;
  enPause: boolean;
  raisonPause: string | null;
  /** Passages de suite où la condition était vraie. */
  vraiDeSuite: number;
  derniereAlerte: number | null;
  actions: number[];
  journal: EntreeJournal[];
}

export function etatInitial(manifeste: ManifesteVeilleur, now: number): EtatVeilleur {
  return {
    id: manifeste.id,
    prochain: manifeste.planning.type === 'intervalle' ? now : prochainPassage(manifeste.planning, now),
    dernierPassage: null,
    echecsDeSuite: 0,
    enPause: false,
    raisonPause: null,
    vraiDeSuite: 0,
    derniereAlerte: null,
    actions: [],
    journal: [],
  };
}

export type Valeur = number | string | boolean | null;
export type Lecture = Record<string, Valeur>;

/** Vrai si la valeur lue remplit la condition. Valeur absente ou d'un autre type : faux. */
export function conditionVraie(condition: Condition, lecture: Lecture): boolean {
  const lu = lecture[condition.champ];
  if (lu === null || lu === undefined) return false;
  const attendu = condition.valeur;
  if (typeof attendu === 'number') {
    if (typeof lu !== 'number' || !Number.isFinite(lu)) return false;
    switch (condition.op) {
      case '>':
        return lu > attendu;
      case '>=':
        return lu >= attendu;
      case '<':
        return lu < attendu;
      case '<=':
        return lu <= attendu;
      case '==':
        return lu === attendu;
      case '!=':
        return lu !== attendu;
    }
  }
  if (condition.op === '==') return lu === attendu;
  if (condition.op === '!=') return lu !== attendu;
  return false;
}

/** Erreurs qui ne passeront pas en réessayant : on met en pause tout de suite. */
const ERREURS_DEFINITIVES = /\b(401|403|unauthori[sz]ed|forbidden|jeton|token|refus|introuvable|not found|404|inconnu)\b/i;

export function erreurDefinitive(message: string): boolean {
  return ERREURS_DEFINITIVES.test(message);
}

export interface DependancesVeilleurs {
  regarder: (outil: string, manifeste: ManifesteVeilleur) => Promise<Lecture>;
  agir: (action: Exclude<ActionSure, 'aucune'>, manifeste: ManifesteVeilleur) => Promise<{ ok: boolean; detail: string }>;
  prevenir: (canaux: readonly Canal[], message: string, manifeste: ManifesteVeilleur) => Promise<void>;
}

function noter(etat: EtatVeilleur, at: number, quoi: string, detail: string): void {
  etat.journal.push({ at, quoi, detail });
  if (etat.journal.length > JOURNAL_MAX) etat.journal.splice(0, etat.journal.length - JOURNAL_MAX);
}

function texteValeur(valeur: Valeur | undefined): string {
  if (typeof valeur === 'number') return String(Math.round(valeur * 10) / 10).replace('.', ',');
  if (typeof valeur === 'boolean') return valeur ? 'oui' : 'non';
  return valeur ?? '?';
}

/**
 * Un passage d'un veilleur, s'il est dû. Rend l'état mis à jour (le même objet).
 * Ne lève jamais : une erreur de lecture, d'action ou d'envoi est notée au journal.
 */
export async function passage(
  manifeste: ManifesteVeilleur,
  etat: EtatVeilleur,
  now: number,
  deps: DependancesVeilleurs,
): Promise<EtatVeilleur> {
  if (!manifeste.actif || etat.enPause || now < etat.prochain) return etat;
  const problemes = verifierManifeste(manifeste);
  if (problemes.length > 0) {
    etat.enPause = true;
    etat.raisonPause = problemes.join(' ; ');
    noter(etat, now, 'pause', etat.raisonPause);
    return etat;
  }

  etat.dernierPassage = now;
  let lecture: Lecture;
  try {
    lecture = await deps.regarder(manifeste.regarder, manifeste);
  } catch (error) {
    const message = String((error as Error)?.message ?? error);
    etat.echecsDeSuite += 1;
    noter(etat, now, 'echec', message);
    if (etat.echecsDeSuite >= ECHECS_AVANT_PAUSE || erreurDefinitive(message)) {
      etat.enPause = true;
      etat.raisonPause = `lecture impossible (${message})`;
      noter(etat, now, 'pause', etat.raisonPause);
      try {
        await deps.prevenir(manifeste.prevenir, `Je mets en pause la surveillance « ${manifeste.nom} » : je n’arrive plus à lire ${manifeste.regarder}.`, manifeste);
      } catch {
        // L'envoi a raté : la pause reste notée au journal et dans le bilan.
      }
    } else {
      etat.prochain = now + attenteApresEchec(etat.echecsDeSuite);
    }
    return etat;
  }

  etat.echecsDeSuite = 0;
  etat.prochain = prochainPassage(manifeste.planning, now);
  const valeur = lecture[manifeste.si.champ];
  noter(etat, now, 'lu', `${manifeste.si.champ} = ${texteValeur(valeur)}`);
  if (!conditionVraie(manifeste.si, lecture)) {
    etat.vraiDeSuite = 0;
    return etat;
  }
  etat.vraiDeSuite += 1;
  if (etat.vraiDeSuite < (manifeste.si.passages ?? 1)) {
    noter(etat, now, 'condition', `vraie ${etat.vraiDeSuite} fois de suite sur ${manifeste.si.passages}`);
    return etat;
  }

  const silence = (manifeste.silenceMinutes ?? SILENCE_DEFAUT_MINUTES) * 60_000;
  if (etat.derniereAlerte !== null && now - etat.derniereAlerte < silence) {
    noter(etat, now, 'silence', 'déjà prévenu récemment');
    return etat;
  }

  let compteRendu = '';
  if (manifeste.alors !== 'aucune') {
    const limite = manifeste.actionsParHeure ?? ACTIONS_PAR_HEURE_DEFAUT;
    etat.actions = etat.actions.filter((at) => now - at < 3_600_000);
    if (etat.actions.length >= limite) {
      noter(etat, now, 'limite', `${etat.actions.length} action(s) dans l’heure : je préviens sans agir`);
      compteRendu = ' Je n’ai rien fait de plus : trop d’actions dans l’heure, à toi de voir.';
    } else {
      etat.actions.push(now);
      try {
        const resultat = await deps.agir(manifeste.alors, manifeste);
        noter(etat, now, 'action', `${manifeste.alors} : ${resultat.ok ? 'fait' : 'raté'} (${resultat.detail})`);
        compteRendu = resultat.ok ? ` J’ai fait : ${resultat.detail}.` : ` J’ai essayé, mais ça a raté : ${resultat.detail}.`;
      } catch (error) {
        const message = String((error as Error)?.message ?? error);
        noter(etat, now, 'action', `${manifeste.alors} : raté (${message})`);
        compteRendu = ` J’ai essayé, mais ça a raté : ${message}.`;
      }
    }
  }

  etat.derniereAlerte = now;
  const message = manifeste.message.replaceAll('{valeur}', texteValeur(valeur)) + compteRendu;
  noter(etat, now, 'alerte', message);
  try {
    await deps.prevenir(manifeste.prevenir, message, manifeste);
  } catch (error) {
    noter(etat, now, 'echec', `envoi du message raté (${String((error as Error)?.message ?? error)})`);
  }
  return etat;
}

/** Fait passer tous les veilleurs dus, un par un, dans l'ordre de la liste. */
export async function passages(
  manifestes: readonly ManifesteVeilleur[],
  etats: Map<string, EtatVeilleur>,
  now: number,
  deps: DependancesVeilleurs,
): Promise<void> {
  for (const manifeste of manifestes) {
    const etat = etats.get(manifeste.id) ?? etatInitial(manifeste, now);
    etats.set(manifeste.id, etat);
    await passage(manifeste, etat, now, deps);
  }
}

/** Remet en marche un veilleur en pause (geste de l'utilisateur). */
export function reprendre(etat: EtatVeilleur, now: number): void {
  etat.enPause = false;
  etat.raisonPause = null;
  etat.echecsDeSuite = 0;
  etat.prochain = now;
  noter(etat, now, 'reprise', 'remis en marche');
}

/** Veilleurs actifs qui ne tournent plus (pour le bilan de santé). */
export function veilleursEnRetard(
  manifestes: readonly ManifesteVeilleur[],
  etats: ReadonlyMap<string, EtatVeilleur>,
  now: number,
): { id: string; raison: string }[] {
  const retard: { id: string; raison: string }[] = [];
  for (const manifeste of manifestes) {
    if (!manifeste.actif) continue;
    const etat = etats.get(manifeste.id);
    if (!etat) continue;
    if (etat.enPause) {
      retard.push({ id: manifeste.id, raison: `en pause : ${etat.raisonPause ?? 'sans raison notée'}` });
      continue;
    }
    if (etat.dernierPassage !== null && now - etat.dernierPassage > RETARD_PERIODES * periodeMs(manifeste.planning)) {
      retard.push({ id: manifeste.id, raison: 'n’a pas tourné depuis trop longtemps' });
    }
  }
  return retard;
}
