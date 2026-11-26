import {
  FACILE_DEFAULT_ANSWER,
  FACILE_QUESTION_TIMEOUT_MS,
  NEW_PROJECT_SCOPE,
  RENFORT_NO_KEY,
  RenfortCapError,
  appFromPayload,
  appsPayload,
  buildRenfortPackage,
  claudeModel,
  closeInterruptedApps,
  detectMyAppsRequest,
  detectProgressQuestion,
  detectRenfortRequest,
  direEuros,
  facilePlan,
  facileProgressReply,
  meteredClaudeCall,
  myAppsReply,
  proposeRenfort,
  renfortReason,
  renfortSpentOn,
  upsertApp,
  type ClaudeCaller,
  type ClaudeFamily,
  type FacileApp,
  type RenfortCaps,
  type RenfortFile,
  type RenfortLedger,
  type RenfortReason,
  creationSearchQueries,
  facileCanOpen,
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
  /** Étape 3 : la liste des applis créées, gardée sur le PC. Absent : rien n'est gardé. */
  apps?: { read(): Promise<FacileApp[]>; write(apps: FacileApp[]): Promise<void> };
  /** Étape 3 : « Claude en renfort ». Absent, ou `settings().enabled` faux : jamais proposé. */
  renfort?: RenfortDeps;
}

export interface RenfortDeps {
  /** Les réglages au moment de s'en servir (la clé vient du coffre ; elle ne sort jamais d'ici). */
  settings(): { enabled: boolean; apiKey: string; caps: RenfortCaps; usdToEur?: number };
  ledger: { read(): Promise<RenfortLedger>; write(ledger: RenfortLedger): Promise<void> };
  /** L'appel à Claude avec cette clé. Les essais passent un faux : aucun appel payant. */
  caller(apiKey: string): ClaudeCaller;
  /** Lit des fichiers du dossier du projet (chemins relatifs) ; un fichier absent est ignoré. */
  readFiles(folder: string, paths: readonly string[]): Promise<RenfortFile[]>;
}

/** Ce que la session dit pour une phrase de suivi, et la carte à poser dessous (« Mes applis »). */
export interface SuiviReply {
  text: string;
  envelope?: ChatMissionEnvelope;
}

interface ActiveCreation {
  conversationId: string;
  messageId: string;
  payload: FacilePayload;
  /** Questions du moteur pour cette attente. */
  questions: string[];
  /** Dernier état écrit dans la discussion, pour ne pas réécrire le même. */
  written: string;
  /** La demande d'origine (pour relancer le travail avec Claude). */
  request: CreationRequest;
  /** Claude en renfort : la mission relancée avec lui, depuis quand, et ce qu'il a coûté cette fois. */
  renfort?: { depuis: number; eur: number; fichiers: number; plafond: boolean };
}

const OPEN_STATUSES: ReadonlySet<FacilePayload['status']> = new Set(['travaille', 'question']);

/** Après un arrêt demandé par la carte, on insiste au plus ce temps-là auprès du moteur. */
export const FACILE_STOP_WATCH_MS = 3 * 60_000;
export const FACILE_STOP_RETRY_MS = 1_000;

/** Un arrêt demandé au moteur, tant que sa mission n'est pas vraiment finie. */
interface PendingStop {
  /** La mission à arrêter ; `null` si elle n'avait pas encore de numéro au moment du clic. */
  missionId: string | null;
  startedAt: number;
  until: number;
}

export class FacileCoordinator {
  private active: ActiveCreation | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private stopping: PendingStop | null = null;
  private stopRetry: ReturnType<typeof setTimeout> | null = null;
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

