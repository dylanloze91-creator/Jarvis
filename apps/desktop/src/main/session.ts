import type { WebContents } from 'electron';
import {
  Agent,
  buildAuditEntry,
  buildPersonalizationPrompt,
  createMessage,
  newConversation,
  randomId,
  withMessages,
  withSiteBlockPrompt,
  withKnowledgePrompt,
  classifyUtterance,
  coderLearningPrompt,
  memoryRetrievalEnabled,
  skillLibraryEnabled,
  learningReminder,
  noteToRecord,
  enforceConstraints,
  debugLog,
  withVoiceOriginNotice,
  chatProviderConfig,
  activeOrchestra,
  addresseeCheckEnabled,
  addresseeUserPrompt,
  ADDRESSEE_SYSTEM_PROMPT,
  followUpAddressee,
  parseAddresseeReply,
  availableTeams,
  clockReply,
  expressTeam,
  orchestraBasePrompt,
  orchestraProviderConfig,
  parseRouterReply,
  routerSystemPrompt,
  routerUserPrompt,
  solveArithmetic,
  teamAssignment,
  teamHasTool,
  teamPrompt,
  TEAM_SPECS,
  type AgentEvent,
  type LLMProvider,
  type OrchestraConfig,
  type OrchestraTeam,
  type AuditLogStore,
  type ChatMessage,
  type ConfirmationRequest,
  type Conversation,
  type ConversationStore,
  type ProviderRegistry,
  type Settings,
  type ToolManager,
} from '@jarvis/core';
import type { ChatEvent, RuntimeStatus, SendChatInput } from '../shared/ipc.js';
import { IpcChannel } from '../shared/ipc.js';
import type { PersonalizationStore } from './personalization.js';
import type { KnowledgeStore } from './knowledge.js';
import type { VoiceBridge } from './voice.js';
import type { LocalLearningController } from './learning/controller.js';

/** Délai du cerveau pour choisir une équipe, chargement compris. */
const BRAIN_DEADLINE_MS = 90_000;
/**
 * 5.0.62 — délai de la question « est-ce pour Jarvis ? ». Au-delà, la phrase est traitée comme
 * une demande : mieux vaut répondre pour rien que perdre une vraie question.
 */
const ADDRESSEE_DEADLINE_MS = 10_000;

interface TurnRoute {
  team: OrchestraTeam | 'calcul' | 'horloge';
  label: string;
  model: string;
  how: 'calcul' | 'express' | 'cerveau';
  /** Réponse déjà prête (calcul) : aucun modèle n'est appelé. */
  reply?: string;
  provider?: LLMProvider;
}

/** Réponse fixe, au même format que les événements de l'agent. */
async function* fixedReply(text: string): AsyncGenerator<AgentEvent> {
  yield { type: 'assistant_delta', delta: text };
  yield { type: 'assistant_message', message: createMessage('assistant', text) };
  yield { type: 'done' };
}

interface SessionDeps {
  registry: ProviderRegistry;
  tools: ToolManager;
  store: ConversationStore;
  auditLog: AuditLogStore;
  getSettings: () => Settings;
  voice: VoiceBridge;
  personalization: PersonalizationStore;
  knowledge: KnowledgeStore;
  localLearning: LocalLearningController;
}

/**
 * Fait le pont entre l'agent (dans `@jarvis/core`) et l'interface : un tour de
 * conversation, ses événements de streaming, ses demandes de confirmation et
 * la persistance du résultat.
 */
export class ChatSession {
  private readonly pendingConfirmations = new Map<string, (approved: boolean) => void>();
  private controller: AbortController | null = null;
  /** 5.0.62 : un envoi plus récent rend caduque une vérification de destinataire en cours. */
  private sendSeq = 0;

  constructor(private readonly deps: SessionDeps) {}

