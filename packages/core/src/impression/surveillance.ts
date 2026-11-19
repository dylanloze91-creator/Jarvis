/**
 * Surveillance d'une impression (Jarvis Development, étape 1 ; cahier
 * `docs/specs/imprimante-surveillance.md`). Pur : aucune horloge, aucun réseau.
 *
 * Le service du PC lit Klipper (par Moonraker), la prise et la caméra à intervalles réguliers,
 * et passe chaque lecture à `stepSurveillance`. La fonction rend le nouvel état et la liste des
 * gestes à faire : dire quelque chose, mettre en pause, annuler, couper la prise. Le service
 * exécute les gestes, puis la lecture suivante dit s'ils ont vraiment eu lieu : rien n'est
 * annoncé comme fait avant d'avoir été constaté.
 *
 * Règles (cahier, section 3) :
 * - un doute seul ne déclenche jamais de geste, seulement une phrase ;
 * - un problème confirmé : pause, alerte avec photo, puis annulation au bout du délai choisi si
 *   l'utilisateur ne répond pas ;
 * - la coupure de la prise vient en tout dernier : Klipper injoignable depuis 2 minutes, une
 *   impression en cours au dernier état connu, la prise qui mesure encore une chauffe, l'option
 *   « coupure de secours » cochée, un seuil de chauffe réglé, puis une minute d'annonce ;
 * - jamais de lancement, de reprise ni de chauffe : la reprise passe par l'utilisateur et sa carte.
 */
import { formatPrintDuration, type PrintStatus } from '../quotidien/moonraker.js';

/** État de Klipper vu par Moonraker (objet `webhooks`). */
export type KlippyState = 'ready' | 'startup' | 'shutdown' | 'error' | 'unknown';

export interface Observation {
  /** Heure de la lecture, en millisecondes. */
  at: number;
  printer: { reachable: true; status: PrintStatus; klippy: KlippyState } | { reachable: false };
  /** Absent : pas de prise reliée. */
  plug?: { reachable: true; on: boolean; watts: number } | { reachable: false };
  /** Absent : pas de caméra. `dark` et `signature` viennent de `CameraWatch`. */
  camera?: { reachable: true; dark: boolean; signature: string } | { reachable: false };
  /**
   * Résultat de la surveillance objet par objet (`objets.ts`) : un problème qui touche toute
   * l'impression (traité comme les autres : pause), un doute (une phrase), et les incidents à
   * garder pour le bilan.
   */
  vision?: { probleme: string | null; doute: string | null; incidents?: readonly string[] };
}

export interface SurveillanceSettings {
  /** Délai entre la pause confirmée et l'annulation, sans réponse de l'utilisateur. */
  cancelAfterMs: number;
  /** Option « coupure de secours », cochée à part par l'utilisateur. */
  emergencyCut: boolean;
  /** Puissance (W) au-dessus de laquelle l'imprimante chauffe. `null` : pas encore réglé, jamais de coupure. */
  heatingWatts: number | null;
}

export const SURVEILLANCE_LIMITS = {
  /** Écart de température (°C) qui compte, une fois la consigne atteinte. */
  tempGap: 15,
  /** Écart (°C) en dessous duquel la consigne est atteinte. */
  tempReached: 5,
  tempDoubtMs: 90_000,
  tempProblemMs: 180_000,
  stuckMs: 600_000,
  unreachableFailures: 3,
  unreachableCutMs: 120_000,
  cutNoticeMs: 60_000,
  /** Nombre de prises identiques de suite qui font une image figée. */
  frozenFrames: 5,
  /** Délai pour constater une pause ou une annulation demandée. */
  checkMs: 60_000,
  defaultCancelAfterMs: 600_000,
} as const;

export const DEFAULT_SURVEILLANCE_SETTINGS: SurveillanceSettings = {
  cancelAfterMs: SURVEILLANCE_LIMITS.defaultCancelAfterMs,
  emergencyCut: false,
  heatingWatts: null,
};

/** `etape` : point d'avancement (25, 50, 75 %), envoyé tout seul à l'enceinte et au téléphone. */
export type SurveillanceLevel = 'info' | 'etape' | 'doute' | 'alerte';

/** Points d'avancement annoncés tout seuls (la fin est annoncée à part). */
export const POINTS_ETAPE = [25, 50, 75] as const;

