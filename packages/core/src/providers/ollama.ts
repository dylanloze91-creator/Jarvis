import type { ChatMessage, ToolCall } from '../types.js';
import { parseNDJSON } from './ndjson.js';
import { safeJsonParse } from './sse.js';
import type { ToolSchema } from './types.js';
import {
  ProviderError,
  type ChatRequest,
  type ChatStreamEvent,
  type FinishReason,
  type ChatUsage,
  type LLMProvider,
  type OllamaCodeOptions,
  type ProviderConfig,
  type ProviderDescriptor,
} from './types.js';

/** Modèle par défaut : voir `packages/core/src/providers/ollamaModels.ts` pour la justification. */
export const OLLAMA_DEFAULT_MODEL = 'qwen2.5:3b';
/** Recommandé dans la doc. Pas le défaut : l'appel d'outils sur 6 Go n'est pas vérifié. */
export const OLLAMA_RECOMMENDED_MODEL = 'qwen3.5:4b';
export const OLLAMA_FALLBACK_MODEL = 'qwen2.5:3b';

/**
 * Fenêtre de contexte demandée à chaque requête, indépendamment de la valeur
 * par défaut du serveur. Avec ses 17 outils, Jarvis envoie environ 2 900
 * tokens de catalogue à chaque tour (mesuré, voir `ollamaModels.ts`) ; le
 * défaut d'Ollama (4096 tokens sous 24 Go de VRAM) laisse trop peu de place
 * pour la conversation elle-même. Le coût mémoire du doublement est faible
 * pour les modèles recommandés (attention multi-requêtes groupées, peu de
 * têtes clé/valeur), donc on le demande systématiquement plutôt que de
 * compter sur un réglage serveur que l'utilisateur devrait penser à changer.
 */
export const OLLAMA_RECOMMENDED_NUM_CTX = 8192;

export const ollamaDescriptor: ProviderDescriptor = {
  id: 'ollama',
  label: 'Ollama (local, gratuit)',
  requiresApiKey: false,
  defaultModel: OLLAMA_DEFAULT_MODEL,
  suggestedModels: ['qwen2.5:3b', 'qwen3.5:4b', 'qwen2.5:7b', 'qwen2.5:1.5b'],
  defaultBaseUrl: 'http://127.0.0.1:11434',
};

interface OllamaToolCallChunk {
  id?: string;
  function?: { index?: number; name?: string; arguments?: unknown };
}

interface OllamaChatChunk {
  message?: { role?: string; content?: string; tool_calls?: OllamaToolCallChunk[] };
  done?: boolean;
  done_reason?: string;
  error?: string;
  total_duration?: number;
  load_duration?: number;
  prompt_eval_count?: number;
  prompt_eval_duration?: number;
  eval_count?: number;
  eval_duration?: number;
}

const NS_PER_MS = 1_000_000;

function usageOf(chunk: OllamaChatChunk): ChatUsage {
  return {
    promptTokens: chunk.prompt_eval_count ?? 0,
    promptMs: (chunk.prompt_eval_duration ?? 0) / NS_PER_MS,
    outputTokens: chunk.eval_count ?? 0,
    outputMs: (chunk.eval_duration ?? 0) / NS_PER_MS,
    loadMs: (chunk.load_duration ?? 0) / NS_PER_MS,
    totalMs: (chunk.total_duration ?? 0) / NS_PER_MS,
  };
}

/** Nombre de caractères observés avant de trancher si un texte commence par une syntaxe d'appel d'outil échappée. */
const SNIFF_WINDOW = 24;

