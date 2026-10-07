import { describe, expect, it } from 'vitest';
import {
  ConversationSession,
  FOLLOW_UP_WINDOW_MS,
  WAKE_GRACE_MS,
  classifySpokenTurn,
  isConversationStop,
} from './conversationSession.js';
import { EndOfSpeechDetector } from './endOfSpeech.js';

const wake = { word: 'jarvis' };
const RATE = 16_000;

const tone = (seconds: number, amplitude = 0.2) =>
  new Float32Array(Math.round(seconds * RATE)).map((_, index) => amplitude * Math.sin(index / 5));
const silence = (seconds: number) => new Float32Array(Math.round(seconds * RATE));

function commandAfterWake(): { session: ConversationSession; kept: string[] } {
  const session = new ConversationSession();
  const detector = new EndOfSpeechDetector();
  const kept: string[] = [];
  session.acceptWake(0);
  let at = 0;
  const push = (pcm: Float32Array, label?: string): 'hold' | 'close' => {
    const ended = detector.pushPcm(pcm, RATE);
    at += (pcm.length / RATE) * 1000;
    if (label) kept.push(label);
    return session.pollCommand(at, ended);
  };
  expect(push(silence(1))).toBe('hold');
  expect(push(tone(0.4), 'quelle heure est-il')).toBe('hold');
  expect(push(silence(0.7))).toBe('hold');
  expect(at).toBeLessThan(WAKE_GRACE_MS);
  expect(push(silence((WAKE_GRACE_MS - at) / 1000 + 0.02))).toBe('close');
  return { session, kept };
}

describe('grâce après le réveil', () => {
  it('ne peut pas se fermer avant 3 s, même si la fin de parole a déjà vu du silence', () => {
    const session = new ConversationSession();
    session.acceptWake(0);
    expect(session.pollCommand(1_500, true)).toBe('hold');
    expect(session.pollCommand(WAKE_GRACE_MS - 1, true)).toBe('hold');
    expect(session.phase).toBe('command');
    expect(session.showListening).toBe(true);
    expect(session.pollCommand(WAKE_GRACE_MS, true)).toBe('close');
  });

  it('garde une commande dite 1 s après le réveil', () => {
    const { kept } = commandAfterWake();
    expect(kept).toEqual(['quelle heure est-il']);
  });

  it('un second « Jarvis » dans la fenêtre ne réinitialise pas la commande', () => {
    const session = new ConversationSession();
    expect(session.acceptWake(0)).toBe('started');
    expect(session.acceptWake(1_000)).toBe('ignored');
    expect(session.graceDeadline).toBe(WAKE_GRACE_MS);
    expect(session.phase).toBe('command');
    expect(session.pollCommand(WAKE_GRACE_MS, true)).toBe('close');
  });
});

