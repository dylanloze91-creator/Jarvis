import type { LLMProvider } from '../providers/types.js';
import type { ToolManager } from '../tools/manager.js';
import type { ToolContext } from '../tools/types.js';
import { createMessage, type ChatMessage, type ToolCall, type ToolCallOutcome } from '../types.js';

export type AgentEvent =
  | { type: 'assistant_delta'; delta: string }
  | { type: 'assistant_message'; message: ChatMessage }
  | { type: 'tool_start'; call: ToolCall }
  | { type: 'tool_result'; outcome: ToolCallOutcome; message: ChatMessage }
  | { type: 'error'; message: string }
  | { type: 'done' };

export interface AgentOptions {
  systemPrompt: string;
  /** Garde-fou contre les boucles d'outils sans fin. */
  maxToolRounds?: number;
  temperature?: number;
  maxTokens?: number;
}

export const DEFAULT_SYSTEM_PROMPT = [
  "Tu es Jarvis, l'assistant personnel de l'utilisateur sur son PC Windows.",
  'Réponds en français, de façon naturelle, directe et concise.',
  "Tu ne peux agir sur l'ordinateur qu'à travers les outils qui te sont fournis.",
  "N'invente jamais un résultat : si tu as besoin d'une information sur la machine, appelle l'outil correspondant.",
  "Certaines actions demandent l'accord de l'utilisateur ; s'il refuse, accepte-le sans insister.",
].join(' ');

/**
 * Orchestre un tour de conversation : appel du modèle, exécution des outils
 * demandés, puis relance du modèle avec les résultats jusqu'à la réponse finale.
 */
export class Agent {
  constructor(
    private readonly provider: LLMProvider,
    private readonly tools: ToolManager,
    private readonly options: AgentOptions,
  ) {}

  async *run(history: ChatMessage[], context: ToolContext): AsyncGenerator<AgentEvent> {
    const conversation = [...history];
    const maxRounds = this.options.maxToolRounds ?? 5;

    for (let round = 0; round <= maxRounds; round += 1) {
      let text = '';
      const calls: ToolCall[] = [];
      let failed = false;

      try {
        const stream = this.provider.streamChat({
          messages: [...conversation],
          system: this.options.systemPrompt,
          tools: this.tools.schemas(),
          temperature: this.options.temperature,
          maxTokens: this.options.maxTokens,
          signal: context.signal,
        });

        for await (const event of stream) {
          if (event.type === 'text') {
            text += event.delta;
            yield { type: 'assistant_delta', delta: event.delta };
          } else if (event.type === 'tool_call') {
            calls.push(event.call);
          } else if (event.type === 'error') {
            failed = true;
            yield { type: 'error', message: event.message };
            break;
          }
        }
      } catch (error) {
        if (context.signal?.aborted) {
          yield { type: 'done' };
          return;
        }
        yield { type: 'error', message: describeError(error) };
        return;
      }

      if (failed) return;

      const assistantMessage = createMessage(
        'assistant',
        text,
        calls.length > 0 ? { toolCalls: calls } : {},
      );
      conversation.push(assistantMessage);
      yield { type: 'assistant_message', message: assistantMessage };

      if (calls.length === 0) {
        yield { type: 'done' };
        return;
      }

      for (const call of calls) {
        yield { type: 'tool_start', call };
        const outcome = await this.tools.execute(call, context);
        const toolMessage = createMessage('tool', outcome.content, {
          toolCallId: call.id,
          toolName: call.name,
        });
        conversation.push(toolMessage);
        yield { type: 'tool_result', outcome, message: toolMessage };
      }
    }

    yield {
      type: 'error',
      message: "Trop d'appels d'outils enchaînés, j'ai interrompu la boucle par sécurité.",
    };
  }
}

function describeError(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}
