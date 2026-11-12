import { describe, expect, it } from 'vitest';
import { classifyUtterance } from '../learning/continuous.js';
import { detectRates } from './detect.js';
import type { ObservedTurn, PreviousTurn, ToolLine } from './types.js';

/**
 * Phrases synthétiques marquées synthetique-test.
 * Aucune n'est une phrase réelle de l'utilisateur, aucune ne part à l'entraînement.
 */
const AT = 1_700_000_000_000;

function previous(partial: Partial<PreviousTurn> = {}): PreviousTurn {
  return {
    at: AT,
    userText: 'Quelle heure est-il ?',
    replyText: 'Il est 3 heures.',
    team: 'horloge',
    model: 'sans modèle',
    how: 'express',
    tools: [],
    durations: {},
    ...partial,
  };
}

function turn(partial: Partial<ObservedTurn> = {}): ObservedTurn {
  return {
    at: AT + 1_000,
    conversationId: 'conv-synthetique',
    edition: 'test',
    place: { kind: 'fenetre' },
    userText: 'bonjour',
    replyText: 'Bonjour.',
    team: 'conversation',
    model: 'qwen2.5:7b',
    how: 'cerveau',
    brainUnreadable: false,
    tools: [],
    durations: {},
    firstWordMs: 400,
    speakerFirstSoundMs: null,
    cut: null,
    previous: null,
    ...partial,
  };
}

function tool(partial: Partial<ToolLine> & Pick<ToolLine, 'name' | 'status' | 'line'>): ToolLine {
  return partial;
}