  private async turnContext(
    settings: Settings,
    text: string,
    source: 'text' | 'voice',
    /** 5.0.60 (orchestre) : consigne de base et fragments à ajouter. Absent : le prompt d'avant. */
    orchestra?: { base: string; siteBlock: boolean; knowledge: boolean },
  ): Promise<{
    systemPrompt: string;
    learningReview?: (reply: string) => string | null;
    learningFinalize?: (reply: string) => string;
  }> {
    const personal =
      withVoiceOriginNotice(orchestra?.base ?? settings.systemPrompt, source) +
      buildPersonalizationPrompt(await this.deps.personalization.get());
    const base = orchestra
      ? [personal, orchestra.siteBlock ? withSiteBlockPrompt('') : '', orchestra.knowledge ? withKnowledgePrompt('') : '']
          .map((part) => part.trim())
          .filter(Boolean)
          .join(' ')
      : withKnowledgePrompt(withSiteBlockPrompt(personal));
    const learningOn = settings.localLearning?.enabled !== false;
    if (!learningOn) return { systemPrompt: base };
    const kind = classifyUtterance(text);
    const knowledge = this.deps.knowledge;
    if (kind !== 'one-off' && knowledge.applyLearning) {
      await knowledge
        .applyLearning(noteToRecord({ id: randomId(), text, now: Date.now(), kind }))
        .catch(() => undefined);
    }
    const recall = knowledge.promptLearning ?? knowledge.relevantLearning;
    const hits = recall ? await recall.call(knowledge, text, 4).catch(() => []) : [];
    const dev = settings.developer;
    const memory = coderLearningPrompt(hits, {
      query: text,
      memory: memoryRetrievalEnabled(dev),
      skills: skillLibraryEnabled(dev),
    });
    const trusted = hits.filter(
      (item) =>
        (item.origin === 'user' || item.origin === 'mission') &&
        !(item.type === 'experience' && item.hint),
    );
    const finalize = (reply: string): string => {
      const checked = enforceConstraints(reply, trusted, { limit: dev?.maxFixAttempts });
      if (settings.debugLogging) {
        for (const line of checked.trace) debugLog(true, 'contrainte', `${line.stage} : ${line.detail}`);
      }
      return checked.ok ? checked.source : reply;
    };
    return {
      systemPrompt: memory ? `${base}\n\n${memory}` : base,
      ...(trusted.length
        ? { learningReview: (reply: string) => learningReminder(reply, trusted), learningFinalize: finalize }
        : {}),
    };
  }

  status(): RuntimeStatus {
    const settings = this.deps.getSettings();
    const { provider, fellBack } = this.deps.registry.createOrFallback(chatProviderConfig(settings));
    return {
      providerId: provider.id,
      providerLabel: provider.label,
      model: provider.model,
      usingFallback: fellBack,
      voiceKeyConfigured: this.deps.voice.hasApiKey(),
    };
  }

  cancel(): void {
    this.controller?.abort();
    this.controller = null;
    for (const resolve of this.pendingConfirmations.values()) resolve(false);
    this.pendingConfirmations.clear();
  }

  respondConfirmation(requestId: string, approved: boolean): void {
    const resolve = this.pendingConfirmations.get(requestId);
    if (!resolve) return;
    this.pendingConfirmations.delete(requestId);
    resolve(approved);
  }

