import { describe, expect, it } from 'vitest';
import { createMessage } from '../types.js';
import { parseSettings } from '../settings.js';
import { DEFAULT_SYSTEM_PROMPT } from './agent.js';
import {
  activeOrchestra,
  arithmeticExpression,
  availableTeams,
  clockReply,
  evaluateArithmetic,
  expressTeam,
  ORCHESTRA_BASE_PROMPT,
  ORCHESTRA_TEAMS,
  orchestraBasePrompt,
  orchestraProviderConfig,
  parseRouterReply,
  routerSystemPrompt,
  routerUserPrompt,
  solveArithmetic,
  SUGGESTED_ORCHESTRA,
  teamAssignment,
  teamHasTool,
  type OrchestraTeam,
} from './orchestra.js';

const ALL = new Set<OrchestraTeam>(ORCHESTRA_TEAMS);

describe('chef d’orchestre — calcul exact sans modèle', () => {
  it('calcule les opérations dites en français', () => {
    expect(solveArithmetic('Combien font 12 fois 37 ?')?.reply).toBe('12 × 37 = 444');
    expect(solveArithmetic('calcule 15 % de 240')?.reply).toBe('15 % de 240 = 36');
    expect(solveArithmetic('Jarvis, combien font 1 250 divisé par 4 ?')?.reply).toBe('1250 ÷ 4 = 312,5');
    expect(solveArithmetic('(3 + 4) * 2 - 1')?.value).toBe(13);
    expect(solveArithmetic('combien font 2 puissance 10')?.value).toBe(1024);
    expect(solveArithmetic('7 au carré')?.value).toBe(49);
    expect(solveArithmetic('0,1 + 0,2')?.reply).toBe('0,1 + 0,2 = 0,3');
    expect(solveArithmetic('-3 + 5 * -2')?.value).toBe(-13);
  });

  it('ne prend jamais une phrase ordinaire pour un calcul', () => {
    for (const text of [
      'Ouvre 2 fenêtres de Chrome',
      'Mets le volume à 50 %',
      'Quelle heure est-il ?',
      'Combien de fichiers dans Documents ?',
      'Il fait 12 degrés ?',
      'Rappelle-moi le 12/05',
      '12 : 30',
      'Bonjour',
      '42',
    ]) {
      expect(solveArithmetic(text), text).toBeNull();
    }
  });

  it('refuse la division par zéro et les expressions mal formées, sans eval', () => {
    expect(evaluateArithmetic('4/0')).toBeNull();
    expect(evaluateArithmetic('(1+2')).toBeNull();
    expect(evaluateArithmetic('1++')).toBeNull();
    expect(arithmeticExpression('process.exit(1) + 2')).toBeNull();
  });
});

describe('chef d’orchestre — chemin express', () => {
  const express = (text: string, history = [] as ReturnType<typeof createMessage>[]) =>
    expressTeam({ text, history, available: ALL, now: new Date('2026-10-30T10:00:00') });

  it('reprend les règles existantes de Jarvis', () => {
    expect(express('Mets Daft Punk sur Spotify')).toBe('musique');
    expect(express('Résume https://youtu.be/dQw4w9WgXcQ')).toBe('web');
    expect(express('Quelle est la météo à Lyon demain ?')).toBe('web');
    expect(express('Bloque youtube.com pendant une heure')).toBe('concentration');
  });

  it('laisse le cerveau décider quand aucune règle ne s’applique', () => {
    expect(express('Ouvre le Bloc-notes')).toBeNull();
    expect(express('Explique-moi la photosynthèse')).toBeNull();
    expect(express('Écris une fonction Python qui trie une liste')).toBeNull();
  });

  it('une équipe sans ses outils n’est jamais choisie', () => {
    const noMusic = new Set(ALL);
    noMusic.delete('musique');
    expect(expressTeam({ text: 'Mets Daft Punk sur Spotify', history: [], available: noMusic })).toBeNull();
  });
});

describe('chef d’orchestre — le cerveau', () => {
  it('ne montre que les équipes disponibles, une par ligne', () => {
    const prompt = routerSystemPrompt(['conversation', 'pc', 'code']);
    expect(prompt).toContain('- pc : ordinateur');
    expect(prompt).toContain('- code : écrire');
    expect(prompt).not.toContain('- google');
    expect(prompt).toMatch(/un seul mot/);
  });

  it('montre la fin de la conversation pour comprendre une suite (« et ferme-le »)', () => {
    const history = [
      createMessage('user', 'Ouvre le Bloc-notes'),
      createMessage('assistant', 'C’est ouvert.'),
      createMessage('tool', 'résultat brut'),
    ];
    const prompt = routerUserPrompt('Et ferme-le', history);
    expect(prompt).toContain('Utilisateur : Ouvre le Bloc-notes');
    expect(prompt).toContain('Jarvis : C’est ouvert.');
    expect(prompt).not.toContain('résultat brut');
    expect(prompt.endsWith('Demande : Et ferme-le\nÉquipe :')).toBe(true);
  });

  it('lit la réponse du cerveau, accents et majuscules compris', () => {
    const teams = [...ORCHESTRA_TEAMS];
    expect(parseRouterReply('pc', teams)).toBe('pc');
    expect(parseRouterReply('Équipe : Mémoire.', teams)).toBe('memoire');
    expect(parseRouterReply('**fichiers**', teams)).toBe('fichiers');
    expect(parseRouterReply('Je pense que c’est la musique', teams)).toBe('musique');
    expect(parseRouterReply('google', ['conversation', 'pc'])).toBeNull();
    expect(parseRouterReply('', teams)).toBeNull();
  });
});

