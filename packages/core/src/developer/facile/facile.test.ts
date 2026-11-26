import { describe, expect, it } from 'vitest';
import {
  FACILE_DEFAULT_ANSWER,
  buildingSentence,
  creationSearchQueries,
  detectCreationRequest,
  facileCanOpen,
  facileFiles,
  facileFolder,
  facileLines,
  facileRestatement,
  facileResult,
  facileVoiceMoment,
  newFacilePayload,
  nextFacileQuestion,
  pickExistingApps,
  simpleWords,
  type FacilePayload,
} from './facile.js';
import type { MissionStep } from '../engine/mission.js';
import { fallbackFactory, projectNameFromRequest, steerFactory } from '../engine/fallbacks.js';
import { TEST_EDITION, LIVE_EDITION } from '../../edition.js';
import { chatMissionsEnabled } from '../chatMissionsSettings.js';
import { parseSettings } from '../../settings.js';

/** Phrases écrites pour les essais : aucune ne vient d'une conversation. */
describe('demande de création, vue par règles', () => {
  it('prend une demande d’application, de programme, de jeu ou de site', () => {
    const pour = [
      'Fais-moi une petite appli pour noter mes heures de chantier',
      'Jarvis, crée-moi un jeu de course de voitures',
      'Crée un site web pour mon club de pétanque.',
      'Tu peux me faire une application qui compte mes pas ?',
      'J’aimerais un petit programme qui renomme mes photos',
      'Il me faudrait une calculatrice pour mes devis',
      'Développe un outil pour suivre mes dépenses',
      'Peux-tu me fabriquer un jeu vidéo de plateformes ?',
    ];
    for (const phrase of pour) expect(detectCreationRequest(phrase), phrase).not.toBeNull();
    const request = detectCreationRequest('Jarvis, fais-moi une petite appli pour noter mes heures de chantier.');
    expect(request?.sujet).toBe('une petite appli pour noter mes heures de chantier');
    expect(request?.objectif).not.toMatch(/^Jarvis/i);
  });

  it('sans trait d’union, comme on le tape ou le dicte : « fais moi une appli »', () => {
    for (const phrase of [
      'fais moi une appli de suivi de commandes',
      'crée moi un programme qui range mes photos par date',
      'fabrique nous un convertisseur de millimètres en pouces',
    ]) {
      expect(detectCreationRequest(phrase), phrase).not.toBeNull();
    }
    expect(detectCreationRequest('fais moi un minuteur de 10 minutes')).toBeNull();
  });

  it('laisse passer tout le reste', () => {
    const contre = [
      'Comment créer une application sur Windows ?',
      'Explique-moi ce que fait une boucle for en JavaScript',
      'Fais-moi une image d’un jeu de société',
      'Fais-moi un programme de musculation pour la semaine',
      'Ouvre le programme de montage vidéo',
      'Fais-moi un jeu de mots sur les chats',
      'Crée une playlist pour ce soir',
      'Fais une note : acheter des piles',
      'Tu connais une appli pour noter mes heures ?',
      'Quelle application est ouverte ?',
      'Fais-moi un café',
      'Crée un jeu',
    ];
    for (const phrase of contre) expect(detectCreationRequest(phrase), phrase).toBeNull();
  });

  it('reformule avec les mots de la demande, sans modèle', () => {
    expect(facileRestatement('une petite appli pour noter mes heures de chantier.')).toBe(
      'Si j’ai bien compris : une petite appli pour noter mes heures de chantier.',
    );
  });
});

