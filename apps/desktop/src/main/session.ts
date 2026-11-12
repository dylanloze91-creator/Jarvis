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
  activePersona,
  teamPersonaPrompt,
  userFirstName,
  chatProviderConfig,
  activeOrchestra,
  activeRouter,
  addresseeCheckEnabled,
  addresseeUserPrompt,
  ADDRESSEE_SYSTEM_PROMPT,
  followUpAddressee,
  parseAddresseeReply,
  availableTeams,
  clockLinePrompt,
  clockReply,
  detectStockRequest,
  expressTeam,
  isTeamCorrection,
  readStockOutcomes,
  speakStockOutcomes,
  stockNotFoundReply,
  orchestraBasePrompt,
  orchestraProviderConfig,
  parseRouterReply,
  routerSystemPrompt,
  routerUserPrompt,
  solveArithmetic,
  teamMissedNotice,
  teamAssignment,
  teamHasTool,
  teamPrompt,
  TEAM_SPECS,
  ORCHESTRA_TEAMS,
  chatMissionsEnabled,
  CHAT_MISSION_DIRECT_INTRO,
  CODE_MISSION_TOOL_PROMPT,
  directMissionRequest,
  looksLikeHealthIntent,
  looksLikeWrittenMissionProposal,
  missionFromUserPhrase,
  PROPOSER_MISSION_TOOL_NAME,
  redactSecrets,
  withAttachmentNotes,
  lastUserHasImageAttachment,
  MAX_ATTACHMENTS_PER_MESSAGE,
  type ChatAttachment,
  type ChatMissionProposalPayload,
  type AgentEvent,
  type LLMProvider,
  type OrchestraConfig,
  type OrchestraTeam,
  type ModelPlace,
  type AuditLogStore,
  type ChatMessage,
  type ConfirmationRequest,
  type Conversation,
  type ConversationStore,
  type ProviderRegistry,
  type HealthReport,
  type Settings,
  type ToolCall,
  type ToolManager,
  parseImageCommand,
  detectDirectImageRequest,
  guessProject,
  directFollowUp,
  stripDirectTurns,
  isDirectImageMessage,
  looksLikeImageIntent,
  isImageToolName,
  type ImageProject,
} from '@jarvis/core';
import { describeDirectResult, type ImagesService } from './images/ImagesService.js';
import type { ChatEvent, RuntimeStatus, SendChatInput } from '../shared/ipc.js';
import { IpcChannel } from '../shared/ipc.js';
import { canOfferTeamValidation, validationPathForHow } from './orchestra/teamValidation.js';
import type { PersonalizationStore } from './personalization.js';
import type { KnowledgeStore } from './knowledge.js';
import type { VoiceBridge } from './voice.js';
import type { LocalLearningController } from './learning/controller.js';
import type { ChatMissionHub } from './chatMission/hub.js';
import { createProposerMissionTool } from './chatMission/proposerMissionTool.js';

/** Délai du cerveau pour choisir une équipe, chargement compris. */
const BRAIN_DEADLINE_MS = 90_000;
/**
 * 5.0.62 — délai de la question « est-ce pour Jarvis ? ». Au-delà, la phrase est traitée comme
 * une demande : mieux vaut répondre pour rien que perdre une vraie question.
 */
const ADDRESSEE_DEADLINE_MS = 10_000;

