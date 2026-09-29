import { describe, expect, it } from 'vitest';
import { classifyUpdateError } from './errorClassifier.js';

describe('classifyUpdateError', () => {
  it('reconnaît une erreur réseau par son code Node', () => {
    const error = Object.assign(new Error('request failed'), { code: 'ENOTFOUND' });
    expect(classifyUpdateError(error).kind).toBe('network');
  });

  it('reconnaît une connexion refusée comme une erreur réseau', () => {
    const error = Object.assign(new Error('connect ECONNREFUSED 127.0.0.1:443'), {
      code: 'ECONNREFUSED',
    });
    expect(classifyUpdateError(error).kind).toBe('network');
  });

  it('reconnaît un échec fetch du runtime comme une erreur réseau', () => {
    expect(classifyUpdateError(new TypeError('Failed to fetch')).kind).toBe('network');
  });

  it("reconnaît l'absence de publication GitHub via son code electron-updater", () => {
    const error = Object.assign(new Error('No published versions on GitHub'), {
      code: 'ERR_UPDATER_NO_PUBLISHED_VERSIONS',
    });
    expect(classifyUpdateError(error).kind).toBe('not-found');
  });

  it('reconnaît une réponse HTTP 404 comme une publication introuvable', () => {
    const error = Object.assign(new Error('404 Not Found'), { statusCode: 404 });
    expect(classifyUpdateError(error).kind).toBe('not-found');
  });

  it('reconnaît une empreinte incorrecte comme un téléchargement corrompu', () => {
    const error = Object.assign(new Error('sha512 checksum mismatch, expected aaa, got bbb'), {
      code: 'ERR_CHECKSUM_MISMATCH',
    });
    expect(classifyUpdateError(error).kind).toBe('corrupted');
  });

  it('retombe sur "unknown" pour une erreur non reconnue, sans jamais lever', () => {
    const result = classifyUpdateError(new Error('quelque chose de complètement imprévu'));
    expect(result.kind).toBe('unknown');
    expect(result.message.length).toBeGreaterThan(0);
  });

  it('ne lève jamais, même pour une valeur qui n’est pas une erreur', () => {
    expect(() => classifyUpdateError('juste une chaîne')).not.toThrow();
    expect(() => classifyUpdateError(null)).not.toThrow();
    expect(() => classifyUpdateError(undefined)).not.toThrow();
    expect(classifyUpdateError(null).kind).toBe('unknown');
  });

  it('conserve le détail technique brut pour les journaux, sans le mélanger au message affiché', () => {
    const error = Object.assign(new Error('connect ETIMEDOUT'), { code: 'ETIMEDOUT' });
    const result = classifyUpdateError(error);
    expect(result.raw).toContain('ETIMEDOUT');
    expect(result.message).not.toContain('ETIMEDOUT');
  });
});
