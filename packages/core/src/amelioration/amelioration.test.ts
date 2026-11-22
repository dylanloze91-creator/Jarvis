import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { ExpressRule } from '../agent/expressRules.js';
import { analyser, lireRegle, rapportMarkdown } from './boucle.js';
import { decouvrirRegles, groupesDeMots } from './decouverte.js';
import { famillesDeRates, ouPartLeTemps, outilsQuiRatent } from './diagnostic.js';
import { bilanDesEquipes } from './equipes.js';
import { ameliorer } from './fichiers.js';
import { porteRegle } from './porte.js';
import { lireLigneCarnet, rattacherRates, toursDeConversation, type TourObserve } from './tours.js';

// Phrases écrites pour ces essais : aucune ne vient d'une conversation réelle.

interface TourEssai {
  texte: string;
  team: string | null;
  how: string | null;
  model?: string | null;
  tools?: { name: string; status: string }[];
  triMs?: number;
  premierMot?: number;
  duree?: number;
}

let compteur = 0;

function conversation(id: string, tours: TourEssai[]): Record<string, unknown> {
  const messages: Record<string, unknown>[] = [];
  const turnLog: Record<string, unknown>[] = [];
  for (const tour of tours) {
    compteur += 1;
    const userId = `u${compteur}`;
    messages.push({ id: userId, role: 'user', content: tour.texte, createdAt: compteur });
    messages.push({ id: `a${compteur}`, role: 'assistant', content: 'réponse', createdAt: compteur });
    turnLog.push({
      userMessageId: userId,
      assistantMessageIds: [`a${compteur}`],
      team: tour.team,
      how: tour.how,
      provider: tour.model === null ? 'aucun' : 'ollama',
      model: tour.model === undefined ? 'qwen2.5:7b' : tour.model,
      place: 'carte',
      source: 'texte',
      tools: tour.tools ?? [],
      durationMs: tour.duree ?? 2000,
      at: compteur,
      etapes: {
        ...(tour.triMs !== undefined ? { tri: { ms: tour.triMs, chemin: tour.how ?? 'cerveau', modele: tour.how === 'cerveau' } } : {}),
        ...(tour.premierMot !== undefined ? { premierMot: tour.premierMot } : {}),
      },
    });
  }
  return { id, title: id, createdAt: 0, updatedAt: 0, messages, turnLog };
}

function historique(): TourObserve[] {
  const tours: TourEssai[] = [];
  const villes = ['Lyon', 'Nantes', 'Lille', 'Brest', 'Dijon', 'Metz', 'Pau'];
  const quand = ['demain', 'ce soir', 'ce week-end', 'samedi', 'cet après-midi', 'lundi', 'jeudi'];
  villes.forEach((ville, index) => tours.push({ texte: `Quelle météo ${quand[index]} à ${ville} ?`, team: 'web', how: 'cerveau', triMs: 900 }));
  for (let i = 0; i < 6; i += 1) tours.push({ texte: `Raconte-moi une blague numéro ${i}`, team: 'conversation', how: 'cerveau', triMs: 800 });
  for (let i = 0; i < 6; i += 1) {
    tours.push({ texte: `Mets la playlist ${i} sur Spotify`, team: 'musique', how: 'express', triMs: 1, tools: [{ name: 'spotify_play', status: 'ok' }] });
  }
  tours.push({ texte: 'Combien font 3 fois 4', team: 'conversation', how: 'calcul', model: null, triMs: 0 });
  return toursDeConversation(conversation('c1', tours));
}

