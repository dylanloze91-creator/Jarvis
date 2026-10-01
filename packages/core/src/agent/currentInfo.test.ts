import { describe, expect, it } from 'vitest';
import { detectCurrentInfoIntent, extractCity, isCurrentInfoQuestion, NEWS_HEADLINES_QUERY } from './currentInfo.js';

const NOW = new Date('2026-10-01T21:30:00Z');
const plan = (text: string) => detectCurrentInfoIntent(text, NOW);

describe('detectCurrentInfoIntent — questions actuelles déroutées vers Internet', () => {
  it.each([
    ['Quelles sont les principales actualités en France aujourd’hui ?', 'news'],
    ['Jarvis, quoi de neuf dans le monde aujourd’hui ?', 'news'],
    ['Lis-moi les actus du jour', 'news'],
    ['Quel est le prix du litre de SP95 en France en ce moment ?', 'price'],
    ['Combien vaut le bitcoin aujourd’hui ?', 'price'],
    ['Combien coûte une PS5 Pro ?', 'price'],
    ['Quel a été le score du dernier match du PSG ?', 'sport'],
    ['Qui a gagné le dernier Grand Prix de Formule 1 ?', 'sport'],
    ['Quel est le classement actuel de la Ligue 1 ?', 'sport'],
    ['Quelle est la dernière version de Node.js ?', 'version'],
    ['Quelle est la dernière version d’iOS ?', 'version'],
    ['Quelle est la dernière mise à jour de Windows 11 ?', 'version'],
    ['Quand sort le prochain film Marvel au cinéma ?', 'version'],
    ['Quel temps fait-il aujourd’hui à Paris ?', 'weather'],
    ['Météo Lyon demain', 'weather'],
    ['Est-ce qu’il va pleuvoir ce soir ?', 'weather'],
    ['Qui est le Premier ministre actuel en France ?', 'office'],
    ['Qui est le président actuel des États-Unis ?', 'office'],
    ['Qui est le PDG actuel d’OpenAI ?', 'office'],
    ['Qui dirige la BCE ?', 'office'],
    ['Quel est le taux du livret A en ce moment ?', 'figure'],
    ['Quel est le taux de chômage en France actuellement ?', 'figure'],
    ['Quelle est la situation en Ukraine aujourd’hui ?', 'generic'],
    ['Cherche sur internet la recette de la tarte tatin', 'explicit'],
    ['Fais une recherche sur le web sur les voitures électriques', 'explicit'],
  ])('« %s » → %s', (text, kind) => {
    expect(plan(text)?.kind).toBe(kind);
    expect(isCurrentInfoQuestion(text, NOW)).toBe(true);
  });
});

describe('detectCurrentInfoIntent — demandes qui gardent leur chemin d’avant', () => {
  it.each([
    // Horloge du PC
    'Quelle heure est-il ?',
    'Jarvis, quelle heure est-il ?',
    'On est quel jour ?',
    'Quelle est la date d’aujourd’hui ?',
    // Spotify
    'Qu’est-ce qui joue sur Spotify en ce moment ?',
    'Mets du Nekfeu',
    'Écoute On Verra de Nekfeu',
    'Monte le volume',
    'Morceau suivant',
    'Quelle est la dernière chanson ajoutée sur Spotify ?',
    // PC et actions
    'Ouvre Chrome',
    'Lance la mise à jour de Windows',
    'Comment va mon PC en ce moment ?',
    'Quels sont les processus qui consomment le plus en ce moment ?',
    'Quelle fenêtre est active ?',
    'Fais une capture d’écran',
    'Combien d’espace disque libre actuellement ?',
    'Supprime le fichier rapport.txt',
    // Mémoire et personnel
    'Cherche dans ta mémoire ce que je t’ai dit sur mon projet',
    'Souviens-toi que mon train part demain à 8 h',
    'Retiens que j’aime le café',
    'Quel est mon prénom ?',
    'Qu’est-ce que j’ai prévu aujourd’hui ?',
    'Quelle est la météo de mon agenda ?',
    'Quelle est ta dernière version ?',
    // Google Workspace (outils google_*)
    'Lis mes derniers mails',
    'Quels événements sont prévus dans l’agenda cette semaine ?',
    'Ai-je reçu des e-mails aujourd’hui ?',
    'Quel est le prochain rendez-vous ?',
    'Quelles réunions aujourd’hui ?',
    'Cherche le rapport dans Google Drive',
    'Quelles sont les dernières lignes de la feuille de calcul budget ?',
    'Ouvre le dernier document Google Docs',
    'Quel est le planning de la semaine ?',
    // SiteBlock
    'Active le mode travail',
    'Bloque youtube.com',
    // Bourse : get_stock_quote garde la main
    'Quel est le cours de l’action Apple ?',
    'Comment va le CAC 40 aujourd’hui ?',
    // Discussion, culture générale, histoire, calcul
    'Comment ça va aujourd’hui ?',
    'Qu’est-ce que tu fais aujourd’hui ?',
    'Raconte-moi une blague',
    'Quelle est la capitale de la France ?',
    'Explique-moi la photosynthèse',
    'Comment installer Node.js ?',
    'Qui a gagné la coupe du monde 1998 ?',
    'Combien font 12 fois 8 ?',
    'Combien font 3 + 4 ?',
    'Comment faire un transfert de fichiers ?',
    '',
  ])('« %s » → pas de recherche forcée', (text) => {
    expect(plan(text)).toBeNull();
  });

  it('un lien YouTube reste à youtube_transcript', () => {
    expect(plan('Quoi de neuf dans https://youtu.be/dQw4w9WgXcQ aujourd’hui ?')).toBeNull();
  });
});

