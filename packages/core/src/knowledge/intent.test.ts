import { describe, expect, it } from 'vitest';
import { extractKnowledgeIntent } from './intent.js';

describe('extractKnowledgeIntent', () => {
  it('route une recherche dans la mémoire locale', () => {
    expect(extractKnowledgeIntent('Cherche dans ta mémoire le projet SiteBlock')).toEqual({
      tool: 'search_jarvis_memory',
      args: { query: 'le projet SiteBlock', limit: 6 },
    });
  });

  it('enregistre un fait explicite, pas une préférence de ton', () => {
    expect(extractKnowledgeIntent('Souviens-toi que le code Wi-Fi du bureau est Jarvis42')).toEqual(
      {
        tool: 'remember_jarvis',
        args: { text: 'le code Wi-Fi du bureau est Jarvis42', title: 'Mémoire Jarvis' },
      },
    );
    expect(extractKnowledgeIntent('Souviens-toi que je veux des réponses courtes')).toBeNull();
  });

  it('indexe un dossier nommé', () => {
    expect(
      extractKnowledgeIntent('Indexe le dossier C:\\Users\\thedexios\\Documents\\Jarvis'),
    ).toEqual({
      tool: 'index_jarvis_folder',
      args: { path: 'C:\\Users\\thedexios\\Documents\\Jarvis' },
    });
  });

  it('efface seulement la mémoire documentaire, pas la personnalisation', () => {
    expect(extractKnowledgeIntent('Efface toute ta mémoire documentaire')).toEqual({
      tool: 'clear_jarvis_memory',
      args: {},
    });
    expect(extractKnowledgeIntent('Efface toute ta personnalisation')).toBeNull();
  });

  it('ignore une recherche web générique', () => {
    expect(extractKnowledgeIntent('Cherche sur Internet qui a fondé Nvidia')).toBeNull();
  });
});
