import { z } from 'zod';
import { defineTool, type Settings } from '@jarvis/core';
import type { KnowledgeStore } from '../knowledge.js';

export function createKnowledgeTools(store: KnowledgeStore, getSettings: () => Settings) {
  const search = defineTool({
    name: 'search_jarvis_memory',
    description:
      "Recherche dans la mémoire locale, les documents indexés et les conversations précédentes de Jarvis. À utiliser quand une question concerne ce que Jarvis sait déjà de l'utilisateur ou d'un projet passé. Ne remplace pas web_search pour une information actuelle sur Internet.",
    risk: 'safe',
    schema: z.object({
      query: z.string().min(2).max(500),
      limit: z.number().int().min(1).max(8).default(6),
    }),
    execute: async ({ query, limit }) => {
      const results = await store.search(query, getSettings(), limit);
      if (!results.length) {
        return {
          ok: true,
          content: 'Aucune information pertinente trouvée dans la mémoire locale.',
        };
      }
      return {
        ok: true,
        content: results
          .map(
            (item, index) => `[${index + 1}] ${item.title}\nSource: ${item.source}\n${item.text}`,
          )
          .join('\n\n'),
        data: results.map(({ embedding: _embedding, ...rest }) => rest),
      };
    },
  });

  const remember = defineTool({
    name: 'remember_jarvis',
    description:
      "Enregistre une information explicitement demandée par l'utilisateur dans la mémoire longue durée locale de Jarvis. À utiliser seulement sur une demande claire (« souviens-toi que… »). Distinct de la personnalisation (ton, nom, règles).",
    risk: 'confirm',
    category: 'apps',
    isDestructive: false,
    schema: z.object({
      text: z.string().min(1).max(8_000),
      title: z.string().min(1).max(120).default('Mémoire Jarvis'),
    }),
    summarize: ({ title }) => `Mémoriser durablement : ${title}.`,
    execute: async ({ text, title }) => {
      await store.remember(text, getSettings(), title);
      return { ok: true, content: 'Information mémorisée localement par Jarvis.' };
    },
  });

  const index = defineTool({
    name: 'index_jarvis_folder',
    description:
      'Indexe un dossier local de documents texte pour que Jarvis puisse ensuite les rechercher. Les dossiers système, node_modules et dist sont ignorés. Confirmation obligatoire.',
    risk: 'confirm',
    category: 'files',
    forceConfirm: true,
    isDestructive: false,
    schema: z.object({
      path: z.string().min(1).describe('Chemin absolu du dossier à indexer.'),
    }),
    summarize: ({ path }) => `Indexer les documents du dossier ${path}.`,
    describeCommand: ({ path }) => path,
    execute: async ({ path }) => {
      try {
        const result = await store.indexFolder(path, getSettings());
        return {
          ok: true,
          content: `${result.files} fichier(s) indexé(s), ${result.chunks} passage(s) créés.`,
        };
      } catch (error) {
        return {
          ok: false,
          content: `Indexation impossible : ${error instanceof Error ? error.message : String(error)}`,
        };
      }
    },
  });

  const stats = defineTool({
    name: 'get_jarvis_memory_stats',
    description: 'Donne les statistiques de la mémoire documentaire locale de Jarvis.',
    risk: 'safe',
    schema: z.object({}),
    execute: async () => {
      const summary = await store.stats();
      return {
        ok: true,
        content: `${summary.chunks} passages, ${summary.sources} sources, ${summary.embedded} passages vectorisés (Ollama local).`,
        data: summary,
      };
    },
  });

  const clear = defineTool({
    name: 'clear_jarvis_memory',
    description:
      'Efface entièrement l’index documentaire et la mémoire longue durée locale de Jarvis. N’efface pas la personnalisation (ton, nom, règles). Confirmation obligatoire.',
    risk: 'confirm',
    category: 'apps',
    forceConfirm: true,
    isDestructive: true,
    schema: z.object({}),
    summarize: () => 'Effacer toute la mémoire documentaire de Jarvis.',
    execute: async () => {
      await store.clear();
      return { ok: true, content: 'Mémoire documentaire locale effacée.' };
    },
  });

  return [search, remember, index, stats, clear];
}
