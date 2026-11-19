import {
  FACILE_DEFAULT_ANSWER,
  FACILE_QUESTION_TIMEOUT_MS,
  NEW_PROJECT_SCOPE,
  creationSearchQueries,
  facileFiles,
  facileFolder,
  facileLines,
  facileResult,
  facileVoiceMoment,
  fallbackFactory,
  newFacilePayload,
  nextFacileQuestion,
  pickExistingApps,
  buildingSentence,
  randomId,
  simpleWords,
  withMessages,
  type ChatMissionEnvelope,
  type ConversationStore,
  type CreationRequest,
  type FacileChoice,
  type FacileHit,
  type FacilePayload,
  type MissionState,
} from '@jarvis/core';
import type { ChatEvent } from '../../shared/ipc.js';
import type { DeveloperState } from '../../shared/developerIpc.js';
import type { DeveloperController } from '../developer/controller.js';

/**
 * Jarvis Développeur facile, étape 1 (`docs/specs/developpeur-facile.md`), Jarvis Test seulement.
 *
 * Une création demandée dans la discussion : la mission « nouveau projet » du moteur démarre tout
 * de suite, **sans changer le moteur**, et cette classe tient à jour ce que la discussion montre :
 * ce qui existe déjà (recherche sans modèle, en même temps que la mission), les lignes de travail
 * tirées des étapes réelles, les fichiers, une question à la fois, la fin.
 *
 * Le moteur garde toutes ses sécurités : dossier neuf du projet, tri des commandes, cartes pour
 * les dépendances, les suppressions et les fichiers protégés.
 */
export interface FacileDeps {
  developer: () => DeveloperController | null;
  /**
   * Une recherche sur Internet par l'outil `web_search` (journal d'audit compris).
   * `null` : Internet n'a pas répondu. Tableau vide : rien trouvé.
   */
  search: (query: string) => Promise<FacileHit[] | null>;
  store: ConversationStore;
  pushEvent: (event: ChatEvent) => void;
  /** Ouvre un lien `http(s)` dans le navigateur. */
  openExternal: (url: string) => Promise<void>;
  now?: () => number;
  /** Tests : délai de la réponse par défaut. */
  questionTimeoutMs?: number;
}

interface ActiveCreation {
  conversationId: string;
  messageId: string;
  payload: FacilePayload;
  /** Questions du moteur pour cette attente. */
  questions: string[];
  /** Dernier état écrit dans la discussion, pour ne pas réécrire le même. */
  written: string;
}

const OPEN_STATUSES: ReadonlySet<FacilePayload['status']> = new Set(['travaille', 'question']);

export class FacileCoordinator {
  private active: ActiveCreation | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;
  /** Écritures en file : deux mises à jour ne se croisent jamais dans la discussion. */
  private queue: Promise<void> = Promise.resolve();

  constructor(private readonly deps: FacileDeps) {}

  private now(): number {
    return this.deps.now?.() ?? Date.now();
  }

  /** Une création est en cours (elle travaille, ou attend une réponse). */
  busy(): boolean {
    return Boolean(this.active && OPEN_STATUSES.has(this.active.payload.status));
  }

  current(): FacilePayload | null {
    return this.active?.payload ?? null;
  }

  /** La carte de départ. Rien ne démarre encore : `start` le fait, une fois le message écrit. */
  prepare(request: CreationRequest, voice: boolean): FacilePayload {
    let template: string | null = null;
    try {
      template = fallbackFactory(request.objectif).template;
    } catch {
      template = null;
    }
    return newFacilePayload({ id: randomId(), request, now: this.now(), voice, template });
  }

  /** Lance en même temps la mission du moteur et la recherche de ce qui existe déjà. */
  start(conversationId: string, messageId: string, payload: FacilePayload, request: CreationRequest): void {
    this.clearTimer();
    this.active = { conversationId, messageId, payload, questions: [], written: JSON.stringify(payload) };
    void this.research(payload.id, request);
    void this.launch(payload.id, request);
  }

  private mine(id: string): ActiveCreation | null {
    return this.active && this.active.payload.id === id ? this.active : null;
  }

