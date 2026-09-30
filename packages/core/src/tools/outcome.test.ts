import { describe, expect, it } from 'vitest';
import { classifyThrownError, presentUserContent, toolFailure, toolSuccess } from './outcome.js';

describe('classifyThrownError', () => {
  it('traduit ECONNRESET en phrase française, sans le code', () => {
    const error = Object.assign(new Error('connect ECONNRESET 1.2.3.4'), { code: 'ECONNRESET' });
    const classified = classifyThrownError(error);
    expect(classified.outcome).toBe('recoverable');
    expect(classified.userMessage).toBe('La connexion a été interrompue. Je peux réessayer.');
    expect(classified.userMessage).not.toMatch(/ECONNRESET/);
    expect(classified.technicalDetail).toContain('ECONNRESET');
  });

  it('distingue timeout, annulation et dépendance manquante', () => {
    expect(classifyThrownError(new DOMException('Timeout', 'TimeoutError')).outcome).toBe('timeout');
    expect(classifyThrownError(new DOMException('Aborted', 'AbortError')).outcome).toBe('cancelled');
    expect(classifyThrownError(new Error('Cannot find module nomic-embed-text')).outcome).toBe(
      'missing_dependency',
    );
  });

  it('garde une phrase déjà française', () => {
    const classified = classifyThrownError(new Error('disque injoignable'));
    expect(classified.outcome).toBe('definitive');
    expect(classified.userMessage).toBe('disque injoignable');
  });

  it('retire un secret du détail technique', () => {
    const classified = classifyThrownError(new Error('échec Bearer BQC-spotify-token-secret-value'));
    expect(classified.technicalDetail).not.toContain('BQC-spotify-token-secret-value');
    expect(classified.technicalDetail).toContain('[REDACTED]');
  });
});

describe('présentations', () => {
  it('succès et échec restent compatibles avec ok', () => {
    expect(toolSuccess('fait').ok).toBe(true);
    expect(toolFailure('timeout', 'trop long', 'ETIMEDOUT').ok).toBe(false);
  });

  it("ne renvoie pas un code brut à l'utilisateur", () => {
    const content = presentUserContent({
      ok: false,
      content: 'Recherche impossible : connect ECONNRESET',
    });
    expect(content).not.toMatch(/ECONNRESET/);
    expect(content).toMatch(/interrompue/);
  });
});
