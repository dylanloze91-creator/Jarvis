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
 * Ligne d'heure des équipes : en tête de la demande dans Jarvis Test (le début du prompt reste
 * le même d'une minute à l'autre), dans le message système dans Jarvis Live (comme avant).
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
  it('Jarvis Test : en tête de la demande du tour, plus dans le message système', async () => {
    const { requests, saved } = await tours('test', ['Raconte-moi une histoire courte']);
    expect(requests).toHaveLength(1);
    const request = requests[0]!;
    expect(request.system).not.toContain(HEURE);
    const last = request.messages.at(-1)!;
    expect(last.role).toBe('user');
    expect(last.content.startsWith(`${TURN_NOTE_LABEL} ${HEURE}`)).toBe(true);
    expect(last.content.endsWith('\n\nRaconte-moi une histoire courte')).toBe(true);
    expect(last.content).toContain('jamais une estimation.');
    // Ce qui est affiché et enregistré ne porte pas la note.
    const users = saved?.messages.filter((message) => message.role === 'user') ?? [];
    expect(users.map((message) => message.content)).toEqual(['Raconte-moi une histoire courte']);
    expect(JSON.stringify(saved)).not.toContain(TURN_NOTE_LABEL);
  });

  it('Jarvis Test : au tour suivant, le message système est le même et l’ancienne demande n’a plus la note', async () => {
    const { requests } = await tours('test', ['Raconte-moi une histoire courte', 'Et une autre, plus drôle']);
    expect(requests).toHaveLength(2);
    expect(requests[1]!.system).toBe(requests[0]!.system);
    const users = requests[1]!.messages.filter((message) => message.role === 'user');
    expect(users[0]!.content).toBe('Raconte-moi une histoire courte');
    expect(users[1]!.content).toContain(HEURE);
  });

  it('Jarvis Test : une demande qui parle de temps garde la ligne dans le message système, comme avant', async () => {
    const { requests } = await tours('test', ['Dis-moi, il est déjà tard là, non ?']);
    expect(requests).toHaveLength(1);
    expect(requests[0]!.system).toContain(HEURE);
    expect(requests[0]!.messages.at(-1)!.content).toBe('Dis-moi, il est déjà tard là, non ?');
  });

  it('Jarvis Live : comme avant, la ligne est dans le message système et la demande ne change pas', async () => {
    const { requests } = await tours('live', ['Raconte-moi une histoire courte']);
    expect(requests).toHaveLength(1);
    expect(requests[0]!.system).toContain(HEURE);
    expect(requests[0]!.messages.at(-1)!.content).toBe('Raconte-moi une histoire courte');
  });
});
