import { describe, expect, it } from 'vitest';
import type { ChatStreamEvent, LLMProvider } from '../providers/types.js';
import type { TurnLogEntry } from '../types.js';
import { TurnClock, emptySteps } from './chrono.js';
import { formatMs, median, speedReport, stepMs, summarizeSpeed, turnLogsOf } from './resume.js';

/** Horloge à la main : chaque essai avance le temps lui-même. */
function horloge(start = 1_000) {
  let now = start;
  return { now: () => now, avance: (ms: number) => (now += ms) };
}

function fauxModele(events: ChatStreamEvent[], seen: unknown[] = []): LLMProvider {
  return {
    id: 'ollama',
    label: 'Ollama',
    model: 'modele-synthetique',
    requiresApiKey: false,
    async *streamChat(request) {
      seen.push(request);
      for (const event of events) yield event;
    },
  };
}

const USAGE = { promptTokens: 1200, promptMs: 800.4, outputTokens: 40, outputMs: 1500.2, loadMs: 4200.6, totalMs: 6600 };

async function lire(provider: LLMProvider, request = { messages: [] }): Promise<ChatStreamEvent[]> {
  const out: ChatStreamEvent[] = [];
  for await (const event of provider.streamChat(request)) out.push(event);
  return out;
}

describe('chronomètre du tour', () => {
  it('un tour sans rien de mesuré ne donne aucune étape', () => {
    const clock = new TurnClock(horloge().now);
    expect(clock.steps()).toEqual({});
    expect(emptySteps(clock.steps())).toBe(true);
  });

  it('le fournisseur enveloppé envoie la même requête et rend les mêmes événements', async () => {
    const events: ChatStreamEvent[] = [
      { type: 'text', delta: 'Bon' },
      { type: 'text', delta: 'jour.' },
      { type: 'done', finishReason: 'stop', usage: USAGE },
    ];
    const seen: unknown[] = [];
    const bare = fauxModele(events, seen);
    const wrapped = new TurnClock(horloge().now).wrap(bare, 'reponse');
    const request = { messages: [], system: 'consigne', temperature: 0.2 };
    expect(await lire(wrapped, request)).toEqual(events);
    expect(seen).toEqual([request]);
    expect(seen[0]).toBe(request);
    expect([wrapped.id, wrapped.label, wrapped.model, wrapped.requiresApiKey]).toEqual([
      bare.id,
      bare.label,
      bare.model,
      bare.requiresApiKey,
    ]);
  });

  it('lit le chargement, la lecture et l’écriture d’Ollama, et les additionne sur les appels du tour', async () => {
    const clock = new TurnClock(horloge().now);
    const model = clock.wrap(fauxModele([{ type: 'done', finishReason: 'tool_calls', usage: USAGE }]), 'reponse');
    await lire(model);
    await lire(model);
    expect(clock.steps()).toEqual({
      appels: 2,
      chargement: 8401,
      lecture: { ms: 1601, jetons: 2400 },
      ecriture: { ms: 3000, jetons: 80 },
    });
  });

  it('sans mesure d’Ollama (chat sans orchestre, autre fournisseur), seul le nombre d’appels est noté', async () => {
    const clock = new TurnClock(horloge().now);
    await lire(clock.wrap(fauxModele([{ type: 'text', delta: 'ok' }, { type: 'done', finishReason: 'stop' }]), 'reponse'));
    expect(clock.steps()).toEqual({ appels: 1 });
  });

  it('le tri par un modèle garde son propre chargement, à part de celui de la réponse', async () => {
    const time = horloge();
    const clock = new TurnClock(time.now);
    clock.startRouting();
    await lire(clock.wrap(fauxModele([{ type: 'done', finishReason: 'stop', usage: { ...USAGE, loadMs: 5000, promptTokens: 300 } }]), 'tri'));
    time.avance(5600);
    clock.endRouting('cerveau');
    expect(clock.steps()).toEqual({ tri: { ms: 5600, chemin: 'cerveau', modele: true, chargementMs: 5000, jetons: 300 } });
  });

  it('un tri par règle ne dit pas qu’un modèle a trié', () => {
    const time = horloge();
    const clock = new TurnClock(time.now);
    clock.startRouting();
    time.avance(3);
    clock.endRouting('express');
    expect(clock.steps()).toEqual({ tri: { ms: 3, chemin: 'express' } });
  });

  it('un tri qui n’a choisi personne est noté « aucun » ; sans début de tri, rien n’est noté', () => {
    const clock = new TurnClock(horloge().now);
    clock.endRouting('express');
    expect(clock.steps()).toEqual({});
    clock.startRouting();
    clock.endRouting(null);
    expect(clock.steps().tri?.chemin).toBe('aucun');
  });

  it('le premier mot et le premier son ne sont notés qu’une fois', () => {
    const time = horloge();
    const clock = new TurnClock(time.now);
    time.avance(900);
    clock.firstWord();
    time.avance(5000);
    clock.firstWord();
    clock.voice(2400);
    clock.voice(9000);
    expect(clock.steps()).toEqual({ premierMot: 900, voix: 2400 });
  });

  it('les outils gardent leur nom, leur durée, et « garde » seulement pour un résultat repris', () => {
    const clock = new TurnClock(horloge().now);
    clock.tool('web_search', 1834.6);
    clock.tool('web_search', 2, true);
    clock.tool('outil_casse', Number.NaN);
    expect(clock.steps().outils).toEqual([
      { name: 'web_search', ms: 1835 },
      { name: 'web_search', ms: 2, garde: true },
      { name: 'outil_casse', ms: 0 },
    ]);
  });
});

