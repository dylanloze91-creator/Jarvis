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

  it('garde le mixage par défaut et un choix explicite du mixage', () => {
    expect(chooseMicrophone(GOXLR, '')).toEqual({
      deviceId: 'mix',
      label: 'Broadcast Stream Mix (TC-HELICON GoXLR Mini)',
      loopback: true,
    });
    expect(chooseMicrophone(GOXLR, 'mix')).toEqual({
      deviceId: 'mix',
      label: 'Broadcast Stream Mix (TC-HELICON GoXLR Mini)',
      loopback: true,
    });
    expect(chooseMicrophone(GOXLR, 'usb')).toEqual({
      deviceId: 'usb',
      label: 'Microphone (USB Audio Device)',
      loopback: false,
    });
  });

  it('garde Stereo Mix quand c’est l’entrée par défaut, même si un micro existe', () => {
    const inputs = [
      { deviceId: 'default', label: 'Default - Stereo Mix (Realtek High Definition Audio)' },
      { deviceId: 'mic', label: 'Microphone (Realtek)' },
      { deviceId: 'stereo', label: 'Stereo Mix (Realtek High Definition Audio)' },
    ];
    expect(chooseMicrophone(inputs, '').deviceId).toBe('default');
    expect(chooseMicrophone(inputs, 'stereo')).toEqual({
      deviceId: 'stereo',
      label: 'Stereo Mix (Realtek High Definition Audio)',
      loopback: true,
    });
  });

  it('retombe sur le défaut Windows si l’identifiant enregistré a disparu', () => {
    expect(chooseMicrophone(GOXLR, 'parti').deviceId).toBe('mix');
    expect(microphoneOptionLabel('Broadcast Stream Mix (TC-HELICON GoXLR Mini)', true)).toBe(
      'Broadcast Stream Mix (TC-HELICON GoXLR Mini)',
    );
  });
});