describe('lecture des tours', () => {
  it('rend une demande par message utilisateur, avec son équipe, son chemin et son tri', () => {
    const tours = toursDeConversation(
      conversation('c0', [
        { texte: 'Ouvre le bloc-notes', team: 'pc', how: 'cerveau', triMs: 1200, tools: [{ name: 'open_application', status: 'ok' }], premierMot: 3000 },
        { texte: 'Quelle heure est-il', team: 'conversation', how: 'horloge', model: null, triMs: 0 },
      ]),
    );
    expect(tours).toHaveLength(2);
    expect(tours[0]).toMatchObject({ equipe: 'pc', chemin: 'cerveau', triMs: 1200, triParModele: true, premierMotMs: 3000, journal: true });
    expect(tours[0]!.outils).toEqual([{ name: 'open_application', ok: true }]);
    expect(tours[1]).toMatchObject({ chemin: 'horloge', triParModele: false });
  });

  it('une conversation illisible rend une liste vide', () => {
    expect(toursDeConversation(null)).toEqual([]);
    expect(toursDeConversation({ messages: 'non' })).toEqual([]);
    expect(toursDeConversation([1, 2])).toEqual([]);
  });

  it('sans journal du tour, le journal des équipes suffit', () => {
    const tours = toursDeConversation({
      id: 'c',
      messages: [{ id: 'x', role: 'user', content: 'Bonjour' }],
      routeLog: [{ userMessageId: 'x', team: 'conversation', how: 'cerveau', model: 'qwen2.5:7b' }],
    });
    expect(tours[0]).toMatchObject({ equipe: 'conversation', chemin: 'cerveau', triParModele: true, journal: false });
  });

  it('rattache les ratés du carnet ; « pas grave » ne compte pas', () => {
    const tours = toursDeConversation(conversation('c2', [{ texte: 'Mets du jazz', team: 'web', how: 'cerveau', triMs: 500 }]));
    const lignes = [
      JSON.stringify({ conversationId: 'c2', userText: 'mets du jazz !', type: 'chemin' }),
      JSON.stringify({ conversationId: 'c2', userText: 'Mets du jazz', type: 'lenteur', category: 'pas-grave' }),
      JSON.stringify({ conversationId: 'autre', userText: 'Rien', type: 'correction' }),
      'pas du json',
    ];
    const rates = lignes.map(lireLigneCarnet).filter((rate) => rate !== null);
    expect(rates).toHaveLength(3);
    expect(rattacherRates(tours, rates)).toEqual({ rattaches: 1, orphelins: 1 });
    expect(tours[0]!.rates).toEqual(['chemin']);
  });
});

describe('diagnostic', () => {
  it('regroupe les ratés en familles avec une piste', () => {
    const tours = toursDeConversation(
      conversation('c3', [
        { texte: 'Lis mes mails', team: 'google', how: 'express', tools: [{ name: 'google_gmail_search', status: 'error' }] },
        { texte: 'Lis mes mails importants', team: 'google', how: 'express', tools: [{ name: 'google_gmail_search', status: 'error' }] },
        { texte: 'Mon PC est lent', team: 'web', how: 'cerveau', triMs: 900 },
      ]),
    );
    tours[0]!.rates.push('outil_echec');
    tours[1]!.rates.push('outil_echec');
    tours[2]!.rates.push('chemin');
    const familles = famillesDeRates(tours);
    expect(familles[0]).toMatchObject({ type: 'outil_echec', equipe: 'google', outil: 'google_gmail_search', rates: 2, tours: 2, taux: 1, piste: 'bogue-outil' });
    expect(familles[1]).toMatchObject({ type: 'chemin', piste: 'tri' });
    expect(outilsQuiRatent(tours)[0]).toMatchObject({ name: 'google_gmail_search', appels: 2, echecs: 2 });
  });

  it('dit combien de temps les tris par modèle ont coûté', () => {
    const temps = ouPartLeTemps(historique());
    expect(temps.triParModeleTotalMs).toBe(7 * 900 + 6 * 800);
    expect(temps.partTriParModele).toBeCloseTo(13 / 20);
    expect(temps.etapes.tri.n).toBe(20);
  });
});

describe('la porte', () => {
  const meteo: ExpressRule = { id: 'meteo', team: 'web', declencheurs: ['meteo'], empechements: [], pour: [], contre: [] };

  it('accepte une règle qui ne prend que des demandes de son équipe', () => {
    const verdict = porteRegle(meteo, historique());
    expect(verdict).toMatchObject({ acceptee: true, prises: 7, justes: 7, volees: 0, accelerees: 7, gainTriMs: 6300 });
  });

  it('refuse une règle qui vole des demandes à une autre équipe', () => {
    const large: ExpressRule = { ...meteo, id: 'large', declencheurs: ['meteo', 'blague'] };
    const verdict = porteRegle(large, historique());
    expect(verdict.acceptee).toBe(false);
    expect(verdict.volees).toBe(6);
    expect(verdict.voleesParEquipe).toEqual({ conversation: 6 });
    expect(verdict.raisons.join(' ')).toMatch(/autres équipes/);
  });

  it('compte comme réparée une demande mal triée que la règle enverrait au bon endroit', () => {
    const tours = historique();
    const mal = toursDeConversation(conversation('c4', [{ texte: 'La météo pour ce soir', team: 'conversation', how: 'cerveau', triMs: 700 }]));
    mal[0]!.rates.push('chemin');
    const verdict = porteRegle(meteo, [...tours, ...mal]);
    expect(verdict.reparees).toBe(1);
    expect(verdict.volees).toBe(0);
    expect(verdict.acceptee).toBe(true);
  });

  it('signale un conflit avec une règle déjà en place', () => {
    const existante: ExpressRule = { id: 'deja', team: 'conversation', declencheurs: ['samedi'], empechements: [], pour: [], contre: [] };
    const verdict = porteRegle(meteo, historique(), [existante]);
    expect(verdict.conflits).toEqual(['deja']);
    expect(verdict.acceptee).toBe(false);
  });

  it('refuse une règle qui ne prend presque rien', () => {
    const rare: ExpressRule = { ...meteo, id: 'rare', declencheurs: ['brest'] };
    expect(porteRegle(rare, historique()).acceptee).toBe(false);
  });
});