function tour(extra: Partial<TurnLogEntry> = {}): TurnLogEntry {
  return {
    userMessageId: 'u',
    assistantMessageIds: ['a'],
    team: 'conversation',
    how: 'cerveau',
    provider: 'ollama',
    model: 'modele-a',
    place: 'carte',
    source: 'texte',
    tools: [],
    durationMs: 10_000,
    at: 1,
    ...extra,
  };
}

describe('résumé de vitesse', () => {
  it('médiane et mise en forme', () => {
    expect(median([])).toBe(0);
    expect(median([5, 1, 3])).toBe(3);
    expect(median([4, 2])).toBe(3);
    expect(formatMs(340)).toBe('340 ms');
    expect(formatMs(1234)).toBe('1,2 s');
    expect(formatMs(12_400)).toBe('12 s');
  });

  it('une étape absente n’est pas comptée comme zéro', () => {
    expect(stepMs(tour(), 'chargement')).toBeNull();
    expect(stepMs(tour({ etapes: {} }), 'chargement')).toBeNull();
    expect(stepMs(tour({ etapes: { chargement: 0 } }), 'chargement')).toBe(0);
    expect(stepMs(tour({ etapes: { outils: [{ name: 'a', ms: 5 }, { name: 'b', ms: 7 }] } }), 'outils')).toBe(12);
    expect(stepMs(tour(), 'total')).toBe(10_000);
  });

  it('calcule médiane, pire cas, parts du temps et chargements payés', () => {
    const summary = summarizeSpeed([
      tour({
        durationMs: 10_000,
        etapes: {
          tri: { ms: 1000, chemin: 'cerveau', modele: true, chargementMs: 0 },
          chargement: 5000,
          lecture: { ms: 1000, jetons: 2000 },
          ecriture: { ms: 2000, jetons: 60 },
          premierMot: 7500,
        },
      }),
      tour({
        durationMs: 2000,
        etapes: {
          tri: { ms: 4, chemin: 'express' },
          chargement: 0,
          lecture: { ms: 200, jetons: 1000 },
          ecriture: { ms: 800, jetons: 30 },
          outils: [{ name: 'web_search', ms: 600 }, { name: 'web_search', ms: 1, garde: true }],
        },
      }),
      // Ancien journal, sans le détail : compté dans le tour entier seulement.
      tour({ durationMs: 4000, team: null, how: null, source: 'voix', model: null, place: null }),
    ]);
    expect(summary.turns).toBe(3);
    expect(summary.timed).toBe(2);
    expect(summary.all.steps.total).toMatchObject({ n: 3, medianMs: 4000, worstMs: 10_000 });
    expect(summary.all.steps.chargement).toMatchObject({ n: 2, medianMs: 2500, worstMs: 5000 });
    expect(summary.all.steps.voix).toBeUndefined();
    // Parts sur les seuls tours chronométrés : 12 000 ms.
    expect(summary.all.shares.chargement).toBeCloseTo(5000 / 12_000);
    expect(summary.all.shares.outils).toBeCloseTo(601 / 12_000);
    expect(summary.all.promptTokens).toEqual({ n: 2, median: 1500, worst: 2000 });
    expect(summary.all.loadsPaid).toBe(1);
    expect(summary.byPath.map((group) => group.name).sort()).toEqual(['cerveau', 'express', 'sans tri']);
    expect(summary.bySource.map((group) => [group.name, group.turns])).toEqual([
      ['texte', 2],
      ['voix', 1],
    ]);
    expect(summary.byTeam.find((group) => group.name === 'chat sans équipe')?.turns).toBe(1);
    expect(summary.tools).toEqual([{ name: 'web_search', calls: 2, kept: 1, medianMs: 301, worstMs: 600 }]);
  });

  it('un chargement payé pendant le tri compte aussi', () => {
    const summary = summarizeSpeed([
      tour({ etapes: { tri: { ms: 6000, chemin: 'cerveau', modele: true, chargementMs: 5500 }, chargement: 0 } }),
    ]);
    expect(summary.all.loadsPaid).toBe(1);
  });

  it('le rapport ne contient que des chiffres et des noms techniques', () => {
    const report = speedReport(
      summarizeSpeed([tour({ etapes: { chargement: 5000, lecture: { ms: 1000, jetons: 2000 }, ecriture: { ms: 2000, jetons: 60 } } })]),
      { date: '17 novembre 2026', sources: ['Jarvis Test : 1 conversation'] },
    );
    expect(report).toContain('# Vitesse de Jarvis');
    expect(report).toContain('chargement du modèle : 50 %');
    expect(report).toContain('| conversation | 1 |');
    expect(report).toContain('5,0 s / 5,0 s');
    expect(report).toContain('Tours qui ont payé un chargement de modèle de plus d’une seconde : 1 sur 1.');
  });

  it('dit clairement quand il n’y a rien à lire, ou rien de chronométré', () => {
    expect(speedReport(summarizeSpeed([]), { date: 'x' })).toContain('Aucun tour dans le journal');
    expect(speedReport(summarizeSpeed([tour()]), { date: 'x' })).toContain('écrits avant le chronomètre');
  });

  it('ne lit que le journal du tour d’une conversation, jamais ses messages', () => {
    const secret = 'phrase-synthetique-qui-ne-doit-pas-sortir';
    const conversation = {
      id: 'c',
      messages: [{ role: 'user', content: secret }],
      turnLog: [tour(), { durationMs: 'x' }, null, { durationMs: 5 }, tour({ durationMs: 7 })],
    };
    const logs = turnLogsOf(conversation);
    expect(logs.map((entry) => entry.durationMs)).toEqual([10_000, 7]);
    expect(speedReport(summarizeSpeed(logs), { date: 'x' })).not.toContain(secret);
    expect(turnLogsOf(null)).toEqual([]);
    expect(turnLogsOf({ turnLog: 'non' })).toEqual([]);
  });
});
