import { describe, expect, it, vi } from 'vitest';
import {
  InMemoryConversationStore,
  RenfortCapError,
  addRenfortSpend,
  createMessage,
  detectCreationRequest,
  emptyRenfortLedger,
  newConversation,
  renfortCaps,
  type ClaudeCaller,
  type FacileApp,
  type FacilePayload,
  type MissionState,
  type MissionStep,
  type RenfortLedger,
} from '@jarvis/core';
import type { ChatEvent } from '../../shared/ipc.js';
import type { DeveloperState } from '../../shared/developerIpc.js';
import type { DeveloperController } from '../developer/controller.js';
import { FacileCoordinator } from './facile.js';

/**
 * Développeur facile, étape 3 : le suivi du projet et « Claude en renfort ». Le moteur est un faux
 * qui rend les états qu'on lui donne ; Claude est un faux qui note ce qu'on lui envoie : **aucun
 * appel payant**. Phrases et clé inventées (`synthetique-test`).
 */
const REQUEST = detectCreationRequest('Fais-moi une appli de suivi de commandes pour mon atelier')!;
const NOW = Date.UTC(2026, 10, 27, 3, 0, 0);

const step = (id: string, status: MissionStep['status'], extra: Partial<MissionStep> = {}): MissionStep => ({ id, actor: 'JARVIS', label: id, status, ...extra });

function mission(patch: Partial<MissionState> = {}): MissionState {
  return {
    id: 'm1',
    projectId: 'suivi-commandes',
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
    createdAt: NOW,
    updatedAt: NOW,
    ...patch,
  } as MissionState;
}

const PROJET = { id: 'suivi-commandes', name: 'Suivi commandes', template: 'vite-react' };
const stateOf = (value: MissionState | null, codeTask?: unknown): DeveloperState => ({ mission: value, projects: [PROJET], notice: null, codeTask: codeTask ?? null }) as unknown as DeveloperState;

const ECRITS = [step('goal', 'done'), step('create', 'done'), step('scaffold', 'done', { detail: 'C:\\dev\\Projets\\suivi-commandes' }), step('plan', 'done'), step('edit', 'done', { files: ['src/App.tsx', 'src/commandes.ts'] })];
const RATEE = mission({ status: 'failed', verdict: 'failed', steps: [...ECRITS, step('test', 'done', { detail: 'npm test (2 échec(s) au total)' }), step('fix', 'failed', { error: 'mêmes échecs' })] });
const ARRET_NET = { repeatedFailure: { attempt: 2, failures: ['src/commandes.test.ts : attendu 2, reçu 0'], unused: 1 }, failureReason: 'La correction a reproduit les mêmes échecs.' };

async function setup(options: { renfort?: { enabled?: boolean; apiKey?: string; ledger?: RenfortLedger } | null } = {}) {
  const store = new InMemoryConversationStore();
  const events: ChatEvent[] = [];
  let apps: FacileApp[] = [];
  let ledger = options.renfort?.ledger ?? emptyRenfortLedger();
  const envoyes: Parameters<ClaudeCaller>[0][] = [];
  const cles: string[] = [];
  const setMissionWriter = vi.fn();
  const startMission = vi.fn(async (kind: string) => stateOf(mission(kind === 'modify' ? { id: 'm2', kind: 'modify', createdAt: NOW + 1 } : {})));
  const developer = {
    startMission,
    setMissionWriter,
    answerMission: async () => stateOf(mission()),
    cancel: vi.fn(),
    respondConfirmation: vi.fn(),
    openCreatedApp: async () => ({ ok: true, message: '' }),
  } as unknown as DeveloperController;
  const coordinator = new FacileCoordinator({
    developer: () => developer,
    search: async () => [],
    store,
    pushEvent: (event) => events.push(event),
    openExternal: async () => undefined,
    now: () => NOW,
    apps: { read: async () => apps, write: async (next) => void (apps = next) },
    ...(options.renfort === null
      ? {}
      : {
          renfort: {
            settings: () => ({ enabled: options.renfort?.enabled ?? true, apiKey: options.renfort?.apiKey ?? 'synthetique-test-cle', caps: renfortCaps() }),
            ledger: { read: async () => ledger, write: async (next) => void (ledger = next) },
            caller: (apiKey) => {
              cles.push(apiKey);
              return async (input) => {
                envoyes.push(input);
                return { text: '```ts\nexport const commandes = [1, 2];\n```', usage: { inputTokens: 3_000, outputTokens: 1_000 }, stopReason: 'end_turn', model: input.model };
              };
            },
            readFiles: async (_folder, paths) => paths.map((path) => ({ path, content: `// ${path}\nexport const x = 1;\n` })),
          },
        }),
  });
  const conversation = newConversation();
  const payload = coordinator.prepare(REQUEST, false);
  const card = createMessage('assistant', '', { chatMission: { kind: 'facile', data: payload } });
  await store.save({ ...conversation, messages: [card] });
  coordinator.start(conversation.id, card.id, payload, REQUEST);
  await coordinator.settled();
  const current = () => coordinator.current() as FacilePayload;
  const settle = async () => {
    await new Promise((r) => setTimeout(r, 0));
    await coordinator.settled();
  };
  return { coordinator, payload, current, settle, startMission, setMissionWriter, envoyes, cles, apps: () => apps, ledger: () => ledger, events };
}

