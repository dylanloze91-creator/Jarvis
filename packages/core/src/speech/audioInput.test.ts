import { describe, expect, it } from 'vitest';
import { chooseMicrophone, isLoopbackOrMixInput, microphoneOptionLabel } from './audioInput.js';

const GOXLR = [
  { deviceId: 'mix', label: 'Broadcast Stream Mix (TC-HELICON GoXLR Mini)' },
  { deviceId: 'chat', label: 'Chat Mic (TC-HELICON GoXLR Mini)' },
  { deviceId: 'usb', label: 'Microphone (USB Audio Device)' },
];

describe('classification mixage / loopback', () => {
  it('reconnaît les mixages cités, pas un vrai micro', () => {
    expect(isLoopbackOrMixInput('Broadcast Stream Mix (TC-HELICON GoXLR Mini)')).toBe(true);
    expect(isLoopbackOrMixInput('Stereo Mix (Realtek High Definition Audio)')).toBe(true);
    expect(isLoopbackOrMixInput('What U Hear (Creative)')).toBe(true);
    expect(isLoopbackOrMixInput('Wave Out')).toBe(true);
    expect(isLoopbackOrMixInput('Mixage stéréo')).toBe(true);
    expect(isLoopbackOrMixInput('Mixage stereo (Realtek)')).toBe(true);
    expect(isLoopbackOrMixInput('Chat Mic (TC-HELICON GoXLR Mini)')).toBe(false);
    expect(isLoopbackOrMixInput('Microphone (Realtek)')).toBe(false);
    expect(isLoopbackOrMixInput('')).toBe(false);
  });

  it('ignore le mixage et retient le micro déjà choisi', () => {
    expect(chooseMicrophone(GOXLR, '').deviceId).toBe('chat');
    expect(chooseMicrophone(GOXLR, 'mix')).toEqual({
      deviceId: 'chat',
      label: 'Chat Mic (TC-HELICON GoXLR Mini)',
      loopback: false,
    });
    expect(chooseMicrophone(GOXLR, 'usb')).toEqual({
      deviceId: 'usb',
      label: 'Microphone (USB Audio Device)',
      loopback: false,
    });
  });

  it('signale le mixage quand c’est la seule entrée', () => {
    expect(chooseMicrophone([{ deviceId: 'mix', label: 'Stereo Mix' }], 'mix')).toEqual({
      deviceId: 'mix',
      label: 'Stereo Mix',
      loopback: true,
    });
    expect(microphoneOptionLabel('Stereo Mix', true)).toBe('Stereo Mix — mixage, pas un micro');
  });
});
