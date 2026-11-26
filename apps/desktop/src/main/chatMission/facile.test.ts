import { describe, expect, it, vi } from 'vitest';
import {
  FACILE_DEFAULT_ANSWER,
  InMemoryConversationStore,
  newConversation,
  createMessage,
  detectCreationRequest,
  type FacileHit,
  type FacilePayload,
  type MissionState,
  type MissionStep,
} from '@jarvis/core';
import type { ChatEvent } from '../../shared/ipc.js';
import type { DeveloperState } from '../../shared/developerIpc.js';
import type { DeveloperController } from '../developer/controller.js';
import { FacileCoordinator } from './facile.js';

/**
 * Développeur facile : la création racontée dans la discussion. Le moteur est remplacé par un
 * faux qui rend les états qu'on lui donne ; la recherche par de faux résultats. Phrases inventées.
 */
const REQUEST = detectCreationRequest('Fais-moi une petite appli pour noter mes heures de chantier')!;

const step = (id: string, status: MissionStep['status'], extra: Partial<MissionStep> = {}): MissionStep => ({
  id,
  actor: 'JARVIS',
  label: id,
  status,
  ...extra,
});

function mission(patch: Partial<MissionState> = {}): MissionState {
  return {
    id: 'm1',
    projectId: 'nouveau',
    kind: 'new-project',
    request: REQUEST.objectif,
    skipQuestions: true,
    status: 'running',
    goal: null,
    answers: [],
    steps: [],
    taskId: null,
    verdict: null,
    summary: null,
    createdAt: 1_000,
    updatedAt: 1_000,
    ...patch,
  } as MissionState;
}

const stateOf = (value: MissionState | null, notice?: string): DeveloperState =>
  ({ mission: value, projects: [], notice: notice ?? null }) as unknown as DeveloperState;

async function setup(options: {
  search?: (query: string) => Promise<FacileHit[] | null>;
  start?: () => Promise<DeveloperState>;
  timeoutMs?: number;
  voice?: boolean;
  openCreatedApp?: (projectId: string) => Promise<{ ok: boolean; message: string }>;
}) {
  const store = new InMemoryConversationStore();
  const events: ChatEvent[] = [];
  const answered: string[][] = [];
  const opened: string[] = [];
  const cancel = vi.fn();
  const refused: string[] = [];
  const startMission = vi.fn(options.start ?? (async () => stateOf(mission())));
  const developer = {
    startMission,
    answerMission: async (answers: string[]) => {
      answered.push(answers);
      return stateOf(mission());
    },
    cancel,
    openCreatedApp: vi.fn(options.openCreatedApp ?? (async () => ({ ok: true, message: 'ouverte' }))),
    respondConfirmation: (requestId: string, approved: boolean) => {
      if (!approved) refused.push(requestId);
    },
  } as unknown as DeveloperController;
  const queries: string[] = [];
  const coordinator = new FacileCoordinator({
    developer: () => developer,
    search: async (query) => {
      queries.push(query);
      return options.search ? options.search(query) : [];
    },
    store,
    pushEvent: (event) => events.push(event),
    openExternal: async (url) => {
      opened.push(url);
    },
    now: () => 1_000,
    questionTimeoutMs: options.timeoutMs ?? 60_000,
  });
  const payload = coordinator.prepare(REQUEST, options.voice ?? false);
  const card = createMessage('assistant', '', { chatMission: { kind: 'facile', data: payload } });
  const conversation = newConversation([createMessage('user', 'demande'), card]);
  await store.save(conversation);
  coordinator.start(conversation.id, card.id, payload, REQUEST);
  const flush = async (): Promise<void> => {
    for (let i = 0; i < 5; i += 1) {
      await new Promise((resolve) => setTimeout(resolve, 0));
      await coordinator.settled();
    }
  };
  await flush();
  const saved = async (): Promise<FacilePayload> => {
    const current = await store.get(conversation.id);
    const envelope = current?.messages.find((message) => message.id === card.id)?.chatMission;
    if (envelope?.kind !== 'facile') throw new Error('carte absente');
    return envelope.data;
  };
  return { coordinator, events, saved, flush, startMission, answered, opened, cancel, refused, queries, payload, developer };
}