  /**
   * Un arrêt demandé dans les premières secondes laissait le moteur sur sa carte « Créer le
   * projet », que personne ne voit dans la discussion : la mission restait « en cours » et Jarvis
   * répondait « je suis déjà en train de construire » jusqu'à son redémarrage (essai réel du
   * 20 novembre 2026). Tant que la mission arrêtée tourne encore, on refuse sa carte et on
   * redemande l'arrêt. Rien d'autre n'est refusé : seulement la mission que la carte a arrêtée.
   */
  private insistOnStop(state: DeveloperState): void {
    const stop = this.stopping;
    if (!stop) return;
    const mission = state.mission;
    const ours =
      mission &&
      (stop.missionId
        ? mission.id === stop.missionId
        : mission.kind === 'new-project' && mission.createdAt >= stop.startedAt - 5_000);
    const running = ours && mission.status !== 'finished' && mission.status !== 'failed' && mission.status !== 'cancelled';
    if (!running || this.now() > stop.until) {
      this.stopping = null;
      return;
    }
    if (!stop.missionId) stop.missionId = mission.id;
    const dev = this.deps.developer();
    if (!dev) return;
    if (this.stopRetry) clearTimeout(this.stopRetry);
    this.stopRetry = null;
    if (!state.confirmation) {
      dev.cancel();
      return;
    }
    // Le moteur annonce sa carte avant de l'avoir enregistrée : un refus donné tout de suite peut
    // tomber dans le vide. On le redonne une seconde plus tard, quelques fois, tant que la mission
    // n'est pas finie. Seul le refus de cette carte-là est répété, jamais un arrêt général : il
    // pourrait toucher une création demandée entre-temps.
    const requestId = state.confirmation.requestId;
    const refuse = (left: number): void => {
      this.deps.developer()?.respondConfirmation(requestId, false);
      if (left <= 0) return;
      this.stopRetry = setTimeout(() => {
        this.stopRetry = null;
        if (this.stopping) refuse(left - 1);
      }, FACILE_STOP_RETRY_MS);
    };
    refuse(5);
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
    // Le plan est visible dès le début : six étapes, toutes « à faire ».
    return { ...newFacilePayload({ id: randomId(), request, now: this.now(), voice, template }), plan: facilePlan(null) };
  }