  async send(sender: WebContents, input: SendChatInput): Promise<void> {
    const emit = (event: ChatEvent): void => {
      if (!sender.isDestroyed()) sender.send(IpcChannel.chatEvent, event);
    };

    // 5.0.62 — une phrase dite sans « Jarvis » pendant la discussion : lui est-elle adressée ?
    // Vérifié avant d'annuler quoi que ce soit : une conversation dans la pièce ne coupe rien.
    const seq = (this.sendSeq += 1);
    if (input.source === 'voice' && input.followUp) {
      const checkSettings = this.deps.getSettings();
      if (addresseeCheckEnabled(checkSettings.voice)) {
        const addressed = await this.addressedToJarvis(checkSettings, input).catch(() => true);
        if (seq !== this.sendSeq) return;
        if (!addressed) {
          if (checkSettings.debugLogging) debugLog(true, 'voix', 'phrase de suivi pas pour Jarvis : ignorée');
          emit({ type: 'not_addressed', text: input.text });
          return;
        }
      }
    }

    this.cancel();
    const controller = new AbortController();
    this.controller = controller;

    let conversationId = input.conversationId ?? '';
    const superseded = (): boolean =>
      controller.signal.aborted && this.controller !== null && this.controller !== controller;
    try {
    const settings = this.deps.getSettings();
    const conversation = await this.loadConversation(input.conversationId);
    conversationId = conversation.id;
    const userMessage = createMessage('user', input.text);
    const messages: ChatMessage[] = [...conversation.messages, userMessage];

    emit({ type: 'started', conversationId: conversation.id, message: userMessage });

    const source = input.source ?? 'text';
    const orchestra = activeOrchestra(settings);
    const route = orchestra
      ? await this.routeTurn(settings, orchestra, input.text, messages, controller.signal)
      : null;
    if (route) {
      emit({
        type: 'route',
        team: route.team,
        label: route.label,
        model: route.model,
        how: route.how,
      });
    }

    let run: AsyncGenerator<AgentEvent>;
    if (route?.reply !== undefined) {
      run = fixedReply(route.reply);
    } else if (route?.provider && route.team !== 'calcul' && route.team !== 'horloge') {
      const team = route.team;
      const turn = await this.turnContext(settings, input.text, source, {
        base: orchestraBasePrompt(settings.systemPrompt),
        siteBlock: team === 'concentration',
        knowledge: team === 'memoire',
      });
      const agent = new Agent(route.provider, this.deps.tools, {
        systemPrompt: `${turn.systemPrompt}\n\n${teamPrompt(team)}`,
        temperature: settings.temperature,
        allowedTools: (name) => teamHasTool(team, name),
        ...(turn.learningReview ? { learningReview: turn.learningReview } : {}),
        ...(turn.learningFinalize ? { learningFinalize: turn.learningFinalize } : {}),
      });
      run = agent.run(messages, {
        signal: controller.signal,
        policies: settings.toolPolicies,
        debug: settings.debugLogging,
        requestConfirmation: (request) => this.askUser(sender, emit, request, controller.signal),
      });
    } else {
      const { provider } = this.deps.registry.createOrFallback(chatProviderConfig(settings));
      const turn = await this.turnContext(settings, input.text, source);
      const agent = new Agent(provider, this.deps.tools, {
        // La note d'origine vocale ne vit que dans ce prompt système, transmis
        // au modèle pour ce tour : elle n'est jamais écrite dans `userMessage`
        // ni dans `messages`, donc jamais affichée ni persistée.
        systemPrompt: turn.systemPrompt,
        temperature: settings.temperature,
        ...(turn.learningReview ? { learningReview: turn.learningReview } : {}),
        ...(turn.learningFinalize ? { learningFinalize: turn.learningFinalize } : {}),
      });
      run = agent.run(messages, {
        signal: controller.signal,
        policies: settings.toolPolicies,
        debug: settings.debugLogging,
        requestConfirmation: (request) => this.askUser(sender, emit, request, controller.signal),
      });
    }

    let visibleReply = false;
    try {
      for await (const event of run) {
        switch (event.type) {
          case 'assistant_delta':
            if (event.delta.trim()) visibleReply = true;
            emit({ type: 'delta', text: event.delta });
            break;
          case 'assistant_message':
            messages.push(event.message);
            if (event.message.content.trim()) visibleReply = true;
            break;
          case 'tool_start':
            emit({ type: 'tool_start', callId: event.call.id, toolName: event.call.name });
            break;
          case 'tool_progress':
            emit({ type: 'tool_progress', callId: event.callId, message: event.message });
            break;
          case 'tool_result':
            visibleReply = true;
            messages.push(event.message);
            emit({
              type: 'tool_result',
              callId: event.outcome.callId,
              toolName: event.outcome.name,
              status: event.outcome.status,
              content: event.outcome.content,
            });
            void this.deps.auditLog.append(buildAuditEntry(event.outcome));
            break;
          case 'error':
            visibleReply = true;
            emit({ type: 'error', message: event.message });
            break;
          case 'done':
            break;
        }
      }
    } catch (error) {
      if (!superseded()) {
        visibleReply = true;
        emit({ type: 'error', message: error instanceof Error ? error.message : String(error) });
      }
    } finally {
      if (this.controller === controller) this.controller = null;
    }

    if (superseded()) return;

    const updated = withMessages(conversation, messages);
    try {
      await this.deps.store.save(updated);
    } catch (error) {
      // `done` doit partir quand même : sinon l'interface reste « Jarvis réfléchit… ».
      emit({
        type: 'error',
        message: `Conversation non enregistrée dans l'historique : ${error instanceof Error ? error.message : String(error)}`,
      });
    }
    void this.deps.knowledge
      .indexConversation(
        `conversation:${updated.id}`,
        messages
          .filter((message) => message.role === 'user' || message.role === 'assistant')
          .map((message) => `${message.role}: ${message.content}`)
          .join('\n'),
        settings,
      )
      .catch(() => undefined);
    void this.deps.localLearning.recordTurn(updated.id, updated.messages).catch(() => undefined);
    if (!visibleReply) {
      emit({
        type: 'error',
        message: 'Je n’ai pas pu répondre. Réessaie dans un instant.',
      });
    }
    emit({ type: 'done', conversationId: updated.id, messages: updated.messages });
    } catch {
      if (this.controller === controller) this.controller = null;
      if (superseded()) return;
      emit({
        type: 'error',
        message: "Le message n'a pas pu être envoyé. Réessaie dans un instant.",
      });
      emit({ type: 'done', conversationId, messages: [] });
    }
  }

