import { describe, expect, it } from 'vitest';
import {
  defaultWakeWordVariants,
  levenshteinDistance,
  matchesWakeWord,
  normalizeForWakeWordMatch,
} from './wakeWordTextMatch.js';

describe('normalizeForWakeWordMatch', () => {
  it('met en minuscules', () => {
    expect(normalizeForWakeWordMatch('JARVIS')).toBe('jarvis');
  });

  it('retire les accents', () => {
    expect(normalizeForWakeWordMatch('éàçÉÀ')).toBe('eacea');
  });

  it('retire la ponctuation et normalise les espaces', () => {
    expect(normalizeForWakeWordMatch('Salut,   Jarvis !!')).toBe('salut jarvis');
  });

  it("renvoie une chaîne vide pour une entrée vide ou qu'espaces", () => {
    expect(normalizeForWakeWordMatch('')).toBe('');
    expect(normalizeForWakeWordMatch('   ')).toBe('');
  });
});

describe('levenshteinDistance', () => {
  it('vaut 0 pour deux chaînes identiques', () => {
    expect(levenshteinDistance('jarvis', 'jarvis')).toBe(0);
  });

  it('compte une insertion', () => {
    expect(levenshteinDistance('jarvis', 'jarviss')).toBe(1);
  });

  it('compte une substitution', () => {
    expect(levenshteinDistance('jarvis', 'jarvus')).toBe(1);
  });

  it('gère les chaînes vides', () => {
    expect(levenshteinDistance('', 'abc')).toBe(3);
    expect(levenshteinDistance('abc', '')).toBe(3);
    expect(levenshteinDistance('', '')).toBe(0);
  });
});

describe('defaultWakeWordVariants', () => {
  it('inclut toujours le mot lui-même, normalisé', () => {
    expect(defaultWakeWordVariants('Jarvis')).toContain('jarvis');
  });

  it('inclut les variantes intégrées connues pour "jarvis"', () => {
    const variants = defaultWakeWordVariants('jarvis');
    expect(variants).toContain('jarviss');
    expect(variants).toContain('djarvis');
  });

  it('se limite au mot lui-même pour un mot de réveil sans variantes intégrées', () => {
    expect(defaultWakeWordVariants('athena')).toEqual(['athena']);
  });
});

describe('matchesWakeWord', () => {
  it('détecte le mot de réveil au milieu d’une phrase', () => {
    expect(matchesWakeWord('Bonjour Jarvis, quelle heure est-il ?', { word: 'jarvis' })).toBe(true);
  });

  it('tolère les variantes orthographiques fréquentes de Whisper', () => {
    expect(matchesWakeWord('jarviss allume la lumière', { word: 'jarvis' })).toBe(true);
    expect(matchesWakeWord('djarvis tu es là', { word: 'jarvis' })).toBe(true);
    expect(matchesWakeWord('jarvice', { word: 'jarvis' })).toBe(true);
  });

  it('détecte un mot de réveil collé à un autre mot', () => {
    expect(matchesWakeWord('salutjarvis', { word: 'jarvis' })).toBe(true);
  });

  it('ignore les accents et la casse', () => {
    expect(matchesWakeWord('JARVIS, éteins tout', { word: 'jarvis' })).toBe(true);
  });

  it('ne détecte rien dans une phrase sans rapport', () => {
    expect(matchesWakeWord('Il fait beau aujourd’hui à Paris', { word: 'jarvis' })).toBe(false);
  });

  it('renvoie faux pour un transcript vide', () => {
    expect(matchesWakeWord('', { word: 'jarvis' })).toBe(false);
  });

  it("n'applique jamais le flou à la liste intégrée : « paris » reste distinct de « jarvis »", () => {
    // Vérifié empiriquement contre le dictionnaire hunspell-fr : appliquer le
    // flou à toute la liste intégrée créait 144 collisions de ce type.
    expect(matchesWakeWord('paris', { word: 'jarvis' })).toBe(false);
  });

  it('accepte des variantes supplémentaires fournies par l’appelant, en flou comme en exact', () => {
    expect(
      matchesWakeWord('artemis, ouvre la porte', { word: 'athena', variants: ['artemis'] }),
    ).toBe(true);
    expect(matchesWakeWord('artemis, ouvre la porte', { word: 'athena' })).toBe(false);
  });

  it('tolère par défaut une faute non répertoriée, à faible distance', () => {
    expect(matchesWakeWord('jarvus, allume la lumière', { word: 'jarvis' })).toBe(true);
  });

  it('respecte une distance maximale personnalisée, plus stricte que le défaut', () => {
    expect(matchesWakeWord('jarvus', { word: 'jarvis', maxDistance: () => 0 })).toBe(false);
  });
});