export type SurveillanceAction =
  | { kind: 'say'; level: SurveillanceLevel; text: string; photo: boolean }
  | { kind: 'pause'; reason: string }
  | { kind: 'cancel'; reason: string }
  | { kind: 'cut'; reason: string };

export type UserAnswer = 'annuler' | 'garder';

interface HeaterTrack {
  target: number;
  reached: boolean;
  gapSince: number | null;
  doubtSaid: boolean;
}

export type SurveillancePhase = 'idle' | 'watching' | 'paused_by_jarvis' | 'cancel_sent' | 'cut_announced' | 'cut_sent';

export interface SurveillanceState {
  phase: SurveillancePhase;
  /** Une impression était en cours (ou en pause) au dernier état connu. */
  printing: boolean;
  filename: string;
  failures: number;
  unreachableSince: number | null;
  heaters: { extruder: HeaterTrack; bed: HeaterTrack };
  progress: { value: number; since: number } | null;
  camera: { last: string | null; same: number; blind: boolean };
  pause: { reason: string; askedAt: number; confirmedAt: number | null; deadline: number | null; userKeeps: boolean } | null;
  cutAnnouncedAt: number | null;
  cancelSentAt: number | null;
  cutSentAt: number | null;
  /** Phrases déjà dites pour cette impression (chacune une seule fois). */
  said: Record<string, true>;
  /** Points d'avancement déjà annoncés. */
  etapes: number[];
  /** Ce qui s'est passé depuis le début de l'impression (doutes, alertes), en mots courts. */
  incidents: string[];
  /** Incidents déjà racontés au dernier point d'étape. */
  incidentsDits: number;
}

function heater(): HeaterTrack {
  return { target: 0, reached: false, gapSince: null, doubtSaid: false };
}

export function initialSurveillanceState(): SurveillanceState {
  return {
    phase: 'idle',
    printing: false,
    filename: '',
    failures: 0,
    unreachableSince: null,
    heaters: { extruder: heater(), bed: heater() },
    progress: null,
    camera: { last: null, same: 0, blind: false },
    pause: null,
    cutAnnouncedAt: null,
    cancelSentAt: null,
    cutSentAt: null,
    said: {},
    etapes: [],
    incidents: [],
    incidentsDits: 0,
  };
}

function clone(state: SurveillanceState): SurveillanceState {
  return {
    ...state,
    heaters: { extruder: { ...state.heaters.extruder }, bed: { ...state.heaters.bed } },
    progress: state.progress ? { ...state.progress } : null,
    camera: { ...state.camera },
    pause: state.pause ? { ...state.pause } : null,
    said: { ...state.said },
    etapes: [...state.etapes],
    incidents: [...state.incidents],
  };
}

function minutes(ms: number): string {
  const value = Math.max(1, Math.round(ms / 60_000));
  return `${value} minute${value > 1 ? 's' : ''}`;
}

class Out {
  readonly actions: SurveillanceAction[] = [];
  constructor(private readonly state: SurveillanceState) {}
  say(level: SurveillanceLevel, text: string, photo = false, incident?: string): void {
    this.actions.push({ kind: 'say', level, text, photo });
    if (incident) this.state.incidents.push(incident);
  }
  /** Une seule fois par impression. */
  once(key: string, level: SurveillanceLevel, text: string, photo = false, incident?: string): void {
    if (this.state.said[key]) return;
    this.state.said[key] = true;
    this.say(level, text, photo, incident);
  }
}

/** Remet l'état d'une impression à zéro (fin, nouvelle impression). */
function resetPrint(state: SurveillanceState, at: number): void {
  state.heaters = { extruder: heater(), bed: heater() };
  state.progress = null;
  state.camera = { last: null, same: 0, blind: false };
  state.pause = null;
  state.cutAnnouncedAt = null;
  state.cancelSentAt = null;
  state.cutSentAt = null;
  state.failures = 0;
  state.unreachableSince = null;
  state.said = {};
  state.etapes = [];
  state.incidents = [];
  state.incidentsDits = 0;
  void at;
}

/**
 * Une lecture. Rend le nouvel état et les gestes, dans l'ordre où les faire.
 * La surveillance ne tourne que si l'utilisateur l'a activée : c'est au service de ne pas
 * l'appeler sinon.
 */
