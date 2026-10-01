import { describe, expect, it, vi } from 'vitest';

vi.mock('electron', () => ({ BrowserWindow: class {}, screen: {} }));

const { INDICATOR_WIDTH, indicatorPosition, shouldShowIndicator } = await import('./listeningIndicator.js');

describe('indicateur d’écoute hors fenêtre', () => {
  it('se place en haut à droite de la zone de travail', () => {
    expect(indicatorPosition({ x: 0, y: 0, width: 1920, height: 1040 })).toEqual({
      x: 1920 - INDICATOR_WIDTH - 16,
      y: 16,
    });
  });

  it('suit l’écran secondaire et sa barre des tâches (zone de travail décalée)', () => {
    expect(indicatorPosition({ x: -2560, y: 40, width: 2560, height: 1400 })).toEqual({
      x: -INDICATOR_WIDTH - 16,
      y: 56,
    });
  });

  it('ne s’affiche que si la fenêtre principale n’est pas sous les yeux', () => {
    expect(shouldShowIndicator({ visible: true, minimized: false, focused: true })).toBe(false);
    expect(shouldShowIndicator({ visible: false, minimized: false, focused: false })).toBe(true);
    expect(shouldShowIndicator({ visible: true, minimized: true, focused: false })).toBe(true);
    expect(shouldShowIndicator({ visible: true, minimized: false, focused: false })).toBe(true);
    expect(shouldShowIndicator(null)).toBe(true);
  });
});
