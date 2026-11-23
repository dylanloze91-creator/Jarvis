import { describe, expect, it } from 'vitest';
import { imageStatusReply, isImageStatusQuestion } from './jobStatus.js';

// Phrases écrites pour l'essai (24 novembre 2026), jamais celles de l'utilisateur.
describe('« où en est l’image ? » lu par règles', () => {
  it('reconnaît les questions d’état', () => {
    for (const text of [
      'Elle en est où, l’image ?',
      'Où en est l’image ?',
      'Jarvis, l’image est prête ?',
      'C’est bientôt fini, l’image ?',
      'Ça avance, mon image ?',
      'Elle est finie, la photo ?',
      'Où en est la génération de l’image ?',
      'Il reste combien de temps pour l’image ?',
    ]) {
      expect(isImageStatusQuestion(text), text).toBe(true);
    }
  });

  it('laisse passer les demandes et le reste', () => {
    for (const text of [
      'Génère une image d’un renard',
      'Dessine-moi une image de chat, et dis-moi quand elle est finie',
      'Où en est la météo ?',
      'Ouvre l’image que tu as finie',
      'Elle en est où, la lessive ?',
      'Montre-moi la dernière image',
    ]) {
      expect(isImageStatusQuestion(text), text).toBe(false);
    }
  });
});

describe('réponse tirée de l’état réel', () => {
  const now = 1_800_000_000_000;

  it('en cours, avec l’étape et l’avancement de Forge', () => {
    const reply = imageStatusReply(
      { state: 'running', startedAt: now - 80_000, stage: 'Forge génère l’image…', progress: 0.45, etaSeconds: 30 },
      now,
    );
    expect(reply).toBe('L’image est en cours depuis 1 min 20 s. Dernière étape : Forge génère l’image. Forge en est à 45 % (Forge estime encore 30 s).');
  });

  it('au tout début, l’estimation de Forge n’est pas dite', () => {
    expect(imageStatusReply({ state: 'running', startedAt: now - 400_000, progress: 0.01, etaSeconds: 9_720 }, now)).toBe(
      'L’image est en cours depuis 6 min 40 s. Forge en est à 1 %.',
    );
  });

  it('en cours sans avancement : rien d’inventé', () => {
    expect(imageStatusReply({ state: 'running', startedAt: now - 5_000 }, now)).toBe('L’image est en cours depuis 5 s.');
  });

  it('finie, ratée, aucune, inconnue', () => {
    expect(imageStatusReply({ state: 'done', finishedAt: now - 120_000, files: ['renard-001.png'] }, now)).toBe(
      'Aucune image en cours. La dernière est finie il y a 2 min : renard-001.png.',
    );
    expect(imageStatusReply({ state: 'failed', finishedAt: now - 3_000, error: 'Forge ne répond pas.' }, now)).toBe(
      'Aucune image en cours. La dernière a échoué il y a 3 s : Forge ne répond pas.',
    );
    expect(imageStatusReply({ state: 'none' }, now)).toMatch(/Aucune image n’est en cours/);
    expect(imageStatusReply(null, now)).toMatch(/Je ne sais pas/);
    expect(imageStatusReply(null, now, false)).toMatch(/module images est coupé/);
  });
});