export function stepSurveillance(
  previous: SurveillanceState,
  obs: Observation,
  settings: SurveillanceSettings = DEFAULT_SURVEILLANCE_SETTINGS,
): { state: SurveillanceState; actions: SurveillanceAction[] } {
  const state = clone(previous);
  const out = new Out(state);
  if (!obs.printer.reachable) {
    unreachable(state, obs, settings, out);
    return { state, actions: out.actions };
  }

  // Klipper répond de nouveau.
  const wasDown = state.failures >= SURVEILLANCE_LIMITS.unreachableFailures;
  state.failures = 0;
  state.unreachableSince = null;
  if (state.phase === 'cut_announced') {
    state.phase = state.pause ? 'paused_by_jarvis' : 'watching';
    state.cutAnnouncedAt = null;
    out.say('info', "L'imprimante répond de nouveau : je ne coupe pas la prise.");
  } else if (wasDown && state.printing) {
    out.say('info', "L'imprimante répond de nouveau.");
  }

  const { status, klippy } = obs.printer;
  if (klippy === 'shutdown' || klippy === 'error') {
    if (state.printing || state.phase !== 'idle') {
      out.once(
        `klippy-${klippy}`,
        'alerte',
        "Klipper s'est arrêté sur une erreur : il a déjà coupé ses chauffes. Va voir l'imprimante.",
        true,
      );
    }
    state.printing = false;
    state.phase = state.phase === 'cut_sent' ? 'cut_sent' : 'idle';
    return { state, actions: out.actions };
  }

  const isPrinting = status.state === 'printing';
  const isPaused = status.state === 'paused';

  if (!isPrinting && !isPaused) {
    if (state.printing || state.phase === 'cancel_sent') {
      if (status.state === 'error') {
        out.say('alerte', "L'impression s'est arrêtée sur une erreur de Klipper.", true);
      } else if (status.state === 'cancelled' && state.phase === 'cancel_sent') {
        out.say('alerte', 'Impression annulée, vérifié.', true);
      } else if (status.state === 'complete') {
        out.say('etape', finImpression(state, status), true);
      }
    }
    resetPrint(state, obs.at);
    state.printing = false;
    state.filename = '';
    state.phase = 'idle';
    return { state, actions: out.actions };
  }

  // Une impression est en cours ou en pause.
  if (state.printing && status.filename && state.filename && status.filename !== state.filename) {
    resetPrint(state, obs.at);
    state.phase = 'idle';
  }
  if (state.phase === 'idle') {
    state.phase = 'watching';
    out.once('debut', 'info', `Je surveille l'impression${status.filename ? ` de ${nomImpression(status.filename)}` : ''}.`);
    for (const point of POINTS_ETAPE) if (status.progress * 100 >= point) state.etapes.push(point);
  }
  state.printing = true;
  if (status.filename) state.filename = status.filename;

  if (isPaused) {
    paused(state, obs.at, settings, out);
    return { state, actions: out.actions };
  }

  // L'impression avance.
  if (state.phase === 'paused_by_jarvis' && state.pause) {
    if (state.pause.confirmedAt === null) {
      if (obs.at - state.pause.askedAt >= SURVEILLANCE_LIMITS.checkMs) {
        out.once('pause-non-faite', 'alerte', "J'ai demandé la pause, mais l'impression continue. Va voir l'imprimante.", true);
      }
      return { state, actions: out.actions };
    }
    // L'utilisateur a repris l'impression après la pause : on repart de zéro.
    resetPrint(state, obs.at);
    state.said = { debut: true };
    state.phase = 'watching';
    out.say('info', "L'impression a repris. Je continue à surveiller.");
  }
  if (state.phase === 'cancel_sent') {
    if (state.cancelSentAt !== null && obs.at - state.cancelSentAt >= SURVEILLANCE_LIMITS.checkMs) {
      out.once('annulation-non-faite', 'alerte', "J'ai demandé l'annulation, mais l'impression continue. Va voir l'imprimante.", true);
    }
    return { state, actions: out.actions };
  }

  const problems: string[] = [];
  if (obs.vision) {
    for (const i of obs.vision.incidents ?? []) state.incidents.push(i);
    if (obs.vision.probleme) problems.push(phrase(obs.vision.probleme));
    else if (obs.vision.doute) out.once(`vision:${obs.vision.doute}`, 'doute', obs.vision.doute, true);
  }
  checkHeater(state.heaters.extruder, status.extruder, status.extruderTarget, 'la buse', obs.at, problems, out);
  checkHeater(state.heaters.bed, status.bed, status.bedTarget, 'le plateau', obs.at, problems, out);
  checkProgress(state, status, obs.at, problems);
  checkCamera(state, obs, out);

  if (problems.length === 0 && state.phase === 'watching') pointEtape(state, status, out);

  if (problems.length > 0 && state.phase === 'watching') {
    const reason = problems[0]!;
    state.phase = 'paused_by_jarvis';
    state.pause = { reason, askedAt: obs.at, confirmedAt: null, deadline: null, userKeeps: false };
    out.actions.push({ kind: 'pause', reason });
    out.say('alerte', `Problème sur l'impression : ${reason} Je la mets en pause.`, true, `pause : ${reason}`);
  }
  return { state, actions: out.actions };
}

