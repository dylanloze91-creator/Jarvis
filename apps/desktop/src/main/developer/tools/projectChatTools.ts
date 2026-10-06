import { z } from 'zod';
import {
  defineTool,
  searchWithFallback,
  toolSuccess,
  webProviderOrder,
  type RegisteredTool,
  type SearchProviderConfig,
  type SearchProviderRegistry,
  type Settings,
} from '@jarvis/core';
import { fail } from './common.js';

export interface ProjectChatToolDeps {
  getSettings: () => Settings;
  searchRegistry: SearchProviderRegistry;
  installedModels: () => string[];
  onSuggestCoder: (model: string, reason: string) => void;
  onRememberDecision: (text: string) => void;
  onOfferCompare: (alternateModel: string, reason: string) => void;
  webSearchUsed: () => boolean;
  markWebSearchUsed: () => void;
}

function searchConfig(settings: Settings): SearchProviderConfig {
  return { provider: settings.searchProvider, apiKey: settings.searchApiKey };
}

export const PROJECT_CHAT_EXTRA_TOOLS = [
  'dev_project_chat_suggest_coder',
  'dev_project_chat_remember_decision',
  'dev_project_chat_web_search',
  'dev_project_chat_offer_compare',
] as const;

export function createProjectChatTools(deps: ProjectChatToolDeps): RegisteredTool[] {
  return [
    defineTool({
      name: 'dev_project_chat_suggest_coder',
      description:
        'Propose un modèle Ollama déjà installé pour l’étape de code de la prochaine mission, avec une raison courte.',
      risk: 'safe',
      schema: z.object({
        model: z.string().min(1).max(100),
        reason: z.string().min(4).max(500),
      }),
      summarize: ({ model }) => `Modèle de code suggéré pour la mission : ${model}.`,
      execute: async ({ model, reason }) => {
        const installed = deps.installedModels();
        if (!installed.includes(model))
          return fail(
            'definitive',
            `« ${model} » n’est pas installé dans Ollama. Choisis un modèle de la liste installée, ou l’utilisateur doit confirmer un téléchargement.`,
          );
        deps.onSuggestCoder(model, reason);
        return toolSuccess(
          `Noté : pour le code, tu suggères ${model} (${reason}). L’utilisateur verra ce choix avant la mission.`,
        );
      },
    }),
    defineTool({
      name: 'dev_project_chat_remember_decision',
      description:
        'Enregistre une décision durable pour ce projet (ex. contrainte de gameplay, pas de tests en plus).',
      risk: 'safe',
      schema: z.object({ decision: z.string().min(3).max(300) }),
      summarize: ({ decision }) => `Mémoriser : ${decision}`,
      execute: async ({ decision }) => {
        deps.onRememberDecision(decision.trim());
        return toolSuccess(`Décision enregistrée pour ce projet : ${decision.trim()}`);
      },
    }),
    defineTool({
      name: 'dev_project_chat_web_search',
      description:
        'Une recherche web sur les modèles de code locaux récents (Ollama). Confirmation obligatoire ; une fois par discussion.',
      risk: 'confirm',
      forceConfirm: true,
      schema: z.object({ query: z.string().min(4).max(200) }),
      summarize: ({ query }) => `Rechercher sur le web : ${query}`,
      describeCommand: ({ query }) => `Recherche web (réglages Jarvis) : ${query}`,
      execute: async ({ query }) => {
        if (deps.webSearchUsed())
          return fail('definitive', 'Une recherche a déjà été faite dans cette discussion.');
        const settings = deps.getSettings();
        const config = searchConfig(settings);
        const { provider, fellBack } = deps.searchRegistry.createOrFallback(config);
        let response;
        try {
          response = await provider.search({ query, limit: 5 });
        } catch {
          const fallback = await searchWithFallback(
            deps.searchRegistry,
            webProviderOrder(deps.searchRegistry, config).filter((id) => id !== provider.id),
            config,
            { query, limit: 5 },
          );
          if (!fallback.results.length)
            return fail('recoverable', 'Aucun résultat de recherche exploitable.');
          response = { results: fallback.results, provider: fallback.label };
        }
        deps.markWebSearchUsed();
        const body = response.results
          .map((r, i) => `${i + 1}. ${r.title}\n${r.url}\n${r.snippet ?? ''}`)
          .join('\n\n');
        return toolSuccess(
          `Résultats (${provider.label}) — indique pour chaque modèle pertinent s’il tient sur 6 Go VRAM + 64 Go RAM ; ne propose pas de télécharger sans confirmation :\n\n${body}`,
        );
      },
    }),
    defineTool({
      name: 'dev_project_chat_offer_compare',
      description:
        'Propose de comparer le modèle de code actuel avec un autre modèle installé sur une petite modification (confirmation utilisateur).',
      risk: 'safe',
      schema: z.object({
        alternateModel: z.string().min(1).max(100),
        reason: z.string().min(4).max(400),
      }),
      summarize: ({ alternateModel }) => `Proposer une comparaison avec ${alternateModel}.`,
      execute: async ({ alternateModel, reason }) => {
        const installed = deps.installedModels();
        if (!installed.includes(alternateModel))
          return fail('definitive', `« ${alternateModel} » n’est pas installé.`);
        deps.onOfferCompare(alternateModel, reason);
        return toolSuccess(
          `Comparaison proposée avec ${alternateModel}. L’utilisateur peut confirmer le bouton « Comparer les modèles ».`,
        );
      },
    }),
  ];
}
