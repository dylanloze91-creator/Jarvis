import { describe, expect, it } from 'vitest';
import { ageInDays, formatCurrentDateTime, formatSourceDate, leadingSnippetDate, parseFeedDate } from './dates.js';
import { filterRelevant, keywordQuery, significantTokens } from './relevance.js';

const NOW = new Date('2026-10-01T19:30:00Z');

describe('dates', () => {
  it('date RSS → ISO', () => {
    expect(parseFeedDate('Thu, 01 Oct 2026 11:50:00 GMT')).toBe('2026-10-01T11:50:00.000Z');
    expect(parseFeedDate('pas une date')).toBeUndefined();
    expect(parseFeedDate(undefined)).toBeUndefined();
  });

  it.each([
    ['30 sept. 2026 · Le texte', '2026-09-30', 'Le texte'],
    ['1er octobre 2026 — Texte', '2026-10-01', 'Texte'],
    ['Sep 30, 2026 · Text', '2026-09-30', 'Text'],
    ['2026-09-29 - Texte', '2026-09-29', 'Texte'],
    ['il y a 3 jours · Texte', '2026-09-28', 'Texte'],
    ['hier · Texte', '2026-09-30', 'Texte'],
  ])('date en tête d’extrait « %s »', (snippet, day, rest) => {
    const parsed = leadingSnippetDate(snippet, NOW);
    expect(parsed.publishedAt?.slice(0, 10)).toBe(day);
    expect(parsed.rest).toBe(rest);
  });

  it('pas de date inventée', () => {
    expect(leadingSnippetDate('Node.js 26 est sorti', NOW)).toEqual({ rest: 'Node.js 26 est sorti' });
    expect(leadingSnippetDate('31 février 2026 · x', NOW).publishedAt).toBeUndefined();
  });

  it('formats français, fuseau du PC', () => {
    expect(formatCurrentDateTime(NOW, 'Europe/Paris')).toBe('jeudi 1 octobre 2026, 21:30');
    expect(formatSourceDate('2026-09-01T10:00:00Z', NOW, 'Europe/Paris')).toBe('1 sept. 2026');
    expect(formatSourceDate('2026-10-01T05:00:00Z', NOW, 'Europe/Paris')).toBe('1 oct. 2026, 07:00');
    expect(formatSourceDate(undefined, NOW)).toBeUndefined();
    expect(Math.round(ageInDays('2026-09-24T19:30:00Z', NOW) ?? 0)).toBe(7);
  });
});

describe('pertinence', () => {
  it('termes porteurs : sans mots outils, accents ni pluriels', () => {
    expect(significantTokens('Quelle est la dernière version de Node.js ?')).toEqual(['derniere', 'version', 'node', 'js']);
    expect(significantTokens('Qui a été élu ?')).toEqual(['elu']);
  });

  it('écarte les pages hors sujet, garde les bonnes, ignore l’année de fraîcheur', () => {
    const kept = filterRelevant('Quelle est la dernière version de Node.js 2026', [
      { title: 'Télécharger Node.js', url: 'https://nodejs.org/fr/download', snippet: '' },
      { title: 'Courrier et calendrier Outlook', url: 'https://www.microsoft.com/outlook', snippet: 'Microsoft 365' },
      { title: 'Tarifs HubSpot', url: 'https://www.hubspot.fr/pricing', snippet: 'versions allégées' },
    ]);
    expect(kept.map((item) => item.url)).toEqual(['https://nodejs.org/fr/download']);
  });

  it('requête d’un seul terme : ce terme est exigé', () => {
    expect(filterRelevant('PSG', [{ title: 'Ligue 1', url: 'https://x.fr', snippet: '' }])).toEqual([]);
  });

  it('mots-clés pour Wikipédia', () => {
    expect(keywordQuery('Quelle est la dernière version de Node.js 2026')).toBe('Node.js');
    expect(keywordQuery("Qui est le PDG actuel d'OpenAI 2026")).toBe('PDG OpenAI');
    expect(keywordQuery('Quel est le taux du livret A en ce moment 2026')).toBe('taux livret A');
  });
});