  /**
   * 5.0.62 — règles sûres d'abord (un ordre, une question en « tu », « et demain ? » = oui ;
   * une mention de Jarvis = non), puis une question d'un mot au modèle (le cerveau de l'orchestre
   * s'il est actif, sinon le modèle du chat). Tout échec ou doute = oui.
   */
  private async addressedToJarvis(settings: Settings, input: SendChatInput): Promise<boolean> {
    const wake = { word: settings.voice.wakeWord, variants: settings.voice.wakeWordVariants };
    const rule = followUpAddressee(input.text, wake);
    if (rule !== 'unsure') return rule === 'yes';
    const history = input.conversationId
      ? ((await this.deps.store.get(input.conversationId).catch(() => null))?.messages ?? [])
      : [];
    const orchestra = activeOrchestra(settings);
    const { provider } = this.deps.registry.createOrFallback(
      orchestra ? orchestraProviderConfig(settings, orchestra.brain, 'carte', true) : chatProviderConfig(settings),
    );
    const deadline = new AbortController();
    const timer = setTimeout(() => deadline.abort(), ADDRESSEE_DEADLINE_MS);
    let reply = '';
    try {
      for await (const event of provider.streamChat({
        system: ADDRESSEE_SYSTEM_PROMPT,
        messages: [createMessage('user', addresseeUserPrompt(input.text, history))],
        temperature: 0,
        maxTokens: 4,
        signal: deadline.signal,
      })) {
        if (event.type === 'text') reply += event.delta;
        if (event.type === 'error') return true;
      }
    } catch {
      return true;
    } finally {
      clearTimeout(timer);
    }
    const verdict = parseAddresseeReply(reply);
    if (settings.debugLogging) debugLog(true, 'voix', `destinataire (modèle) : ${verdict === 'yes' ? 'Jarvis' : 'autre'}`);
    return verdict === 'yes';
  }