describe('Développeur facile : démarrage', () => {
  it('lance tout de suite la mission « nouveau projet » du moteur, sans questionnaire', async () => {
    const run = await setup({});
    expect(run.startMission).toHaveBeenCalledTimes(1);
    // Appel entier : un quatrième argument (un identifiant de projet) ferait refuser le moteur.
    expect(run.startMission.mock.calls[0]).toEqual(['new-project', REQUEST.objectif, true]);
    expect(run.payload.restatement).toBe('Si j’ai bien compris : une petite appli pour noter mes heures de chantier.');
    expect(run.coordinator.busy()).toBe(true);
  });

  it('le moteur refuse de démarrer : la carte le dit, rien ne tourne', async () => {
    const run = await setup({ start: async () => stateOf(null, 'Aucun modèle de code choisi.') });
    const card = await run.saved();
    expect(card.status).toBe('rate');
    expect(card.result).toBe('Aucun modèle de code choisi.');
    expect(run.coordinator.busy()).toBe(false);
  });
});

describe('Développeur facile : ce qui existe déjà', () => {
  it('montre de vrais résultats, et rien d’autre', async () => {
    const run = await setup({
      search: async (query) =>
        query.endsWith('gratuit')
          ? [{ title: 'Heures Pro', url: 'https://heurespro.example/', snippet: 'Suivez vos heures de chantier. Gratuit.' }]
          : [{ title: 'Chrono Chantier', url: 'https://github.com/exemple/chrono', snippet: '' }],
    });
    const card = await run.saved();
    expect(run.queries).toEqual([
      'appli pour noter mes heures de chantier gratuit',
      'appli pour noter mes heures de chantier open source',
    ]);
    expect(card.findings.state).toBe('trouve');
    expect(card.findings.existing.map((item) => item.url)).toEqual([
      'https://heurespro.example/',
      'https://github.com/exemple/chrono',
    ]);
    expect(card.findings.method).not.toMatch(/gabarit/i);
  });

  it('rien trouvé : la carte le dit, la construction continue', async () => {
    const run = await setup({ search: async () => [] });
    const card = await run.saved();
    expect(card.findings.state).toBe('rien');
    expect(card.findings.existing).toEqual([]);
    expect(card.status).toBe('travaille');
  });

  it('Internet coupé : la carte le dit, la construction continue', async () => {
    const run = await setup({ search: async () => null });
    const card = await run.saved();
    expect(card.findings.state).toBe('coupe');
    expect(card.status).toBe('travaille');
    expect(run.startMission).toHaveBeenCalledTimes(1);
  });

  it('« Montre-moi celle qui existe » ouvre le premier lien trouvé et arrête la construction', async () => {
    const run = await setup({
      search: async () => [{ title: 'Heures Pro', url: 'https://heurespro.example/', snippet: '' }],
    });
    await run.coordinator.choose('voir');
    await run.flush();
    const card = await run.saved();
    expect(run.opened).toEqual(['https://heurespro.example/']);
    expect(run.cancel).toHaveBeenCalledTimes(1);
    expect(card.status).toBe('arrete');
    expect(card.findings.choice).toBe('voir');
  });

  it('après un arrêt, la carte du moteur est refusée et l’arrêt redemandé jusqu’à la vraie fin', async () => {
    const run = await setup({});
    await run.coordinator.choose('changer');
    expect(run.cancel).toHaveBeenCalledTimes(1);
    // Le moteur, mal arrêté, demande sa carte « Créer le projet » : personne ne la voit.
    await run.coordinator.onDeveloperState({
      ...stateOf(mission()),
      confirmation: { requestId: 'c1' },
    } as unknown as DeveloperState);
    expect(run.refused).toEqual(['c1']);
    // Toujours en cours, sans carte : l'arrêt est redemandé.
    await run.coordinator.onDeveloperState(stateOf(mission()));
    expect(run.cancel).toHaveBeenCalledTimes(2);
    // Mission vraiment finie : plus rien n'est refusé ni arrêté, même pour une autre mission.
    await run.coordinator.onDeveloperState(stateOf(mission({ status: 'cancelled' })));
    await run.coordinator.onDeveloperState({
      ...stateOf(mission({ id: 'm2' })),
      confirmation: { requestId: 'c2' },
    } as unknown as DeveloperState);
    expect(run.refused).toEqual(['c1']);
    expect(run.cancel).toHaveBeenCalledTimes(2);
  });

  it('« Construis-la quand même » ne change rien au travail', async () => {
    const run = await setup({});
    await run.coordinator.choose('construire');
    await run.flush();
    const card = await run.saved();
    expect(run.cancel).not.toHaveBeenCalled();
    expect(card.status).toBe('travaille');
    expect(card.findings.choice).toBe('construire');
  });
});

