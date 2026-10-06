import type { ChatUsage, LLMProvider } from '../providers/types.js';
import type { ToolManager } from '../tools/manager.js';
import type { ConfirmationRequest } from '../tools/types.js';
import { createMessage, type ChatMessage, type ToolCall, type ToolCallOutcome } from '../types.js';

/**
 * Boucle modèle → outils de Jarvis Développeur. Pas l'Agent du chat : ses
 * intentions forcées (YouTube, Spotify, actualité) n'ont rien à faire ici,
 * et le chat reste intact. Même plafond de tours que le chat par défaut.
 */
export interface ToolLoopInput {
  provider: LLMProvider;
  /** Un gestionnaire d'outils, ou une vue filtrée (seuls les outils montrés au modèle). */
  tools: Pick<ToolManager, 'schemas' | 'execute'>;
  system: string;
  prompt: string;
  /** Images base64 (PNG/JPEG) pour le premier message utilisateur (aperçu projet). */
  userImages?: string[];
  maxRounds?: number;
  temperature?: number;
  /** Jetons au plus par réponse du modèle (5.0.1) ; absent : pas de plafond. */
  maxTokens?: number;
  signal?: AbortSignal;
  requestConfirmation?: (request: ConfirmationRequest) => Promise<boolean>;
  /** Appelé avant chaque tour du modèle (le chat peut y reprendre la main). */
  beforeRound?: (round: number) => Promise<void>;
  /**
   * Réponse sans appel d'outil (5.0.1) : un message pour relancer le modèle
   * (par exemple « écris maintenant ce fichier »), ou null pour s'arrêter.
   */
  nudge?: (answer: string, calls: readonly ToolLoopCall[]) => string | null;
}

export interface ToolLoopCall {
  name: string;
  arguments: Record<string, unknown>;
  status: 'ok' | 'error' | 'denied';
  content: string;
}

export interface ToolLoopResult {
  finalText: string;
  calls: ToolLoopCall[];
  rounds: number;
  stoppedBy: 'answer' | 'max-rounds' | 'error';
  error: string | null;
  usage: ChatUsage;
}

const EMPTY_USAGE: ChatUsage = {
  promptTokens: 0,
  promptMs: 0,
  outputTokens: 0,
  outputMs: 0,
  loadMs: 0,
  totalMs: 0,
};

export function addUsage(a: ChatUsage, b: ChatUsage | undefined): ChatUsage {
  if (!b) return a;
  return {
    promptTokens: a.promptTokens + b.promptTokens,
    promptMs: a.promptMs + b.promptMs,
    outputTokens: a.outputTokens + b.outputTokens,
    outputMs: a.outputMs + b.outputMs,
    loadMs: a.loadMs + b.loadMs,
    totalMs: a.totalMs + b.totalMs,
  };
}

/** Vue d'un gestionnaire limitée à quelques outils : les autres restent invisibles et refusés. */
export function toolView(
  manager: Pick<ToolManager, 'schemas' | 'execute'>,
  names: readonly string[],
): Pick<ToolManager, 'schemas' | 'execute'> {
  const allowed = new Set(names);
  return {
    schemas: () => manager.schemas().filter((schema) => allowed.has(schema.name)),
    execute: async (call, context, events) => {
      if (allowed.has(call.name)) return manager.execute(call, context, events);
      const outcome: ToolCallOutcome = {
        callId: call.id,
        name: call.name,
        status: 'error',
        content: `Outil indisponible à cette étape : « ${call.name} ». Aucune action n'a été effectuée.`,
        arguments: {},
        decision: 'blocked',
        durationMs: 0,
        outcome: 'definitive',
      };
      events?.onFinish?.(outcome);
      return outcome;
    },
  };
}

export async function runToolLoop(input: ToolLoopInput): Promise<ToolLoopResult> {
  const maxRounds = input.maxRounds ?? 6;
  const messages: ChatMessage[] = [
    createMessage('user', input.prompt, input.userImages?.length ? { images: input.userImages } : {}),
  ];
  const calls: ToolLoopCall[] = [];
  let usage = EMPTY_USAGE;
  let finalText = '';
  for (let round = 1; round <= maxRounds; round += 1) {
    let text = '';
    const pending: ToolCall[] = [];
    try {
      await input.beforeRound?.(round);
      for await (const event of input.provider.streamChat({
        system: input.system,
        messages,
        tools: input.tools.schemas(),
        temperature: input.temperature ?? 0,
        ...(input.maxTokens ? { maxTokens: input.maxTokens } : {}),
        signal: input.signal,
      })) {
        if (event.type === 'text') text += event.delta;
        else if (event.type === 'tool_call') pending.push(event.call);
        else if (event.type === 'done') usage = addUsage(usage, event.usage);
        else if (event.type === 'error') throw new Error(event.message);
      }
    } catch (error) {
      return {
        finalText: text,
        calls,
        rounds: round,
        stoppedBy: 'error',
        error: error instanceof Error ? error.message : String(error),
        usage,
      };
    }
    if (pending.length === 0) {
      const more = round < maxRounds ? input.nudge?.(text, calls) : null;
      if (more) {
        messages.push(createMessage('assistant', text));
        messages.push(createMessage('user', more));
        continue;
      }
      finalText = text;
      return { finalText, calls, rounds: round, stoppedBy: 'answer', error: null, usage };
    }
    messages.push(createMessage('assistant', text, { toolCalls: pending }));
    for (const call of pending) {
      const outcome = await input.tools.execute(call, {
        requestConfirmation: input.requestConfirmation ?? (async () => false),
        signal: input.signal,
      });
      calls.push({
        name: call.name,
        arguments: call.arguments,
        status: outcome.status,
        content: outcome.content,
      });
      messages.push(
        createMessage('tool', outcome.content, {
          toolCallId: call.id,
          toolName: call.name,
          toolStatus: outcome.status,
        }),
      );
    }
  }
  return { finalText, calls, rounds: maxRounds, stoppedBy: 'max-rounds', error: null, usage };
}