function paused(state: SurveillanceState, at: number, settings: SurveillanceSettings, out: Out): void {
  if (state.phase === 'cancel_sent') {
    if (state.cancelSentAt !== null && at - state.cancelSentAt >= SURVEILLANCE_LIMITS.checkMs) {
      out.once('annulation-non-faite', 'alerte', "J'ai demandé l'annulation, mais l'impression est toujours en pause. Va voir l'imprimante.", true);
    }
    return;
  }
  if (state.phase !== 'paused_by_jarvis' || !state.pause) {
    out.once('pause-externe', 'info', "L'impression est en pause, mais pas par moi. Je n'y touche pas.");
    return;
  }
  const pause = state.pause;
  if (pause.confirmedAt === null) {
    pause.confirmedAt = at;
    pause.deadline = pause.userKeeps ? null : at + settings.cancelAfterMs;
    out.say(
      'alerte',
      `Impression en pause, vérifié. ${pause.reason} Dis-moi si je l'annule ou si je la laisse en pause. Sans réponse dans ${minutes(settings.cancelAfterMs)}, je l'annule.`,
      true,
    );
    return;
  }
  if (!pause.userKeeps && pause.deadline !== null && at >= pause.deadline) {
    state.phase = 'cancel_sent';
    state.cancelSentAt = at;
    const reason = `Pas de réponse depuis ${minutes(settings.cancelAfterMs)}.`;
    out.actions.push({ kind: 'cancel', reason });
    out.say('alerte', `${reason} J'annule l'impression.`);
  }
}

function checkHeater(
  track: HeaterTrack,
  temp: number,
  target: number,
  name: string,
  at: number,
  problems: string[],
  out: Out,
): void {
  if (target !== track.target) {
    track.target = target;
    track.reached = false;
    track.gapSince = null;
    track.doubtSaid = false;
  }
  if (target <= 0) return;
  const gap = Math.abs(temp - target);
  if (gap <= SURVEILLANCE_LIMITS.tempReached) track.reached = true;
  // Pendant la chauffe du début, la consigne n'est pas encore atteinte : ce n'est pas un écart.
  if (!track.reached || gap <= SURVEILLANCE_LIMITS.tempGap) {
    track.gapSince = null;
    track.doubtSaid = false;
    return;
  }
  track.gapSince ??= at;
  const lasting = at - track.gapSince;
  const what = `${Math.round(temp)}° au lieu de ${Math.round(target)}°`;
  if (lasting >= SURVEILLANCE_LIMITS.tempProblemMs) {
    problems.push(`La température de ${name} s'écarte de sa consigne depuis ${minutes(lasting)} (${what}).`);
  } else if (lasting >= SURVEILLANCE_LIMITS.tempDoubtMs && !track.doubtSaid) {
    track.doubtSaid = true;
    out.say('doute', `La température de ${name} s'écarte de sa consigne (${what}). Je surveille.`, false, `température de ${name} (${what})`);
  }
}

function checkProgress(state: SurveillanceState, status: PrintStatus, at: number, problems: string[]): void {
  const heatingDone =
    (status.extruderTarget <= 0 || state.heaters.extruder.reached) && (status.bedTarget <= 0 || state.heaters.bed.reached);
  if (!state.progress || state.progress.value !== status.progress || !heatingDone) {
    state.progress = { value: status.progress, since: at };
    return;
  }
  if (at - state.progress.since >= SURVEILLANCE_LIMITS.stuckMs) {
    problems.push(`L'impression n'avance plus depuis ${minutes(at - state.progress.since)}.`);
  }
}

