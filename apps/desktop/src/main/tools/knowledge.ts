import { z } from 'zod';
import { defineTool, formatVideoMemory, type Settings, type VideoMemoryRecord } from '@jarvis/core';
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
      section: z.enum(['profile', 'preferences', 'projects', 'conversations']).default('projects'),
    }),
    summarize: ({ title }) => `Mémoriser durablement : ${title}.`,
    execute: async ({ text, title, section }) => {
      await store.remember(text, getSettings(), title, section);
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

  const indexFolder = defineTool({
    name: 'index_folder',
    description:
      "Indexe un dossier choisi par l'utilisateur (txt, md, json, csv, code, html, css, yaml, xml, sql, pdf lisible). Confirmation obligatoire. N'indexe rien d'autre.",
    risk: 'confirm',
    category: 'files',
    forceConfirm: true,
    isDestructive: false,
    schema: z.object({
      path: z.string().min(1).describe('Chemin absolu du dossier à indexer.'),
    }),
    summarize: ({ path }) => `Indexer le dossier ${path}.`,
    describeCommand: ({ path }) => path,
    execute: async ({ path }) => {
      try {
        const result = await store.indexFolder(path, getSettings());
        return {
          ok: true,
          outcome: 'success',
          content: `${result.files} fichier(s) indexé(s), ${result.chunks} passage(s) créés.`,
        };
      } catch (error) {
        return {
          ok: false,
          outcome: 'definitive',
          content: `Indexation impossible : ${error instanceof Error ? error.message : String(error)}`,
          technicalDetail: error instanceof Error ? error.message : String(error),
        };
      }
    },
  });

  const searchDocuments = defineTool({
    name: 'search_documents',
    description:
      "Cherche dans les documents indexés par l'utilisateur, pas dans toute la mémoire. Renvoie seulement les passages pertinents.",
    risk: 'safe',
    schema: z.object({
      query: z.string().min(2).max(500),
      limit: z.number().int().min(1).max(8).default(6),
    }),
    execute: async ({ query, limit }) => {
      const results = await store.searchDocuments(query, getSettings(), limit);
      if (!results.length) {
        return {
          ok: true,
          outcome: 'success',
          content: 'Aucun passage correspondant dans les documents indexés.',
        };
      }
      return {
        ok: true,
        outcome: 'success',
        content: results
          .map((item, i) => `[${i + 1}] ${item.title}\nSource: ${item.source}\n${item.text}`)
          .join('\n\n'),
      };
    },
  });

  const readDocument = defineTool({
    name: 'read_document',
    description:
      'Lit un document déjà indexé, par son chemin ou son nom de fichier. Ne charge pas le reste de la mémoire.',
    risk: 'safe',
    schema: z.object({
      source: z.string().min(1).max(1000).describe('Chemin ou nom du document indexé.'),
    }),
    execute: async ({ source }) => {
      const text = await store.readDocument(source);
      if (!text) {
        return {
          ok: false,
          outcome: 'definitive',
          content: `Document introuvable dans l'index : ${source}.`,
        };
      }
      return { ok: true, outcome: 'success', content: text };
    },
  });

  const rememberVideo = defineTool({
    name: 'remember_video',
    description:
      "Sur « garde cette vidéo en mémoire », indexe le résumé, les thèmes, concepts, chiffres, entreprises, risques, conclusions et timestamps. Ensuite une question retrouve les passages via search_jarvis_memory.",
    risk: 'confirm',
    category: 'apps',
    isDestructive: false,
    schema: z.object({
      summary: z.string().min(1).max(4000),
      themes: z.string().default(''),
      concepts: z.string().default(''),
      figures: z.string().default(''),
      companies: z.string().default(''),
      risks: z.string().default(''),
      conclusions: z.string().default(''),
      timestamps: z.string().default(''),
    }),
    summarize: () => 'Garder cette vidéo en mémoire.',
    execute: async (input) => {
      const record: VideoMemoryRecord = {
        summary: input.summary,
        themes: splitList(input.themes),
        concepts: splitList(input.concepts),
        figures: splitList(input.figures),
        companies: splitList(input.companies),
        risks: splitList(input.risks),
        conclusions: splitList(input.conclusions),
        timestamps: splitList(input.timestamps),
      };
      await store.remember(formatVideoMemory(record), getSettings(), 'Vidéo en mémoire', 'projects');
      return {
        ok: true,
        outcome: 'success',
        content: 'Vidéo indexée en mémoire locale. Une question ultérieure peut retrouver les passages.',
      };
    },
  });

  return [search, remember, index, stats, clear, indexFolder, searchDocuments, readDocument, rememberVideo];
}

function splitList(value: string): string[] {
  return value
    .split(/[|,;\n]/)
    .map((part) => part.trim())
    .filter(Boolean);
}