/**
 * Fournisseur pour un serveur Ollama local — parle l'API native `/api/chat`
 * plutôt que le point de compatibilité OpenAI, pour deux raisons : elle
 * distingue clairement « modèle sans outils » (erreur explicite) de
 * « appel d'outil réussi », et `/api/tags` y renvoie déjà la capacité
 * `tools` par modèle sans requête supplémentaire.
 *
 * Contrairement à OpenAI et Anthropic, un modèle local peut échouer à
 * produire un appel d'outil correctement formé sans jamais renvoyer
 * d'erreur HTTP — il répond juste en texte, ou laisse fuiter sa syntaxe
 * interne (`<tool_call>…</tool_call>`) dans le contenu. Ce provider détecte
 * ces deux cas et les transforme en repli explicite plutôt que de les
 * transmettre tels quels : voir `detectLeakedToolCallAttempt` et
 * `normalizeToolArguments`.
 */
export class OllamaProvider implements LLMProvider {
  readonly id = ollamaDescriptor.id;
  readonly label = ollamaDescriptor.label;
  readonly requiresApiKey = false;
  readonly model: string;
  private readonly baseUrl: string;
  private readonly codeOptions: OllamaCodeOptions | undefined;

  constructor(config: ProviderConfig) {
    this.model = config.model || ollamaDescriptor.defaultModel;
    this.baseUrl = (config.baseUrl || ollamaDescriptor.defaultBaseUrl!).replace(/\/+$/, '');
    this.codeOptions = config.ollama;
  }

  async *streamChat(request: ChatRequest): AsyncIterable<ChatStreamEvent> {
    const code = this.codeOptions;
    const body: Record<string, unknown> = {
      model: this.model,
      stream: true,
      messages: toOllamaMessages(request),
      options: {
        temperature: request.temperature ?? 0.25,
        num_ctx: code?.numCtx ?? OLLAMA_RECOMMENDED_NUM_CTX,
        ...(request.maxTokens ? { num_predict: request.maxTokens } : {}),
        ...(code?.numGpu !== undefined ? { num_gpu: code.numGpu } : {}),
        ...(code?.numThread !== undefined ? { num_thread: code.numThread } : {}),
        ...(code?.numBatch !== undefined ? { num_batch: code.numBatch } : {}),
      },
    };
    if (request.tools?.length) {
      body.tools = request.tools.map(toOllamaTool);
    }
    if (code?.think !== undefined) body.think = code.think;
    if (code?.keepAlive !== undefined) body.keep_alive = code.keepAlive;

    let response: Response;
    try {
      response = await fetch(`${this.baseUrl}/api/chat`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
        signal: request.signal,
      });
    } catch (error) {
      // Une annulation volontaire (Agent.run vérifie `signal.aborted`) prime sur
      // le message ci-dessous : celui-ci ne sera affiché que si ce n'en était pas une.
      throw new ProviderError(describeConnectionError(error, this.baseUrl));
    }

    if (!response.ok || !response.body) {
      const raw = await response.text().catch(() => '');
      throw new ProviderError(
        interpretOllamaHttpError(response.status, raw, this.model),
        response.status,
      );
    }

