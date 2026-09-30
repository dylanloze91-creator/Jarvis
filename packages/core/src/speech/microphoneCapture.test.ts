import { describe, expect, it } from 'vitest';
import {
  CAPTURE_NO_AUDIO_ERROR,
  CAPTURE_TIMEOUT_ERROR,
  actionOnDeviceChange,
  captureConstraints,
  captureFailureText,
  describeCaptureFailure,
  formatCaptureTimings,
  formatSeconds,
  recoveryDelayMs,
  redactDeviceId,
  resolveCaptureTarget,
  shouldFallbackToDefault,
} from './microphoneCapture.js';

function domError(name: string, message = ''): Error {
  return Object.assign(new Error(message), { name });
}

const GOXLR = [
  { deviceId: 'default', label: 'Default - Broadcast Stream Mix (TC-HELICON GoXLR Mini)' },
  { deviceId: 'mix', label: 'Broadcast Stream Mix (TC-HELICON GoXLR Mini)' },
  { deviceId: 'chat', label: 'Chat Mic (TC-HELICON GoXLR Mini)' },
];

describe('erreurs de capture', () => {
  it('garde toujours le nom exact et le message de Chromium', () => {
    const failure = describeCaptureFailure(
      domError('NotReadableError', 'Could not start audio source'),
      'getUserMedia',
      'Chat Mic (TC-HELICON GoXLR Mini)',
    );
    expect(failure.name).toBe('NotReadableError');
    const text = captureFailureText(failure);
    expect(text).toContain('NotReadableError : Could not start audio source');
    expect(text).toContain('Chat Mic (TC-HELICON GoXLR Mini)');
    expect(text).not.toMatch(/^Micro indisponible/);
  });

  it('reconnaît le blocage par la confidentialité Windows et donne le chemin du réglage', () => {
    const failure = describeCaptureFailure(
      domError('NotAllowedError', 'Permission denied by system'),
      'getUserMedia',
    );
    expect(failure.privacySettings).toBe(true);
    expect(failure.title).toMatch(/Windows bloque/);
    expect(captureFailureText(failure)).toMatch(/applications de bureau/);
    expect(captureFailureText(failure)).toContain('NotAllowedError : Permission denied by system');
  });

  it('distingue un refus de Jarvis, un micro absent, un micro disparu et un délai dépassé', () => {
    expect(describeCaptureFailure(domError('NotAllowedError', 'Permission denied'), 'getUserMedia').title).toBe(
      'Accès au micro refusé',
    );
    expect(describeCaptureFailure(domError('NotFoundError', 'Requested device not found'), 'getUserMedia').title).toMatch(
      /Aucune entrée/,
    );
    expect(describeCaptureFailure(domError('OverconstrainedError'), 'getUserMedia').title).toMatch(/n’existe plus/);
    expect(describeCaptureFailure(domError(CAPTURE_TIMEOUT_ERROR, 'getUserMedia > 10 s'), 'getUserMedia').title).toMatch(
      /ne répond pas/,
    );
    expect(describeCaptureFailure(domError(CAPTURE_NO_AUDIO_ERROR), 'first-frame', 'Mix').title).toMatch(
      /n’envoie aucun son/,
    );
  });

  it('une erreur sans nom ni message reste explicite', () => {
    const failure = describeCaptureFailure(new Error(''), 'getUserMedia');
    expect(captureFailureText(failure)).toMatch(/^Le micro ne s’ouvre pas \(Error\)\./);
    expect(describeCaptureFailure('boom', 'audio-graph').name).toBe('Error');
  });
});

describe('contraintes getUserMedia', () => {
  it('coupe annulation d’écho, réduction de bruit et contrôle de gain', () => {
    expect(captureConstraints('')).toEqual({
      echoCancellation: false,
      noiseSuppression: false,
      autoGainControl: false,
      channelCount: { ideal: 1 },
    });
  });

  it('ouvre le défaut Windows sans deviceId, un choix explicite en exact', () => {
    expect(captureConstraints('default').deviceId).toBeUndefined();
    expect(captureConstraints('chat').deviceId).toEqual({ exact: 'chat' });
  });
});