describe('suivi sans mot de réveil', () => {
  function sent(session = new ConversationSession()): ConversationSession {
    session.acceptWake(0);
    session.pollCommand(WAKE_GRACE_MS, true);
    expect(session.deliver('quelle heure est-il', wake)).toEqual({
      kind: 'send',
      text: 'quelle heure est-il',
    });
    expect(session.acceptsWakeWord).toBe(false);
    expect(session.showListening).toBe(true);
    return session;
  }

  it('une parole pendant la réponse part sans mot de réveil', () => {
    const session = sent();
    expect(session.awaitingReply).toBe(true);
    expect(session.noteHotSpeech(1_000, 100)).toBe('wait');
    expect(session.phase).toBe('hot');
    expect(session.noteHotSpeech(1_200, 150)).toBe('capture');
    expect(session.deliver('pause', wake)).toEqual({ kind: 'send', text: 'pause' });
    expect(session.acceptsWakeWord).toBe(false);
  });

  it('une parole longtemps après la réponse part sans mot de réveil', () => {
    const session = sent();
    session.replyFinished(4_000);
    expect(session.noteHotSpeech(4_000 + FOLLOW_UP_WINDOW_MS + 60_000, 200)).toBe('capture');
    expect(session.deliver('et demain', wake)).toEqual({ kind: 'send', text: 'et demain' });
    expect(session.acceptsWakeWord).toBe(false);
    expect(session.showListening).toBe(true);
  });

  it('le silence prolongé ne ferme pas la session : seul un arrêt explicite', () => {
    expect(FOLLOW_UP_WINDOW_MS).toBe(2_000);
    const session = sent();
    session.replyFinished(4_000);
    expect(session.pollHot(4_000 + FOLLOW_UP_WINDOW_MS - 1)).toBe('stay');
    expect(session.acceptsWakeWord).toBe(false);
    expect(session.pollHot(4_000 + FOLLOW_UP_WINDOW_MS + 120_000)).toBe('stay');
    expect(session.acceptsWakeWord).toBe(false);
    expect(session.showListening).toBe(true);
    expect(session.phase).toBe('hot');
    session.standby();
    expect(session.acceptsWakeWord).toBe(true);
    expect(session.showListening).toBe(false);
  });

  it('« stop », « tais-toi » et « merci c’est bon » reviennent en veille', () => {
    for (const phrase of ['stop', 'tais-toi', "merci c'est bon"]) {
      const session = sent();
      session.replyFinished(0);
      expect(session.noteHotSpeech(1_000, 200)).toBe('capture');
      expect(session.deliver(phrase, wake)).toEqual({ kind: 'stop' });
      expect(session.phase).toBe('standby');
      expect(session.showListening).toBe(false);
      expect(session.acceptsWakeWord).toBe(true);
    }
  });

  it('une hallucination ne lance pas de tour et ne ferme pas la session', () => {
    const session = sent();
    session.replyFinished(0);
    expect(session.noteHotSpeech(1_000, 200)).toBe('capture');
    expect(session.deliver('...', wake)).toEqual({ kind: 'ignore' });
    expect(session.phase).toBe('hot');
    expect(session.noteHotSpeech(1_500, 200)).toBe('capture');
    expect(session.deliver('you', wake).kind).toBe('ignore');
    expect(session.phase).toBe('hot');
    expect(session.pollHot(FOLLOW_UP_WINDOW_MS + 99_000)).toBe('stay');
    expect(session.showListening).toBe(true);
  });
});

describe('veille', () => {
  it('l’orbe au repos ne suit pas la voix', () => {
    const session = new ConversationSession();
    expect(session.showListening).toBe(false);
    expect(session.acceptsWakeWord).toBe(true);
    session.acceptWake(0);
    expect(session.showListening).toBe(true);
    session.standby();
    expect(session.showListening).toBe(false);
  });
});

describe('classifySpokenTurn', () => {
  it('retire le réveil de la première commande et ignore les queues connues', () => {
    expect(classifySpokenTurn('Jarvis, quelle heure est-il ?', 'command', wake)).toEqual({
      kind: 'send',
      text: 'quelle heure est-il',
    });
    expect(classifySpokenTurn('...', 'command', wake).kind).toBe('ignore');
    expect(classifySpokenTurn('you', 'follow-up', wake).kind).toBe('ignore');
    expect(classifySpokenTurn('', 'follow-up', wake).kind).toBe('ignore');
    expect(
      classifySpokenTurn('Je vous invite à vous dire que vous avez une question qui', 'follow-up', wake).kind,
    ).toBe('ignore');
  });

  it('reconnaît les arrêts', () => {
    expect(isConversationStop('Stop.')).toBe(true);
    expect(isConversationStop('Tais-toi !')).toBe(true);
    expect(isConversationStop("Merci, c'est bon")).toBe(true);
    expect(classifySpokenTurn('Jarvis, stop', 'command', wake)).toEqual({ kind: 'stop' });
    expect(classifySpokenTurn('pause', 'follow-up', wake)).toEqual({ kind: 'send', text: 'pause' });
  });
});