  /**
   * 5.0.60 — chef d'orchestre. Calcul exact sans modèle, puis règles express, puis le cerveau.
   * `null` : le cerveau n'a pas pu choisir (Ollama arrêté, réponse illisible) ; le tour suit
   * le chemin d'avant, avec le modèle et le catalogue habituels.
   */
  private async routeTurn(
    settings: Settings,
    orchestra: OrchestraConfig,
    text: string,
    messages: ChatMessage[],
    signal: AbortSignal,
  ): Promise<TurnRoute | null> {
    const calc = solveArithmetic(text);
    if (calc) {
      return { team: 'calcul', label: 'Calcul', model: 'sans modèle', how: 'calcul', reply: `${calc.reply}.` };
    }
    const clock = clockReply(text, new Date());
    if (clock) return { team: 'horloge', label: 'Horloge', model: 'sans modèle', how: 'express', reply: clock };
    const teams = availableTeams(this.deps.tools.schemas().map((tool) => tool.name));
    const available = new Set(teams);
    let team: OrchestraTeam | null = expressTeam({ text, history: messages, available });
    const how: TurnRoute['how'] = team ? 'express' : 'cerveau';
    if (!team) team = await this.askBrain(settings, orchestra, teams, text, messages.slice(0, -1), signal);
    if (!team) {
      if (settings.debugLogging) debugLog(true, 'orchestre', 'le cerveau n’a pas choisi d’équipe : chemin habituel');
      return null;
    }
    const assignment = teamAssignment(orchestra, team);
    const brain = assignment.model === orchestra.brain && assignment.place === 'carte';
    const { provider } = this.deps.registry.createOrFallback(
      orchestraProviderConfig(settings, assignment.model, assignment.place, brain),
    );
    if (settings.debugLogging) {
      debugLog(true, 'orchestre', `${how} → ${team} · ${assignment.model} (${assignment.place})`);
    }
    return { team, label: TEAM_SPECS[team].label, model: assignment.model, how, provider };
  }

  private async askBrain(
    settings: Settings,
    orchestra: OrchestraConfig,
    teams: OrchestraTeam[],
    text: string,
    history: ChatMessage[],
    signal: AbortSignal,
  ): Promise<OrchestraTeam | null> {
    const { provider } = this.deps.registry.createOrFallback(
      orchestraProviderConfig(settings, orchestra.brain, 'carte', true),
    );
    // Premier chargement du cerveau compris (environ 20 s sur la RTX 2060).
    const deadline = new AbortController();
    const timer = setTimeout(() => deadline.abort(), BRAIN_DEADLINE_MS);
    const onAbort = (): void => deadline.abort();
    signal.addEventListener('abort', onAbort, { once: true });
    let reply = '';
    try {
      for await (const event of provider.streamChat({
        system: routerSystemPrompt(teams),
        messages: [createMessage('user', routerUserPrompt(text, history))],
        temperature: 0,
        maxTokens: 12,
        signal: deadline.signal,
      })) {
        if (event.type === 'text') reply += event.delta;
        if (event.type === 'error') break;
      }
    } catch {
      return null;
    } finally {
      clearTimeout(timer);
      signal.removeEventListener('abort', onAbort);
    }
    return parseRouterReply(reply, teams);
  }

  private askUser(
    sender: WebContents,
    emit: (event: ChatEvent) => void,
    request: ConfirmationRequest,
    signal: AbortSignal,
  ): Promise<boolean> {
    const requestId = randomId();
    return new Promise<boolean>((resolve) => {
      let settled = false;
      const settle = (approved: boolean): void => {
        if (settled) return;
        settled = true;
        signal.removeEventListener('abort', onAbort);
        sender.removeListener?.('destroyed', onDestroyed);
        resolve(approved);
      };
      const onAbort = (): void => {
        this.pendingConfirmations.delete(requestId);
        settle(false);
      };
      const onDestroyed = (): void => {
        this.pendingConfirmations.delete(requestId);
        settle(false);
      };

      signal.addEventListener('abort', onAbort, { once: true });
      sender.once?.('destroyed', onDestroyed);
      this.pendingConfirmations.set(requestId, settle);
      emit({
        type: 'confirm',
        requestId,
        toolName: request.toolName,
        details: request.details,
        command: request.command,
        forced: request.forced,
      });
    });
  }

  private async loadConversation(id: string | null): Promise<Conversation> {
    if (!id) return newConversation();
    return (await this.deps.store.get(id)) ?? newConversation();
  }
}