describe('Développeur facile : lignes de travail', () => {
  it('chaque ligne vient d’une étape réelle du moteur ; une étape pas commencée n’a pas de ligne', async () => {
    const run = await setup({});
    await run.coordinator.onDeveloperState(
      stateOf(
        mission({
          steps: [
            step('supervisor', 'done'),
            step('scaffold', 'done', { detail: 'C:\\dev\\Projets\\heures-chantier' }),
            step('design', 'running', { startedAt: 900 }),
            step('create', 'pending'),
          ],
        }),
      ),
    );
    await run.flush();
    const card = await run.saved();
    expect(card.lines.map((line) => line.id)).toEqual(['supervisor', 'scaffold', 'design']);
    expect(card.lines.at(-1)?.text).toBe('Je choisis la base qui convient…');
    expect(card.folder).toBe('C:\\dev\\Projets\\heures-chantier');
    expect(card.missionId).toBe('m1');
    expect(JSON.stringify(card.lines)).not.toMatch(/pose la base/);
  });

  it('les fichiers apparaissent quand le moteur les a écrits', async () => {
    const run = await setup({});
    await run.coordinator.onDeveloperState(
      stateOf(mission({ status: 'task', steps: [step('edit-1', 'done', { files: ['src/main.ts', 'src/heures.ts'] })] })),
    );
    await run.flush();
    const card = await run.saved();
    expect(card.files).toEqual(['src/main.ts', 'src/heures.ts']);
    expect(card.lines[0]?.text).toBe('J’ai écrit 2 fichiers.');
  });

  it('ignore une autre mission que la sienne', async () => {
    const run = await setup({});
    await run.coordinator.onDeveloperState(stateOf(mission({ id: 'autre', steps: [step('edit-1', 'done', { files: ['x.ts'] })] })));
    await run.flush();
    expect((await run.saved()).files).toEqual([]);
  });

  it('« prêt » seulement quand le moteur a réussi', async () => {
    const run = await setup({});
    await run.coordinator.onDeveloperState(
      stateOf(mission({ status: 'finished', verdict: 'success', steps: [step('scaffold', 'done', { detail: 'C:\\p\\heures' })] })),
    );
    await run.flush();
    const card = await run.saved();
    expect(card.status).toBe('pret');
    expect(card.result).toBe('C’est prêt. Tout est dans le dossier du projet.');
    expect(run.coordinator.busy()).toBe(false);
  });

  it('un échec du moteur est dit comme un échec', async () => {
    const run = await setup({});
    await run.coordinator.onDeveloperState(stateOf(mission({ status: 'failed', verdict: 'failed' })));
    await run.flush();
    const card = await run.saved();
    expect(card.status).toBe('rate');
    expect(card.result).toMatch(/pas réussi/);
  });
});

describe('Développeur facile : questions une à la fois', () => {
  const waiting = (): MissionState =>
    mission({
      status: 'waiting-answers',
      goal: { questions: ['Fond clair ou sombre ?', 'Une ou plusieurs personnes ?'] } as MissionState['goal'],
    });

  it('pose une seule question, puis la suivante, et rend toutes les réponses au moteur', async () => {
    const run = await setup({});
    await run.coordinator.onDeveloperState(stateOf(waiting()));
    await run.flush();
    let card = await run.saved();
    expect(card.status).toBe('question');
    expect(card.question).toMatchObject({ text: 'Fond clair ou sombre ?', index: 1, total: 2, defaut: FACILE_DEFAULT_ANSWER });
    run.coordinator.answer('Sombre');
    await run.flush();
    card = await run.saved();
    expect(card.question?.text).toBe('Une ou plusieurs personnes ?');
    expect(run.answered).toEqual([]);
    run.coordinator.answer('Juste moi');
    await run.flush();
    card = await run.saved();
    expect(card.question).toBeNull();
    expect(card.status).toBe('travaille');
    expect(run.answered).toEqual([['Sombre', 'Juste moi']]);
  });

  it('sans réponse après le délai : la réponse par défaut, dite sur la carte, et le travail continue', async () => {
    const run = await setup({ timeoutMs: 200 });
    await run.coordinator.onDeveloperState(
      stateOf(mission({ status: 'waiting-answers', goal: { questions: ['Fond clair ou sombre ?'] } as MissionState['goal'] })),
    );
    await run.flush();
    expect((await run.saved()).status).toBe('question');
    await new Promise((resolve) => setTimeout(resolve, 400));
    await run.flush();
    const card = await run.saved();
    expect(card.answers).toEqual([{ question: 'Fond clair ou sombre ?', answer: FACILE_DEFAULT_ANSWER, parDefaut: true }]);
    expect(card.status).toBe('travaille');
    expect(run.answered).toEqual([[FACILE_DEFAULT_ANSWER]]);
    run.coordinator.dispose();
  });
});

