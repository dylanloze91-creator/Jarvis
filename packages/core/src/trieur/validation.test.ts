import { describe, expect, it } from 'vitest';
import {
  examTeamCounts,
  parseValidationLine,
  splitValidationLines,
  validationRecord,
  validationSplitTarget,
  VALIDATION_FILE,
} from './validation.js';
import type { ExamLine } from './extract.js';

describe('validation trieur (valide.jsonl)', () => {
  it('parse une ligne conforme', () => {
    const raw = {
      phrase: '  Lance Spotify  ',
      context: 'Demande : Lance Spotify\nÉquipe :',
      equipe: 'musique',
      equipeProposee: 'musique',
      chemin: 'express',
      statut: 'confirme',
      date: '2026-11-04T12:00:00.000Z',
    };
    const line = parseValidationLine(raw);
    expect(line?.phrase).toBe('  Lance Spotify  ');
    expect(line?.equipe).toBe('musique');
  });

  it('refuse une équipe inconnue', () => {
    expect(
      parseValidationLine({
        phrase: 'x',
        context: 'c',
        equipe: 'nope',
        equipeProposee: 'pc',
        chemin: 'cerveau',
        statut: 'confirme',
        date: '2026-11-04T12:00:00.000Z',
      }),
    ).toBeNull();
  });

  it('nomme le fichier attendu', () => {
    expect(VALIDATION_FILE).toBe('valide.jsonl');
  });

  it('envoie les corrections à l’examen tant qu’une équipe a moins de 20 phrases', () => {
    const line = validationRecord({
      phrase: 'Ouvre le bloc-notes',
      context: 'Demande : Ouvre le bloc-notes\nÉquipe :',
      proposedTeam: 'web',
      chosenTeam: 'pc',
      path: 'cerveau',
    });
    expect(line.statut).toBe('corrige');
    const counts = { pc: 5 };
    expect(validationSplitTarget(line, counts)).toBe('exam');
    counts.pc = 20;
    const again = validationSplitTarget(line, counts);
    expect(again === 'exam' || again === 'train').toBe(true);
  });

  it('découpe de façon déterministe entre examen et entraînement', () => {
    const manual: ExamLine[] = [];
    const lines = Array.from({ length: 40 }, (_, index) =>
      validationRecord({
        phrase: `Phrase ${index}`,
        context: `Demande : Phrase ${index}\nÉquipe :`,
        proposedTeam: 'conversation',
        chosenTeam: 'conversation',
        path: 'cerveau',
      }),
    );
    const first = splitValidationLines(lines, manual);
    const second = splitValidationLines(lines, manual);
    expect(first).toEqual(second);
    expect(first.exam.length + first.trainLines.length).toBe(40);
  });

  it('compte les équipes de l’examen manuel', () => {
    const counts = examTeamCounts([
      { phrase: 'a', context: 'c', team: 'pc' },
      { phrase: 'b', context: 'c', team: 'pc' },
      { phrase: 'c', context: 'c', team: 'conversation' },
    ]);
    expect(counts).toEqual({ pc: 2, conversation: 1 });
  });
});