describe('ce qui existe déjà', () => {
  it('prépare deux recherches sur le sujet, sans l’article', () => {
    expect(creationSearchQueries('une petite appli pour noter mes heures de chantier')).toEqual([
      'appli pour noter mes heures de chantier gratuit',
      'appli pour noter mes heures de chantier open source',
    ]);
    expect(creationSearchQueries('   ')).toEqual([]);
  });

  it('ne garde que de vrais résultats, un par site, trois au plus', () => {
    const found = pickExistingApps([
      {
        title: 'Heures Pro',
        url: 'https://www.heurespro.example/app',
        snippet: 'Suivez vos heures de chantier depuis le téléphone. Gratuit pour un utilisateur.',
      },
      { title: 'Heures Pro, les tarifs', url: 'https://heurespro.example/tarifs', snippet: 'Tarifs.' },
      { title: '', url: 'https://sans-titre.example/' },
      { title: 'Pas un lien', url: 'javascript:alert(1)' },
      { title: 'Chrono Chantier', url: 'https://github.com/exemple/chrono-chantier' },
      { title: 'Pointage Libre', url: 'https://pointage.example/' },
      { title: 'Un quatrième', url: 'https://quatre.example/' },
    ]);
    expect(found.map((item) => item.site)).toEqual(['heurespro.example', 'github.com', 'pointage.example']);
    expect(found[0]?.phrase).toBe('Suivez vos heures de chantier depuis le téléphone.');
    expect(found[1]?.phrase).toBe('');
    expect(pickExistingApps([])).toEqual([]);
  });

  it('dit comment construire sans jargon', () => {
    for (const template of ['web-game', 'vite-react', 'node-cli', 'dotnet-winforms', null, 'inconnu']) {
      const text = buildingSentence(template);
      expect(text).not.toMatch(/gabarit|TypeScript|React|Node|npm|branche|diff/i);
      expect(text.length).toBeGreaterThan(30);
    }
  });
});

const step = (id: string, status: MissionStep['status'], extra: Partial<MissionStep> = {}): MissionStep => ({
  id,
  actor: 'JARVIS',
  label: `libellé technique de ${id}`,
  status,
  ...extra,
});

describe('lignes de travail', () => {
  it('une ligne par étape commencée, jamais pour une étape en attente ou sautée', () => {
    const lines = facileLines({
      steps: [
        step('supervisor', 'done', { startedAt: 1, finishedAt: 2 }),
        step('web-research', 'skipped'),
        step('scaffold', 'done', { detail: 'C:\\dev\\Projets\\heures-chantier' }),
        step('goal', 'done'),
        step('design', 'running', { startedAt: 5 }),
        step('create', 'pending'),
      ],
    });
    expect(lines.map((line) => line.id)).toEqual(['supervisor', 'scaffold', 'goal', 'design']);
    expect(lines.at(-1)).toMatchObject({ state: 'en-cours', text: 'Je choisis la base qui convient…', startedAt: 5 });
    expect(lines[0]).toMatchObject({ state: 'fait', finishedAt: 2 });
  });

  it('raconte la boucle : écrire, tester, corriger, avec le nombre de fichiers', () => {
    const lines = facileLines({
      steps: [
        step('plan-1', 'done'),
        step('edit-1', 'done', { files: ['src/main.ts', 'src/heures.ts'] }),
        step('test-1', 'failed'),
        step('diagnose-1', 'done'),
        step('fix-1', 'done', { files: ['src/heures.ts'] }),
        step('test-2', 'running'),
        step('etape-inconnue', 'running'),
      ],
    });
    expect(lines.map((line) => line.text)).toEqual([
      'Je sais quels fichiers toucher.',
      'J’ai écrit 2 fichiers.',
      'Un essai ne marche pas, je regarde pourquoi.',
      'J’ai trouvé ce qui ne va pas.',
      'J’ai corrigé un fichier.',
      'Je teste…',
    ]);
    expect(lines[2]?.state).toBe('rate');
  });

  it('aucune ligne ne porte un mot de développeur', () => {
    const ids = [
      'supervisor',
      'web-research',
      'scaffold',
      'goal',
      'design',
      'create',
      'plan-1',
      'edit-1',
      'test-1',
      'review-1',
      'diagnose-1',
      'fix-1',
    ];
    for (const status of ['running', 'done', 'failed'] as const) {
      for (const line of facileLines({ steps: ids.map((id) => step(id, status)) })) {
        expect(line.text, `${line.id} ${status}`).not.toMatch(
          /branche|diff|plan valid|crit[èe]re|copie isol|gabarit|commit|worktree/i,
        );
      }
    }
  });

  it('liste les fichiers sans doublon et lit le dossier du projet', () => {
    const mission = {
      steps: [
        step('scaffold', 'done', { detail: 'déjà là C:\\dev\\Projets\\heures' }),
        step('edit-1', 'done', { files: ['src/a.ts', 'src/b.ts'] }),
        step('fix-1', 'done', { files: ['src/b.ts', 'src/c.ts'] }),
      ],
    };
    expect(facileFiles(mission)).toEqual(['src/a.ts', 'src/b.ts', 'src/c.ts']);
    expect(facileFolder(mission)).toBe('C:\\dev\\Projets\\heures');
    expect(facileFolder({ steps: [step('scaffold', 'running', { detail: 'dossier du projet' })] })).toBeNull();
  });

  it('remplace les mots de développeur dans un texte du moteur', () => {
    expect(simpleWords('Voir le diff')).toBe('Voir le ce qui a changé');
    expect(simpleWords('dans la copie isolée')).toBe('dans la dossier de travail');
    expect(simpleWords('le gabarit')).toBe('le base');
  });
});