describe('carnet — détection par règles (synthetique-test)', () => {
  it('synthetique-test un tour réussi ne note rien', () => {
    expect(detectRates(turn({ previous: previous() }))).toEqual([]);
  });

  it('synthetique-test correction : non, c’est faux, pas ça, corrige', () => {
    for (const userText of [
      'Non, c’est faux',
      'pas ça',
      'corrige le calcul',
      "c'est faux, il est 14 h",
    ]) {
      const found = detectRates(turn({ userText, previous: previous() }));
      expect(found.map((item) => item.type)).toContain('correction');
      expect(found.find((item) => item.type === 'correction')).toMatchObject({
        rule: 'correction-classify',
        userText,
        replyText: 'Il est 3 heures.',
      });
    }
  });

  it('synthetique-test correction : je t’ai dit', () => {
    const found = detectRates(turn({ userText: "je t'ai dit 14 heures", previous: previous() }));
    expect(found).toEqual([
      expect.objectContaining({
        type: 'correction',
        rule: 'correction-je-t-ai-dit',
        userText: "je t'ai dit 14 heures",
      }),
    ]);
  });

  it('synthetique-test pas de correction sans réponse juste avant', () => {
    expect(detectRates(turn({ userText: 'Non, c’est faux' }))).toEqual([]);
  });

  it('synthetique-test faux raté : non, mais… est une nouvelle demande', () => {
    const userText = 'Non, mais cherche la météo de Lyon';
    expect(classifyUtterance(userText)).toBe('correction');
    const found = detectRates(turn({ userText, previous: previous() }));
    expect(found.some((item) => item.type === 'correction')).toBe(false);
  });

  it('synthetique-test répétition : la même demande dans les 3 minutes', () => {
    const userText = 'ouvre le dossier photos';
    const found = detectRates(
      turn({
        at: AT + 60_000,
        userText,
        previous: previous({ at: AT, userText, replyText: 'Je ne le trouve pas.' }),
      }),
    );
    expect(found.map((item) => item.rule)).toEqual(['repetition-70-3min']);
  });

  it('synthetique-test répétition trop tardive : rien', () => {
    const userText = 'ouvre le dossier photos';
    expect(
      detectRates(
        turn({
          at: AT + 3 * 60_000 + 1,
          userText,
          previous: previous({ at: AT, userText }),
        }),
      ),
    ).toEqual([]);
  });

  it('synthetique-test faux raté : répétition volontaire, encore une blague', () => {
    const found = detectRates(
      turn({
        userText: 'raconte encore une blague drole',
        previous: previous({ userText: 'raconte une blague drole', replyText: 'Une blague.' }),
      }),
    );
    expect(found.some((item) => item.type === 'repetition')).toBe(false);
    expect(
      detectRates(
        turn({
          userText: 'encore une blague',
          previous: previous({ userText: 'raconte une blague', replyText: 'Une blague.' }),
        }),
      ).some((item) => item.type === 'repetition'),
    ).toBe(false);
  });

  it('synthetique-test interruption : stop, tais-toi, bouton, parole, dans les 5 secondes', () => {
    expect(
      detectRates(turn({ cut: { afterMs: 1_000, text: 'stop', speech: true } })).map(
        (item) => item.rule,
      ),
    ).toEqual(['interruption-stop']);
    expect(
      detectRates(turn({ cut: { afterMs: 5_000, text: 'tais-toi' } })).map((item) => item.rule),
    ).toEqual(['interruption-tais-toi']);
    expect(
      detectRates(turn({ cut: { afterMs: 800, button: true } })).map((item) => item.rule),
    ).toEqual(['interruption-bouton']);
    expect(
      detectRates(turn({ cut: { afterMs: 2_000, speech: true, text: 'attends' } })).map(
        (item) => item.rule,
      ),
    ).toEqual(['interruption-parole']);
  });

  it('synthetique-test interruption trop tardive : rien', () => {
    expect(detectRates(turn({ cut: { afterMs: 5_001, text: 'stop' } }))).toEqual([]);
  });

  it('synthetique-test faux raté : stop adressé à Spotify', () => {
    expect(
      detectRates(turn({ cut: { afterMs: 500, speech: true, text: 'stop Spotify' } })),
    ).toEqual([]);
    expect(detectRates(turn({ cut: { afterMs: 500, text: 'arrête la musique' } }))).toEqual([]);
  });

  it('synthetique-test outil en erreur, délai, verification_failed, refus non voulu', () => {
    const error = detectRates(
      turn({
        tools: [tool({ name: 'web_search', status: 'error', line: 'La page est introuvable.' })],
      }),
    );
    expect(error.map((item) => item.rule)).toEqual(['outil-erreur']);

    const timeout = detectRates(
      turn({
        tools: [
          tool({
            name: 'web_search',
            status: 'error',
            line: "L'opération n'a pas répondu à temps.",
            outcome: 'timeout',
          }),
        ],
      }),
    );
    expect(timeout.map((item) => item.rule)).toEqual(['outil-delai']);

    const verified = detectRates(
      turn({
        tools: [
          tool({
            name: 'google_gmail_send',
            status: 'error',
            line: 'verification_failed',
            outcome: 'verification_failed',
          }),
        ],
      }),
    );
    expect(verified.map((item) => item.rule)).toEqual(['outil-verification-failed']);

    const refused = detectRates(
      turn({
        tools: [
          tool({
            name: 'run_command',
            status: 'denied',
            line: "L'outil « run_command » est désactivé par la politique de sécurité.",
          }),
        ],
      }),
    );
    expect(refused.map((item) => item.rule)).toEqual(['outil-refus']);
  });

  it('synthetique-test un outil réussi ou un refus de l’utilisateur ne compte pas', () => {
    expect(
      detectRates(
        turn({
          tools: [
            tool({ name: 'spotify_play', status: 'ok', line: 'Lecture en cours.' }),
            tool({
              name: 'create_folder',
              status: 'denied',
              line: "L'utilisateur a refusé cette action. Ne la retente pas sans son accord.",
            }),
          ],
        }),
      ),
    ).toEqual([]);
  });

  it('synthetique-test lenteur fenêtre au-delà de 10 s, pas à 10 s pile', () => {
    expect(detectRates(turn({ firstWordMs: 10_000 }))).toEqual([]);
    expect(
      detectRates(turn({ firstWordMs: 10_001, place: { kind: 'telephone' } })).map(
        (item) => item.rule,
      ),
    ).toEqual(['lenteur-fenetre']);
  });

  it('synthetique-test lenteur enceinte au-delà de 6 s', () => {
    expect(
      detectRates(
        turn({
          place: { kind: 'enceinte', name: 'Cuisine' },
          speakerFirstSoundMs: 6_000,
          firstWordMs: 20_000,
        }),
      ),
    ).toEqual([]);
    expect(
      detectRates(
        turn({
          place: { kind: 'enceinte', name: 'Cuisine' },
          speakerFirstSoundMs: 6_001,
          firstWordMs: 100,
        }),
      ).map((item) => item.rule),
    ).toEqual(['lenteur-enceinte']);
  });

  it('synthetique-test faux raté : lenteur pendant un téléchargement demandé', () => {
    expect(
      detectRates(turn({ userText: 'télécharge le modèle qwen', firstWordMs: 40_000 })),
    ).toEqual([]);
    expect(
      detectRates(
        turn({
          userText: 'télécharge whisper',
          place: { kind: 'enceinte', name: 'Salon' },
          speakerFirstSoundMs: 30_000,
        }),
      ),
    ).toEqual([]);
  });

  it('synthetique-test chemin : cerveau illisible, ou équipe sans l’outil voulu', () => {
    const illisible = detectRates(
      turn({ userText: 'bonjour', brainUnreadable: true, how: null, team: null }),
    );
    expect(illisible.map((item) => item.rule)).toEqual(['chemin-illisible']);
    expect(illisible[0]?.how).toBe('chemin-avant');

    const missing = detectRates(
      turn({ userText: 'Mets Daft Punk sur Spotify', team: 'conversation', how: 'cerveau' }),
    );
    expect(missing.map((item) => item.rule)).toEqual(['chemin-sans-outil']);

    expect(
      detectRates(
        turn({ userText: 'Mets Daft Punk sur Spotify', team: 'musique', how: 'express' }),
      ),
    ).toEqual([]);
  });

  it('synthetique-test revue : une phrase plus longue va au modèle, le film n’est pas un signal', () => {
    const before = previous({ userText: 'Quelle heure est-il ?', replyText: 'Il est 15 h.' });
    for (const userText of [
      "Tu t'es trompé, il est 17 h, pas 15 h",
      "Le script, ça n'a pas marché, regarde l'erreur",
      "L'impression d'hier, ça n'a pas marché, tu peux la relancer ?",
    ]) {
      const found = detectRates(turn({ userText, previous: before }));
      expect(found, userText).toEqual([
        expect.objectContaining({
          type: 'signale',
          rule: 'signale-phrase',
          userText: 'Quelle heure est-il ?',
          replyText: 'Il est 15 h.',
        }),
      ]);
    }
    expect(
      detectRates(
        turn({ userText: "Le film d'hier soir, c'était nul", previous: before }),
      ),
    ).toEqual([]);
  });

  it('synthetique-test revue : phrase seule, Jarvis devant ou derrière', () => {
    const before = previous();
    for (const userText of [
      "ça n'a pas marché",
      'ça marche pas',
      'ça a pas marché',
      "c'était nul",
      "tu t'es trompé",
      "tu t'es planté",
      "Jarvis, ça n'a pas marché",
      "ça n'a pas marché, Jarvis",
      'Jarvis vraiment ça marche pas hein',
      "bon, tu t'es planté, Jarvis",
    ]) {
      const found = detectRates(turn({ userText, previous: before }));
      expect(found, userText).toEqual([
        expect.objectContaining({ type: 'signale', rule: 'signale-phrase' }),
      ]);
    }
  });

  it('synthetique-test signale : ça n’a pas marché, c’était nul, tu t’es trompé notent le tour précédent', () => {
    const before = previous({ userText: 'Quelle heure est-il ?', replyText: 'Il est 3 heures.' });
    for (const userText of ["ça n'a pas marché", 'Jarvis, c’était nul', "tu t'es trompé"]) {
      const found = detectRates(turn({ userText, replyText: "C'est noté.", previous: before }));
      expect(found).toEqual([
        expect.objectContaining({
          type: 'signale',
          rule: 'signale-phrase',
          userText: 'Quelle heure est-il ?',
          replyText: 'Il est 3 heures.',
        }),
      ]);
    }
    expect(detectRates(turn({ userText: "ça n'a pas marché" }))).toEqual([]);
  });

  it('synthetique-test signale : pouce en bas sur cette réponse', () => {
    const found = detectRates(
      turn({ userText: 'ouvre le dossier', replyText: 'Je ne peux pas.', thumbDown: true }),
    );
    expect(found.map((item) => item.rule)).toEqual(['signale-pouce']);
    expect(found[0]).toMatchObject({ userText: 'ouvre le dossier', replyText: 'Je ne peux pas.' });
  });
});
