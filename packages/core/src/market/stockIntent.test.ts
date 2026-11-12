import { describe, expect, it } from 'vitest';
import { detectStockRequest } from './stockIntent.js';

/**
 * synthetique-test — phrases inventées pour la règle, pas des paroles réelles.
 * Le marqueur est dans le titre pour qu'on les retrouve.
 */
describe('detectStockRequest — synthetique-test', () => {
  const yes: { text: string; names: string[]; prefer: 'paris' | null }[] = [
    { text: 'le cours de SPIE', names: ['SPIE'], prefer: null },
    { text: "cours de l'action Airbus", names: ['Airbus'], prefer: null },
    { text: 'combien vaut SPIE en bourse', names: ['SPIE'], prefer: null },
    { text: 'SPIE en bourse', names: ['SPIE'], prefer: null },
    { text: "comment va l'action TotalEnergies", names: ['TotalEnergies'], prefer: null },
    { text: 'cotation de Nvidia', names: ['Nvidia'], prefer: null },
    { text: 'le cours de SPIE sur Yahoo Finance', names: ['SPIE'], prefer: null },
    { text: 'regarde sur Yahoo le cours de Schneider', names: ['Schneider'], prefer: null },
    { text: 'Jarvis, le cours de SPIE', names: ['SPIE'], prefer: null },
    { text: "Jarvis, cours de l'action Airbus", names: ['Airbus'], prefer: null },
    { text: "le cours d'Apple et de Nvidia", names: ['Apple', 'Nvidia'], prefer: null },
    { text: 'Apple et Nvidia en bourse', names: ['Apple', 'Nvidia'], prefer: null },
    { text: 'cours de SPIE', names: ['SPIE'], prefer: null },
    { text: 'quel est le cours de Spie', names: ['Spie'], prefer: null },
    { text: 'Jarvis, quel est le cours de Spie ?', names: ['Spie'], prefer: null },
    { text: 'la cotation de Nvidia', names: ['Nvidia'], prefer: null },
    { text: 'combien vaut Airbus en bourse', names: ['Airbus'], prefer: null },
    { text: "comment va l'action Schneider", names: ['Schneider'], prefer: null },
    { text: "le cours de l'action TotalEnergies", names: ['TotalEnergies'], prefer: null },
    { text: 'le cours de spi en bourse', names: ['spi'], prefer: null },
    { text: "le cours de l'action spi", names: ['spi'], prefer: null },
    { text: 'le cours de SPIE à Paris', names: ['SPIE'], prefer: 'paris' },
    { text: "comment va l'action française TotalEnergies", names: ['TotalEnergies'], prefer: 'paris' },
    { text: 'le cours de SPIE sur Euronext', names: ['SPIE'], prefer: 'paris' },
    { text: 'le cours de SPIE au CAC', names: ['SPIE'], prefer: 'paris' },
    { text: 'Jarvis, cotation de Nvidia', names: ['Nvidia'], prefer: null },
    { text: 'le cours de LVMH', names: ['LVMH'], prefer: null },
    { text: "cours de l'action Saint-Gobain", names: ['Saint-Gobain'], prefer: null },
    { text: 'regarde sur Yahoo Finance le cours de SPIE', names: ['SPIE'], prefer: null },
    { text: "Jarvis, le cours d'Apple et de Nvidia", names: ['Apple', 'Nvidia'], prefer: null },
    { text: "l'entreprise française, le cours de SPIE", names: ['SPIE'], prefer: 'paris' },
    { text: 'cherche sur Google le cours de SPIE', names: ['SPIE'], prefer: null },
  ];

  const no = [
    "le cours de l'or",
    "cours de l'euro",
    'cours du bitcoin',
    'cours de maths',
    'cours de guitare',
    'cours de cuisine',
    'le projet est en cours',
    'au cours de la réunion',
    'bonjour',
    'quelle heure est-il',
    'explique la photosynthèse',
    'bitcoin en bourse',
    "combien vaut l'or",
    '',
    'quel est le cours',
    'finance',
    'Google',
    'lis mes mails',
    'cours de français',
    'je suis en cours de maths',
    'une phrase sans nom',
    'le cours de spi',
    "à quelle heure est mon cours de demain",
    'rappelle-moi mon cours de boxe',
    'le cours de boxe de jeudi',
    "met le cours de musique sur l'agenda",
    "j'ai raté le cours de ce matin",
    "j'ai cours de 8h à 10h",
    "j'ai un cours de soutien",
    "le cours de l'eau",
    'le cours de la Seine',
    'le cours de la vie',
    'les cours de la récréation',
    'mon cours de SPIE',
    'le cours de SPIE de jeudi',
    "le cours de SPIE sur l'agenda",
    "j'ai un cours de SPIE",
    'des cours de SPIE',
  ];

  it(`reconnaît au moins 30 phrases synthetique-test (${yes.length + no.length})`, () => {
    expect(yes.length + no.length).toBeGreaterThanOrEqual(30);
  });

  it.each(yes)('oui synthetique-test : « $text »', ({ text, names, prefer }) => {
    expect(detectStockRequest(text), text).toEqual({ names, prefer });
  });

  it.each(no)('non synthetique-test : « %s »', (text) => {
    expect(detectStockRequest(text), text).toBeNull();
  });
});