describe('detectCurrentInfoIntent — plan de recherche', () => {
  it('la une quand la question ne porte que sur « les actualités »', () => {
    expect(plan('Quelles sont les principales actualités en France aujourd’hui ?')).toMatchObject({
      newsQuery: NEWS_HEADLINES_QUERY,
      freshness: 'day',
      preferNews: true,
    });
  });

  it('mots porteurs pour l’actualité, question nettoyée pour le web', () => {
    const result = plan('Jarvis, quel a été le score du dernier match du PSG ?');
    expect(result?.newsQuery).toBe('score match PSG');
    expect(result?.query).toBe('quel a été le score du dernier match du PSG');
    expect(result?.freshness).toBe('week');
  });

  it('ajoute l’année aux versions, chiffres et personnalités, pas à l’actualité', () => {
    expect(plan('Quelle est la dernière version de Node.js ?')?.query).toMatch(/Node\.js 2026$/);
    expect(plan('Qui est le PDG actuel d’OpenAI ?')?.query).toMatch(/2026$/);
    expect(plan('Quel a été le score du dernier match du PSG ?')?.query).not.toMatch(/2026/);
    expect(plan('Quelle est la dernière version de Node.js en 2026 ?')?.query).not.toMatch(/2026 2026/);
  });

  it('garde le « A » du livret A', () => {
    expect(plan('Quel est le taux du livret A en ce moment ?')?.newsQuery).toBe('taux livret A');
  });

  it('fraîcheur : le jour pour « aujourd’hui », le mois pour une version', () => {
    expect(plan('Quel est le prix du litre de SP95 aujourd’hui ?')?.freshness).toBe('day');
    expect(plan('Qui a gagné le dernier Grand Prix de Formule 1 ?')?.freshness).toBe('week');
    expect(plan('Quelle est la dernière version d’iOS ?')?.freshness).toBe('month');
  });

  it('météo : ville extraite et requête actualité « météo <ville> »', () => {
    expect(plan('Quel temps fait-il aujourd’hui à Paris ?')).toMatchObject({ kind: 'weather', city: 'Paris', newsQuery: 'météo Paris' });
    expect(plan('Quel temps fait-il aujourd’hui ?')).toMatchObject({ kind: 'weather', newsQuery: 'météo' });
    expect(plan('Quel temps fait-il aujourd’hui ?')?.city).toBeUndefined();
  });

  it('question complexe ou contestée : 2 à 4 requêtes pour web_research', () => {
    const result = plan('Est-ce vrai que le prix de l’essence va baisser cette semaine ?');
    expect(result?.complex).toBe(true);
    expect(result?.researchQueries.length).toBeGreaterThanOrEqual(2);
    expect(result?.researchQueries.length).toBeLessThanOrEqual(4);
    expect(new Set(result?.researchQueries).size).toBe(result?.researchQueries.length);
    expect(plan('Qui a gagné le dernier Grand Prix de Formule 1 ?')?.complex).toBe(false);
    expect(plan('Qui a gagné le dernier Grand Prix de Formule 1 ?')?.researchQueries).toEqual([]);
  });

  it('une année récente nommée rend la question actuelle, une année ancienne non', () => {
    expect(plan('Qui a gagné la coupe du monde 2026 ?')?.kind).toBe('sport');
    expect(plan('Qui a gagné la coupe du monde 2018 ?')).toBeNull();
    expect(plan('Cherche sur internet qui a gagné la coupe du monde 2018')?.kind).toBe('explicit');
  });
});

describe('extractCity', () => {
  it.each([
    ['Quel temps fait-il à Lyon demain ?', 'Lyon'],
    ['Météo à Saint-Étienne', 'Saint-Étienne'],
    ['météo sur Marseille ce week-end', 'Marseille'],
    ['Météo Bordeaux', 'Bordeaux'],
    ['Va-t-il pleuvoir à Aix-en-Provence ?', 'Aix-en-Provence'],
  ])('« %s » → %s', (text, city) => {
    expect(extractCity(text)).toBe(city);
  });

  it('sans ville nommée', () => {
    expect(extractCity('Quel temps fait-il aujourd’hui ?')).toBeUndefined();
    expect(extractCity('météo à demain')).toBeUndefined();
  });
});
