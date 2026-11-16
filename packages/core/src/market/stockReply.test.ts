import { describe, expect, it } from 'vitest';
import { formatStockSpoken, speakStockOutcomes, stockNotFoundReply } from './stockReply.js';
import type { StockQuote } from './types.js';

const SPIE: StockQuote = {
  query: 'SPIE',
  symbol: 'SPIE.PA',
  name: 'SPIE SA',
  price: 34.12,
  currency: 'EUR',
  change: 0.41,
  changePercent: 1.2,
  exchange: 'Euronext Paris',
  asOf: '2026-11-11T16:35:00.000Z',
  providerId: 'yahoo-finance',
};

describe('phrase de cours', () => {
  it('dit le cours comme à voix haute, sans inventer', () => {
    expect(formatStockSpoken(SPIE)).toBe(
      "SPIE, Euronext Paris : 34,12 €, en hausse de 1,2 % aujourd'hui (17 h 35).",
    );
  });

  it('ajoute la phrase « tu voulais peut-être » quand la cotation la porte', () => {
    const spoken = formatStockSpoken({
      ...SPIE,
      clarification: "J'ai pris SPIE (Paris). Tu voulais peut-être SPI Energy (Nasdaq) ?",
    });
    expect(spoken).toMatch(/tu voulais peut-être/i);
    expect(spoken.startsWith('SPIE, Euronext Paris : 34,12 €')).toBe(true);
  });

  it("échec : demande le symbole, pas un prix", () => {
    expect(stockNotFoundReply('SPIE')).toBe(
      "Je n'ai pas trouvé SPIE à la bourse. Tu peux me donner son symbole ?",
    );
    expect(speakStockOutcomes(['SPIE'], [{ query: 'SPIE', error: 'rien' }])).toBe(
      "Je n'ai pas trouvé SPIE à la bourse. Tu peux me donner son symbole ?",
    );
    expect(speakStockOutcomes(['SPIE'], null)).not.toMatch(/\d/);
  });
});
