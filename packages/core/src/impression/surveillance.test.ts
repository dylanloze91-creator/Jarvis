import { describe, expect, it } from 'vitest';
import type { PrintStatus } from '../quotidien/moonraker.js';
import {
  answerSurveillance,
  initialSurveillanceState,
  stepSurveillance,
  SURVEILLANCE_LIMITS,
  type Observation,
  type SurveillanceAction,
  type SurveillanceSettings,
  type SurveillanceState,
} from './surveillance.js';

const MIN = 60_000;
const BASE: SurveillanceSettings = { cancelAfterMs: 10 * MIN, emergencyCut: false, heatingWatts: null };
const CUT: SurveillanceSettings = { cancelAfterMs: 10 * MIN, emergencyCut: true, heatingWatts: 80 };

function status(part: Partial<PrintStatus> = {}): PrintStatus {
  return {
    state: 'printing',
    filename: 'cube.gcode',
    progress: 0.2,
    printDuration: 600,
    totalDuration: 620,
    bed: 60,
    bedTarget: 60,
    extruder: 210,
    extruderTarget: 210,
    ...part,
  };
}

function seen(at: number, part: Partial<PrintStatus> = {}, extra: Partial<Observation> = {}): Observation {
  return { at, printer: { reachable: true, status: status(part), klippy: 'ready' }, ...extra };
}

function down(at: number, extra: Partial<Observation> = {}): Observation {
  return { at, printer: { reachable: false }, ...extra };
}

/** Rejoue des lectures et garde tous les gestes. */
function run(observations: Observation[], settings = BASE, start = initialSurveillanceState()) {
  let state: SurveillanceState = start;
  const all: { at: number; action: SurveillanceAction }[] = [];
  for (const obs of observations) {
    const result = stepSurveillance(state, obs, settings);
    state = result.state;
    for (const action of result.actions) all.push({ at: obs.at, action });
  }
  return { state, all, gestures: all.filter((a) => a.action.kind !== 'say'), says: all.filter((a) => a.action.kind === 'say') };
}

/** Une lecture toutes les 10 s entre deux heures. */
function every(from: number, to: number, make: (at: number) => Observation): Observation[] {
  const out: Observation[] = [];
  for (let at = from; at <= to; at += 10_000) out.push(make(at));
  return out;
}

function text(a: { action: SurveillanceAction }): string {
  return a.action.kind === 'say' ? a.action.text : a.action.kind;
}