interface TurnRoute {
  team: OrchestraTeam | 'calcul' | 'horloge' | 'bourse';
  label: string;
  model: string;
  how: 'calcul' | 'express' | 'cerveau' | 'trieur';
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

async function* directMissionIntroStream(intro: string): AsyncGenerator<AgentEvent> {
  yield { type: 'assistant_delta', delta: intro };
  yield { type: 'assistant_message', message: createMessage('assistant', intro) };
  yield { type: 'done' };
}

interface SessionDeps {
  registry: ProviderRegistry;
  /** Mode direct de Jarvis Imager (`/image`, demandes repérées par règles) : sans lui, pas de chemin direct. */
  images?: ImagesService;
  /** Ouvre l'image produite dans la visionneuse (`shell.openPath`, côté main). */
  openImagePath?: (path: string) => Promise<string | void>;
  /** Le message de l'utilisateur en cours (mot pour mot, photos), pour l'outil `generer_image`. */
  noteUserTurn?: (turn: { text: string; attachments: ChatAttachment[] }) => void;
  tools: ToolManager;
  store: ConversationStore;
  auditLog: AuditLogStore;
  getSettings: () => Settings;
  voice: VoiceBridge;
  personalization: PersonalizationStore;
  knowledge: KnowledgeStore;
  localLearning: LocalLearningController;
  /** 5.0.68 — missions depuis la discussion (après le contrôleur Développeur). */
  getChatMissionHub?: () => ChatMissionHub | null;
  /**
   * Module images : enregistre une photo jointe (dossier des images) et rend la pièce jointe
   * du message. Absent : les photos jointes sont refusées avec un message clair.
   */
  saveAttachment?: (input: { name: string; mime: string; data: Buffer }) => Promise<ChatAttachment>;
  /** Bilan de santé, sans modèle. Absent : la phrase suit le chat habituel. */
  healthReport?: () => Promise<HealthReport>;
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
  /** Fenêtre, téléphone et chaque enceinte ont leur question Spotify. */
  private readonly spotifyVoiceSessionId = randomId();
  /** Dernière équipe d'un tour d'orchestre, pour une correction (« non », « passe par »). */
  private readonly lastTeamByConversation = new Map<string, string>();

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
    // Photos jointes : enregistrées sur le disque avant le tour ; seul leur chemin ira au modèle.
    const attachments = await this.saveAttachments(input);
    this.deps.noteUserTurn?.({ text: input.text, attachments });
    // Mode direct de Jarvis Imager : `/image …` ou une demande repérée par règles part à Imager sans
    // aucun modèle de langage ; le tour est marqué `direct` et jamais renvoyé au modèle ensuite.
    const direct = attachments.length ? null : await this.directImageRequest(input.text, conversation.messages);
    const userMessage = createMessage('user', input.text, {
      ...(attachments.length ? { attachments } : {}),
      ...(direct ? { direct: 'image' as const, directPrompt: direct.prompt } : {}),
    });
    const messages: ChatMessage[] = [...conversation.messages, userMessage];
    /** Copie pour le modèle : sans les tours directs, les photos devenues des notes ; `messages` (affiché, enregistré) ne change pas. */
    const modelMessages = withAttachmentNotes(stripDirectTurns(messages));

    emit({ type: 'started', conversationId: conversation.id, message: userMessage });

    if (direct) {
      await this.directImageTurn(emit, conversation, messages, direct, controller, superseded);
      return;
    }

    const source = input.source ?? 'text';
    const healthIntent = looksLikeHealthIntent(input.text);
    const orchestra = activeOrchestra(settings);
    const route = !healthIntent && orchestra
      ? await this.routeTurn(
          settings,
          orchestra,
          input.text,
          messages,
          controller.signal,
          this.lastTeamByConversation.get(conversation.id) ?? null,
        )
      : null;
    if (route) this.lastTeamByConversation.set(conversation.id, route.team);

    const chatMissionHub = this.deps.getChatMissionHub?.() ?? null;
    const chatMissionsOn =
      Boolean(chatMissionHub?.enabled()) && chatMissionsEnabled(settings) && route?.team === 'code';
    const wakeWord = { word: settings.voice.wakeWord, variants: settings.voice.wakeWordVariants };
    const directReq =
      chatMissionsOn && route?.team === 'code'
        ? directMissionRequest(input.text, {
            wakeWord,
            knownProjectNames: chatMissionHub?.knownProjectNames() ?? [],
          })
        : null;
    const directMissionTake = Boolean(directReq && chatMissionHub && !chatMissionHub.missionBusy());
    const directMissionBlocked = Boolean(directReq && chatMissionHub && chatMissionHub.missionBusy());