function checkCamera(state: SurveillanceState, obs: Observation, out: Out): void {
  if (!obs.camera) return;
  const camera = state.camera;
  let blind = false;
  if (!obs.camera.reachable || obs.camera.dark) {
    blind = true;
    camera.last = null;
    camera.same = 0;
  } else {
    camera.same = obs.camera.signature === camera.last ? camera.same + 1 : 0;
    camera.last = obs.camera.signature;
    blind = camera.same >= SURVEILLANCE_LIMITS.frozenFrames - 1;
  }
  if (blind && !camera.blind) {
    out.say('doute', "Je ne vois plus l'imprimante (caméra noire, figée ou muette). Je ne peux pas dire que tout va bien.", false, 'caméra aveugle');
  } else if (!blind && camera.blind) {
    out.say('info', "Je revois l'imprimante.");
  }
  camera.blind = blind;
}

function unreachable(state: SurveillanceState, obs: Observation, settings: SurveillanceSettings, out: Out): void {
  state.failures += 1;
  state.unreachableSince ??= obs.at;
  if (state.phase === 'cut_sent') {
    verifyCut(state, obs, out);
    return;
  }
  if (!state.printing) return;
  if (state.failures === SURVEILLANCE_LIMITS.unreachableFailures) {
    out.once('injoignable', 'doute', "Je n'arrive plus à joindre l'imprimante (Klipper ou Moonraker). Je réessaie.", false, 'imprimante injoignable');
  }
  const down = obs.at - state.unreachableSince;
  if (down < SURVEILLANCE_LIMITS.unreachableCutMs) return;

  const plug = obs.plug;
  if (!settings.emergencyCut) {
    out.once('injoignable-long', 'alerte', `L'imprimante ne répond plus depuis ${minutes(down)}. Va la voir : la coupure de secours n'est pas activée.`);
    return;
  }
  if (settings.heatingWatts === null) {
    out.once('injoignable-long', 'alerte', `L'imprimante ne répond plus depuis ${minutes(down)}. Va la voir : le seuil de chauffe de la prise n'est pas encore réglé, je ne coupe pas.`);
    return;
  }
  if (!plug) {
    out.once('injoignable-long', 'alerte', `L'imprimante ne répond plus depuis ${minutes(down)}. Va la voir : aucune prise n'est reliée.`);
    return;
  }
  if (!plug.reachable) {
    out.once('rien-a-faire', 'alerte', "L'imprimante et la prise ne répondent plus : je ne peux rien faire. Va voir l'imprimante.");
    return;
  }
  const heating = plug.on && plug.watts >= settings.heatingWatts;
  if (!heating) {
    if (state.phase === 'cut_announced') {
      state.phase = state.pause ? 'paused_by_jarvis' : 'watching';
      state.cutAnnouncedAt = null;
      out.say('info', "La prise ne mesure plus de chauffe : je ne coupe pas. Va voir l'imprimante quand tu peux.");
      return;
    }
    out.once('injoignable-froid', 'alerte', `L'imprimante ne répond plus depuis ${minutes(down)}, mais elle ne chauffe pas d'après la prise. Je ne coupe pas. Va la voir quand tu peux.`);
    return;
  }
  if (state.phase !== 'cut_announced') {
    state.phase = 'cut_announced';
    state.cutAnnouncedAt = obs.at;
    out.say(
      'alerte',
      `L'imprimante ne répond plus depuis ${minutes(down)} et elle chauffe encore (${Math.round(plug.watts)} W). Je coupe sa prise dans ${minutes(SURVEILLANCE_LIMITS.cutNoticeMs)} si rien ne change.`,
    );
    return;
  }
  if (state.cutAnnouncedAt !== null && obs.at - state.cutAnnouncedAt >= SURVEILLANCE_LIMITS.cutNoticeMs) {
    state.phase = 'cut_sent';
    state.cutSentAt = obs.at;
    const reason = `Klipper injoignable depuis ${minutes(down)}, chauffe mesurée par la prise.`;
    out.actions.push({ kind: 'cut', reason });
    out.say('alerte', "Je coupe la prise de l'imprimante.", false, 'prise coupée');
  }
}