describe('questions une à la fois', () => {
  it('pose la première sans réponse, avec une réponse par défaut', () => {
    const questions = ['Fond clair ou sombre ?', 'Une ou plusieurs personnes ?'];
    const first = nextFacileQuestion(questions, [], 100);
    expect(first).toEqual({
      text: 'Fond clair ou sombre ?',
      defaut: FACILE_DEFAULT_ANSWER,
      askedAt: 100,
      index: 1,
      total: 2,
    });
    const one = { question: 'Fond clair ou sombre ?', answer: 'Sombre', parDefaut: false };
    const second = nextFacileQuestion(questions, [one], 200);
    expect(second?.text).toBe('Une ou plusieurs personnes ?');
    expect(second?.index).toBe(2);
    const two = { question: 'Une ou plusieurs personnes ?', answer: FACILE_DEFAULT_ANSWER, parDefaut: true };
    expect(nextFacileQuestion(questions, [one, two], 300)).toBeNull();
  });
});

describe('lignes : ce que l’essai réel du 20 novembre a montré', () => {
  it('une série d’essais rouge n’est jamais racontée « Les essais marchent »', () => {
    const lines = facileLines({
      steps: [
        step('plan-1', 'done'),
        step('test-1', 'done', { detail: 'typecheck : réussi · test : 2 tests réussis' }),
        step('edit-1', 'done', { files: ['src/main.ts', 'src/main.test.ts'] }),
        step('test-2', 'done', { detail: 'typecheck : 15 erreur(s) TypeScript · test : échec (7 échec(s) au total)' }),
        step('diagnose-1', 'done'),
        step('fix-1', 'done', { files: ['src/main.ts'] }),
        step('test-3', 'done', { detail: 'typecheck : réussi · test : 8 tests réussis' }),
      ],
    });
    expect(lines.map((line) => `${line.state} ${line.text}`)).toEqual([
      'fait Je sais quels fichiers toucher.',
      'fait La base marche, je peux commencer.',
      'fait J’ai écrit 2 fichiers.',
      'rate Un essai ne marche pas, je regarde pourquoi.',
      'fait J’ai trouvé ce qui ne va pas.',
      'fait J’ai corrigé un fichier.',
      'fait Les essais marchent.',
    ]);
  });

  it('la série d’avant l’écriture parle de la base, en cours comme en échec', () => {
    expect(facileLines({ steps: [step('test-1', 'running')] })[0]?.text).toBe('Je vérifie que la base marche…');
    expect(
      facileLines({ steps: [step('test-1', 'done', { detail: 'typecheck : 1 erreur(s) TypeScript (1 échec(s) au total)' })] })[0],
    ).toMatchObject({ state: 'rate', text: 'La base a un souci avant même que j’y touche.' });
  });

  it('un échec ne dit pas que le travail est dans le dossier du projet', () => {
    const result = facileResult({ status: 'failed', verdict: 'failed', summary: null }, 'C:\\p');
    expect(result?.text).toBe(
      'Je n’ai pas réussi à finir. Le dossier du projet contient seulement la base : mon travail inachevé n’y a pas été copié.',
    );
  });
});