    if (route) {
      const routeEvent: ChatEvent = {
        type: 'route',
        team: route.team,
        label: route.label,
        model: directMissionTake ? 'mission directe' : route.model,
        how: directMissionTake ? 'mission-directe' : route.how,
      };
      if (
        canOfferTeamValidation(settings) &&
        !directMissionTake &&
        route.how !== 'calcul' &&
        ORCHESTRA_TEAMS.includes(route.team as OrchestraTeam)
      ) {
        const teams = availableTeams(this.deps.tools.schemas().map((tool) => tool.name));
        routeEvent.validation = {
          phrase: input.text,
          context: routerUserPrompt(input.text, messages.slice(0, -1)),
          proposedTeam: route.team,
          path: validationPathForHow(route.how),
          teams: teams.map((id) => ({ id, label: TEAM_SPECS[id].label })),
        };
      }
      emit(routeEvent);
    }

    let run: AsyncGenerator<AgentEvent>;
    let appendMissionProposal: (() => void) | null = null;
    if (healthIntent) {
      let reply = "Je n'ai pas pu faire le bilan.";
      if (this.deps.healthReport) {
        try {
          const report = await this.deps.healthReport();
          reply = source === 'voice' ? report.voice : report.text;
        } catch {
          reply = "Je n'ai pas pu faire le bilan.";
        }
      }
      run = fixedReply(reply);
    } else if (directMissionBlocked && chatMissionHub) {
      run = fixedReply(
        'Une mission est déjà en cours. Termine-la ou annule-la avant d’en lancer une autre.',
      );
    } else if (directMissionTake && directReq && chatMissionHub) {
      run = directMissionIntroStream(CHAT_MISSION_DIRECT_INTRO);
      appendMissionProposal = () => {
        const recorded = chatMissionHub.recordProposal({
          type: directReq.type,
          objectif: directReq.objectif,
          ...(directReq.langage ? { langage: directReq.langage } : {}),
        });
        const proposalMessage = createMessage('assistant', '', {
          chatMission: { kind: 'proposal', data: recorded.payload },
          missionId: recorded.payload.proposalId,
        });
        messages.push(proposalMessage);
        chatMissionHub.setConversationContext(conversation.id);
        chatMissionHub.bindMissionMessage(proposalMessage.id);
        emit({
          type: 'mission_proposal',
          message: proposalMessage,
          voiceHint: recorded.voiceHint,
        });
      };
    } else if (route?.reply !== undefined) {
      run = fixedReply(route.reply);
    } else if (route?.provider && route.team !== 'calcul' && route.team !== 'horloge' && route.team !== 'bourse') {
      const team = route.team;
      const turn = await this.turnContext(settings, input.text, source, {
        base: orchestraBasePrompt(settings.systemPrompt),
        siteBlock: team === 'concentration',
        knowledge: team === 'memoire',
      });
      // Caractère de Jarvis : dans les consignes de l'équipe, comme l'avis franc (5.0.62).
      // Le cerveau routeur et le chat sans orchestre ne le reçoivent jamais.
      const character = teamPersonaPrompt(team, activePersona(settings), {
        now: new Date(),
        userName: userFirstName((await this.deps.personalization.get()).user),
        source,
      });
      const missionPrompt = chatMissionsOn ? `\n\n${CODE_MISSION_TOOL_PROMPT}` : '';
      const turnTools =
        chatMissionsOn && chatMissionHub
          ? this.deps.tools.compose(createProposerMissionTool(chatMissionHub))
          : this.deps.tools;
      const agent = new Agent(route.provider, turnTools, {
        systemPrompt: `${turn.systemPrompt}\n\n${teamPrompt(team, character, clockLinePrompt(new Date()))}${missionPrompt}`,
        temperature: settings.temperature,
        homeLocation: settings.homeLocation ?? null,
        allowedTools: (name) =>
          teamHasTool(team, name) || (chatMissionsOn && name === PROPOSER_MISSION_TOOL_NAME),
        spotifyAskDevice: settings.spotifyAskDevice === true,
        spotifyVoiceSessionId: this.spotifyVoiceSessionId,
        ...(turn.learningReview ? { learningReview: turn.learningReview } : {}),
        ...(turn.learningFinalize ? { learningFinalize: turn.learningFinalize } : {}),
      });
      run = agent.run(modelMessages, {
        signal: controller.signal,
        policies: settings.toolPolicies,
        debug: settings.debugLogging,
        spotifyVoiceSessionId: this.spotifyVoiceSessionId,
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
        homeLocation: settings.homeLocation ?? null,
        spotifyAskDevice: settings.spotifyAskDevice === true,
        spotifyVoiceSessionId: this.spotifyVoiceSessionId,
        ...(turn.learningReview ? { learningReview: turn.learningReview } : {}),
        ...(turn.learningFinalize ? { learningFinalize: turn.learningFinalize } : {}),
      });
      run = agent.run(modelMessages, {
        signal: controller.signal,
        policies: settings.toolPolicies,
        debug: settings.debugLogging,
        spotifyVoiceSessionId: this.spotifyVoiceSessionId,
        requestConfirmation: (request) => this.askUser(sender, emit, request, controller.signal),
      });
    }

