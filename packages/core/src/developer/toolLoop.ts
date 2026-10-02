import type { ChatUsage, LLMProvider } from '../providers/types.js';
import type { ToolManager } from '../tools/manager.js';
import type { ConfirmationRequest } from '../tools/types.js';
import { createMessage, type ChatMessage, type ToolCall } from '../types.js';

/**
 * Boucle modèle → outils de Jarvis Développeur. Pas l'Agent du chat : ses
 * intentions forcées (YouTube, Spotify, actualité) n'ont rien à faire ici,
 * et le chat reste intact. Même plafond de tours que le chat par défaut.
 */
export interface ToolLoopInput {
  provider: LLMProvider;
  tools: ToolManager;
  system: string;
  prompt: string;
  maxRounds?: number;
  temperature?: number;
  signal?: AbortSignal;
  requestConfirmation?: (request: ConfirmationRequest) => Promise<boolean>;
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

export async function runToolLoop(input: ToolLoopInput): Promise<ToolLoopResult> {
  const maxRounds = input.maxRounds ?? 6;
  const messages: ChatMessage[] = [createMessage('user', input.prompt)];
  const calls: ToolLoopCall[] = [];
  let usage = EMPTY_USAGE;
  let finalText = '';
  for (let round = 1; round <= maxRounds; round += 1) {
    let text = '';
    const pending: ToolCall[] = [];
    try {
      for await (const event of input.provider.streamChat({
        system: input.system,
        messages,
        tools: input.tools.schemas(),
        temperature: input.temperature ?? 0,
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
