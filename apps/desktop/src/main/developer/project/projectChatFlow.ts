import {
  ASK_TOOLS,
  STEP_LIMITS,
  limitText,
  projectChatPrompt,
  projectChatSystemPrompt,
  toolView,
  withDeadline,
  ToolManager,
  type CodeAIProvider,
  type ProjectProfile,
  type StepLimit,
  type ToolManager as TM,
} from '@jarvis/core';
import type { ConfirmationRequest, RegisteredTool } from '@jarvis/core';
import { PROJECT_CHAT_EXTRA_TOOLS } from '../tools/projectChatTools.js';

export interface ProjectChatSideEffects {
  codingPick?: { model: string; reason: string };
  decisions: string[];
  webSearchUsed: boolean;
  compareOffer?: { alternateModel: string; reason: string };
}

export interface ProjectChatDeps {
  code: CodeAIProvider;
  readTools: Pick<TM, 'schemas' | 'execute'>;
  chatTools: RegisteredTool[];
  profile: ProjectProfile;
  memoryNotes: string;
  decisions: string[];
  installedModels: string[];
  webSearchUsed: boolean;
  history: Array<{ role: 'user' | 'assistant'; content: string }>;
  signal?: AbortSignal;
  beforeRound?: (round: number) => Promise<void>;
  requestConfirmation?: (request: ConfirmationRequest) => Promise<boolean>;
  limit?: StepLimit;
  screenshotBase64?: string;
  effects: ProjectChatSideEffects;
}

async function limited(
  deps: ProjectChatDeps,
  input: Omit<Parameters<ProjectChatDeps['code']['runTools']>[0], 'signal' | 'maxTokens'>,
  limit: StepLimit,
) {
  const deadline = withDeadline(deps.signal, limit.timeoutMs);
  try {
    const result = await deps.code.runTools({
      ...input,
      maxTokens: limit.maxTokens,
      signal: deadline.signal,
    });
    if (result.stoppedBy === 'error' && deadline.expired())
      throw new Error(`Le modèle de code n’a pas fini à temps (${limitText(limit)}).`);
    return result;
  } finally {
    deadline.dispose();
  }
}

/** Un tour de discussion projet : outils lecture + mémorisation, modèle, recherche, comparaison. */
export async function runProjectChatTurn(
  deps: ProjectChatDeps,
  userText: string,
): Promise<{ reply: string; rounds: number; calls: number }> {
  const chatManager = new ToolManager().registerAll(deps.chatTools);
  const names = [...ASK_TOOLS, ...PROJECT_CHAT_EXTRA_TOOLS];
  const askSet = new Set<string>(ASK_TOOLS);
  const combined = {
    schemas: () => [
      ...deps.readTools.schemas().filter((s) => askSet.has(s.name)),
      ...chatManager.schemas(),
    ],
    execute: async (call, context, events) => {
      if (askSet.has(call.name)) return deps.readTools.execute(call, context, events);
      return chatManager.execute(call, context, events);
    },
  };
  const system = projectChatSystemPrompt(
    deps.profile,
    deps.memoryNotes,
    deps.decisions,
    deps.installedModels,
    !deps.webSearchUsed && !deps.effects.webSearchUsed,
  );
  const limit = deps.limit ?? STEP_LIMITS.answer;
  const images = deps.screenshotBase64 ? [deps.screenshotBase64] : undefined;
  const result = await limited(
    deps,
    {
      tools: toolView(combined, names),
      system,
      prompt: projectChatPrompt(deps.history, userText, Boolean(images?.length)),
      userImages: images,
      maxRounds: 12,
      beforeRound: deps.beforeRound,
      requestConfirmation: deps.requestConfirmation,
    },
    limit,
  );
  if (result.stoppedBy === 'error')
    throw new Error(`Le modèle de code n’a pas répondu : ${result.error}`);
  const reply = result.finalText.trim().slice(0, 12_000);
  if (!reply) throw new Error('Réponse vide du modèle de code.');
  return { reply, rounds: result.rounds, calls: result.calls.length };
}
