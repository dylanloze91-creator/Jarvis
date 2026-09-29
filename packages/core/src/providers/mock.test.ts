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
  { name: 'web_search', description: '', parameters: {} },
  { name: 'web_research', description: '', parameters: {} },
  { name: 'fetch_page', description: '', parameters: {} },
  { name: 'youtube_transcript', description: '', parameters: {} },
  { name: 'get_stock_quote', description: '', parameters: {} },
  { name: 'spotify_play', description: '', parameters: {} },
  { name: 'spotify_pause', description: '', parameters: {} },
  { name: 'spotify_resume', description: '', parameters: {} },
  { name: 'spotify_next', description: '', parameters: {} },
  { name: 'spotify_previous', description: '', parameters: {} },
  { name: 'spotify_set_volume', description: '', parameters: {} },
  { name: 'spotify_set_shuffle', description: '', parameters: {} },
  { name: 'spotify_current_track', description: '', parameters: {} },
  { name: 'get_jarvis_personalization', description: '', parameters: {} },
  { name: 'set_jarvis_personalization', description: '', parameters: {} },
  { name: 'add_jarvis_personalization_rule', description: '', parameters: {} },
  { name: 'forget_jarvis_personalization', description: '', parameters: {} },
  { name: 'reset_jarvis_personalization', description: '', parameters: {} },
  { name: 'search_jarvis_memory', description: '', parameters: {} },
  { name: 'remember_jarvis', description: '', parameters: {} },
  { name: 'index_jarvis_folder', description: '', parameters: {} },
  { name: 'get_jarvis_memory_stats', description: '', parameters: {} },
  { name: 'clear_jarvis_memory', description: '', parameters: {} },
  { name: 'siteblock_get_status', description: '', parameters: {} },
  { name: 'siteblock_set_blocking', description: '', parameters: {} },
  { name: 'siteblock_add_domain', description: '', parameters: {} },
  { name: 'siteblock_remove_domain', description: '', parameters: {} },
  { name: 'siteblock_start_focus', description: '', parameters: {} },
  { name: 'siteblock_stop_focus', description: '', parameters: {} },
  { name: 'siteblock_add_period', description: '', parameters: {} },
  { name: 'siteblock_remove_period', description: '', parameters: {} },
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

  it('planifie la capture de l’action rapide du tableau de bord', async () => {
    const events = await run([createMessage('user', 'Prends une capture de l’écran.')]);
    expect(calls(events)[0]).toMatchObject({ name: 'take_screenshot', arguments: { display: 0 } });
  });

  it('salue même avec une majuscule', async () => {
    const events = await run([createMessage('user', 'Bonjour Jarvis')]);
    expect(text(events)).toMatch(/^Bonjour\. Je suis Jarvis/);
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

  it('planifie une recherche boursière et en extrait le nom de la société', async () => {
    const events = await run([createMessage('user', 'Quel est le cours de Nvidia ?')]);
    expect(calls(events)[0]).toMatchObject({
      name: 'get_stock_quote',
      arguments: { queries: ['Nvidia'] },
    });
  });

  it('planifie une recherche boursière pour plusieurs sociétés à la fois', async () => {
    const events = await run([createMessage('user', 'Cours de bourse de Nvidia et Apple')]);
    expect(calls(events)[0]).toMatchObject({
      name: 'get_stock_quote',
      arguments: { queries: ['Nvidia', 'Apple'] },
    });
  });

  it('planifie une recherche Internet et nettoie la formule d’introduction', async () => {
    const events = await run([
      createMessage('user', 'Peux-tu chercher sur Internet qui a inventé le jeu d’échecs ?'),
    ]);
    expect(calls(events)[0]).toMatchObject({
      name: 'web_search',
      arguments: { query: 'qui a inventé le jeu d’échecs' },
    });
  });

  it('planifie web_research pour une demande de recherche approfondie', async () => {
    const events = await run([
      createMessage('user', 'Fais une recherche approfondie sur Qwen 3.5'),
    ]);
    expect(calls(events)[0]?.name).toBe('web_research');
    const args = calls(events)[0]?.arguments as { queries: string[] };
    expect(args.queries.length).toBeGreaterThanOrEqual(2);
  });

  it('planifie youtube_transcript seulement si le lien est dans le dernier message', async () => {
    const events = await run([
      createMessage('user', 'Résume https://youtu.be/dQw4w9WgXcQ'),
    ]);
    expect(calls(events)[0]).toMatchObject({
      name: 'youtube_transcript',
      arguments: { url: 'https://youtu.be/dQw4w9WgXcQ' },
    });

    const later = await run([
      createMessage('user', 'Résume https://youtu.be/dQw4w9WgXcQ'),
      createMessage('assistant', 'Condensé.'),
      createMessage('user', 'Quelle heure est-il ?'),
    ]);
    expect(calls(later)[0]?.name).not.toBe('youtube_transcript');
  });

  it('planifie la lecture d’une page quand une URL est fournie', async () => {
    const events = await run([
      createMessage('user', 'Peux-tu résumer cette page : https://fr.wikipedia.org/wiki/Nvidia ?'),
    ]);
    expect(calls(events)[0]).toMatchObject({
      name: 'fetch_page',
      arguments: { url: 'https://fr.wikipedia.org/wiki/Nvidia' },
    });
  });

  it('planifie la lecture d’un morceau sur Spotify (« … sur Spotify »)', async () => {
    const events = await run([createMessage('user', 'Lance Get Lucky de Daft Punk sur Spotify')]);
    expect(calls(events)[0]).toMatchObject({
      name: 'spotify_play',
      arguments: { query: 'Get Lucky de Daft Punk' },
    });
  });

  it('planifie la lecture d’un morceau sur Spotify (« mets du … »)', async () => {
    const events = await run([createMessage('user', 'Mets du Daft Punk')]);
    expect(calls(events)[0]).toMatchObject({
      name: 'spotify_play',
      arguments: { query: 'Daft Punk' },
    });
  });

  it('planifie « écouter On Verra de Nekfeu » vers spotify_play (repro 0.4.2)', async () => {
    const events = await run([createMessage('user', 'écouter On Verra de Nekfeu')]);
    expect(calls(events)[0]).toMatchObject({
      name: 'spotify_play',
      arguments: { query: 'On Verra de Nekfeu' },
    });
  });

  it('planifie « je veux écouter un versat de Necfeu » vers spotify_play', async () => {
    const events = await run([createMessage('user', 'je veux écouter un versat de Necfeu')]);
    expect(calls(events)[0]?.name).toBe('spotify_play');
    expect(String(calls(events)[0]?.arguments.query)).toMatch(/versat de Necfeu/i);
  });

  it('« Lance Spotify » seul reste une ouverture d’application, pas une lecture', async () => {
    const events = await run([createMessage('user', 'Lance Spotify')]);
    expect(calls(events)[0]).toMatchObject({
      name: 'open_application',
      arguments: { name: 'Spotify' },
    });
  });

  it('« lance Chrome » ouvre l’application, ne lance pas de morceau', async () => {
    const events = await run([createMessage('user', 'Lance Chrome')]);
    expect(calls(events)[0]).toMatchObject({
      name: 'open_application',
      arguments: { name: 'Chrome' },
    });
  });

  it('après une lecture, un autre sujet ne reste pas sur Spotify', async () => {
    const events = await run([
      createMessage('user', 'écouter On Verra de Nekfeu'),
      createMessage('assistant', 'Lecture lancée sur Spotify : On Verra.'),
      createMessage('user', 'quelle heure est-il ?'),
    ]);
    expect(calls(events)[0]?.name).not.toBe('spotify_play');
    expect(calls(events)[0]?.name).not.toBe('spotify_pause');
  });

  it('planifie la mise en pause de Spotify', async () => {
    const events = await run([createMessage('user', 'Pause')]);
    expect(calls(events)[0]?.name).toBe('spotify_pause');
  });

  it('planifie la reprise de la lecture Spotify', async () => {
    const events = await run([createMessage('user', 'Reprends la musique')]);
    expect(calls(events)[0]?.name).toBe('spotify_resume');
  });

  it('planifie le morceau Spotify suivant', async () => {
    const events = await run([createMessage('user', 'Passe au morceau suivant')]);
    expect(calls(events)[0]?.name).toBe('spotify_next');
  });

  it('planifie le morceau Spotify précédent', async () => {
    const events = await run([createMessage('user', 'Reviens au morceau précédent')]);
    expect(calls(events)[0]?.name).toBe('spotify_previous');
  });

  it('planifie le réglage du volume Spotify avec le pourcentage demandé', async () => {
    const events = await run([createMessage('user', 'Mets le volume Spotify à 50 %')]);
    expect(calls(events)[0]).toMatchObject({
      name: 'spotify_set_volume',
      arguments: { percent: 50 },
    });
  });

  it('planifie l’activation du shuffle Spotify', async () => {
    const events = await run([createMessage('user', 'Active le shuffle sur Spotify')]);
    expect(calls(events)[0]).toMatchObject({
      name: 'spotify_set_shuffle',
      arguments: { enabled: true },
    });
  });

  it('planifie la désactivation du shuffle Spotify', async () => {
    const events = await run([createMessage('user', 'Désactive le mode aléatoire')]);
    expect(calls(events)[0]).toMatchObject({
      name: 'spotify_set_shuffle',
      arguments: { enabled: false },
    });
  });

  it('planifie la consultation du morceau Spotify en cours', async () => {
    const events = await run([createMessage('user', "Qu'est-ce qui joue ?")]);
    expect(calls(events)[0]?.name).toBe('spotify_current_track');
  });

  it('planifie « appelle-moi Monsieur » vers set_jarvis_personalization', async () => {
    const events = await run([createMessage('user', 'Appelle-moi Monsieur.')]);
    expect(calls(events)[0]).toMatchObject({
      name: 'set_jarvis_personalization',
      arguments: { scope: 'user', key: 'preferredName', value: 'Monsieur' },
    });
  });

  it('planifie « efface toute ta personnalisation » vers reset', async () => {
    const events = await run([createMessage('user', 'Efface toute ta personnalisation.')]);
    expect(calls(events)[0]?.name).toBe('reset_jarvis_personalization');
  });

  it('planifie « cherche dans ta mémoire » vers search_jarvis_memory, pas web_search', async () => {
    const events = await run([
      createMessage('user', 'Cherche dans ta mémoire le projet SiteBlock'),
    ]);
    expect(calls(events)[0]).toMatchObject({
      name: 'search_jarvis_memory',
      arguments: { query: 'le projet SiteBlock', limit: 6 },
    });
  });

  it('planifie « souviens-toi que » vers remember_jarvis', async () => {
    const events = await run([
      createMessage('user', 'Souviens-toi que le code Wi-Fi du bureau est Jarvis42'),
    ]);
    expect(calls(events)[0]?.name).toBe('remember_jarvis');
  });

  it('planifie « active mon mode travail » vers SiteBlock', async () => {
    const events = await run([createMessage('user', 'active mon mode travail')]);
    expect(calls(events)[0]).toMatchObject({
      name: 'siteblock_start_focus',
      arguments: { minutes: 60 },
    });
  });

  it('planifie « bloque Instagram » vers SiteBlock', async () => {
    const events = await run([createMessage('user', 'bloque Instagram')]);
    expect(calls(events)[0]).toMatchObject({
      name: 'siteblock_add_domain',
      arguments: { domain: 'instagram.com' },
    });
  });

  it('« Lance Chrome » n’est pas volé par SiteBlock', async () => {
    const events = await run([createMessage('user', 'Lance Chrome')]);
    expect(calls(events)[0]).toMatchObject({
      name: 'open_application',
      arguments: { name: 'Chrome' },
    });
  });
});
