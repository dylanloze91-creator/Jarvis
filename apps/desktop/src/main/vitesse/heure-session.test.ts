import { afterAll, describe, expect, it } from 'vitest';
import {
  InMemoryAuditLogStore,
  InMemoryConversationStore,
  ProviderRegistry,
  TURN_NOTE_LABEL,
  ToolManager,
  emptyPersonalization,
  ollamaDescriptor,
  parseSettings,
  type ChatRequest,
} from '@jarvis/core';
import type { ChatEvent } from '../../shared/ipc.js';
import { ChatSession } from '../session.js';
import { stubLocalLearning } from '../test/localLearningStub.js';

/**
 * Ligne d'heure des équipes : dans le message système, dans Jarvis Test comme dans Jarvis Live.
 * Jarvis Test l'a placée en tête de la demande du 17 au 19 novembre : avec la personnalisation de
 * l'utilisateur, le modèle répondait alors à la note au lieu d'appeler l'outil (banc
 * `banc-outils-pc.banc.ts`, rapport `rapports/2026-11-19-correction-outils-pc.md`).
 */
const PRECEDENT = process.env.JARVIS_EDITION;

afterAll(() => {
  if (PRECEDENT === undefined) delete process.env.JARVIS_EDITION;
  else process.env.JARVIS_EDITION = PRECEDENT;
});

const ORCHESTRA = { enabled: true, brain: 'modele-cerveau' };
const HEURE = 'Date et heure du PC :';

async function tours(editionId: 'test' | 'live', texts: string[]) {
  process.env.JARVIS_EDITION = editionId;
  const requests: ChatRequest[] = [];
  const registry = new ProviderRegistry().register({ ...ollamaDescriptor }, (config) => ({
    id: 'ollama',
    label: 'Ollama',
    model: config.model,
    requiresApiKey: false,
    async *streamChat(request: ChatRequest) {
      const routeur = (request.system ?? '').includes('chef d');
      if (!routeur) requests.push(request);
      yield { type: 'text' as const, delta: routeur ? 'conversation' : 'Très bien.' };
      yield { type: 'done' as const, finishReason: 'stop' as const };
    },
  }));
  const settings = parseSettings({ provider: 'ollama', model: 'modele-chat', orchestra: ORCHESTRA });
  const store = new InMemoryConversationStore();
  const session = new ChatSession({
    registry,
    tools: new ToolManager(),
    store,
    auditLog: new InMemoryAuditLogStore(),
    getSettings: () => settings,
    voice: { hasApiKey: () => false } as never,
    personalization: { get: async () => emptyPersonalization() } as never,
    knowledge: { indexConversation: async () => 0 } as never,
    localLearning: stubLocalLearning(),
  });
  let conversationId: string | null = null;
  for (const text of texts) {
    const events: ChatEvent[] = [];
    const sender = {
      isDestroyed: () => false,
      send: (_channel: string, event: ChatEvent) => events.push(event),
    } as unknown as Electron.WebContents;
    await session.send(sender, { conversationId, text });
    const done = events.find((event): event is Extract<ChatEvent, { type: 'done' }> => event.type === 'done');
    conversationId = done?.conversationId ?? conversationId;
  }
  const saved = conversationId ? await store.get(conversationId) : null;
  return { requests, saved };
}

describe('ligne d’heure des équipes', () => {
  it.each(['test', 'live'] as const)('Jarvis %s : la ligne est dans le message système, la demande part telle quelle', async (editionId) => {
    const { requests, saved } = await tours(editionId, ['Donne-moi les informations sur mon PC']);
    expect(requests).toHaveLength(1);
    const request = requests[0]!;
    expect(request.system).toContain(HEURE);
    // Le modèle lit la demande de l'utilisateur, et rien d'autre : une note placée devant elle
    // faisait répondre sans appeler l'outil (défaut du 18 novembre).
    expect(request.messages.at(-1)).toMatchObject({ role: 'user', content: 'Donne-moi les informations sur mon PC' });
    expect(JSON.stringify(request.messages)).not.toContain(TURN_NOTE_LABEL);
    expect(JSON.stringify(request.messages)).not.toContain(HEURE);
    expect(JSON.stringify(saved)).not.toContain(TURN_NOTE_LABEL);
  });

  it('Jarvis Test : au tour suivant non plus, aucune demande ne porte de note', async () => {
    const { requests } = await tours('test', ['Raconte-moi une histoire courte', 'Et une autre, plus drôle']);
    expect(requests).toHaveLength(2);
    expect(requests[1]!.system).toContain(HEURE);
    const users = requests[1]!.messages.filter((message) => message.role === 'user');
    expect(users.map((message) => message.content)).toEqual(['Raconte-moi une histoire courte', 'Et une autre, plus drôle']);
  });

  it('Jarvis Test : une demande qui parle de temps a la ligne au même endroit', async () => {
    const { requests } = await tours('test', ['Dis-moi, il est déjà tard là, non ?']);
    expect(requests).toHaveLength(1);
    expect(requests[0]!.system).toContain(HEURE);
    expect(requests[0]!.messages.at(-1)!.content).toBe('Dis-moi, il est déjà tard là, non ?');
  });
});
