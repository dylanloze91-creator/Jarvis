import { describe, expect, it } from 'vitest';
import { checkExamName, listExamFiles, trieurFileNames } from './files.js';

describe('fichiers du trieur', () => {
  it('sans nom : les fichiers habituels', () => {
    const files = trieurFileNames('C:\\data\\trieur');
    expect(files.exam).toBe('C:/data/trieur/examen.jsonl');
    expect(files.toSort).toBe('C:/data/trieur/a-trier.jsonl');
    expect(files.sortProgress).toBe('C:/data/trieur/tri-progress.json');
  });

  it('un examen à part prend un suffixe, le cahier reste commun', () => {
    const files = trieurFileNames('C:\\data\\trieur\\', 'jarvis');
    expect(files.exam).toBe('C:/data/trieur/examen-jarvis.jsonl');
    expect(files.toSort).toBe('C:/data/trieur/a-trier-jarvis.jsonl');
    expect(files.sortProgress).toBe('C:/data/trieur/tri-progress-jarvis.json');
    expect(files.training).toBe('C:/data/trieur/entrainement.jsonl');
    expect(files.validated).toBe('C:/data/trieur/valide.jsonl');
    expect(files.prepDir).toBe('C:/data/trieur/preparation');
  });

  it('refuse un nom qui sortirait du dossier ou du format', () => {
    expect(checkExamName('jarvis-2')).toBeNull();
    expect(checkExamName('../x')).not.toBeNull();
    expect(checkExamName('Jarvis')).not.toBeNull();
    expect(checkExamName('')).not.toBeNull();
    expect(() => trieurFileNames('C:\\data', 'a b')).toThrow(/invalide/);
  });

  it('liste tous les examens du dossier, le principal en tête, rien d’autre', () => {
    const files = listExamFiles('C:\\data\\trieur', [
      'examen-jarvis.jsonl',
      'a-trier.jsonl',
      'examen.jsonl',
      'entrainement.jsonl',
      'examen-valide.jsonl.bak',
      'examen-Claude.jsonl',
      'examen-2026-11.jsonl',
    ]);
    expect(files).toEqual([
      'C:/data/trieur/examen.jsonl',
      'C:/data/trieur/examen-2026-11.jsonl',
      'C:/data/trieur/examen-jarvis.jsonl',
    ]);
    expect(listExamFiles('C:/x', ['a-trier.jsonl'])).toEqual([]);
  });
});
