import type { ChatMessage } from '../types.js';
import { parseSSE, safeJsonParse } from './sse.js';
import {
  ProviderError,
  type ChatRequest,
  type ChatStreamEvent,
  type FinishReason,
  type LLMProvider,
  type ProviderConfig,
  type ProviderDescriptor,
} from './types.js';

export const anthropicDescriptor: ProviderDescriptor = {
  id: 'anthropic',
  label: 'Anthropic Claude',
  requiresApiKey: true,
  defaultModel: 'claude-sonnet-4-5',
  suggestedModels: ['claude-sonnet-4-5', 'claude-opus-4-1', 'claude-haiku-4-5'],
  defaultBaseUrl: 'https://api.anthropic.com/v1',
};

interface AnthropicEvent {
  type: string;
  index?: number;
  content_block?: { type: string; id?: string; name?: string };
  delta?: { type?: string; text?: string; partial_json?: string; stop_reason?: string };
  error?: { message?: string };
}

export class AnthropicProvider implements LLMProvider {
  readonly id = anthropicDescriptor.id;
  readonly label = anthropicDescriptor.label;
  readonly requiresApiKey = true;
  readonly model: string;
  private readonly apiKey: string;
  private readonly baseUrl: string;

  constructor(config: ProviderConfig) {
    this.model = config.model || anthropicDescriptor.defaultModel;
    this.apiKey = config.apiKey ?? '';
    this.baseUrl = (config.baseUrl || anthropicDescriptor.defaultBaseUrl!).replace(/\/+$/, '');
  }

  async *streamChat(request: ChatRequest): AsyncIterable<ChatStreamEvent> {
    if (!this.apiKey) {
      yield { type: 'error', message: 'Clé API manquante pour le provider Anthropic.' };
      return;
    }

    const body: Record<string, unknown> = {
      model: this.model,
      max_tokens: request.maxTokens ?? 2048,
      temperature: request.temperature ?? 0.4,
      stream: true,
      messages: toAnthropicMessages(request.messages),
    };
    if (request.system) body.system = request.system;
    if (request.tools?.length) {
      body.tools = request.tools.map((tool) => ({
        name: tool.name,
        description: tool.description,
        input_schema: tool.parameters,
      }));
    }

    const response = await fetch(`${this.baseUrl}/messages`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': this.apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify(body),
      signal: request.signal,
    });

    if (!response.ok || !response.body) {
      throw new ProviderError(await readError(response), response.status);
    }

    const blocks = new Map<number, { id: string; name: string; json: string }>();
    let finishReason: FinishReason = 'stop';

    for await (const { data } of parseSSE(response.body)) {
      const event = safeJsonParse<AnthropicEvent>(data);
      if (!event) continue;

      switch (event.type) {
        case 'content_block_start': {
          if (event.content_block?.type === 'tool_use' && event.index !== undefined) {
            blocks.set(event.index, {
              id: event.content_block.id ?? '',
              name: event.content_block.name ?? '',
              json: '',
            });
          }
          break;
        }
        case 'content_block_delta': {
          if (event.delta?.type === 'text_delta' && event.delta.text) {
            yield { type: 'text', delta: event.delta.text };
          } else if (event.delta?.type === 'input_json_delta' && event.index !== undefined) {
            const slot = blocks.get(event.index);
            if (slot) slot.json += event.delta.partial_json ?? '';
          }
          break;
        }
        case 'message_delta': {
          if (event.delta?.stop_reason === 'tool_use') finishReason = 'tool_calls';
          else if (event.delta?.stop_reason === 'max_tokens') finishReason = 'length';
          break;
        }
        case 'error': {
          yield { type: 'error', message: event.error?.message ?? 'Erreur Anthropic inconnue.' };
          return;
        }
      }
    }

    for (const slot of blocks.values()) {
      if (!slot.name) continue;
      finishReason = 'tool_calls';
      yield {
        type: 'tool_call',
        call: {
          id: slot.id || `call-${slot.name}`,
          name: slot.name,
          arguments: safeJsonParse<Record<string, unknown>>(slot.json || '{}') ?? {},
        },
      };
    }

    yield { type: 'done', finishReason };
  }
}

/**
 * Anthropic attend des blocs typés plutôt que des messages `tool` séparés :
 * les résultats d'outils consécutifs sont regroupés dans un message `user`.
 */
function toAnthropicMessages(messages: ChatMessage[]): Record<string, unknown>[] {
  const out: Record<string, unknown>[] = [];

  for (const message of messages) {
    if (message.role === 'system') continue;

    if (message.role === 'tool') {
      const block = {
        type: 'tool_result',
        tool_use_id: message.toolCallId,
        content: message.content,
      };
      const last = out.at(-1);
      if (last && last.role === 'user' && Array.isArray(last.content)) {
        (last.content as unknown[]).push(block);
      } else {
        out.push({ role: 'user', content: [block] });
      }
      continue;
    }

    if (message.role === 'assistant' && message.toolCalls?.length) {
      const content: unknown[] = [];
      if (message.content) content.push({ type: 'text', text: message.content });
      for (const call of message.toolCalls) {
        content.push({ type: 'tool_use', id: call.id, name: call.name, input: call.arguments });
      }
      out.push({ role: 'assistant', content });
      continue;
    }

    if (message.content.trim().length === 0) continue;
    out.push({ role: message.role, content: [{ type: 'text', text: message.content }] });
  }

  return out;
}

async function readError(response: Response): Promise<string> {
  const raw = await response.text().catch(() => '');
  const parsed = safeJsonParse<{ error?: { message?: string } }>(raw);
  return parsed?.error?.message ?? raw.slice(0, 300) ?? `HTTP ${response.status}`;
}
