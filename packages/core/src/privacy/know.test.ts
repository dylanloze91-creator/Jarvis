import { describe, expect, it } from 'vitest';
import { countKnowledge, countPersonalization, eraseKnowledge, eraseTouchesSettingsOrProjects, sorterPhraseCount } from './know.js';

describe('ce que Jarvis sait de moi', () => {
  it('compte les catégories et n’efface ni les réglages ni les projets', () => {
    expect(countPersonalization({ user: { prenom: 'Camarade' }, rules: ['une règle'] })).toBe(2);
    const chunks = [
      { id: '1', kind: 'memory', text: 'un souvenir' },
      { id: '2', kind: 'file', title: 'note.txt' },
      { id: '3', kind: 'memory', learning: { type: 'preference', content: 'tutoiement' } },
      { id: '4', kind: 'conversation', text: 'bonjour' },
    ];
    expect(countKnowledge(chunks)).toEqual({ memories: 1, documents: 1, learning: 1 });
    expect(eraseKnowledge(chunks, 'memories').map((chunk) => chunk.id)).toEqual(['2', '3', '4']);
    expect(eraseKnowledge(chunks, 'learning').map((chunk) => chunk.id)).toEqual(['1', '2', '4']);
    expect(eraseKnowledge(chunks, 'documents').some((chunk) => chunk.kind === 'file')).toBe(false);
    expect(eraseTouchesSettingsOrProjects('settings.json')).toBe(true);
    expect(eraseTouchesSettingsOrProjects('developer/projects/atelier/memory.json')).toBe(true);
    expect(eraseTouchesSettingsOrProjects('conversations/une.json')).toBe(false);
    expect(eraseTouchesSettingsOrProjects('developer/code-model.json')).toBe(false);
    expect(sorterPhraseCount({ 'a-trier.jsonl': 2, 'examen.jsonl': 1, 'valide.jsonl': 0 })).toBe(3);
  });
});
