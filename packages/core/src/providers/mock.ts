import { randomId, type ChatMessage } from '../types.js';
import type {
  ChatRequest,
  ChatStreamEvent,
  LLMProvider,
  ProviderConfig,
  ProviderDescriptor,
} from './types.js';

export const mockDescriptor: ProviderDescriptor = {
  id: 'mock',
  label: 'Démo hors ligne (sans clé API)',
  requiresApiKey: false,
  defaultModel: 'jarvis-demo',
  suggestedModels: ['jarvis-demo'],
};

/**
 * Provider de démonstration : aucune requête réseau, aucune clé. Il sert à
 * faire tourner l'application et la boucle d'outils immédiatement après le
 * clonage, et de filet de sécurité quand aucune clé n'est configurée.
 */
export class MockProvider implements LLMProvider {
  readonly id = mockDescriptor.id;
  readonly label = mockDescriptor.label;
  readonly requiresApiKey = false;
  readonly model: string;

  constructor(config?: ProviderConfig) {
    this.model = config?.model || mockDescriptor.defaultModel;
  }

  async *streamChat(request: ChatRequest): AsyncIterable<ChatStreamEvent> {
    // Seul le tour courant compte : les outils des tours précédents ne doivent
    // pas empêcher d'en planifier un nouveau.
    const turn = currentTurn(request.messages);
    const prompt = turn.find((m) => m.role === 'user')?.content ?? '';
    const alreadyRan = turn.some((m) => m.role === 'tool');
    const available = new Set((request.tools ?? []).map((t) => t.name));

    const plan = alreadyRan ? null : planToolCall(prompt, available);

    if (plan) {
      yield* stream(plan.preamble);
      yield { type: 'tool_call', call: { id: randomId(), name: plan.tool, arguments: plan.args } };
      yield { type: 'done', finishReason: 'tool_calls' };
      return;
    }

    yield* stream(alreadyRan ? summarizeToolRun(turn) : answer(prompt));
    yield { type: 'done', finishReason: 'stop' };
  }
}

/** Messages postérieurs au dernier message utilisateur, celui-ci inclus. */
function currentTurn(messages: ChatMessage[]): ChatMessage[] {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    if (messages[index]?.role === 'user') return messages.slice(index);
  }
  return messages;
}

interface ToolPlan {
  preamble: string;
  tool: string;
  args: Record<string, unknown>;
}

function planToolCall(prompt: string, available: Set<string>): ToolPlan | null {
  const normalized = prompt.toLowerCase();

  if (
    available.has('get_system_info') &&
    /système|systeme|cpu|ram|mémoire|memoire|disque|stockage|lent|perf|machine|pc/.test(normalized)
  ) {
    return { preamble: 'Je regarde l’état de la machine.\n\n', tool: 'get_system_info', args: {} };
  }

  if (available.has('create_folder') && /dossier|répertoire|repertoire|folder/.test(normalized)) {
    return {
      preamble: 'Je prépare la création du dossier.\n\n',
      tool: 'create_folder',
      args: { name: extractFolderName(prompt), location: 'documents' },
    };
  }

  return null;
}

function extractFolderName(prompt: string): string {
  const quoted = prompt.match(/[«"']([^»"']{1,60})[»"']/);
  if (quoted?.[1]) return quoted[1].trim();
  const named = prompt.match(/(?:nommé|nomme|appelé|appele|nommer)\s+([\p{L}\p{N}\-_. ]{1,40})/iu);
  if (named?.[1]) return named[1].trim();
  return 'Nouveau dossier';
}

function summarizeToolRun(turn: ChatMessage[]): string {
  const last = [...turn].reverse().find((m) => m.role === 'tool');
  const body = last?.content?.trim() ?? '';
  const lines = body
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);

  return [
    'Voici ce que j’ai obtenu :',
    '',
    lines.length > 0
      ? lines.map((line) => `- ${line}`).join('\n')
      : '_Aucun résultat retourné par l’outil._',
    '',
    '_(Réponse générée par le provider de démonstration. Ajoute une clé API dans les réglages pour parler à un vrai modèle.)_',
  ].join('\n');
}

function answer(prompt: string): string {
  if (prompt.trim().length === 0) {
    return 'Je t’écoute. Pose-moi une question ou demande-moi une action.';
  }
  if (/bonjour|salut|hello|hey/.test(prompt)) {
    return 'Bonjour. Je suis Jarvis, en mode démonstration hors ligne. Demande-moi l’état de ta machine ou la création d’un dossier pour voir la boucle d’outils en action.';
  }
  return [
    `Tu m’as demandé : « ${prompt} ».`,
    '',
    'Je tourne actuellement avec le **provider de démonstration**, qui ne contacte aucun modèle distant. Il sert à valider l’interface, le streaming et la boucle d’outils.',
    '',
    'Pour une vraie réponse, ouvre les réglages et renseigne une clé API OpenAI ou Anthropic.',
  ].join('\n');
}

async function* stream(text: string): AsyncGenerator<ChatStreamEvent> {
  for (const token of text.match(/\S+\s*|\s+/g) ?? []) {
    yield { type: 'text', delta: token };
    await sleep(12);
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