describe('fin et voix', () => {
  it('ne dit « prêt » que si le moteur a réussi', () => {
    expect(facileResult({ status: 'finished', verdict: 'success', summary: null }, 'C:\\p')).toMatchObject({
      status: 'pret',
      text: 'C’est prêt. Tout est dans le dossier du projet.',
    });
    expect(facileResult({ status: 'finished', verdict: null, summary: null }, 'C:\\p')?.text).toMatch(/pas pu relire/);
    expect(facileResult({ status: 'failed', verdict: 'failed', summary: null }, null)).toMatchObject({ status: 'rate' });
    expect(facileResult({ status: 'cancelled', verdict: 'stopped', summary: null }, null)).toMatchObject({
      status: 'arrete',
    });
    expect(facileResult({ status: 'task', verdict: null, summary: null }, null)).toBeNull();
  });

  const base = (voice: boolean): FacilePayload =>
    newFacilePayload({
      id: 'f1',
      request: { objectif: 'une appli', sujet: 'une appli pour noter mes heures' },
      now: 1,
      voice,
    });

  it('à la voix : seulement ce qui a été trouvé, une question, la fin', () => {
    const start = base(true);
    const lines = { ...start, lines: [{ id: 'goal', text: 'Je relis ta demande…', state: 'en-cours' as const }] };
    expect(facileVoiceMoment(start, lines)).toBeNull();
    const found = {
      ...start,
      findings: {
        ...start.findings,
        state: 'trouve' as const,
        existing: [{ name: 'A', phrase: '', url: 'https://a.example', site: 'a.example' }],
      },
    };
    expect(facileVoiceMoment(start, found)).toMatch(/une application qui fait presque ça/);
    const asked = { ...start, question: { text: 'Fond clair ou sombre ?', defaut: 'x', askedAt: 2, index: 1, total: 1 } };
    expect(facileVoiceMoment(start, asked)).toBe('Fond clair ou sombre ?');
    expect(facileVoiceMoment(asked, asked)).toBeNull();
    expect(facileVoiceMoment(start, { ...start, result: 'C’est prêt.' })).toBe('C’est prêt.');
  });

  it('au clavier : rien n’est dit', () => {
    const start = base(false);
    expect(facileVoiceMoment(start, { ...start, result: 'C’est prêt.' })).toBeNull();
  });
});

describe('réservé à Jarvis Test', () => {
  it('la table d’édition porte le réglage pour Test seulement', () => {
    expect(TEST_EDITION.easyDeveloper).toBe(true);
    expect(LIVE_EDITION.easyDeveloper).toBeUndefined();
  });

  it('dans Test, la discussion qui fait tout est active dès que le mode Développeur l’est', () => {
    const settings = parseSettings({
      provider: 'ollama',
      orchestra: { enabled: true, brain: 'qwen2.5:7b' },
      developer: { enabled: true },
    });
    expect(chatMissionsEnabled(settings)).toBe(false);
    expect(chatMissionsEnabled(settings, { easyDeveloper: true })).toBe(true);
    const coupe = parseSettings({ provider: 'ollama', orchestra: { enabled: true, brain: 'qwen2.5:7b' } });
    expect(chatMissionsEnabled(coupe, { easyDeveloper: true })).toBe(false);
  });
});

