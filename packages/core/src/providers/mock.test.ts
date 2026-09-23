import { describe, expect, it } from 'vitest';
import { MockProvider } from './mock.js';
import type { ChatStreamEvent, ToolSchema } from './types.js';
import { createMessage, type ChatMessage } from '../types.js';

const tools: ToolSchema[] = [
  { name: 'get_system_info', description: '', parameters: {} },
  { name: 'create_folder', description: '', parameters: {} },
  { name: 'list_processes', description: '', parameters: {} },
  { name: 'get_active_window', description: '', parameters: {} },
  { name: 'search_files', description: '', parameters: {} },
  { name: 'read_file', description: '', parameters: {} },
  { name: 'get_system_errors', description: '', parameters: {} },
  { name: 'open_application', description: '', parameters: {} },
  { name: 'close_application', description: '', parameters: {} },
  { name: 'move_file', description: '', parameters: {} },
  { name: 'copy_file', description: '', parameters: {} },
  { name: 'delete_file', description: '', parameters: {} },
  { name: 'take_screenshot', description: '', parameters: {} },
  { name: 'run_command', description: '', parameters: {} },
];

async function run(messages: ChatMessage[]): Promise<ChatStreamEvent[]> {
  const events: ChatStreamEvent[] = [];
  for await (const event of new MockProvider().streamChat({ messages, tools })) {
    events.push(event);
  }
  return events;
}

function text(events: ChatStreamEvent[]): string {
  return events
    .filter((event) => event.type === 'text')
    .map((event) => event.delta)
    .join('');
}

function calls(events: ChatStreamEvent[]) {
  return events.filter((event) => event.type === 'tool_call').map((event) => event.call);
}

describe('MockProvider', () => {
  it('appelle l’outil système quand la question porte sur la machine', async () => {
    const events = await run([createMessage('user', 'Que se passe-t-il sur mon PC ?')]);
    expect(calls(events)[0]?.name).toBe('get_system_info');
  });

  it('conserve la casse du nom de dossier demandé', async () => {
    const events = await run([createMessage('user', 'Crée un dossier nommé "Rapports 2026"')]);
    expect(calls(events)[0]).toMatchObject({
      name: 'create_folder',
      arguments: { name: 'Rapports 2026' },
    });
  });

  it('résume le résultat au lieu de rappeler l’outil dans le même tour', async () => {
    const events = await run([
      createMessage('user', 'Que se passe-t-il sur mon PC ?'),
      createMessage('assistant', '', {
        toolCalls: [{ id: 'c1', name: 'get_system_info', arguments: {} }],
      }),
      createMessage('tool', 'Mémoire : 8 Go', { toolCallId: 'c1', toolName: 'get_system_info' }),
    ]);

    expect(calls(events)).toHaveLength(0);
    expect(text(events)).toContain('Mémoire : 8 Go');
  });

  it('planifie un nouvel outil au tour suivant malgré l’historique', async () => {
    const events = await run([
      createMessage('user', 'Que se passe-t-il sur mon PC ?'),
      createMessage('assistant', '', {
        toolCalls: [{ id: 'c1', name: 'get_system_info', arguments: {} }],
      }),
      createMessage('tool', 'Mémoire : 8 Go', { toolCallId: 'c1', toolName: 'get_system_info' }),
      createMessage('assistant', 'Voici ce que j’ai obtenu.'),
      createMessage('user', 'Crée un dossier nommé "Projet"'),
    ]);

    expect(calls(events)[0]).toMatchObject({
      name: 'create_folder',
      arguments: { name: 'Projet' },
    });
  });

  it('répond sans outil quand la demande n’en réclame aucun', async () => {
    const events = await run([createMessage('user', 'Bonjour')]);
    expect(calls(events)).toHaveLength(0);
    expect(text(events).length).toBeGreaterThan(0);
  });

  it('planifie la liste des processus', async () => {
    const events = await run([createMessage('user', 'Quels sont les processus en cours ?')]);
    expect(calls(events)[0]).toMatchObject({ name: 'list_processes' });
  });

  it('planifie la fenêtre active', async () => {
    const events = await run([createMessage('user', 'Quelle est ma fenêtre active ?')]);
    expect(calls(events)[0]?.name).toBe('get_active_window');
  });

  it('planifie la lecture du journal d’événements', async () => {
    const events = await run([createMessage('user', 'Il y a des erreurs système récentes ?')]);
    expect(calls(events)[0]?.name).toBe('get_system_errors');
  });

  it('planifie une recherche de fichiers avec le motif demandé', async () => {
    const events = await run([createMessage('user', 'Recherche un fichier nommé "facture.pdf"')]);
    expect(calls(events)[0]).toMatchObject({
      name: 'search_files',
      arguments: { query: 'facture.pdf' },
    });
  });

  it('planifie la lecture d’un fichier', async () => {
    const events = await run([createMessage('user', 'Lis le fichier "notes.md"')]);
    expect(calls(events)[0]).toMatchObject({ name: 'read_file', arguments: { path: 'notes.md' } });
  });

  it('planifie une capture d’écran', async () => {
    const events = await run([createMessage('user', 'Fais une capture d’écran')]);
    expect(calls(events)[0]?.name).toBe('take_screenshot');
  });

  it('planifie l’ouverture d’une application par son nom courant', async () => {
    const events = await run([createMessage('user', 'Ouvre Chrome')]);
    expect(calls(events)[0]).toMatchObject({
      name: 'open_application',
      arguments: { name: 'Chrome' },
    });
  });

  it('planifie la fermeture d’une application', async () => {
    const events = await run([createMessage('user', 'Ferme Chrome')]);
    expect(calls(events)[0]).toMatchObject({
      name: 'close_application',
      arguments: { name: 'Chrome' },
    });
  });

  it('planifie un déplacement de fichier avec source et destination', async () => {
    const events = await run([createMessage('user', 'Déplace "a.txt" vers "b.txt"')]);
    expect(calls(events)[0]).toMatchObject({
      name: 'move_file',
      arguments: { source: 'a.txt', destination: 'b.txt' },
    });
  });

  it('planifie une suppression (corbeille)', async () => {
    const events = await run([createMessage('user', 'Supprime "vieux-fichier.txt"')]);
    expect(calls(events)[0]).toMatchObject({
      name: 'delete_file',
      arguments: { path: 'vieux-fichier.txt' },
    });
  });

  it('planifie une commande shell en séparant l’exécutable de ses arguments', async () => {
    const events = await run([createMessage('user', 'Exécute la commande "echo bonjour"')]);
    expect(calls(events)[0]).toMatchObject({
      name: 'run_command',
      arguments: { command: 'echo', args: ['bonjour'] },
    });
  });

  it('n’escalade pas vers run_command une simple demande d’ouverture', async () => {
    const events = await run([createMessage('user', 'Lance Spotify')]);
    expect(calls(events)[0]?.name).toBe('open_application');
  });
});