    yield* this.consume(response.body, code !== undefined);
  }

  private async *consume(
    body: ReadableStream<Uint8Array>,
    reportUsage: boolean,
  ): AsyncGenerator<ChatStreamEvent> {
    const pending = new Map<number, ToolCall>();
    let sawStructuredToolCall = false;
    let malformedDetail: string | null = null;
    let doneReason: string | undefined;
    let usage: ChatUsage | undefined;

    let fullText = '';
    let sniffed = false;
    let leakedMode = false;
    let holdBuffer = '';

    const emitSniffed = (): ChatStreamEvent | null => {
      if (leakedTagStart(holdBuffer)) {
        leakedMode = true;
        return null;
      }
      const delta = holdBuffer;
      holdBuffer = '';
      return delta ? { type: 'text', delta } : null;
    };

    for await (const chunk of parseNDJSON<OllamaChatChunk>(body)) {
      if (chunk.error) {
        throw new ProviderError(`Erreur Ollama : ${chunk.error}`);
      }

      const content = chunk.message?.content;
      if (content) {
        fullText += content;
        if (!sniffed) {
          holdBuffer += content;
          if (holdBuffer.length >= SNIFF_WINDOW) {
            sniffed = true;
            const event = emitSniffed();
            if (event) yield event;
          }
        } else if (!leakedMode) {
          yield { type: 'text', delta: content };
        }
      }

      for (const call of chunk.message?.tool_calls ?? []) {
        const index = call.function?.index ?? pending.size;
        const name = call.function?.name;
        if (!name) {
          malformedDetail = "un appel d'outil sans nom de fonction";
          continue;
        }
        const args = normalizeToolArguments(call.function?.arguments);
        if (args === undefined) {
          malformedDetail = `des arguments illisibles (JSON invalide) pour l'outil « ${name} »`;
          continue;
        }
        pending.set(index, { id: call.id || `call-${name}-${index}`, name, arguments: args });
        sawStructuredToolCall = true;
      }

      if (chunk.done) {
        doneReason = chunk.done_reason;
        if (reportUsage) usage = usageOf(chunk);
        break;
      }
    }

    if (malformedDetail) {
      throw new ProviderError(buildMalformedToolCallMessage(malformedDetail));
    }

    if (sawStructuredToolCall) {
      for (const call of pending.values()) yield { type: 'tool_call', call };
      yield usage
        ? { type: 'done', finishReason: 'tool_calls', usage }
        : { type: 'done', finishReason: 'tool_calls' };
      return;
    }

    if (!sniffed) {
      const event = emitSniffed();
      if (event) yield event;
    }

    const leaked = detectLeakedToolCallAttempt(fullText);
    if (leaked) {
      throw new ProviderError(buildLeakedToolCallMessage(leaked));
    }

    const finishReason: FinishReason = doneReason === 'length' ? 'length' : 'stop';
    yield usage ? { type: 'done', finishReason, usage } : { type: 'done', finishReason };
  }
}

function toOllamaTool(tool: ToolSchema): Record<string, unknown> {
  return {
    type: 'function',
    function: {
      name: tool.name,
      description: tool.description,
      parameters: tool.parameters,
    },
  };
}

function toOllamaMessages(request: ChatRequest): Record<string, unknown>[] {
  const out: Record<string, unknown>[] = [];
  if (request.system) out.push({ role: 'system', content: request.system });

  for (const message of request.messages) {
    out.push(convert(message));
  }
  return out;
}

function convert(message: ChatMessage): Record<string, unknown> {
  if (message.role === 'tool') {
    return { role: 'tool', content: message.content };
  }
  if (message.role === 'assistant' && message.toolCalls?.length) {
    return {
      role: 'assistant',
      content: message.content || '',
      tool_calls: message.toolCalls.map((call) => ({
        function: { name: call.name, arguments: call.arguments },
      })),
    };
  }
  return { role: message.role, content: message.content };
}

/**
 * Les arguments arrivent normalement déjà comme un objet JSON (l'API native
 * d'Ollama ne les encode pas en chaîne comme le fait l'API OpenAI). Certains
 * modèles renvoient malgré tout une chaîne, voire une valeur incohérente :
 * on l'accepte si elle se laisse encore interpréter, on refuse sinon plutôt
 * que de transmettre `{}` en silence à l'outil.
 */
function normalizeToolArguments(raw: unknown): Record<string, unknown> | undefined {
  if (raw === undefined || raw === null) return {};
  if (typeof raw === 'object' && !Array.isArray(raw)) return raw as Record<string, unknown>;
  if (typeof raw === 'string') {
    if (raw.trim().length === 0) return {};
    const parsed = safeJsonParse<Record<string, unknown>>(raw);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return parsed;
    return undefined;
  }
  return undefined;
}