describe('étape 2 (essai réel du 20 novembre 2026)', () => {
  it('un petit outil nommé sans « appli » est une création, pas une durée', () => {
    expect(detectCreationRequest('Crée-moi un minuteur de pause café')?.sujet).toBe('un minuteur de pause café');
    expect(detectCreationRequest('Développe-moi un convertisseur de mètres en pieds')).not.toBeNull();
    expect(detectCreationRequest('Jarvis, crée-moi un petit chronomètre pour mes tours de vélo')).not.toBeNull();
    // Une durée : c'est un minuteur à lancer, pas une application.
    expect(detectCreationRequest('Crée-moi un minuteur de 5 minutes')).toBeNull();
    // « Fais-moi un minuteur » sans « appli » : le verbe ne dit pas « fabrique », c'est l'équipe PC.
    expect(detectCreationRequest('Fais-moi un minuteur pour le gâteau')).toBeNull();
    expect(detectCreationRequest('Comment créer un minuteur ?')).toBeNull();
  });

  it('« C’est prêt » dit comment s’en servir, selon la base', () => {
    const ok = { status: 'finished', verdict: 'success', summary: null } as const;
    expect(facileResult(ok, 'C:\\p', 'vite-react')?.text).toBe(
      'C’est prêt. Clique sur « Ouvrir l’appli » pour l’essayer : je la prépare et je l’ouvre dans une fenêtre.',
    );
    expect(facileResult(ok, 'C:\\p', 'node-cli')?.text).toMatch(/^C’est prêt\. C’est un petit programme qui se lance en tapant une commande/);
    expect(facileResult(ok, 'C:\\p', 'dotnet-winforms')?.text).toMatch(/application Windows/);
    // Base inconnue : la phrase d'avant.
    expect(facileResult(ok, 'C:\\p', null)?.text).toBe('C’est prêt. Tout est dans le dossier du projet.');
    expect(facileResult({ status: 'finished', verdict: null, summary: null }, 'C:\\p', 'vite-react')?.text).toMatch(/pas pu relire.*Ouvrir l’appli/);
    expect(facileCanOpen('vite-react')).toBe(true);
    expect(facileCanOpen('web-game')).toBe(true);
    expect(facileCanOpen('node-cli')).toBe(false);
    expect(facileCanOpen(null)).toBe(false);
  });

  it('« une appli » part d’une base avec écran, avec un nom lisible', () => {
    const cas: Array<[string, string, string]> = [
      ['Fais-moi une petite appli pour noter mes heures de chantier', 'vite-react', 'Heures chantier'],
      ['Crée-moi un petit programme pour compter mes heures de travail par chantier', 'vite-react', 'Heures travail chantier'],
      ['Fais-moi un petit programme qui additionne mes heures de chantier de la semaine', 'vite-react', 'Heures chantier semaine'],
      ['Crée-moi une appli de minuteur pour mes pauses', 'vite-react', 'Minuteur pauses'],
      ['Développe-moi un convertisseur de mètres en pieds', 'vite-react', 'Convertisseur mètres pieds'],
      ['Fais-moi un programme en ligne de commande qui trie mes photos', 'node-cli', 'Photos'],
      ['Crée une petite CLI qui renomme des photos', 'node-cli', 'CLI qui renomme'],
      ['Crée une appli Windows qui bloque des sites', 'dotnet-winforms', 'Windows qui bloque'],
    ];
    for (const [demande, base, nom] of cas) {
      expect(fallbackFactory(demande).template, demande).toBe(base);
      expect(projectNameFromRequest(demande), demande).toBe(nom);
    }
    // Le modèle qui choisit « programme à commande » pour une appli est ramené à la base avec écran.
    const choisi = { template: 'node-cli' as const, name: 'Heures', description: '' };
    expect(steerFactory('Fais-moi une petite appli pour noter mes heures de chantier', choisi).template).toBe('vite-react');
    expect(steerFactory('Crée une petite CLI qui renomme des photos', choisi).template).toBe('node-cli');
  });
});
