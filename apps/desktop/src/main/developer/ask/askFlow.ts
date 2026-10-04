import { readFile, stat } from 'node:fs/promises';
import {
  ASK_TOOLS,
  CodeModelFormatError,
  addUsage,
  askPrompt,
  askSystemPrompt,
  checkAnswer,
  parseAskReply,
  retryLimit,
  limitText,
  STEP_LIMITS,
  toolView,
  withDeadline,
  type StepLimit,
  type AskAnswer,
  type ChatUsage,
  type CheckedAnswer,
  type CodeAIProvider,
  type ProjectProfile,
  type RepoReader,
  type ToolManager,
} from '@jarvis/core';
import { RepoJailError, resolveInRepo } from '../tools/jail.js';

const MAX_READ_BYTES = 2_000_000;

/** Lecture d'un fichier de la copie pour vérifier une citation : enfermée, bornée, jamais un secret. */
export function repoReader(root: string): RepoReader {
  return async (path) => {
    try {
      const file = await resolveInRepo(root, path);
      const info = await stat(file.absolute);
      if (!info.isFile() || info.size > MAX_READ_BYTES) return null;
      return await readFile(file.absolute, 'utf8');
    } catch (error) {
      if (error instanceof RepoJailError) return null;
      return null;
    }
  };
}

export interface AskDeps {
  code: CodeAIProvider;
  /** Outils de lecture de la copie (le flux n'en montre que les six de lecture). */
  tools: Pick<ToolManager, 'schemas' | 'execute'>;
  read: RepoReader;
  profile: ProjectProfile;
  signal?: AbortSignal;
  beforeRound?: (round: number) => Promise<void>;
  maxRounds?: number;
  /** Plafond de jetons par réponse et durée (5.0.1) ; défaut : `STEP_LIMITS.answer`. */
  limit?: StepLimit;
}

async function limited(
  deps: AskDeps,
  input: Omit<Parameters<AskDeps['code']['runTools']>[0], 'signal' | 'maxTokens'>,
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

export interface AskResult {
  checked: CheckedAnswer;
  rounds: number;
  calls: number;
  usage: ChatUsage;
  retried: boolean;
}

/** Question sur le code : lecture seule, réponse JSON, chaque citation relue dans le fichier. */
export async function runAsk(deps: AskDeps, question: string): Promise<AskResult> {
  const tools = toolView(deps.tools, ASK_TOOLS);
  const system = askSystemPrompt(deps.profile);
  const limit = deps.limit ?? STEP_LIMITS.answer;
  const first = await limited(
    deps,
    {
      tools,
      system,
      prompt: askPrompt(question),
      maxRounds: deps.maxRounds ?? 12,
      beforeRound: deps.beforeRound,
    },
    limit,
  );
  if (first.stoppedBy === 'error')
    throw new Error(`Le modèle de code n’a pas répondu : ${first.error}`);
  let answer: AskAnswer;
  let usage = first.usage;
  let rounds = first.rounds;
  let retried = false;
  try {
    answer = parseAskReply(first.finalText);
  } catch (error) {
    if (!(error instanceof CodeModelFormatError)) throw error;
    retried = true;
    const read = first.calls
      .filter((c) => c.status === 'ok')
      .map((c) => `${c.name} ${JSON.stringify(c.arguments)}`)
      .slice(0, 12)
      .join('\n');
    const retry = await limited(
      deps,
      {
        tools: toolView(deps.tools, []),
        system,
        prompt: `${askPrompt(question)}\n\nDéjà consulté :\n${read || '—'}\n\nTa réponse précédente n’était pas au bon format (${error.message}). Réponds seulement par le bloc JSON.`,
        maxRounds: 1,
        beforeRound: deps.beforeRound,
      },
      retryLimit(limit),
    );
    if (retry.stoppedBy === 'error')
      throw new Error(`Le modèle de code n’a pas répondu : ${retry.error}`);
    usage = addUsage(usage, retry.usage);
    rounds += retry.rounds;
    answer = parseAskReply(retry.finalText);
  }
  return {
    checked: await checkAnswer(answer, deps.read),
    rounds,
    calls: first.calls.length,
    usage,
    retried,
  };
}
