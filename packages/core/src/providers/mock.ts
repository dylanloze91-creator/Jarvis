import { randomId } from '../types.js';
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
    const lastUser = [...request.messages].reverse().find((m) => m.role === 'user');
    const prompt = (lastUser?.content ?? '').toLowerCase();
    const alreadyRan = request.messages.some((m) => m.role === 'tool');
    const available = new Set((request.tools ?? []).map((t) => t.name));

    const plan = alreadyRan ? null : planToolCall(prompt, available);

    if (plan) {
      yield* stream(plan.preamble);
      yield { type: 'tool_call', call: { id: randomId(), name: plan.tool, arguments: plan.args } };
      yield { type: 'done', finishReason: 'tool_calls' };
      return;
    }

    yield* stream(alreadyRan ? summarizeToolRun(request) : answer(prompt));
    yield { type: 'done', finishReason: 'stop' };
  }
}

interface ToolPlan {
  preamble: string;
  tool: string;
  args: Record<string, unknown>;
}

function planToolCall(prompt: string, available: Set<string>): ToolPlan | null {
  if (
    available.has('get_system_info') &&
    /système|systeme|cpu|ram|mémoire|memoire|disque|stockage|lent|perf|machine|pc/.test(prompt)
  ) {
    return { preamble: 'Je regarde l’état de la machine.\n\n', tool: 'get_system_info', args: {} };
  }

  if (available.has('create_folder') && /dossier|répertoire|repertoire|folder/.test(prompt)) {
    return {
      preamble: 'Je prépare la création du dossier.\n\n',
      tool: 'create_folder',
      args: { name: extractFolderName(prompt), location: 'documents' },
    };
  }

  if (available.has('search_files') && /cherche|trouve|fichier|recherche/.test(prompt)) {
    return {
      preamble: 'Je lance la recherche.\n\n',
      tool: 'search_files',
      args: { query: extractQuery(prompt), location: 'documents' },
    };
  }

  return null;
}

function extractFolderName(prompt: string): string {
  const quoted = prompt.match(/[«"']([^»"']{1,60})[»"']/);
  if (quoted?.[1]) return quoted[1].trim();
  const named = prompt.match(/(?:nommé|nomme|appelé|appele|nommer)\s+([\w\-. ]{1,40})/);
  if (named?.[1]) return named[1].trim();
  return 'Nouveau dossier';
}

function extractQuery(prompt: string): string {
  const quoted = prompt.match(/[«"']([^»"']{1,60})[»"']/);
  if (quoted?.[1]) return quoted[1].trim();
  const words = prompt.replace(/[^\p{L}\p{N}\s.-]/gu, ' ').split(/\s+/).filter(Boolean);
  return words.at(-1) ?? '';
}

function summarizeToolRun(request: ChatRequest): string {
  const last = [...request.messages].reverse().find((m) => m.role === 'tool');
  const body = last?.content?.trim() ?? '';
  return [
    'Voici ce que j’ai obtenu :',
    '',
    body.length > 0 ? body : '_Aucun résultat retourné par l’outil._',
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