describe('surveillance de l’impression', () => {
  it('une impression qui se passe bien : aucun geste, le début, 25/50/75 % et la fin', () => {
    // 40 minutes d'impression : 1 % toutes les 24 s.
    const obs = every(0, 40 * MIN - 10_000, (at) => seen(at, { progress: at / (40 * MIN), printDuration: at / 1000 }));
    obs.push(seen(40 * MIN, { state: 'complete', progress: 1, printDuration: 2400 }));
    const { gestures, says } = run(obs);
    expect(gestures).toEqual([]);
    expect(says.map(text)).toEqual([
      "Je surveille l'impression de cube.",
      'Impression de cube : 25 %. Tout va bien. Reste environ 30 min.',
      'Impression de cube : 50 %. Tout va bien. Reste environ 20 min.',
      'Impression de cube : 75 %. Tout va bien. Reste environ 10 min.',
      "Impression de cube terminée en 40 min. Tout s'est bien passé.",
    ]);
    expect(says.filter((s) => s.action.kind === 'say' && s.action.level === 'etape')).toHaveLength(4);
    expect(says.at(-1)!.action).toMatchObject({ photo: true });
  });

  it('la chauffe du début n’est pas un écart, même longue', () => {
    const obs = every(0, 6 * MIN, (at) => seen(at, { bed: Math.min(60, 20 + at / 9000), progress: 0 }));
    const { gestures, says } = run(obs);
    expect(gestures).toEqual([]);
    expect(says.filter((s) => s.action.kind === 'say' && s.action.level !== 'info')).toEqual([]);
  });

  it('température qui dérive : doute à 90 s, pause à 3 min, puis pause vérifiée, puis annulation sans réponse', () => {
    const obs = [seen(0)];
    obs.push(...every(10_000, 3 * MIN + 10_000, (at) => seen(at, { extruder: 180, progress: 0.2 + at / 1e9 })));
    const first = run(obs);
    expect(first.says.some((s) => text(s).includes("s'écarte de sa consigne (180° au lieu de 210°). Je surveille."))).toBe(true);
    const pause = first.gestures.find((g) => g.action.kind === 'pause');
    expect(pause?.at).toBe(3 * MIN + 10_000);
    expect(first.state.phase).toBe('paused_by_jarvis');

    // La lecture suivante montre la pause : elle est dite « vérifiée », avec le délai.
    const t1 = 3 * MIN + 20_000;
    const second = run([seen(t1, { state: 'paused', extruder: 180 })], BASE, first.state);
    expect(second.says.map(text)[0]).toContain('Impression en pause, vérifié.');
    expect(second.says.map(text)[0]).toContain('Sans réponse dans 10 minutes');
    expect(second.gestures).toEqual([]);

    // Pas de réponse : rien avant le délai, l'annulation au délai.
    const before = run([seen(t1 + 10 * MIN - 10_000, { state: 'paused' })], BASE, second.state);
    expect(before.gestures).toEqual([]);
    const at = run([seen(t1 + 10 * MIN, { state: 'paused' })], BASE, before.state);
    expect(at.gestures.map((g) => g.action.kind)).toEqual(['cancel']);
    const after = run([seen(t1 + 10 * MIN + 10_000, { state: 'cancelled' })], BASE, at.state);
    expect(after.says.map(text)).toEqual(['Impression annulée, vérifié.']);
    expect(after.state.phase).toBe('idle');
  });

  it('« laisse-la en pause » : jamais d’annulation', () => {
    const obs = [seen(0), ...every(10_000, 3 * MIN + 10_000, (at) => seen(at, { extruder: 180 }))];
    let { state } = run(obs);
    state = run([seen(3 * MIN + 20_000, { state: 'paused' })], BASE, state).state;
    const answered = answerSurveillance(state, 'garder', 3 * MIN + 30_000);
    expect(answered.actions.map((a) => a.kind)).toEqual(['say']);
    const later = run(every(4 * MIN, 30 * MIN, (at) => seen(at, { state: 'paused' })), BASE, answered.state);
    expect(later.gestures).toEqual([]);
  });

  it('« annule-la » : annulation tout de suite', () => {
    const obs = [seen(0), ...every(10_000, 3 * MIN + 10_000, (at) => seen(at, { extruder: 180 }))];
    let { state } = run(obs);
    state = run([seen(3 * MIN + 20_000, { state: 'paused' })], BASE, state).state;
    const answered = answerSurveillance(state, 'annuler', 3 * MIN + 30_000);
    expect(answered.actions.map((a) => a.kind)).toEqual(['cancel', 'say']);
    expect(answered.state.phase).toBe('cancel_sent');
  });

  it('une pause demandée mais pas constatée au bout d’une minute est dite', () => {
    const obs = [seen(0), ...every(10_000, 4 * MIN + 30_000, (at) => seen(at, { extruder: 180 }))];
    const { says } = run(obs);
    expect(says.map(text)).toContain("J'ai demandé la pause, mais l'impression continue. Va voir l'imprimante.");
  });

  it('l’utilisateur reprend après la pause : la surveillance repart de zéro', () => {
    const obs = [seen(0), ...every(10_000, 3 * MIN + 10_000, (at) => seen(at, { extruder: 180 }))];
    let { state } = run(obs);
    state = run([seen(3 * MIN + 20_000, { state: 'paused' })], BASE, state).state;
    const resumed = run([seen(5 * MIN), seen(5 * MIN + 10_000)], BASE, state);
    expect(resumed.says.map(text)).toEqual(["L'impression a repris. Je continue à surveiller."]);
    expect(resumed.state.phase).toBe('watching');
    expect(resumed.gestures).toEqual([]);
  });

  it('impression qui n’avance plus depuis 10 minutes : pause', () => {
    const obs = every(0, 11 * MIN, (at) => seen(at, { progress: 0.42 }));
    const { gestures } = run(obs);
    expect(gestures.map((g) => g.action.kind)).toEqual(['pause']);
    expect(gestures[0]!.at).toBe(10 * MIN);
  });

  it('Klipper arrêté sur une erreur : une alerte, aucun geste', () => {
    const obs = [seen(0), { at: 10_000, printer: { reachable: true as const, status: status(), klippy: 'shutdown' as const } }];
    const { gestures, says } = run(obs);
    expect(gestures).toEqual([]);
    expect(says.at(-1)!.action).toMatchObject({ level: 'alerte', photo: true });
  });

  it('caméra noire ou figée : un doute, jamais un geste, et pas de « tout va bien »', () => {
    const dark = run(every(0, 2 * MIN, (at) => seen(at, {}, { camera: { reachable: true, dark: true, signature: 'x' } })));
    expect(dark.gestures).toEqual([]);
    expect(dark.says.filter((s) => text(s).startsWith('Je ne vois plus'))).toHaveLength(1);

    const frozen = run(every(0, 2 * MIN, (at) => seen(at, {}, { camera: { reachable: true, dark: false, signature: 'meme' } })));
    expect(frozen.gestures).toEqual([]);
    const blindAt = frozen.says.find((s) => text(s).startsWith('Je ne vois plus'))!.at;
    expect(blindAt).toBe((SURVEILLANCE_LIMITS.frozenFrames - 1) * 10_000);

    const moving = run(every(0, 2 * MIN, (at) => seen(at, {}, { camera: { reachable: true, dark: false, signature: String(at) } })));
    expect(moving.says.filter((s) => text(s).startsWith('Je ne vois plus'))).toEqual([]);
  });

  it('pause faite par l’utilisateur : une information, jamais d’annulation', () => {
    const obs = [seen(0), ...every(10_000, 30 * MIN, (at) => seen(at, { state: 'paused' }))];
    const { gestures, says } = run(obs);
    expect(gestures).toEqual([]);
    expect(says.map(text)).toContain("L'impression est en pause, mais pas par moi. Je n'y touche pas.");
  });
});

