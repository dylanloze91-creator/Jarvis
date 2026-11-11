import { describe, expect, it } from 'vitest';
import { createMessage } from '../types.js';
import { parseSettings } from '../settings.js';
import { DEFAULT_SYSTEM_PROMPT } from './agent.js';
import {
  activeOrchestra,
  activeRouter,
  arithmeticExpression,
  availableTeams,
  clockLinePrompt,
  clockReply,
  evaluateArithmetic,
  expressTeam,
  isTeamCorrection,
  looksLikeExpressWeb,
  ORCHESTRA_BASE_PROMPT,
  ORCHESTRA_TEAMS,
  orchestraBasePrompt,
  orchestraProviderConfig,
  parseRouterReply,
  routerSystemPrompt,
  teamPrompt,
  routerUserPrompt,
  solveArithmetic,
  SUGGESTED_ORCHESTRA,
  teamAssignment,
  teamHasTool,
  teamMissedNotice,
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

  it('Yahoo, cherche, le web et Wikipédia partent vers Internet sans modèle', () => {
    expect(express('passe par Yahoo Finance')).toBe('web');
    expect(express('regarde sur Yahoo')).toBe('web');
    expect(express('cherche sur internet le prix du cuivre')).toBe('web');
    expect(express('sur le web')).toBe('web');
    expect(express('Wikipédia Nvidia')).toBe('web');
    expect(express('cherche sur Google le prix du cuivre')).toBe('web');
    expect(looksLikeExpressWeb('cherche sur Google')).toBe(true);
  });

  it('« Google » seul et « finance » ne vont pas à l’équipe Google', () => {
    expect(express('Google')).not.toBe('google');
    expect(express('finance')).not.toBe('google');
    expect(express('finance')).toBeNull();
    expect(express('lis mes mails')).toBe('google');
  });

  it('une correction sans règle le dit au cerveau ; « passe par » reste une règle', () => {
    expect(isTeamCorrection('non')).toBe(true);
    expect(isTeamCorrection("je t'ai dit le cours")).toBe(true);
    expect(isTeamCorrection('passe par Yahoo Finance')).toBe(true);
    expect(isTeamCorrection('pas Google')).toBe(true);
    expect(isTeamCorrection('bonjour')).toBe(false);
    const notice = teamMissedNotice('google');
    expect(notice).toBe("l'équipe google n'a pas su répondre au tour précédent");
    expect(routerUserPrompt('non', [], notice)).toBe(`${notice}\nDemande : non\nÉquipe :`);
    expect(express('passe par Yahoo Finance')).toBe('web');
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
    expect(activeRouter(parseSettings({}))).toBeNull();
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

  it('trieur : absent par défaut ; présent seulement si orchestre Ollama allumé', () => {
    expect(activeRouter(parseSettings({ provider: 'ollama', orchestra: { enabled: true, brain: 'qwen2.5:7b' } }))).toBeNull();
    expect(
      activeRouter(
        parseSettings({
          provider: 'ollama',
          orchestra: { enabled: true, brain: 'qwen2.5:7b', router: { model: 'jarvis-trieur', place: 'carte' } },
        }),
      ),
    ).toEqual({ model: 'jarvis-trieur', place: 'carte' });
  });

  it('validation en direct : champs facultatifs dans orchestra', () => {
    expect(parseSettings({}).orchestra).toBeUndefined();
    const on = parseSettings({
      provider: 'ollama',
      orchestra: {
        enabled: true,
        brain: 'qwen2.5:7b',
        trieurDataDir: 'C:\\dev\\jarvis-data\\trieur',
        teamValidation: true,
      },
    });
    expect(on.orchestra?.trieurDataDir).toContain('jarvis-data');
    expect(on.orchestra?.teamValidation).toBe(true);
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
  it('donne la date et l’heure du PC aux équipes, sans changer la consigne sans horloge', () => {
    const line = clockLinePrompt(now, 'Europe/Paris');
    expect(line).toBe(
      'Date et heure du PC : vendredi 30 octobre 2026, 08 h 05. Pour l’heure ou la date, c’est cette ligne, jamais une estimation.',
    );
    expect(teamPrompt('conversation')).not.toContain('Date et heure');
    expect(teamPrompt('conversation', null, line)).toBe(`${teamPrompt('conversation')}\n\n${line}`);
    expect(teamPrompt('pc', 'CARACTÈRE', line)).toBe(`${teamPrompt('pc')}\n\nCARACTÈRE\n\n${line}`);
  });

  it('laisse passer toute autre phrase', () => {
    // Fautes habituelles de Whisper : toujours l'horloge, jamais le modèle (qui invente l'heure).
    for (const q of [
      'Quel heure est-il?',
      "Qu'elle heure est-il ?",
      'Quelle heure est il',
      'Quelle heure est-t-il ?',
      'Quel heure il est',
      'Jarvis, il est quel heure ?',
      "T'as l'heure ?",
      'As-tu l’heure ?',
    ]) {
      expect(clockReply(q, now, 'Europe/Paris'), q).toBe('Il est 08 h 05.');
    }
    for (const q of [
      'Quel jour on est ?',
      'Quel jour on est aujourd’hui',
      'Quelle jour on est ?',
      'On est le combien ?',
      'Nous sommes quel jour ?',
      "C'est quel jour aujourd'hui ?",
      'Quel jour c’est ?',
      'Quelle date aujourd’hui ?',
      'Quel est la date ?',
    ]) {
      expect(clockReply(q, now, 'Europe/Paris'), q).toBe('Nous sommes le vendredi 30 octobre 2026.');
    }
    // Amorce ajoutée par Whisper, question répétée, politesse : toujours l'horloge.
    for (const q of [
      "Je t'ai demandé quelle heure est-il ?",
      'Tu peux me dire quelle heure il est ?',
      'Jarvis, s’il te plaît, quelle heure est-il ?',
      'Quelle heure est-il, s’il te plaît ?',
      'Quel heure est-il ? Quel heure est-il ?',
    ]) {
      expect(clockReply(q, now, 'Europe/Paris'), q).toBe('Il est 08 h 05.');
    }
    expect(clockReply('Quel jour on est? Quel jour on est?', now, 'Europe/Paris')).toBe('Nous sommes le vendredi 30 octobre 2026.');
    expect(clockReply("Je t'ai demandé quelle heure est le match ?", now)).toBeNull();
    expect(clockReply('Quelle heure est-il ? Et demain ?', now)).toBeNull();
    expect(clockReply('Quel heure est-il à Tokyo ?', now)).toBeNull();
    expect(clockReply('Quel jour on est parti ?', now)).toBeNull();
    expect(clockReply('Quelle heure est-il à Tokyo ?', now)).toBeNull();
    expect(clockReply('Rappelle-moi l’heure du rendez-vous', now)).toBeNull();
    expect(clockReply('Quel jour est le match ?', now)).toBeNull();
  });
});