  private async launch(id: string, request: CreationRequest): Promise<void> {
    const dev = this.deps.developer();
    if (!dev) {
      this.finish(id, 'rate', 'Le mode Développeur est coupé : je ne peux pas construire.');
      return;
    }
    try {
      const state = await dev.startMission('new-project', request.objectif, true, NEW_PROJECT_SCOPE);
      const active = this.mine(id);
      if (!active) return;
      if (!state.mission || (active.payload.missionId && state.mission.id !== active.payload.missionId)) {
        if (!active.payload.missionId) {
          this.finish(id, 'rate', simpleWords(state.notice ?? 'Je n’ai pas pu démarrer.'));
        }
        return;
      }
      await this.onDeveloperState(state);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.finish(id, 'rate', `Je n’ai pas pu démarrer : ${simpleWords(message).slice(0, 200)}`);
    }
  }

  private async research(id: string, request: CreationRequest): Promise<void> {
    const queries = creationSearchQueries(request.sujet);
    const hits: FacileHit[] = [];
    let answered = false;
    for (const query of queries) {
      if (!this.mine(id)) return;
      let found: FacileHit[] | null = null;
      try {
        found = await this.deps.search(query);
      } catch {
        found = null;
      }
      if (found) {
        answered = true;
        hits.push(...found);
      }
    }
    const active = this.mine(id);
    if (!active) return;
    const existing = pickExistingApps(hits);
    this.update(active, {
      findings: {
        ...active.payload.findings,
        state: existing.length ? 'trouve' : answered ? 'rien' : 'coupe',
        existing,
      },
    });
  }

  /** Appelée à chaque changement d'état du mode Développeur. */
  async onDeveloperState(state: DeveloperState): Promise<void> {
    const active = this.active;
    if (!active || !OPEN_STATUSES.has(active.payload.status)) return;
    const mission = state.mission;
    if (!mission) return;
    if (!active.payload.missionId) {
      // La première mission « nouveau projet » née après la demande est la nôtre.
      if (mission.kind !== 'new-project' || mission.createdAt < active.payload.startedAt - 5_000) return;
    } else if (mission.id !== active.payload.missionId) {
      return;
    }
    const folder = facileFolder(mission);
    const template = state.projects?.find((project) => project.id === mission.projectId)?.template ?? null;
    const patch: Partial<FacilePayload> = {
      missionId: mission.id,
      projectId: mission.projectId === NEW_PROJECT_SCOPE ? null : mission.projectId,
      lines: facileLines(mission),
      files: facileFiles(mission),
      folder: folder ?? active.payload.folder,
      ...(template
        ? { findings: { ...active.payload.findings, method: buildingSentence(template) } }
        : {}),
    };
    const result = facileResult(mission, patch.folder ?? null);
    if (result) {
      this.clearTimer();
      patch.status = result.status;
      patch.result = result.text;
      patch.question = null;
    } else if (mission.status === 'waiting-answers') {
      const questions = missionQuestions(mission);
      if (questions.join('\n') !== active.questions.join('\n')) {
        active.questions = questions;
        patch.answers = [];
        active.payload = { ...active.payload, answers: [] };
      }
      if (!active.payload.question) {
        const question = nextFacileQuestion(active.questions, active.payload.answers, this.now());
        if (question) {
          patch.question = question;
          patch.status = 'question';
          this.armTimer(active.payload.id);
        }
      }
    } else if (active.payload.status === 'question') {
      this.clearTimer();
      patch.status = 'travaille';
      patch.question = null;
    }
    this.update(active, patch);
  }

  /** Réponse de l'utilisateur à la question affichée. */
  answer(text: string): void {
    const active = this.active;
    if (!active?.payload.question) return;
    this.record(active, text.trim().slice(0, 500) || FACILE_DEFAULT_ANSWER, !text.trim());
  }