describe('Klipper injoignable et coupure de secours', () => {
  const heating = { plug: { reachable: true as const, on: true, watts: 250 } };
  const cold = { plug: { reachable: true as const, on: true, watts: 8 } };

  it('coupure de secours non cochée : on prévient, on ne coupe jamais', () => {
    const { gestures, says } = run([seen(0), ...every(10_000, 10 * MIN, (at) => down(at, heating))], BASE);
    expect(gestures).toEqual([]);
    expect(says.map(text).some((t) => t.includes("la coupure de secours n'est pas activée"))).toBe(true);
  });

  it('seuil de chauffe pas réglé : jamais de coupure', () => {
    const settings = { ...CUT, heatingWatts: null };
    const { gestures } = run([seen(0), ...every(10_000, 10 * MIN, (at) => down(at, heating))], settings);
    expect(gestures).toEqual([]);
  });

  it('injoignable et chauffe mesurée : annonce à 2 min, coupure 1 min après, puis vérifiée', () => {
    const obs = [seen(0), ...every(10_000, 4 * MIN, (at) => down(at, heating))];
    const { gestures, says, state } = run(obs, CUT);
    const announce = says.find((s) => text(s).includes('Je coupe sa prise dans 1 minute'));
    expect(announce?.at).toBe(2 * MIN + 10_000);
    expect(gestures.map((g) => g.action.kind)).toEqual(['cut']);
    expect(gestures[0]!.at).toBe(3 * MIN + 10_000);
    const verified = run([down(4 * MIN + 10_000, { plug: { reachable: true, on: false, watts: 0 } })], CUT, state);
    expect(verified.says.map(text)).toEqual(["Prise de l'imprimante coupée, vérifié. Pour la rallumer, il faudra ton accord."]);
  });

  it('injoignable mais froide : pas de coupure', () => {
    const { gestures, says } = run([seen(0), ...every(10_000, 10 * MIN, (at) => down(at, cold))], CUT);
    expect(gestures).toEqual([]);
    expect(says.map(text).some((t) => t.includes('elle ne chauffe pas'))).toBe(true);
  });

  it('imprimante et prise injoignables : « je ne peux rien faire »', () => {
    const { gestures, says } = run([seen(0), ...every(10_000, 10 * MIN, (at) => down(at, { plug: { reachable: false } }))], CUT);
    expect(gestures).toEqual([]);
    expect(says.map(text)).toContain("L'imprimante et la prise ne répondent plus : je ne peux rien faire. Va voir l'imprimante.");
  });

  it('Klipper répond de nouveau pendant l’annonce : on ne coupe pas', () => {
    const obs = [seen(0), ...every(10_000, 2 * MIN + 30_000, (at) => down(at, heating)), seen(2 * MIN + 40_000), ...every(2 * MIN + 50_000, 6 * MIN, (at) => seen(at, { progress: 0.2 + at / 1e9 }))];
    const { gestures, says, state } = run(obs, CUT);
    expect(gestures).toEqual([]);
    expect(says.map(text)).toContain("L'imprimante répond de nouveau : je ne coupe pas la prise.");
    expect(state.phase).toBe('watching');
  });

  it('rien n’est surveillé quand aucune impression n’était en cours', () => {
    const { all } = run(every(0, 10 * MIN, (at) => down(at, heating)), CUT);
    expect(all).toEqual([]);
  });
});