describe('Développeur facile : voix', () => {
  it('demande venue de la voix : seuls les moments importants portent une phrase à dire', async () => {
    const run = await setup({
      voice: true,
      search: async () => [{ title: 'Heures Pro', url: 'https://heurespro.example/', snippet: '' }],
    });
    await run.coordinator.onDeveloperState(stateOf(mission({ steps: [step('design', 'running')] })));
    await run.coordinator.onDeveloperState(stateOf(mission({ status: 'finished', verdict: 'success' })));
    await run.flush();
    const spoken = run.events
      .filter((event): event is Extract<ChatEvent, { type: 'mission_update' }> => event.type === 'mission_update')
      .map((event) => event.voiceHint)
      .filter(Boolean);
    expect(spoken).toHaveLength(2);
    expect(spoken[0]).toMatch(/une application qui fait presque ça/);
    expect(spoken[1]).toBe('C’est prêt.');
  });

  it('demande tapée : rien n’est dit', async () => {
    const run = await setup({ search: async () => [{ title: 'Heures Pro', url: 'https://heurespro.example/', snippet: '' }] });
    await run.coordinator.onDeveloperState(stateOf(mission({ status: 'finished', verdict: 'success' })));
    await run.flush();
    const spoken = run.events.filter((event) => event.type === 'mission_update' && event.voiceHint);
    expect(spoken).toEqual([]);
  });
});

describe('Développeur facile, étape 2 : « Ouvrir l’appli »', () => {
  const pret = (template: string) =>
    ({
      mission: mission({
        projectId: 'heures-chantier',
        status: 'finished',
        verdict: 'success',
        steps: [step('scaffold', 'done', { detail: 'C:\\Projets\\heures-chantier' })],
      }),
      projects: [{ id: 'heures-chantier', template }],
      notice: null,
    }) as unknown as DeveloperState;

  it('« C’est prêt » dit comment s’en servir, et le bouton ouvre l’appli', async () => {
    const run = await setup({});
    await run.coordinator.onDeveloperState(pret('vite-react'));
    await run.flush();
    let card = await run.saved();
    expect(card.status).toBe('pret');
    expect(card.template).toBe('vite-react');
    expect(card.result).toBe('C’est prêt. Clique sur « Ouvrir l’appli » pour l’essayer : je la prépare et je l’ouvre dans une fenêtre.');
    await run.coordinator.openApp();
    await run.flush();
    const open = (run.developer as unknown as { openCreatedApp: ReturnType<typeof vi.fn> }).openCreatedApp;
    expect(open.mock.calls).toEqual([['heures-chantier']]);
    card = await run.saved();
    expect(card.ouverture).toEqual({ etat: 'ouverte', message: 'Elle est ouverte dans une fenêtre à côté.' });
  });

  it('préparation ratée : la raison est dite, rien n’est prétendu', async () => {
    const run = await setup({ openCreatedApp: async () => ({ ok: false, message: 'Je n’ai pas réussi à la préparer : npm run build a échoué.' }) });
    await run.coordinator.onDeveloperState(pret('vite-react'));
    await run.flush();
    await run.coordinator.openApp();
    await run.flush();
    expect((await run.saved()).ouverture).toEqual({ etat: 'ratee', message: 'Je n’ai pas réussi à la préparer : npm run build a échoué.' });
  });

  it('un programme à commande n’a pas de bouton : la fin dit où est le mode d’emploi', async () => {
    const run = await setup({});
    await run.coordinator.onDeveloperState(pret('node-cli'));
    await run.flush();
    const card = await run.saved();
    expect(card.result).toMatch(/se lance en tapant une commande/);
    await run.coordinator.openApp();
    await run.flush();
    const open = (run.developer as unknown as { openCreatedApp: ReturnType<typeof vi.fn> }).openCreatedApp;
    expect(open.mock.calls).toEqual([]);
  });

  it('rien ne s’ouvre avant que ce soit prêt', async () => {
    const run = await setup({});
    await run.coordinator.openApp();
    await run.flush();
    const open = (run.developer as unknown as { openCreatedApp: ReturnType<typeof vi.fn> }).openCreatedApp;
    expect(open.mock.calls).toEqual([]);
  });
});