/** Amorce d'une syntaxe d'appel d'outil échappée dans le texte, avant qu'on l'ait laissée fuiter à l'écran. */
function leakedTagStart(text: string): boolean {
  const trimmed = text.trimStart();
  if (trimmed.length === 0) return false;
  if (/^<\s*tool_call\b/i.test(trimmed)) return true;
  if (/^\{\s*"name"\s*:/.test(trimmed)) return true;
  return false;
}

export interface LeakedToolCallAttempt {
  raw: string;
}

/**
 * Détecte, sur le texte complet une fois le tour terminé, une tentative
 * d'appel d'outil qui a fui en clair au lieu de passer par le canal
 * structuré (`tool_calls`). Cas connu avec certains modèles Hermes/Qwen
 * quand le gabarit de chat n'est pas appliqué correctement.
 */
export function detectLeakedToolCallAttempt(text: string): LeakedToolCallAttempt | null {
  const trimmed = text.trim();
  if (trimmed.length === 0) return null;
  if (/<tool_call>/i.test(trimmed)) return { raw: trimmed };
  if (/^\{\s*"name"\s*:\s*"[^"]+"\s*,\s*"arguments"\s*:/.test(trimmed)) return { raw: trimmed };
  return null;
}

function describeConnectionError(error: unknown, baseUrl: string): string {
  const cause = (error as { cause?: { code?: string } } | undefined)?.cause;
  if (cause?.code === 'ECONNREFUSED') {
    return (
      `Aucun serveur Ollama ne répond à l'adresse ${baseUrl}. ` +
      "Vérifie qu'il est démarré (« ollama serve ») et réessaie."
    );
  }
  return (
    `Impossible de contacter le serveur Ollama à l'adresse ${baseUrl}. ` +
    "Vérifie l'URL de base dans les réglages, puis relance le test de connexion."
  );
}

function interpretOllamaHttpError(status: number, raw: string, model: string): string {
  const parsed = safeJsonParse<{ error?: string }>(raw);
  const errorMessage = parsed?.error ?? raw.slice(0, 300) ?? `HTTP ${status}`;

  if (/does not support tools/i.test(errorMessage)) {
    return (
      `Le modèle « ${model} » ne gère pas l'appel d'outils sur ce serveur Ollama. ` +
      `Choisis un modèle listé avec la capacité « tools » (ex. ${OLLAMA_DEFAULT_MODEL}) dans les réglages.`
    );
  }
  if (status === 404 || /not found/i.test(errorMessage)) {
    return (
      `Le modèle « ${model} » n'est pas installé sur ce serveur Ollama. ` +
      `Lance « ollama pull ${model} » puis réessaie, ou choisis un modèle déjà installé dans les réglages.`
    );
  }
  return `Erreur Ollama (HTTP ${status}) : ${errorMessage}`;
}

function buildMalformedToolCallMessage(detail: string): string {
  return (
    `Le modèle local a produit ${detail} : ce n'est pas un appel d'outil valide. ` +
    "Je m'arrête plutôt que d'improviser avec des arguments incorrects — c'est le signe que ce modèle " +
    'ne gère pas correctement l’appel d’outils. Utilise le test de connexion des réglages pour le vérifier, ' +
    `ou choisis un modèle plus fiable (ex. ${OLLAMA_DEFAULT_MODEL}).`
  );
}

function buildLeakedToolCallMessage(leaked: LeakedToolCallAttempt): string {
  const excerpt = leaked.raw.length > 160 ? `${leaked.raw.slice(0, 160)}…` : leaked.raw;
  return (
    "Le modèle local a tenté d'appeler un outil en texte brut au lieu d'un appel structuré " +
    `(« ${excerpt} »), et Ollama n'a pas su l'interpréter. Je m'arrête plutôt que d'afficher une réponse ` +
    "incohérente. Ce modèle n'est probablement pas fiable pour l'appel d'outils ici — vérifie-le avec le " +
    `test de connexion des réglages, ou choisis-en un autre (ex. ${OLLAMA_DEFAULT_MODEL}).`
  );
}