describe('Développeur facile, étape 3 : suivre son projet', () => {
  it('le plan est visible dès le début, puis coché d’après les étapes réelles ; la fiche de l’appli suit', async () => {
    const t = await setup();
    expect(t.payload.plan?.map((s) => s.etat)).toEqual(['a-faire', 'a-faire', 'a-faire', 'a-faire', 'a-faire', 'a-faire']);
    await t.coordinator.onDeveloperState(stateOf(mission({ status: 'task', steps: [...ECRITS.slice(0, 4), step('edit', 'running')] })));
    await t.settle();
    expect(t.current().plan?.map((s) => s.etat)).toEqual(['fait', 'fait', 'fait', 'en-cours', 'a-faire', 'a-faire']);
    expect(t.current().nom).toBe('Suivi commandes');
    expect(t.apps()[0]).toMatchObject({ nom: 'Suivi commandes', status: 'travaille', etape: 'Écrire les fichiers', faites: 3, etapes: 6, projectId: 'suivi-commandes' });
  });

  it('« où en est mon appli ? » : l’état réel, en trois phrases ; une seule à l’enceinte', async () => {
    const t = await setup();
    await t.coordinator.onDeveloperState(stateOf(mission({ status: 'task', steps: [...ECRITS.slice(0, 4), step('edit', 'running')] })));
    const fenetre = await t.coordinator.suivi('Où en est mon appli ?', { voice: false, speaker: false });
    expect(fenetre?.text).toBe('Je construis « Suivi commandes » : j’en suis à « Écrire les fichiers » (j’écris les fichiers). 3 étapes sur 6 sont faites. Il reste : tester et corriger, relire mon travail.');
    const enceinte = await t.coordinator.suivi('t’en es où ?', { voice: true, speaker: true });
    expect(enceinte?.text).toBe('Je construis « Suivi commandes » : j’en suis à « Écrire les fichiers » (j’écris les fichiers). Le détail est sur le PC.');
    // Une autre phrase n'est pas pour le suivi.
    expect(await t.coordinator.suivi('quelle heure est-il ?', { voice: false, speaker: false })).toBeNull();
    expect(await t.coordinator.suivi('elle en est où, l’image ?', { voice: false, speaker: false })).toBeNull();
  });

  it('« mes applis » : la phrase, et la carte avec « Ouvrir l’appli » pour une appli prête', async () => {
    const t = await setup();
    await t.coordinator.onDeveloperState(stateOf(mission({ status: 'finished', verdict: 'success', steps: [...ECRITS, step('test', 'done'), step('review', 'done')] })));
    await t.settle();
    const r = await t.coordinator.suivi('montre-moi mes applis', { voice: false, speaker: false });
    expect(r?.text).toBe('Voici ton appli :');
    expect(r?.envelope).toMatchObject({ kind: 'facile-applis', data: { apps: [{ nom: 'Suivi commandes', status: 'pret', peutOuvrir: true, etat: 'prête' }] } });
    expect((await t.coordinator.suivi('mes applis', { voice: true, speaker: true }))?.text).toBe('J’ai 1 appli pour toi, dont 1 prête. La liste est sur le PC.');
    expect(await t.coordinator.openListedApp(t.apps()[0]!.id)).toEqual({ ok: true, message: '' });
    expect(await t.coordinator.openListedApp('inconnue')).toMatchObject({ ok: false });
  });
});