describe('points d’avancement envoyés tout seuls', () => {
  it('surveillance démarrée en cours de route : on ne rattrape pas les points déjà passés', () => {
    const obs = every(0, 5 * MIN, (at) => seen(at, { progress: 0.6 + at / (100 * MIN), printDuration: 1200 + at / 1000 }));
    const { says } = run(obs);
    const etapes = says.filter((s) => s.action.kind === 'say' && s.action.level === 'etape').map(text);
    expect(etapes).toHaveLength(0);
    const later = run([...obs, seen(16 * MIN, { progress: 0.76, printDuration: 2000 })]);
    expect(later.says.filter((s) => s.action.kind === 'say' && s.action.level === 'etape').map(text)).toEqual([
      'Impression de cube : 75 %. Tout va bien. Reste environ 10 min.',
    ]);
  });

  it('un saut de 20 % à 55 % : un seul message, le plus récent', () => {
    const { says } = run([seen(0, { progress: 0.2 }), seen(10_000, { progress: 0.55 })]);
    const etapes = says.filter((s) => s.action.kind === 'say' && s.action.level === 'etape').map(text);
    expect(etapes).toHaveLength(1);
    expect(etapes[0]!.startsWith('Impression de cube : 50 %')).toBe(true);
  });

  it('un doute entre deux points : le point suivant le dit, la fin le raconte', () => {
    const obs = [
      seen(0, { progress: 0.1 }),
      ...every(10_000, 100_000, (at) => seen(at, { progress: 0.1 + at / 10_000_000, extruder: 180 })),
      seen(110_000, { progress: 0.3 }),
      seen(120_000, { progress: 0.52 }),
      seen(130_000, { state: 'complete', progress: 1, printDuration: 3700 }),
    ];
    const { says, gestures } = run(obs);
    expect(gestures).toEqual([]);
    const etapes = says.filter((s) => s.action.kind === 'say' && s.action.level === 'etape').map(text);
    expect(etapes[0]).toContain('Tout va bien maintenant, après un doute depuis le dernier point.');
    expect(etapes[1]).toContain('Tout va bien.');
    expect(etapes.at(-1)).toBe(
      "Impression de cube terminée en 1 h 1. Un incident pendant l'impression : température de la buse (180° au lieu de 210°). Vérifie la pièce.",
    );
  });

  it('caméra aveugle au moment d’un point : jamais « tout va bien »', () => {
    const cam = (at: number) => ({ camera: { reachable: true, dark: true, signature: String(at) } });
    const obs = every(0, 60_000, (at) => seen(at, { progress: 0.2 }, cam(at)));
    obs.push(seen(70_000, { progress: 0.26 }, cam(70_000)));
    const etapes = run(obs).says.filter((s) => s.action.kind === 'say' && s.action.level === 'etape').map(text);
    expect(etapes).toHaveLength(1);
    expect(etapes[0]).toContain("Klipper va bien, mais je ne vois plus l'imprimante.");
    expect(etapes[0]).not.toContain('Tout va bien');
  });

  it('pas de point pendant une pause de Jarvis', () => {
    const obs = [seen(0, { progress: 0.2 }), ...every(10_000, 10 * MIN, (at) => seen(at, { progress: 0.2 }))];
    const paused = run(obs);
    expect(paused.gestures.map((g) => g.action.kind)).toContain('pause');
    const after = run([seen(11 * MIN, { state: 'paused', progress: 0.3 })], BASE, paused.state);
    expect(after.says.filter((s) => s.action.kind === 'say' && s.action.level === 'etape')).toEqual([]);
  });
});