function verifyCut(state: SurveillanceState, obs: Observation, out: Out): void {
  const plug = obs.plug;
  if (plug?.reachable && !plug.on) {
    out.once('coupure-verifiee', 'alerte', "Prise de l'imprimante coupée, vérifié. Pour la rallumer, il faudra ton accord.");
    return;
  }
  if (state.cutSentAt !== null && obs.at - state.cutSentAt >= SURVEILLANCE_LIMITS.checkMs) {
    out.once('coupure-non-faite', 'alerte', "J'ai demandé la coupure, mais je ne peux pas vérifier que la prise est coupée. Va voir l'imprimante.");
  }
}

/** Première lettre en majuscule (après un éventuel « ), point final. */
function phrase(t: string): string {
  const s = t.trim().replace(/^(« )?(.)/, (_m, g: string | undefined, c: string) => `${g ?? ''}${c.toUpperCase()}`);
  return /[.!?]$/.test(s) ? s : `${s}.`;
}

/** « cube.gcode » se dit « cube ». */
export function nomImpression(filename: string): string {
  const base = filename.split(/[\\/]/).pop() ?? filename;
  return base.replace(/\.gcode$/i, '').replace(/[_]+/g, ' ').trim() || 'en cours';
}

function reste(status: PrintStatus): string {
  if (status.progress <= 0 || status.progress >= 1 || status.printDuration <= 0) return '';
  return ` Reste environ ${formatPrintDuration(status.printDuration * ((1 - status.progress) / status.progress))}.`;
}

function pointEtape(state: SurveillanceState, status: PrintStatus, out: Out): void {
  const point = POINTS_ETAPE.filter((p) => status.progress * 100 >= p && !state.etapes.includes(p)).pop();
  if (point === undefined) return;
  for (const p of POINTS_ETAPE) if (p <= point && !state.etapes.includes(p)) state.etapes.push(p);
  const nouveaux = state.incidents.length - state.incidentsDits;
  state.incidentsDits = state.incidents.length;
  let etat = 'Tout va bien.';
  if (state.camera.blind) etat = "Klipper va bien, mais je ne vois plus l'imprimante.";
  else if (nouveaux > 0) etat = `Tout va bien maintenant, après ${nouveaux === 1 ? 'un doute' : `${nouveaux} doutes`} depuis le dernier point.`;
  out.say('etape', `Impression de ${nomImpression(status.filename)} : ${point} %. ${etat}${reste(status)}`, true);
}

function finImpression(state: SurveillanceState, status: PrintStatus): string {
  const duree = status.printDuration > 0 ? ` en ${formatPrintDuration(status.printDuration)}` : '';
  const debut = `Impression de ${nomImpression(status.filename || state.filename)} terminée${duree}.`;
  if (state.incidents.length === 0) return `${debut} Tout s'est bien passé.`;
  const liste = state.incidents.slice(0, 3).join(' ; ');
  return `${debut} ${state.incidents.length === 1 ? 'Un incident' : `${state.incidents.length} incidents`} pendant l'impression : ${liste}. Vérifie la pièce.`;
}

/** Réponse de l'utilisateur après une pause demandée par Jarvis. Reprendre ne passe pas par ici : c'est une carte. */
export function answerSurveillance(
  previous: SurveillanceState,
  answer: UserAnswer,
  at: number,
): { state: SurveillanceState; actions: SurveillanceAction[] } {
  const state = clone(previous);
  const out = new Out(state);
  if (state.phase !== 'paused_by_jarvis' || !state.pause) {
    out.say('info', "Il n'y a pas de pause de ma part en cours.");
    return { state, actions: out.actions };
  }
  if (answer === 'garder') {
    state.pause.userKeeps = true;
    state.pause.deadline = null;
    out.say('info', "D'accord, je la laisse en pause et je ne l'annule pas. Pour la reprendre, demande-le-moi : il faudra ton accord.");
    return { state, actions: out.actions };
  }
  state.phase = 'cancel_sent';
  state.cancelSentAt = at;
  out.actions.push({ kind: 'cancel', reason: 'Demandé par toi.' });
  out.say('info', "J'annule l'impression.");
  return { state, actions: out.actions };
}