describe('Développeur facile, étape 3 : Claude en renfort (faux Claude)', () => {
  it('proposé seulement sur un signe mesuré : la même erreur deux fois ; la carte dit le modèle, « environ », le plafond', async () => {
    const t = await setup();
    // Un raté ordinaire, sans signe mesuré : pas de carte.
    await t.coordinator.onDeveloperState(stateOf(mission({ status: 'task', steps: ECRITS })));
    expect(t.current().renfort ?? null).toBeNull();
    await t.coordinator.onDeveloperState(stateOf(RATEE, ARRET_NET));
    await t.settle();
    const carte = t.current().renfort!;
    expect(carte).toMatchObject({ etat: 'propose', etape: 'Tester et corriger', raison: 'meme-erreur', modele: { id: 'claude-haiku-5-5' }, depenseEur: 0, plafondEur: 2 });
    expect(carte.message).toMatch(/^Cette étape est trop dure pour moi : j’ai fait deux fois la même erreur sur cette étape\. Je propose de la confier à Claude \(Claude Haiku 5\.5\) : environ /);
    expect(carte.envoi.fichiers).toEqual(['src/App.tsx', 'src/commandes.ts']);
    // Rien n'est parti : ni clé lue, ni appel.
    expect(t.cles).toEqual([]);
    expect(t.envoyes).toEqual([]);
    expect((await t.coordinator.suivi('où en est mon appli', { voice: false, speaker: false }))?.text).toMatch(/Je te propose de confier cette étape à Claude : la carte attend ta réponse\.$/);
  });

  it('« Oui, avec Claude » : le travail repart dans le moteur, Claude écrit, chaque appel est compté, le coût réel est dit', async () => {
    const t = await setup();
    await t.coordinator.onDeveloperState(stateOf(RATEE, ARRET_NET));
    await t.coordinator.renfortAnswer('oui');
    await t.settle();
    expect(t.startMission).toHaveBeenLastCalledWith('modify', REQUEST.objectif, true, 'suivi-commandes');
    expect(t.current()).toMatchObject({ status: 'travaille', renfort: { etat: 'en-cours' } });
    const writer = t.setMissionWriter.mock.calls[0]![0] as (input: { system: string; prompt: string }) => Promise<{ text: string }>;
    // Le moteur demande un fichier : Claude l'écrit ; une clé qui traînerait dans la demande est masquée.
    const ecrit = await writer({ system: 'consigne du moteur', prompt: 'écris src/commandes.ts ; clé : sk-ant-api03-synthetique-test-0000000000000000' });
    expect(ecrit.text).toContain('export const commandes');
    expect(t.envoyes).toHaveLength(1);
    expect(t.envoyes[0]).toMatchObject({ model: 'claude-haiku-5-5', system: 'consigne du moteur' });
    expect(t.envoyes[0]!.prompt).not.toContain('sk-ant-api03-synthetique-test');
    // 3 000 jetons lus à 0,10 $ + 1 000 écrits à 0,50 $ par million = 0,0008 $.
    expect(t.ledger().applis[t.payload.id]!.eur).toBeCloseTo(0.0008, 9);
    await t.settle();
    expect(t.current().claudeEur).toBeCloseTo(0.0008, 9);
    // La mission relancée réussit : le rédacteur est retiré, la carte dit le coût réel.
    await t.coordinator.onDeveloperState(stateOf(mission({ id: 'm2', kind: 'modify', createdAt: NOW + 1, status: 'finished', verdict: 'success', steps: [...ECRITS, step('test', 'done'), step('review', 'done')] })));
    await t.settle();
    expect(t.setMissionWriter).toHaveBeenLastCalledWith(null);
    expect(t.current()).toMatchObject({ status: 'pret', renfort: { etat: 'fait', message: 'Claude a écrit 1 fichier, et mes contrôles sont passés. Coût réel : moins d’un centime.' } });
    expect(t.apps()[0]).toMatchObject({ status: 'pret', claude: true });
  });

  it('plafond : l’appel qui le ferait dépasser n’a pas lieu', async () => {
    const presque = addRenfortSpend(emptyRenfortLedger(), 'autre', 'x', { quand: NOW, modele: 'm', etape: 'e', inputTokens: 0, outputTokens: 0, usd: 0, eur: 0 });
    const t = await setup({ renfort: { ledger: presque } });
    await t.coordinator.onDeveloperState(stateOf(RATEE, ARRET_NET));
    await t.coordinator.renfortAnswer('oui');
    const writer = t.setMissionWriter.mock.calls[0]![0] as (input: { system: string; prompt: string }) => Promise<{ text: string }>;
    // Le plafond de l'appli est presque atteint entre-temps (1,999 € sur 2 €).
    const plein = addRenfortSpend(t.ledger(), t.payload.id, 'Suivi', { quand: NOW, modele: 'm', etape: 'e', inputTokens: 0, outputTokens: 0, usd: 1.999, eur: 1.999 });
    Object.assign(t.ledger(), plein);
    await expect(writer({ system: 's', prompt: 'p' })).rejects.toBeInstanceOf(RenfortCapError);
    expect(t.envoyes).toEqual([]);
    await t.coordinator.onDeveloperState(stateOf(mission({ id: 'm2', kind: 'modify', createdAt: NOW + 1, status: 'failed', verdict: 'failed', steps: [...ECRITS, step('edit-2', 'failed')] })));
    await t.settle();
    expect(t.current().renfort).toMatchObject({ etat: 'plafond', message: 'Je me suis arrêté avant de dépasser le plafond. Coût réel : moins d’un centime.' });
  });

  it('« Non, continue en local » et « Arrête » : aucun appel ; sans clé : la carte dit comment l’ajouter ; coupé : pas de carte', async () => {
    const non = await setup();
    await non.coordinator.onDeveloperState(stateOf(RATEE, ARRET_NET));
    await non.coordinator.renfortAnswer('non');
    expect(non.current().renfort).toMatchObject({ etat: 'refuse' });
    expect(non.setMissionWriter).not.toHaveBeenCalled();
    expect(non.envoyes).toEqual([]);

    const sansCle = await setup({ renfort: { apiKey: '' } });
    await sansCle.coordinator.onDeveloperState(stateOf(RATEE, ARRET_NET));
    expect(sansCle.current().renfort).toMatchObject({ etat: 'sans-cle' });
    await sansCle.coordinator.renfortAnswer('oui');
    expect(sansCle.setMissionWriter).not.toHaveBeenCalled();

    const coupe = await setup({ renfort: { enabled: false } });
    await coupe.coordinator.onDeveloperState(stateOf(RATEE, ARRET_NET));
    expect(coupe.current().renfort ?? null).toBeNull();
    const absent = await setup({ renfort: null });
    await absent.coordinator.onDeveloperState(stateOf(RATEE, ARRET_NET));
    expect(absent.current().renfort ?? null).toBeNull();
  });

  it('« passe à Claude pour cette étape » : la carte, jamais depuis une enceinte, jamais pendant le travail', async () => {
    const t = await setup();
    await t.coordinator.onDeveloperState(stateOf(mission({ status: 'task', steps: ECRITS })));
    expect((await t.coordinator.suivi('passe à Claude pour cette étape', { voice: false, speaker: false }))?.text).toMatch(/^Je suis en plein travail en local/);
    await t.coordinator.onDeveloperState(stateOf(mission({ status: 'failed', verdict: 'failed', steps: [...ECRITS, step('test', 'failed')] })));
    expect(t.current().renfort ?? null).toBeNull();
    expect((await t.coordinator.suivi('passe à Claude', { voice: true, speaker: true }))?.text).toBe('Je ne confie rien à Claude depuis l’enceinte : demande-le-moi sur le PC.');
    const r = await t.coordinator.suivi('essaie avec Sonnet', { voice: false, speaker: false });
    expect(r?.text).toMatch(/tu me l’as demandé\. Je propose de la confier à Claude \(Claude Sonnet 5\.5\)/);
    expect(t.current().renfort).toMatchObject({ etat: 'propose', raison: 'demande', modele: { id: 'claude-sonnet-5-5' } });
    expect(t.envoyes).toEqual([]);
  });
});