  /** Lance en même temps la mission du moteur et la recherche de ce qui existe déjà. */
  start(conversationId: string, messageId: string, payload: FacilePayload, request: CreationRequest): void {
    this.clearTimer();
    this.active = { conversationId, messageId, payload, questions: [], written: JSON.stringify(payload), request };
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
      // Projet neuf : aucun identifiant de projet. En passer un (même « nouveau ») fait chercher un
      // projet existant au moteur, qui répond « Projet introuvable » (essai réel du 20 novembre).
      const state = await dev.startMission('new-project', request.objectif, true);
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
    this.insistOnStop(state);
    const active = this.active;
    if (!active || !OPEN_STATUSES.has(active.payload.status)) return;
    const mission = state.mission;
    if (!mission) return;
    if (!active.payload.missionId && active.renfort) {
      // Le travail relancé avec Claude : la première mission née après le « oui ».
      if (mission.createdAt < active.renfort.depuis - 5_000) return;
    } else if (!active.payload.missionId) {
      // La première mission « nouveau projet » née après la demande est la nôtre.
      if (mission.kind !== 'new-project' || mission.createdAt < active.payload.startedAt - 5_000) return;
    } else if (mission.id !== active.payload.missionId) {
      return;
    }
    const folder = facileFolder(mission);
    const project = state.projects?.find((item) => item.id === mission.projectId) ?? null;
    const template = project?.template ?? null;
    const patch: Partial<FacilePayload> = {
      // Étape 3 : le plan coché, d'après les étapes réelles, et le nom lisible de l'appli.
      plan: facilePlan(mission),
      ...(project?.name ? { nom: project.name } : {}),
      missionId: mission.id,
      projectId: mission.projectId === NEW_PROJECT_SCOPE ? null : mission.projectId,
      lines: facileLines(mission),
      files: facileFiles(mission),
      folder: folder ?? active.payload.folder,
      ...(template
        ? { findings: { ...active.payload.findings, method: buildingSentence(template) } }
        : {}),
    };
    if (template) patch.template = template;
    const result = facileResult(mission, patch.folder ?? null, template ?? active.payload.template ?? null);
    if (result) {
      this.clearTimer();
      patch.status = result.status;
      patch.result = result.text;
      patch.question = null;
      if (active.renfort) {
        // Le travail confié à Claude est fini : le rédacteur est retiré, le coût réel est dit.
        this.deps.developer()?.setMissionWriter(null);
        const r = active.renfort;
        delete active.renfort;
        const card = active.payload.renfort;
        if (card) {
          patch.renfort = {
            ...card,
            etat: result.status === 'pret' ? 'fait' : r.plafond ? 'plafond' : 'rate',
            coutReelEur: r.eur,
            message:
              result.status === 'pret'
                ? `Claude a écrit ${r.fichiers} fichier${r.fichiers > 1 ? 's' : ''}, et mes contrôles sont passés. Coût réel : ${direEuros(r.eur, false)}.`
                : r.plafond
                  ? `Je me suis arrêté avant de dépasser le plafond. Coût réel : ${direEuros(r.eur, false)}.`
                  : `Même avec Claude, je n’ai pas réussi à finir. Coût réel : ${direEuros(r.eur, false)}.`,
          };
        }
      } else if (result.status === 'rate') {
        // Un raté : Claude n'est proposé que sur un signe mesuré, jamais au hasard.
        const raison = renfortReason({
          repeatedFailure: state.codeTask?.repeatedFailure,
          failureReason: state.codeTask?.failureReason ?? mission.summary ?? null,
        });
        if (raison) {
          const erreurs = [state.codeTask?.failureReason ?? '', ...(state.codeTask?.repeatedFailure?.failures ?? [])].filter(Boolean).join('\n');
          const card = await this.renfortCard({ ...active.payload, ...patch }, raison, null, erreurs);
          if (card) patch.renfort = card;
        }
      }
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
    this.stopping = {
      missionId: active.payload.missionId,
      startedAt: active.payload.startedAt,
      until: this.now() + FACILE_STOP_WATCH_MS,
    };
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

  /**
   * « Ouvrir l'appli » (étape 2) : le clic vaut accord pour préparer l'appli que Jarvis vient de
   * créer (`npm run build` dans son dossier, rien n'est publié) et l'ouvrir dans une fenêtre de
   * Jarvis. Seulement la création affichée, seulement si elle est prête et que sa base s'ouvre.
   */
  async openApp(): Promise<void> {
    const active = this.active;
    if (!active || active.payload.status !== 'pret' || !active.payload.projectId) return;
    if (!facileCanOpen(active.payload.template)) return;
    if (active.payload.ouverture?.etat === 'en-cours') return;
    const dev = this.deps.developer();
    if (!dev) return;
    this.update(active, { ouverture: { etat: 'en-cours', message: 'Je prépare l’appli, puis je l’ouvre…' } });
    let outcome: { ok: boolean; message: string };
    try {
      outcome = await dev.openCreatedApp(active.payload.projectId);
    } catch (error) {
      outcome = { ok: false, message: `Je n’ai pas pu l’ouvrir : ${error instanceof Error ? error.message : String(error)}` };
    }
    this.update(active, {
      ouverture: outcome.ok
        ? { etat: 'ouverte', message: 'Elle est ouverte dans une fenêtre à côté.' }
        : { etat: 'ratee', message: outcome.message },
    });
  }

  // -------------------------------------------------------------------------------------------
  // Étape 3 : suivre son projet

  /**
   * Une phrase de suivi, reconnue par règles, sans modèle : « où en est mon appli ? », « mes
   * applis », « passe à Claude pour cette étape ». `null` : la phrase n'est pas pour le suivi.
   */
  async suivi(text: string, options: { voice: boolean; speaker: boolean }): Promise<SuiviReply | null> {
    const enCours = this.busy();
    if (detectProgressQuestion(text, enCours || Boolean(this.active))) {
      const payload = this.active?.payload ?? null;
      if (payload) return { text: facileProgressReply({ ...payload, renfortPropose: payload.renfort?.etat === 'propose' }, { voice: options.speaker }) };
      const derniere = (await this.apps())[0];
      if (!derniere) return { text: facileProgressReply(null, { voice: options.speaker }) };
      return {
        text: facileProgressReply(
          { objectif: derniere.objectif, status: derniere.status, question: null, result: null, folder: derniere.folder, nom: derniere.nom },
          { voice: options.speaker, ancienne: true },
        ),
      };
    }
    if (detectMyAppsRequest(text)) {
      const apps = await this.apps();
      const reply = myAppsReply(apps, { voice: options.speaker });
      return apps.length && !options.speaker ? { text: reply.split('\n')[0]!, envelope: { kind: 'facile-applis', data: appsPayload(apps) } } : { text: reply };
    }
    const demande = this.active && this.deps.renfort ? detectRenfortRequest(text) : null;
    if (demande && this.active) {
      const active = this.active;
      if (options.speaker) return { text: 'Je ne confie rien à Claude depuis l’enceinte : demande-le-moi sur le PC.' };
      if (OPEN_STATUSES.has(active.payload.status)) return { text: 'Je suis en plein travail en local. Dis-moi d’arrêter d’abord, puis redemande-le-moi.' };
      if (!this.deps.renfort!.settings().enabled) return { text: 'Claude en renfort est coupé. Pour l’activer : Réglages → Développeur → « Claude en renfort ».' };
      const card = await this.renfortCard(active.payload, 'demande', demande.famille, active.payload.result ?? '');
      if (!card) return { text: 'Je n’ai pas de projet à confier à Claude : cette appli n’a pas encore de dossier.' };
      this.update(active, { renfort: card });
      return { text: card.message ?? 'La carte est juste au-dessus.' };
    }
    return null;
  }

  private appsLoaded: Promise<void> | null = null;

  /** La liste des applis. Au premier appel, celles restées « en cours » d'un autre lancement sont fermées. */
  private async apps(): Promise<FacileApp[]> {
    const store = this.deps.apps;
    if (!store) return [];
    this.appsLoaded ??= (async () => {
      const lues = await store.read().catch(() => [] as FacileApp[]);
      const moi = this.active?.payload.id;
      const fermees = closeInterruptedApps(lues.filter((a) => a.id !== moi), this.now());
      const tout = [...lues.filter((a) => a.id === moi), ...fermees];
      if (JSON.stringify(tout) !== JSON.stringify(lues)) await store.write(tout).catch(() => undefined);
    })();
    await this.appsLoaded;
    return store.read().catch(() => []);
  }

  /** Une appli de la liste (jamais un autre dossier). */
  async listedApp(id: string): Promise<FacileApp | null> {
    return (await this.apps()).find((a) => a.id === id) ?? null;
  }

  /** « Ouvrir l'appli » depuis « Mes applis » : seulement une appli prête de la liste. */
  async openListedApp(id: string): Promise<{ ok: boolean; message: string }> {
    const app = await this.listedApp(id);
    if (!app?.projectId || app.status !== 'pret' || !facileCanOpen(app.template)) return { ok: false, message: 'Cette appli ne s’ouvre pas d’un clic.' };
    const dev = this.deps.developer();
    if (!dev) return { ok: false, message: 'Le mode Développeur est coupé.' };
    try {
      return await dev.openCreatedApp(app.projectId);
    } catch (error) {
      return { ok: false, message: `Je n’ai pas pu l’ouvrir : ${error instanceof Error ? error.message : String(error)}` };
    }
  }

  private async saveApp(active: ActiveCreation): Promise<void> {
    const store = this.deps.apps;
    if (!store) return;
    const apps = await this.apps();
    const ledger = this.deps.renfort ? await this.deps.renfort.ledger.read().catch(() => null) : null;
    const eur = ledger ? renfortSpentOn(ledger, active.payload.id) : 0;
    const fiche = appFromPayload(active.payload, {
      nom: active.payload.nom ?? null,
      now: this.now(),
      conversationId: active.conversationId,
      messageId: active.messageId,
      ...(eur > 0 ? { claudeEur: eur, claude: true } : {}),
    });
    await store.write(upsertApp(apps, fiche));
  }

  // -------------------------------------------------------------------------------------------
  // Étape 3 : Claude en renfort

  /** La carte de proposition, d'après l'état réel. `null` : coupé, ou pas de dossier de projet. */
  private async renfortCard(payload: FacilePayload, raison: RenfortReason, famille: ClaudeFamily | null, erreurs: string): Promise<FacilePayload['renfort']> {
    const renfort = this.deps.renfort;
    if (!renfort || !payload.folder || !payload.projectId) return null;
    const reglages = renfort.settings();
    if (!reglages.enabled) return null;
    const aEcrire = payload.files.slice(0, 8);
    const fichiers = await renfort.readFiles(payload.folder, aEcrire).catch(() => [] as RenfortFile[]);
    const plan = (payload.plan ?? []).map((s) => `- ${s.titre} : ${s.etat}${s.detail ? ` (${s.detail})` : ''}`).join('\n');
    const colis = buildRenfortPackage({ objectif: payload.objectif, plan, aEcrire, fichiers, erreurs });
    const ledger = await renfort.ledger.read();
    const etape = (payload.plan ?? []).find((s) => s.etat === 'rate')?.titre ?? 'Écrire les fichiers';
    return proposeRenfort({
      etape,
      raison,
      famille,
      colis,
      aEcrire: (fichiers.length ? fichiers : aEcrire.map((path) => ({ path, content: '' }))).map((f) => ({ path: f.path, chars: Math.max(1_500, f.content.length) })),
      ledger,
      appId: payload.id,
      caps: reglages.caps,
      now: this.now(),
      cle: Boolean(reglages.apiKey.trim()),
      ...(reglages.usdToEur !== undefined ? { usdToEur: reglages.usdToEur } : {}),
    });
  }

  /**
   * Réponse à la carte. « oui » : le travail est relancé sur le projet, et Claude écrit les fichiers
   * à la place du modèle local, **dans la boucle du moteur** (plan, revue du diff, essais, cartes) ;
   * chaque appel est compté, et le plafond revérifié juste avant. Rien ne part sans ce clic.
   */
  async renfortAnswer(choice: 'oui' | 'non' | 'arrete'): Promise<void> {
    const active = this.active;
    const card = active?.payload.renfort;
    if (!active || !card || card.etat !== 'propose') return;
    if (choice !== 'oui') {
      this.update(active, { renfort: { ...card, etat: 'refuse', message: choice === 'non' ? 'D’accord, je reste en local. Dis-moi si je réessaie, ou autrement.' : 'D’accord, j’arrête là. Ce qui est fait reste dans son dossier.' } });
      return;
    }
    const renfort = this.deps.renfort;
    const dev = this.deps.developer();
    const reglages = renfort?.settings();
    const modele = claudeModel(card.modele.id);
    if (!renfort || !dev || !reglages?.enabled || !modele || !active.payload.projectId) return;
    if (!reglages.apiKey.trim()) {
      this.update(active, { renfort: { ...card, etat: 'sans-cle', message: RENFORT_NO_KEY } });
      return;
    }
    const caller = renfort.caller(reglages.apiKey);
    const suivi = { depuis: this.now(), eur: 0, fichiers: 0, plafond: false };
    active.renfort = suivi;
    const id = active.payload.id;
    // Les appels sont comptés un par un, dans l'ordre (le registre est relu avant chacun).
    let file: Promise<unknown> = Promise.resolve();
    dev.setMissionWriter((input) => {
      const appel = file.then(async () => {
        const ledger = await renfort.ledger.read();
        try {
          const r = await meteredClaudeCall({
            appId: id,
            nom: active.payload.nom ?? active.payload.objectif.slice(0, 60),
            etape: card.etape,
            modele,
            system: input.system,
            prompt: input.prompt,
            ledger,
            caps: reglages.caps,
            caller,
            now: () => this.now(),
            ...(reglages.usdToEur !== undefined ? { usdToEur: reglages.usdToEur } : {}),
            ...(input.signal ? { signal: input.signal } : {}),
          });
          await renfort.ledger.write(r.ledger);
          suivi.eur += r.appel.eur;
          suivi.fichiers += 1;
          const mien = this.mine(id);
          if (mien) this.update(mien, { claudeEur: renfortSpentOn(r.ledger, id) });
          return { text: r.text };
        } catch (error) {
          if (error instanceof RenfortCapError) suivi.plafond = true;
          throw error;
        }
      });
      file = appel.catch(() => undefined);
      return appel;
    });
    this.update(active, {
      status: 'travaille',
      result: null,
      missionId: null,
      lines: [],
      plan: facilePlan(null),
      renfort: { ...card, etat: 'en-cours', message: `Claude (${card.modele.nom}) écrit les fichiers ; je garde mes contrôles : plan, relecture, essais.` },
    });
    try {
      const state = await dev.startMission('modify', active.request.objectif, true, active.payload.projectId);
      if (!state.mission) throw new Error(simpleWords(state.notice ?? 'la mission n’a pas démarré'));
      await this.onDeveloperState(state);
    } catch (error) {
      dev.setMissionWriter(null);
      delete active.renfort;
      const mien = this.mine(id);
      if (mien) {
        this.update(mien, {
          status: 'rate',
          result: 'Je n’ai pas pu relancer le travail avec Claude.',
          renfort: { ...card, etat: 'rate', coutReelEur: suivi.eur, message: `Je n’ai pas pu relancer le travail : ${simpleWords(error instanceof Error ? error.message : String(error)).slice(0, 200)}. Rien n’a été dépensé.` },
        });
      }
    }
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
        // Étape 3 : la fiche de l'appli suit sa carte (« mes applis », « où en est mon appli ? »).
        await this.saveApp(active).catch(() => undefined);
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
