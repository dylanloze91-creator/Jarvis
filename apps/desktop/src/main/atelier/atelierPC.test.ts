import { describe, expect, it } from 'vitest';
import { ADRESSE_IMPRIMANTE_PAR_DEFAUT, adresseImprimante } from './atelierPC.js';

/**
 * L'adresse de l'imprimante de l'atelier. Jarvis Test : seulement si elle est réglée et activée.
 * Jarvis Live (5.0.81) : sans réglage, l'adresse par défaut ; décochée, rien n'est envoyé.
 */
describe('adresse de l’imprimante de l’atelier', () => {
  it('Jarvis Test : rien sans réglage, rien si elle est coupée', () => {
    expect(adresseImprimante(undefined, false)).toBeNull();
    expect(adresseImprimante({ enabled: false, baseUrl: 'http://mainsailos.local' }, false)).toBeNull();
    expect(adresseImprimante({ enabled: true }, false)).toBeNull();
    expect(adresseImprimante({ enabled: true, baseUrl: 'http://mainsailos.local' }, false)).toBe('http://mainsailos.local');
  });

  it('Jarvis Live : l’adresse par défaut sans réglage', () => {
    expect(ADRESSE_IMPRIMANTE_PAR_DEFAUT).toBe('http://mainsailos.local');
    expect(adresseImprimante(undefined, true)).toBe(ADRESSE_IMPRIMANTE_PAR_DEFAUT);
    expect(adresseImprimante({}, true)).toBe(ADRESSE_IMPRIMANTE_PAR_DEFAUT);
    expect(adresseImprimante({ enabled: true, baseUrl: '  ' }, true)).toBe(ADRESSE_IMPRIMANTE_PAR_DEFAUT);
  });

  it('Jarvis Live : l’adresse réglée, ou rien si l’envoi est décoché', () => {
    expect(adresseImprimante({ baseUrl: 'http://192.168.1.50:7125' }, true)).toBe('http://192.168.1.50:7125');
    expect(adresseImprimante({ enabled: false }, true)).toBeNull();
    expect(adresseImprimante({ enabled: false, baseUrl: 'http://192.168.1.50' }, true)).toBeNull();
  });

  it('jamais une adresse hors du réseau local', () => {
    expect(adresseImprimante({ baseUrl: 'https://exemple.com' }, true)).toBeNull();
    expect(adresseImprimante({ enabled: true, baseUrl: 'https://exemple.com' }, false)).toBeNull();
  });
});
