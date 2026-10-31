import { describe, expect, it } from 'vitest';
import { createMessage } from '../types.js';
import {
  checkRoverBaseUrl,
  describeRoverMovement,
  formatRoverMove,
  formatRoverTurn,
  isRoverToolName,
  looksLikeRoverIntent,
  recentlyUsedRoverTools,
  roverTurnPrompt,
} from './index.js';

describe('checkRoverBaseUrl', () => {
  it('accepte le réseau local', () => {
    for (const url of [
      'http://jarvis-rover.local:8765',
      'http://192.168.1.42:8765',
      'http://10.0.0.5:8765',
      'http://127.0.0.1:8765',
      'http://localhost:8765',
      'http://jarvis-rover:8765',
    ]) {
      expect(checkRoverBaseUrl(url).ok, url).toBe(true);
    }
  });

  it('refuse Internet, les identifiants et les autres protocoles', () => {
    for (const url of [
      'https://example.com',
      'http://8.8.8.8:8765',
      'http://user:pass@192.168.1.42:8765',
      'file:///etc/hosts',
      '',
      'pas une url',
    ]) {
      expect(checkRoverBaseUrl(url).ok, url).toBe(false);
    }
  });

  it('renvoie l’origine sans chemin', () => {
    expect(checkRoverBaseUrl(' http://192.168.1.42:8765/api/ ')).toEqual({ ok: true, origin: 'http://192.168.1.42:8765' });
  });
});

describe('looksLikeRoverIntent', () => {
  it('reconnaît les ordres de conduite', () => {
    for (const prompt of [
      'Fais avancer le robot de 50 cm',
      'avance de 50 cm',
      'recule de 1 mètre',
      'tourne à gauche de 90°',
      'tourne de 45 degrés à droite',
      'arrête le robot',
      'où en est le rover ?',
      'Arrêt d’urgence !',
      'fais un demi-tour',
    ]) {
      expect(looksLikeRoverIntent(prompt), prompt).toBe(true);
    }
  });

  it('laisse le reste tranquille', () => {
    for (const prompt of [
      'mets de la musique',
      'pause',
      'quel temps fait-il à Paris ?',
      'ouvre Chrome',
      'tourne la page',
      'avance la réunion à 14h',
      'arrête la musique',
    ]) {
      expect(looksLikeRoverIntent(prompt), prompt).toBe(false);
    }
  });
});

describe('recentlyUsedRoverTools', () => {
  it('garde les outils pour un suivi', () => {
    const conversation = [
      createMessage('user', 'avance le robot de 50 cm'),
      createMessage('assistant', '', { toolCalls: [{ id: '1', name: 'rover_move', arguments: { distanceM: 0.5 } }] }),
      createMessage('tool', 'ok', { toolCallId: '1', toolName: 'rover_move' }),
      createMessage('assistant', 'Fait.'),
      createMessage('user', 'encore 20'),
    ];
    expect(recentlyUsedRoverTools(conversation)).toBe(true);
    expect(isRoverToolName('rover_stop')).toBe(true);
    expect(isRoverToolName('google_gmail_send')).toBe(false);
  });

  it('oublie après deux échanges', () => {
    const conversation = [
      createMessage('assistant', '', { toolCalls: [{ id: '1', name: 'rover_move', arguments: {} }] }),
      createMessage('user', 'a'),
      createMessage('user', 'b'),
      createMessage('user', 'c'),
    ];
    expect(recentlyUsedRoverTools(conversation)).toBe(false);
  });
});

describe('textes', () => {
  it('résume les ordres pour la confirmation', () => {
    expect(formatRoverMove(0.5)).toBe('Avancer de 50 cm');
    expect(formatRoverMove(-1.2, 0.2)).toBe('Reculer de 1,2 m à 0,2 m/s');
    expect(formatRoverTurn(90)).toBe('Tourner à gauche de 90°');
    expect(formatRoverTurn(-45, true)).toBe('Tourner à droite de 45° en marche arrière');
  });

  it('décrit un mouvement mesuré', () => {
    const text = describeRoverMovement({
      id: 1,
      type: 'avancer',
      parametres: {},
      statut: 'termine',
      message: 'Distance atteinte.',
      mesure: { distance_m: 0.497, ecart_m: 0.003 },
      duree_s: 2.4,
    });
    expect(text).toBe('Mouvement terminé (distance mesurée 49,7 cm). Distance atteinte.');
  });

  it('le prompt du tour demande l’arrêt immédiat', () => {
    expect(roverTurnPrompt()).toContain('rover_stop');
  });
});
