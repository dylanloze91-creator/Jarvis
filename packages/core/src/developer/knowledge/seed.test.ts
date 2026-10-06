import { describe, expect, it } from 'vitest';
import { DEVELOPER_MANUAL_SEED, DEVELOPER_MANUAL_SEED_VERSION } from './seed.js';

describe('DEVELOPER_MANUAL_SEED', () => {
  it('contient les cinq pages concrètes et la page méthode', () => {
    expect(Object.keys(DEVELOPER_MANUAL_SEED).sort()).toEqual(
      [
        'debugging.md',
        'game-canvas.md',
        'jarvis-conventions.md',
        'methode-travail.md',
        'typescript-strict.md',
        'vitest-tests.md',
      ].sort(),
    );
    expect(DEVELOPER_MANUAL_SEED_VERSION).toBeGreaterThanOrEqual(2);
  });

  it('résume la méthode sans dupliquer les pièges des autres pages', () => {
    const page = DEVELOPER_MANUAL_SEED['methode-travail.md'];
    expect(page).toMatch(/Comprendre avant de coder/);
    expect(page).toMatch(/plus simple, fiable et testable/);
    expect(page).not.toMatch(/TS2588/);
  });
});
