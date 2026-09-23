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

export const openAIDescriptor: ProviderDescriptor = {
  id: 'openai',
  label: 'OpenAI (ou API compatible)',
  requiresApiKey: true,
  defaultModel: 'gpt-4o-mini',
  suggestedModels: ['gpt-4o-mini', 'gpt-4o', 'gpt-4.1-mini', 'gpt-4.1'],
  defaultBaseUrl: 'https://api.openai.com/v1',
};

interface OpenAIDelta {
  content?: string | null;
  tool_calls?: {
    index: number;
    id?: string;
    function?: { name?: string; arguments?: string };
  }[];
}

interface OpenAIChunk {
  choices?: { delta?: OpenAIDelta; finish_reason?: string | null }[];
  error?: { message?: string };
}

/**
 * Fonctionne avec l'API OpenAI et tout backend qui en reprend le contrat
 * (Ollama, LM Studio, Groq, OpenRouter…) via `baseUrl`.
 */
export class OpenAIProvider implements LLMProvider {
  readonly id = openAIDescriptor.id;
  readonly label = openAIDescriptor.label;
  readonly requiresApiKey = true;
  readonly model: string;
  private readonly apiKey: string;
  private readonly baseUrl: string;

  constructor(config: ProviderConfig) {
    this.model = config.model || openAIDescriptor.defaultModel;
    this.apiKey = config.apiKey ?? '';
    this.baseUrl = (config.baseUrl || openAIDescriptor.defaultBaseUrl!).replace(/\/+$/, '');
  }

  async *streamChat(request: ChatRequest): AsyncIterable<ChatStreamEvent> {
    if (!this.apiKey) {
      yield { type: 'error', message: 'Clé API manquante pour le provider OpenAI.' };
      return;
    }

    const messages = toOpenAIMessages(request);
    const body: Record<string, unknown> = {
      model: this.model,
      messages,
      stream: true,
      temperature: request.temperature ?? 0.4,
    };
    if (request.maxTokens) body.max_tokens = request.maxTokens;
    if (request.tools?.length) {
      body.tools = request.tools.map((tool) => ({
        type: 'function',
        function: {
          name: tool.name,
          description: tool.description,
          parameters: tool.parameters,
        },
      }));
      body.tool_choice = 'auto';
    }

    const response = await fetch(`${this.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify(body),
      signal: request.signal,
    });

    if (!response.ok || !response.body) {
      throw new ProviderError(await readError(response), response.status);
    }

    const pending = new Map<number, { id: string; name: string; args: string }>();
    let finishReason: FinishReason = 'stop';

    for await (const { data } of parseSSE(response.body)) {
      if (data === '[DONE]') break;
      const chunk = safeJsonParse<OpenAIChunk>(data);
      if (!chunk) continue;
      if (chunk.error?.message) {
        yield { type: 'error', message: chunk.error.message };
        return;
      }

      const choice = chunk.choices?.[0];
      if (!choice) continue;

      const text = choice.delta?.content;
      if (text) yield { type: 'text', delta: text };

      for (const call of choice.delta?.tool_calls ?? []) {
        const slot = pending.get(call.index) ?? { id: '', name: '', args: '' };
        if (call.id) slot.id = call.id;
        if (call.function?.name) slot.name = call.function.name;
        if (call.function?.arguments) slot.args += call.function.arguments;
        pending.set(call.index, slot);
      }

      if (choice.finish_reason) {
        finishReason = choice.finish_reason === 'tool_calls' ? 'tool_calls' : 'stop';
      }
    }

    for (const slot of pending.values()) {
      if (!slot.name) continue;
      finishReason = 'tool_calls';
      yield {
        type: 'tool_call',
        call: {
          id: slot.id || `call-${slot.name}`,
          name: slot.name,
          arguments: safeJsonParse<Record<string, unknown>>(slot.args || '{}') ?? {},
        },
      };
    }

    yield { type: 'done', finishReason };
  }
}

function toOpenAIMessages(request: ChatRequest): Record<string, unknown>[] {
  const out: Record<string, unknown>[] = [];
  if (request.system) out.push({ role: 'system', content: request.system });

  for (const message of request.messages) {
    out.push(convert(message));
  }
  return out;
}

function convert(message: ChatMessage): Record<string, unknown> {
  if (message.role === 'tool') {
    return { role: 'tool', tool_call_id: message.toolCallId, content: message.content };
  }
  if (message.role === 'assistant' && message.toolCalls?.length) {
    return {
      role: 'assistant',
      content: message.content || null,
      tool_calls: message.toolCalls.map((call) => ({
        id: call.id,
        type: 'function',
        function: { name: call.name, arguments: JSON.stringify(call.arguments) },
      })),
    };
  }
  return { role: message.role, content: message.content };
}

async function readError(response: Response): Promise<string> {
  const raw = await response.text().catch(() => '');
  const parsed = safeJsonParse<{ error?: { message?: string } }>(raw);
  return parsed?.error?.message ?? raw.slice(0, 300) ?? `HTTP ${response.status}`;
}