describe('découverte de règles', () => {
  it('ne garde que les groupes de mots qui portent du sens', () => {
    const groupes = groupesDeMots('Quelle est la météo à Lyon ?');
    expect(groupes.has('meteo')).toBe(true);
    expect(groupes.has('est la')).toBe(false);
    expect(groupes.has('la')).toBe(false);
  });

  it('propose une règle pour la météo, triée par le cerveau, et elle passe la porte', () => {
    const propositions = decouvrirRegles(historique());
    const web = propositions.find((proposition) => proposition.equipe === 'web');
    expect(web).toBeDefined();
    expect(web!.regle.declencheurs).toContain('meteo');
    expect(web!.verdict.acceptee).toBe(true);
    expect(web!.couvertes).toBe(7);
    // La musique passe déjà par une règle express : rien à gagner, rien à proposer.
    expect(propositions.some((proposition) => proposition.equipe === 'musique')).toBe(false);
  });

  it('ne propose rien sous 4 demandes', () => {
    const tours = toursDeConversation(
      conversation('c5', [
        { texte: 'Quelle météo à Lyon', team: 'web', how: 'cerveau', triMs: 900 },
        { texte: 'Quelle météo à Nantes', team: 'web', how: 'cerveau', triMs: 900 },
        { texte: 'Quelle météo à Pau', team: 'web', how: 'cerveau', triMs: 900 },
      ]),
    );
    expect(decouvrirRegles(tours)).toEqual([]);
  });

  it('met l’outil dans la règle seulement s’il est permis sans modèle', () => {
    const tours = toursDeConversation(
      conversation(
        'c6',
        ['Montre la config de la machine', 'La config de la machine stp', 'Donne la config de la machine', 'Config de la machine maintenant', 'Et la config de la machine'].map(
          (texte) => ({ texte, team: 'pc', how: 'cerveau', triMs: 1000, tools: [{ name: 'get_system_info', status: 'ok' }] }),
        ),
      ),
    );
    const pc = decouvrirRegles(tours).find((proposition) => proposition.equipe === 'pc');
    expect(pc?.outilFrequent).toBe('get_system_info');
    expect(pc?.outilPermis).toBe(true);
    expect(pc?.regle.outil).toBe('get_system_info');
  });
});

describe('modèle par équipe', () => {
  it('suggère le modèle qui réussit mieux et répond plus vite, avec assez d’exemples', () => {
    const tours: TourEssai[] = [];
    for (let i = 0; i < 6; i += 1) tours.push({ texte: `Chanson ${i}`, team: 'musique', how: 'cerveau', model: 'qwen2.5:3b', premierMot: 4000 });
    for (let i = 0; i < 5; i += 1) tours.push({ texte: `Morceau ${i}`, team: 'musique', how: 'cerveau', model: 'qwen2.5:7b', premierMot: 2000 });
    const lus = toursDeConversation(conversation('c7', tours));
    lus.slice(0, 3).forEach((tour) => tour.rates.push('correction'));
    const musique = bilanDesEquipes(lus).find((bilan) => bilan.equipe === 'musique')!;
    expect(musique.actuel).toBe('qwen2.5:3b');
    expect(musique.meilleur).toBe('qwen2.5:7b');
    expect(musique.suggestion).toMatch(/qwen2\.5:7b/);
  });

  it('ne suggère rien sous 5 exemples par modèle', () => {
    const lus = toursDeConversation(
      conversation('c8', [
        { texte: 'a', team: 'pc', how: 'cerveau', model: 'm1', premierMot: 5000 },
        { texte: 'b', team: 'pc', how: 'cerveau', model: 'm2', premierMot: 1000 },
      ]),
    );
    expect(bilanDesEquipes(lus)[0]!.suggestion).toBeNull();
  });
});

