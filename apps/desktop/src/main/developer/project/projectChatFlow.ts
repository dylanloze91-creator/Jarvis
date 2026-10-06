import {
  ASK_TOOLS,
  STEP_LIMITS,
  limitText,
  projectChatPrompt,
  projectChatSystemPrompt,
  toolView,
  withDeadline,
  type CodeAIProvider,
  type ProjectProfile,
  type StepLimit,
  type ToolManager,
} from '@jarvis/core';

export interface ProjectChatDeps {
  code: CodeAIProvider;
  tools: Pick<ToolManager, 'schemas' | 'execute'>;
  profile: ProjectProfile;
  memoryNotes: string;
  history: Array<{ role: 'user' | 'assistant'; content: string }>;
  signal?: AbortSignal;
  beforeRound?: (round: number) => Promise<void>;
  limit?: StepLimit;
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

/** Un tour de discussion projet : lecture seule, réponse en texte libre. */
export async function runProjectChatTurn(
  deps: ProjectChatDeps,
  userText: string,
): Promise<{ reply: string; rounds: number; calls: number }> {
  const tools = toolView(deps.tools, ASK_TOOLS);
  const system = projectChatSystemPrompt(deps.profile, deps.memoryNotes);
  const limit = deps.limit ?? STEP_LIMITS.answer;
  const result = await limited(
    deps,
    {
      tools,
      system,
      prompt: projectChatPrompt(deps.history, userText),
      maxRounds: 10,
      beforeRound: deps.beforeRound,
    },
    limit,
  );
  if (result.stoppedBy === 'error')
    throw new Error(`Le modèle de code n’a pas répondu : ${result.error}`);
  const reply = result.finalText.trim().slice(0, 8_000);
  if (!reply) throw new Error('Réponse vide du modèle de code.');
  return { reply, rounds: result.rounds, calls: result.calls.length };
}