  private record(active: ActiveCreation, answer: string, parDefaut: boolean): void {
    const question = active.payload.question;
    if (!question) return;
    this.clearTimer();
    const answers = [...active.payload.answers, { question: question.text, answer, parDefaut }];
    const next = nextFacileQuestion(active.questions, answers, this.now());
    if (next) {
      this.update(active, { answers, question: next });
      this.armTimer(active.payload.id);
      return;
    }
    this.update(active, { answers, question: null, status: 'travaille' });
    const dev = this.deps.developer();
    void dev?.answerMission(answers.map((item) => item.answer)).catch(() => undefined);
  }

  private armTimer(id: string): void {
    this.clearTimer();
    this.timer = setTimeout(() => {
      this.timer = null;
      const active = this.mine(id);
      if (!active?.payload.question) return;
      // Sans réponse : la réponse par défaut, dite telle quelle dans la discussion, et on continue.
      this.record(active, active.payload.question.defaut, true);
    }, this.deps.questionTimeoutMs ?? FACILE_QUESTION_TIMEOUT_MS);
  }

  private clearTimer(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }

  /** Le choix de l'utilisateur sous « Ça existe déjà ». Sans choix, la construction continue. */
  async choose(choice: FacileChoice): Promise<void> {
    const active = this.active;
    if (!active) return;
    const findings = { ...active.payload.findings, choice };
    if (choice === 'construire' || !OPEN_STATUSES.has(active.payload.status)) {
      this.update(active, { findings });
      if (choice === 'voir') await this.openFirst(active);
      return;
    }
    this.clearTimer();
    this.deps.developer()?.cancel();
    if (choice === 'voir') await this.openFirst(active);
    this.update(active, {
      findings,
      status: 'arrete',
      question: null,
      result:
        choice === 'voir'
          ? 'Je t’ai ouvert celle qui existe, et j’ai arrêté la construction. Ce qui est fait reste dans son dossier.'
          : 'D’accord, j’arrête. Dis-moi ce que tu veux à la place.',
    });
  }

  private async openFirst(active: ActiveCreation): Promise<void> {
    const first = active.payload.findings.existing[0];
    if (!first || !/^https?:\/\//i.test(first.url)) return;
    await this.deps.openExternal(first.url).catch(() => undefined);
  }

  private finish(id: string, status: FacilePayload['status'], result: string): void {
    const active = this.mine(id);
    if (!active) return;
    this.clearTimer();
    this.update(active, { status, result, question: null });
  }

  /** Change la carte, l'écrit dans la discussion et prévient la fenêtre. Rien si rien n'a changé. */
  private update(active: ActiveCreation, patch: Partial<FacilePayload>): void {
    const before = active.payload;
    const after: FacilePayload = { ...before, ...patch };
    const text = JSON.stringify(after);
    if (text === active.written) return;
    active.payload = after;
    active.written = text;
    const voiceHint = facileVoiceMoment(before, after);
    const envelope: ChatMissionEnvelope = { kind: 'facile', data: after };
    const { conversationId, messageId } = active;
    this.queue = this.queue
      .then(async () => {
        const conversation = await this.deps.store.get(conversationId);
        if (conversation) {
          const messages = conversation.messages.map((message) =>
            message.id === messageId
              ? { ...message, chatMission: envelope, ...(after.missionId ? { missionId: after.missionId } : {}) }
              : message,
          );
          await this.deps.store.save(withMessages(conversation, messages));
        }
        this.deps.pushEvent({
          type: 'mission_update',
          conversationId,
          messageId,
          envelope,
          ...(voiceHint ? { voiceHint } : {}),
        });
      })
      .catch((error: unknown) => console.error('[jarvis] création : discussion non mise à jour :', error));
  }

  /** Tests : attendre que les écritures en file soient passées. */
  async settled(): Promise<void> {
    await this.queue;
  }

  dispose(): void {
    this.clearTimer();
  }
}

/** Les questions que le moteur attend : celles de l'objectif, sinon les étapes en attente. */
function missionQuestions(mission: MissionState): string[] {
  const fromGoal = (mission.goal?.questions ?? []).map((question) => question.trim()).filter(Boolean);
  if (fromGoal.length) return fromGoal;
  return mission.steps
    .filter((step) => step.status === 'waiting')
    .map((step) => (step.detail ?? step.label).trim())
    .filter(Boolean);
}