describe('chef d’orchestre — équipes, modèles et réglages', () => {
  it('chaque équipe n’a que ses outils', () => {
    expect(teamHasTool('musique', 'spotify_play')).toBe(true);
    expect(teamHasTool('musique', 'run_command')).toBe(false);
    expect(teamHasTool('pc', 'run_command')).toBe(true);
    expect(teamHasTool('google', 'google_gmail_send')).toBe(true);
    expect(teamHasTool('conversation', 'web_search')).toBe(false);
    expect(availableTeams(['spotify_play', 'open_application'])).toEqual(['conversation', 'pc', 'musique', 'code']);
  });

  it('une équipe sans modèle choisi prend le cerveau, sur la carte', () => {
    expect(teamAssignment({ brain: 'qwen2.5:7b', teams: {} }, 'pc')).toEqual({ model: 'qwen2.5:7b', place: 'carte' });
    expect(teamAssignment(SUGGESTED_ORCHESTRA, 'code')).toEqual({ model: 'qwen2.5-coder:7b', place: 'processeur' });
  });

  it('options Ollama : processeur = num_gpu 0, réflexion coupée pour Qwen3, appels relus', () => {
    expect(orchestraProviderConfig({ baseUrl: 'http://127.0.0.1:11434' }, 'qwen3.5:4b', 'processeur', false)).toEqual({
      provider: 'ollama',
      model: 'qwen3.5:4b',
      baseUrl: 'http://127.0.0.1:11434',
      ollama: { numGpu: 0, keepAlive: '10m', think: false, recoverToolCalls: true },
    });
    expect(orchestraProviderConfig({}, 'qwen2.5:7b', 'carte', true).ollama).toEqual({
      keepAlive: '30m',
      recoverToolCalls: true,
    });
  });

  it('consigne courte, sauf si l’utilisateur a écrit sa propre personnalité', () => {
    expect(orchestraBasePrompt(DEFAULT_SYSTEM_PROMPT)).toBe(ORCHESTRA_BASE_PROMPT);
    expect(orchestraBasePrompt('Tu es Jarvis, tu me tutoies.')).toBe('Tu es Jarvis, tu me tutoies.');
    expect(ORCHESTRA_BASE_PROMPT.length).toBeLessThan(DEFAULT_SYSTEM_PROMPT.length / 4);
  });

  it('réglage absent ou coupé : aucun orchestre, et les réglages par défaut ne gagnent pas de clé', () => {
    expect('orchestra' in parseSettings({})).toBe(false);
    expect(activeOrchestra(parseSettings({ provider: 'ollama' }))).toBeNull();
    expect(
      activeOrchestra(parseSettings({ provider: 'ollama', orchestra: { enabled: false, brain: 'qwen2.5:7b' } })),
    ).toBeNull();
    expect(
      activeOrchestra(parseSettings({ provider: 'openai', orchestra: { enabled: true, brain: 'qwen2.5:7b' } })),
    ).toBeNull();
    const on = parseSettings({
      provider: 'ollama',
      orchestra: { enabled: true, brain: 'qwen2.5:7b', teams: { code: { model: 'qwen2.5-coder:7b', place: 'processeur' } } },
    });
    expect(activeOrchestra(on)).toEqual({
      brain: 'qwen2.5:7b',
      teams: { code: { model: 'qwen2.5-coder:7b', place: 'processeur' } },
    });
  });

  it('une équipe inconnue dans settings.json n’efface pas le reste des réglages', () => {
    const settings = parseSettings({ provider: 'ollama', model: 'qwen2.5:3b', orchestra: { enabled: true, brain: 'x', teams: { pirate: {} } } });
    expect(settings.model).toBe('qwen2.5:3b');
  });
});

describe('chef d’orchestre — heure et date sans modèle', () => {
  const now = new Date('2026-10-30T07:05:00Z');
  it('répond depuis l’horloge', () => {
    expect(clockReply('Quelle heure est-il ?', now, 'Europe/Paris')).toBe('Il est 08 h 05.');
    expect(clockReply('Jarvis, il est quelle heure', now, 'Europe/Paris')).toBe('Il est 08 h 05.');
    expect(clockReply('On est quel jour ?', now, 'Europe/Paris')).toBe('Nous sommes le vendredi 30 octobre 2026.');
  });
  it('laisse passer toute autre phrase', () => {
    expect(clockReply('Quelle heure est-il à Tokyo ?', now)).toBeNull();
    expect(clockReply('Rappelle-moi l’heure du rendez-vous', now)).toBeNull();
    expect(clockReply('Quel jour est le match ?', now)).toBeNull();
  });
});