describe('entrée à ouvrir', () => {
  it('ouvre le choix enregistré présent, mixage compris', () => {
    expect(resolveCaptureTarget(GOXLR, 'mix')).toEqual({ deviceId: 'mix', fallback: false });
    expect(resolveCaptureTarget(GOXLR, 'chat')).toEqual({ deviceId: 'chat', fallback: false });
  });

  it('prend le défaut Windows sans choix, et sur un identifiant périmé', () => {
    expect(resolveCaptureTarget(GOXLR, '')).toEqual({ deviceId: '', fallback: false });
    expect(resolveCaptureTarget(GOXLR, 'default')).toEqual({ deviceId: '', fallback: false });
    expect(resolveCaptureTarget(GOXLR, 'id-de-la-0.4.13')).toEqual({ deviceId: '', fallback: true });
  });

  it('tente l’identifiant enregistré quand la liste est illisible', () => {
    expect(resolveCaptureTarget([{ deviceId: '', label: '' }], 'chat')).toEqual({
      deviceId: 'chat',
      fallback: false,
    });
  });

  it('ne se replie sur le défaut que pour un périphérique introuvable', () => {
    expect(shouldFallbackToDefault('OverconstrainedError', 'chat')).toBe(true);
    expect(shouldFallbackToDefault('NotFoundError', 'chat')).toBe(true);
    expect(shouldFallbackToDefault('NotAllowedError', 'chat')).toBe(false);
    expect(shouldFallbackToDefault('NotReadableError', 'chat')).toBe(false);
    expect(shouldFallbackToDefault('NotFoundError', '')).toBe(false);
  });
});

describe('changement de périphériques', () => {
  const base = { inputs: GOXLR, preferredId: '', openedId: 'default', usingFallback: false };

  it('réessaie tout de suite après un échec ou une perte', () => {
    expect(actionOnDeviceChange({ ...base, phase: 'error' })).toBe('retry');
    expect(actionOnDeviceChange({ ...base, phase: 'recovering' })).toBe('retry');
    expect(actionOnDeviceChange({ ...base, phase: 'off' })).toBe('none');
  });

  it('rouvre si le périphérique ouvert a disparu', () => {
    expect(
      actionOnDeviceChange({ ...base, phase: 'open', openedId: 'usb', inputs: GOXLR }),
    ).toBe('reopen');
    expect(actionOnDeviceChange({ ...base, phase: 'open' })).toBe('none');
  });

  it('suit un nouveau périphérique par défaut de Windows', () => {
    const inputs = [
      { deviceId: 'default', label: 'Default - Chat Mic (TC-HELICON GoXLR Mini)' },
      { deviceId: 'mix', label: 'Broadcast Stream Mix (TC-HELICON GoXLR Mini)' },
      { deviceId: 'chat', label: 'Chat Mic (TC-HELICON GoXLR Mini)' },
    ];
    expect(
      actionOnDeviceChange({
        phase: 'open',
        inputs,
        preferredId: '',
        openedId: 'default',
        openedLabel: 'Default - Broadcast Stream Mix (TC-HELICON GoXLR Mini)',
        usingFallback: false,
      }),
    ).toBe('reopen');
    expect(
      actionOnDeviceChange({
        phase: 'open',
        inputs,
        preferredId: '',
        openedId: 'default',
        openedLabel: 'Chat Mic (TC-HELICON GoXLR Mini)',
        usingFallback: false,
      }),
    ).toBe('none');
  });

  it('revient au micro choisi quand il réapparaît', () => {
    expect(
      actionOnDeviceChange({
        phase: 'open',
        inputs: GOXLR,
        preferredId: 'chat',
        openedId: 'default',
        usingFallback: true,
      }),
    ).toBe('return-to-preferred');
  });
});

describe('journal', () => {
  it('ne recopie pas les identifiants de périphérique en clair', () => {
    expect(redactDeviceId('3b1aebd34d8f0c2e9a')).toBe('3b1aeb…');
    expect(redactDeviceId('')).toBe('défaut Windows');
    expect(redactDeviceId('default')).toBe('default');
  });

  it('écrit chaque étape et sa durée', () => {
    expect(
      formatCaptureTimings({
        permission: 'granted',
        permissionMs: 2.4,
        enumerateMs: 11,
        inputCount: 3,
        getUserMediaMs: 180,
        graphMs: 20,
        firstFrameMs: 420,
        firstWakeScoreMs: 1900,
      }),
    ).toBe(
      'autorisation granted (2 ms) · liste 11 ms (3 entrées) · getUserMedia 180 ms · Web Audio 20 ms · 1re trame 420 ms · 1er score réveil 1900 ms',
    );
  });

  it('affiche une ouverture rapide en millisecondes', () => {
    expect(formatSeconds(36.4)).toBe('36 ms');
    expect(formatSeconds(1234)).toBe('1,2 s');
  });

  it('espace les reprises automatiques', () => {
    expect(recoveryDelayMs(0)).toBe(300);
    expect(recoveryDelayMs(3)).toBe(5_000);
    expect(recoveryDelayMs(99)).toBe(10_000);
  });
});
