import { afterEach, describe, expect, it, vi } from 'vitest';
import type { SpeakerStatus, SpeakerTranscribeRequest, SpeakerTranscribeResult } from '../../../shared/ipc';
import { createSpeakerWhisperBridge, shouldWarmWhisper } from './speakerWhisper';

/**
 * 5.0.64 (revue, point 6) — Whisper est chargé à l'avance dès que le pont des enceintes écoute,
 * pour que la première phrase du salon ne paie pas le réveil du modèle ; et jamais quand les
 * enceintes sont coupées (rien à charger pour rien).
 */
function status(partial: Partial<SpeakerStatus>): SpeakerStatus {
  return { enabled: false, running: false, port: 53131, error: null, addresses: [], hostName: 'pc.local', speakers: [], ...partial };
}

function fakeWindow(initial: SpeakerStatus) {
  let onEvent: ((status: SpeakerStatus) => void) | null = null;
  let onTranscribe: ((request: SpeakerTranscribeRequest) => void) | null = null;
  const reports: SpeakerTranscribeResult[] = [];
  vi.stubGlobal('window', {
    jarvis: {
      speaker: {
        status: async () => initial,
        onEvent: (listener: (status: SpeakerStatus) => void) => {
          onEvent = listener;
          return () => {
            onEvent = null;
          };
        },
        onTranscribe: (listener: (request: SpeakerTranscribeRequest) => void) => {
          onTranscribe = listener;
          return () => {
            onTranscribe = null;
          };
        },
        reportTranscript: (payload: SpeakerTranscribeResult) => reports.push(payload),
      },
    },
  });
  return {
    reports,
    emit: (next: SpeakerStatus) => onEvent?.(next),
    request: (request: SpeakerTranscribeRequest) => onTranscribe?.(request),
    get listening() {
      return onEvent !== null && onTranscribe !== null;
    },
  };
}

const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('Whisper chargé à l’avance pour les enceintes', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('quand faut-il charger : interrupteur sur « on » et port ouvert', () => {
    expect(shouldWarmWhisper(status({ enabled: true, running: true }))).toBe(true);
    expect(shouldWarmWhisper(status({ enabled: true, running: false }))).toBe(false);
    expect(shouldWarmWhisper(status({ enabled: false, running: false }))).toBe(false);
    expect(shouldWarmWhisper(null)).toBe(false);
  });

  it('enceintes déjà actives au lancement : chargé une seule fois, pas à chaque événement', async () => {
    const win = fakeWindow(status({ enabled: true, running: true }));
    const warm = vi.fn(async () => undefined);
    const dispose = createSpeakerWhisperBridge({ transcribe: async () => '', warm });
    await tick();
    expect(warm).toHaveBeenCalledTimes(1);
    win.emit(status({ enabled: true, running: true, speakers: [{ id: 'a', name: 'Salon', createdAt: 1, lastTurnAt: 2 }] }));
    await tick();
    expect(warm).toHaveBeenCalledTimes(1);
    dispose();
    expect(win.listening).toBe(false);
  });

  it('enceintes coupées : rien ; interrupteur allumé plus tard : chargé ; échec : nouvel essai au prochain événement', async () => {
    const win = fakeWindow(status({ enabled: false }));
    let fail = true;
    const warm = vi.fn(async () => {
      if (fail) throw new Error('modèle introuvable');
    });
    createSpeakerWhisperBridge({ transcribe: async () => '', warm });
    await tick();
    expect(warm).not.toHaveBeenCalled();

    win.emit(status({ enabled: true, running: true }));
    await tick();
    expect(warm).toHaveBeenCalledTimes(1);

    fail = false;
    win.emit(status({ enabled: true, running: true }));
    await tick();
    expect(warm).toHaveBeenCalledTimes(2);
    win.emit(status({ enabled: true, running: true }));
    await tick();
    expect(warm).toHaveBeenCalledTimes(2);
  });

  it('une demande de transcription passe par Whisper et revient avec le même identifiant', async () => {
    const win = fakeWindow(status({ enabled: true, running: true }));
    const transcribe = vi.fn(async () => ' Jarvis, quelle heure est-il ? ');
    createSpeakerWhisperBridge({ transcribe, warm: async () => undefined });
    const voice = Float32Array.from({ length: 1600 }, (_, i) => 0.3 * Math.sin(i / 5));
    win.request({ requestId: 'r1', pcm: voice });
    win.request({ requestId: 'r2', pcm: new Float32Array(1600) }); // silence : pas de Whisper
    await tick();
    expect(transcribe).toHaveBeenCalledTimes(1);
    expect(win.reports).toEqual([
      { requestId: 'r2', text: '' },
      { requestId: 'r1', text: 'Jarvis, quelle heure est-il ?' },
    ]);
  });
});