    let visibleReply = false;
    let missionProposed = false;
    try {
      for await (const event of run) {
        switch (event.type) {
          case 'assistant_delta':
            if (event.delta.trim()) visibleReply = true;
            emit({ type: 'delta', text: event.delta });
            break;
          case 'assistant_message': {
            const proposerOnly =
              chatMissionsOn &&
              event.message.toolCalls?.length &&
              event.message.toolCalls.every((call) => call.name === PROPOSER_MISSION_TOOL_NAME) &&
              !event.message.content.trim();
            if (!proposerOnly) {
              messages.push(event.message);
              if (event.message.content.trim()) visibleReply = true;
            }
            break;
          }
          case 'tool_start':
            if (chatMissionsOn && event.call.name === PROPOSER_MISSION_TOOL_NAME) break;
            emit({
              type: 'tool_start',
              callId: event.call.id,
              toolName: event.call.name,
              ...summaryOf(this.deps.tools, event.call),
            });
            break;
          case 'tool_progress':
            emit({ type: 'tool_progress', callId: event.callId, message: event.message });
            break;
          case 'tool_result':
            if (chatMissionsOn && event.outcome.name === PROPOSER_MISSION_TOOL_NAME) {
              const payload = event.outcome.data as ChatMissionProposalPayload | undefined;
              if (payload) {
                missionProposed = true;
                const proposalMessage = createMessage('assistant', '', {
                  chatMission: { kind: 'proposal', data: payload },
                  missionId: payload.proposalId,
                });
                messages.push(proposalMessage);
                chatMissionHub?.setConversationContext(conversation.id);
                chatMissionHub?.bindMissionMessage(proposalMessage.id);
                emit({
                  type: 'mission_proposal',
                  message: proposalMessage,
                  voiceHint: 'Je te propose une mission pour ça, elle est à l’écran.',
                });
                visibleReply = true;
              }
            } else {
              visibleReply = true;
              messages.push(event.message);
              emit({
                type: 'tool_result',
                callId: event.outcome.callId,
                toolName: event.outcome.name,
                status: event.outcome.status,
                content: event.outcome.content,
              });
            }
            void this.deps.auditLog
              .append(buildAuditEntry(event.outcome))
              .catch((error: unknown) => console.error('[jarvis] journal d’audit non écrit :', error));
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

    if (appendMissionProposal && !controller.signal.aborted && !superseded()) {
      appendMissionProposal();
      visibleReply = true;
    }

    if (
      chatMissionsOn &&
      chatMissionHub &&
      !missionProposed &&
      !appendMissionProposal &&
      !directMissionBlocked &&
      !controller.signal.aborted &&
      !superseded()
    ) {
      const lastAssistant = [...messages]
        .reverse()
        .find((message) => message.role === 'assistant' && message.content.trim());
      if (lastAssistant && looksLikeWrittenMissionProposal(lastAssistant.content)) {
        const fromUser = missionFromUserPhrase(input.text, {
          wakeWord,
          knownProjectNames: chatMissionHub.knownProjectNames(),
        });
        if (fromUser) {
          const recorded = chatMissionHub.recordProposal(
            {
              type: fromUser.type,
              objectif: fromUser.objectif,
              ...(fromUser.langage ? { langage: fromUser.langage } : {}),
            },
            { objectifReprise: true },
          );
          const proposalMessage = createMessage('assistant', '', {
            chatMission: { kind: 'proposal', data: recorded.payload },
            missionId: recorded.payload.proposalId,
          });
          messages.push(proposalMessage);
          chatMissionHub.setConversationContext(conversation.id);
          chatMissionHub.bindMissionMessage(proposalMessage.id);
          emit({
            type: 'mission_proposal',
            message: proposalMessage,
            voiceHint: recorded.voiceHint,
          });
          visibleReply = true;
        }
      }
    }

    if (superseded()) return;

    // Mode direct : le modèle a répondu sans Imager alors que la demande ressemblait à une image → bouton « Envoyer à Imager ».
    if (
      this.deps.images?.isEnabled() &&
      !attachments.length &&
      !controller.signal.aborted &&
      looksLikeImageIntent(input.text) &&
      !messages
        .slice(conversation.messages.length)
        .some((message) => message.toolCalls?.some((call) => isImageToolName(call.name)) || (message.role === 'tool' && message.toolName !== undefined && isImageToolName(message.toolName)))
    ) {
      emit({ type: 'imager_offer', text: input.text });
    }

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
          .filter((message) => (message.role === 'user' || message.role === 'assistant') && !isDirectImageMessage(message))
          .map((message) => `${message.role}: ${message.content}`)
          .join('\n'),
        settings,
      )
      .catch(() => undefined);
    void this.deps.localLearning.recordTurn(updated.id, stripDirectTurns(updated.messages)).catch(() => undefined);
    // 5.0.64 : un tour interrompu par l'utilisateur (bouton Arrêter) n'est pas un échec.
    if (!visibleReply && !controller.signal.aborted) {
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
   * Mode direct de Jarvis Imager : `/image …` (commande) ou un début de phrase de `direct.declencheurs`
   * (règles, modifiables dans `imager_rules.yaml`). Module coupé ou texte sans rapport : `null`.
   */
  private async directImageRequest(
    text: string,
    history: readonly ChatMessage[],
  ): Promise<{ prompt: string; project: ImageProject; how: 'commande' | 'regle' | 'suite' } | null> {
    const images = this.deps.images;
    if (!images?.isEnabled()) return null;
    const command = parseImageCommand(text);
    if (command) return { prompt: command.prompt, project: guessProject(command.prompt), how: 'commande' };
    const { rules } = await images.loadRules().catch(() => ({ rules: null }));
    const detected = detectDirectImageRequest(text, rules?.direct.declencheurs);
    if (detected) return { prompt: detected.prompt, project: guessProject(detected.prompt), how: 'regle' };
    // Suite d'un tour direct (« pas mal mais en version anime ») : la consigne précédente plus le changement.
    const lastUser = [...history].reverse().find((message) => message.role === 'user');
    if (lastUser?.direct === 'image' && lastUser.directPrompt) {
      const followUp = directFollowUp(text, lastUser.directPrompt);
      if (followUp) return { prompt: followUp, project: guessProject(followUp), how: 'suite' };
    }
    return null;
  }

  /** Un tour direct : Imager seul, événements de la discussion comme pour un outil, journal d'audit, rien pour le modèle ni la mémoire. */
  private async directImageTurn(
    emit: (event: ChatEvent) => void,
    conversation: Conversation,
    messages: ChatMessage[],
    direct: { prompt: string; project: ImageProject; how: 'commande' | 'regle' | 'suite' },
    controller: AbortController,
    superseded: () => boolean,
  ): Promise<void> {
    const images = this.deps.images!;
    emit({
      type: 'route',
      team: 'images',
      label: 'Jarvis Imager',
      model: direct.how === 'commande' ? 'commande /image, sans modèle' : direct.how === 'suite' ? 'suite de l’image précédente, sans modèle' : 'règle, sans modèle',
      how: 'direct',
    });
    let content: string;
    let status: 'ok' | 'error' = 'ok';
    const callId = randomId();
    const started = Date.now();
    if (!direct.prompt) {
      content = 'Écris ta consigne après /image, par exemple : /image un renard roux dans la neige.';
      status = 'error';
    } else {
      emit({ type: 'tool_start', callId, toolName: 'generer_image', summary: `Jarvis Imager, mode direct (projet ${direct.project}) : « ${direct.prompt.length > 80 ? `${direct.prompt.slice(0, 80)}…` : direct.prompt} ».` });
      try {
        const result = await images.generateDirect(
          { prompt: direct.prompt, negative: '', project: direct.project },
          { onProgress: (message) => emit({ type: 'tool_progress', callId, message }), signal: controller.signal },
        );
        content = describeDirectResult(result);
        const first = result.files[0];
        if (first && this.deps.openImagePath && images.settings().openAfterGeneration) await this.deps.openImagePath(first.png).catch(() => undefined);
      } catch (error) {
        status = 'error';
        content = `${error instanceof Error ? error.message : String(error)} Le modèle de langage est rechargé.`;
      }
      emit({ type: 'tool_result', callId, toolName: 'generer_image', status, content });
      void this.deps.auditLog
        .append(
          buildAuditEntry({
            callId,
            name: 'generer_image',
            status,
            content,
            arguments: { mode: 'direct', projet: direct.project, demande: direct.prompt },
            decision: 'auto',
            durationMs: Date.now() - started,
            outcome: status === 'ok' ? 'success' : controller.signal.aborted ? 'cancelled' : 'definitive',
          }),
        )
        .catch((error: unknown) => console.error('[jarvis] journal d’audit non écrit :', error));
    }
    if (this.controller === controller) this.controller = null;
    if (superseded()) return;
    emit({ type: 'delta', text: content });
    messages.push(createMessage('assistant', content, { direct: 'image' }));
    const updated = withMessages(conversation, messages);
    try {
      await this.deps.store.save(updated);
    } catch (error) {
      emit({ type: 'error', message: `Conversation non enregistrée dans l'historique : ${error instanceof Error ? error.message : String(error)}` });
    }
    // Rien pour la mémoire ni pour l'apprentissage : un tour direct ne nourrit aucun modèle.
    emit({ type: 'done', conversationId: updated.id, messages: updated.messages });
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
    // Enceinte en mode rapide : pas d'appel de modèle. Règles muettes = on répond.
    if (input.rulesOnlyAddressee) return true;
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

  /** Photos jointes du message : enregistrées par le module images, 3 au plus ; refus clair sinon. */
  private async saveAttachments(input: SendChatInput): Promise<ChatAttachment[]> {
    const list = input.attachments ?? [];
    if (!list.length) return [];
    if (!this.deps.saveAttachment) {
      throw new Error('Les photos jointes demandent le module images (Réglages → Services → Images).');
    }
    if (list.length > MAX_ATTACHMENTS_PER_MESSAGE) {
      throw new Error(`Au plus ${MAX_ATTACHMENTS_PER_MESSAGE} photos par message.`);
    }
    const saved: ChatAttachment[] = [];
    for (const item of list) {
      const data = Buffer.from(item.dataBase64, 'base64');
      saved.push(await this.deps.saveAttachment({ name: item.name, mime: item.mime, data }));
    }
    return saved;
  }

  /**
   * 5.0.60 — chef d'orchestre. Calcul exact sans modèle, horloge, cours de bourse,
   * puis règles express, puis le cerveau. `null` : le cerveau n'a pas pu choisir
   * (Ollama arrêté, réponse illisible) ; le tour suit le chemin d'avant.
   */
  private async routeTurn(
    settings: Settings,
    orchestra: OrchestraConfig,
    text: string,
    messages: ChatMessage[],
    signal: AbortSignal,
    previousTeam: string | null,
  ): Promise<TurnRoute | null> {
    const calc = solveArithmetic(text);
    if (calc) {
      return { team: 'calcul', label: 'Calcul', model: 'sans modèle', how: 'calcul', reply: `${calc.reply}.` };
    }
    const clock = clockReply(text, new Date());
    if (clock) return { team: 'horloge', label: 'Horloge', model: 'sans modèle', how: 'express', reply: clock };
    const stock = detectStockRequest(text);
    if (stock) {
      const reply = await this.stockQuoteReply(stock.names, stock.prefer, signal);
      return { team: 'bourse', label: 'Bourse', model: 'express', how: 'express', reply };
    }
    const teams = availableTeams(this.deps.tools.schemas().map((tool) => tool.name));
    const available = new Set(teams);
    let team: OrchestraTeam | null = expressTeam({
      text,
      history: messages,
      available,
      hasImageAttachment: lastUserHasImageAttachment(messages),
    });
    let how: TurnRoute['how'] = team ? 'express' : 'cerveau';
    const notice =
      !team && previousTeam && isTeamCorrection(text) ? teamMissedNotice(previousTeam) : undefined;
    if (!team) {
      const router = activeRouter(settings);
      if (router) {
        team = await this.askRouter(settings, router, teams, text, messages.slice(0, -1), signal, notice);
        if (team) how = 'trieur';
        else {
          team = await this.askBrain(settings, orchestra, teams, text, messages.slice(0, -1), signal, notice);
          if (team) how = 'cerveau';
        }
      } else {
        team = await this.askBrain(settings, orchestra, teams, text, messages.slice(0, -1), signal, notice);
      }
    }
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

  /**
   * `get_stock_quote` appelé ici, pas par un modèle. Le journal d'audit reçoit l'appel.
   * Sans prix renvoyé : une phrase d'échec, jamais un cours inventé.
   */
  private async stockQuoteReply(
    names: readonly string[],
    prefer: 'paris' | null,
    signal: AbortSignal,
  ): Promise<string> {
    if (!this.deps.tools.get('get_stock_quote')) return names.map((name) => stockNotFoundReply(name)).join(' ');
    const callId = randomId();
    try {
      const outcome = await this.deps.tools.execute(
        { id: callId, name: 'get_stock_quote', arguments: { queries: [...names] } },
        {
          signal,
          requestConfirmation: async () => false,
          ...(prefer ? { stockPrefer: prefer } : {}),
        },
      );
      void this.deps.auditLog
        .append(buildAuditEntry(outcome))
        .catch((error: unknown) => console.error('[jarvis] journal d’audit non écrit :', error));
      return speakStockOutcomes(names, readStockOutcomes(outcome.data));
    } catch {
      return names.map((name) => stockNotFoundReply(name)).join(' ');
    }
  }

  private async askRouter(
    settings: Settings,
    router: { model: string; place: ModelPlace },
    teams: OrchestraTeam[],
    text: string,
    history: ChatMessage[],
    signal: AbortSignal,
    notice?: string,
  ): Promise<OrchestraTeam | null> {
    const { provider } = this.deps.registry.createOrFallback(
      orchestraProviderConfig(settings, router.model, router.place, true),
    );
    const deadline = new AbortController();
    const timer = setTimeout(() => deadline.abort(), BRAIN_DEADLINE_MS);
    const onAbort = (): void => deadline.abort();
    signal.addEventListener('abort', onAbort, { once: true });
    let reply = '';
    try {
      for await (const event of provider.streamChat({
        system: routerSystemPrompt(teams),
        messages: [createMessage('user', routerUserPrompt(text, history, notice))],
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

  private async askBrain(
    settings: Settings,
    orchestra: OrchestraConfig,
    teams: OrchestraTeam[],
    text: string,
    history: ChatMessage[],
    signal: AbortSignal,
    notice?: string,
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
        messages: [createMessage('user', routerUserPrompt(text, history, notice))],
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

/**
 * 5.0.64 — la bulle « outil » montre la phrase française de l'outil (celle de la
 * carte de confirmation) plutôt que son nom technique. Le résumé de secours
 * (JSON des arguments) et un `summarize` qui lève sont ignorés : la bulle garde
 * alors un libellé tiré du nom.
 */
function summaryOf(tools: ToolManager, call: ToolCall): { summary?: string } {
  const tool = tools.get(call.name);
  if (!tool) return {};
  try {
    const text = redactSecrets(tool.summarize(call.arguments)).split('\n')[0]?.trim() ?? '';
    if (!text || text.startsWith('Exécuter « ')) return {};
    return { summary: text.length > 160 ? `${text.slice(0, 157)}…` : text };
  } catch {
    return {};
  }
}