describe('règle écrite à la main', () => {
  it('lit une règle valable et refuse le reste', () => {
    expect(lireRegle({ id: 'x', team: 'web', declencheurs: ['meteo'] })).toMatchObject({ regle: { id: 'x', team: 'web' } });
    expect(lireRegle({ id: 'x', team: 'inconnue', declencheurs: ['a'] })).toMatchObject({ erreur: expect.stringContaining('équipe') });
    expect(lireRegle({ team: 'web', declencheurs: ['a'] })).toMatchObject({ erreur: expect.stringContaining('id') });
    expect(lireRegle([])).toMatchObject({ erreur: expect.any(String) });
  });

  it('passe à la porte et dit ce qui manque pour entrer dans Jarvis', () => {
    const analyse = analyser(historique(), {
      existantes: [],
      aEssayer: [{ id: 'meteo', team: 'web', declencheurs: ['meteo'], empechements: [], pour: [], contre: [] }],
    });
    expect(analyse.reglesEssayees[0]!.verdict.acceptee).toBe(true);
    expect(analyse.reglesEssayees[0]!.problemes.join(' ')).toMatch(/phrases/);
  });
});

describe('rapport et fichiers', () => {
  it('le rapport ne contient pas les phrases ; le fichier d’exemples les contient', () => {
    const analyse = analyser(historique(), { existantes: [] });
    const rapport = rapportMarkdown(analyse, { date: '2026-11-23' });
    const exemples = rapportMarkdown(analyse, { date: '2026-11-23', avecPhrases: true });
    expect(rapport).not.toContain('à Lyon');
    expect(rapport).toContain('Règles express proposées');
    expect(exemples).toContain('Quelle météo demain à Lyon ?');
  });

  it('lit un dossier, écrit trois fichiers, et le fichier de comptes ne contient aucune phrase', async () => {
    const base = await mkdtemp(join(tmpdir(), 'amelioration-'));
    const dossier = join(base, 'conversations');
    await mkdir(dossier);
    const tours: TourEssai[] = ['Lyon', 'Nantes', 'Lille', 'Brest', 'Dijon'].map((ville) => ({
      texte: `Quelle météo demain à ${ville} ?`,
      team: 'web',
      how: 'cerveau',
      triMs: 900,
    }));
    await writeFile(join(dossier, 'a.json'), JSON.stringify(conversation('fa', tours)));
    await writeFile(join(dossier, 'zeros.json'), new Uint8Array(16));
    await writeFile(join(dossier, 'casse.json'), '{');
    const carnet = join(base, 'rates.jsonl');
    await writeFile(carnet, `${JSON.stringify({ conversationId: 'fa', userText: 'Quelle météo demain à Lyon ?', type: 'lenteur' })}\n`);
    const regle = join(base, 'regle.json');
    await writeFile(regle, JSON.stringify([{ id: 'meteo', team: 'web', declencheurs: ['meteo'] }, { id: 'mauvaise' }]));

    const resultat = await ameliorer({
      conversations: [dossier, join(base, 'absent')],
      carnet,
      regles: [regle],
      dir: join(base, 'donnees'),
      now: new Date(2026, 10, 23, 1, 2),
    });
    expect(resultat.lecture).toMatchObject({ conversations: 1, sautees: 2, dossiersAbsents: 1 });
    expect(resultat.lecture.carnet).toMatchObject({ lignes: 1, rattaches: 1, orphelins: 0 });
    expect(resultat.lecture.reglesRefusees).toHaveLength(1);
    expect(resultat.analyse.reglesEssayees).toHaveLength(1);
    expect(resultat.fichiers!.rapport).toContain(join('donnees', 'amelioration', '2026-11-23-0102'));
    const json = await readFile(resultat.fichiers!.analyse, 'utf8');
    expect(json).not.toContain('Lyon');
    expect(JSON.parse(json).tours).toBe(5);
    expect(await readFile(resultat.fichiers!.exemples, 'utf8')).toContain('Lyon');
  });

  it('refuse d’écrire dans le dépôt', async () => {
    const base = await mkdtemp(join(tmpdir(), 'amelioration-depot-'));
    await expect(ameliorer({ conversations: [join(base, 'x')], dir: join(base, 'depot', 'donnees'), depot: join(base, 'depot') })).rejects.toThrow('dépôt');
  });
});
