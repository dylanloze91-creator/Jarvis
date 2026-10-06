import { z } from 'zod';
import {
  codeModelById,
  defineTool,
  formatModelSize,
  toolSuccess,
  type RegisteredTool,
} from '@jarvis/core';
import type { OllamaApi } from '../models/ollamaApi.js';
import { fail } from './common.js';

export interface ModelToolDeps {
  ollama: () => OllamaApi;
  modelsDir: () => string;
  freeBytes: (path: string) => Promise<number | null>;
  /** Faux tant que l'utilisateur n'a pas validé une configuration pour ce modèle. */
  pullAllowed: (modelId: string) => boolean;
  onPullProgress?: (modelId: string, status: string, completed: number, total: number) => void;
}

/**
 * Téléchargement d'un modèle de code : toujours confirmé, seulement après la
 * validation de la configuration, seulement un modèle du catalogue. Par
 * l'API HTTP d'Ollama, aucun programme lancé.
 */
export function createModelTools(deps: ModelToolDeps): RegisteredTool[] {
  return [
    defineTool({
      name: 'dev_pull_ollama_model',
      description:
        'Télécharge un modèle Ollama par son nom exact, après confirmation explicite. Hors catalogue.',
      risk: 'confirm',
      forceConfirm: true,
      schema: z.object({ model: z.string().min(1).max(100) }),
      summarize: ({ model }) => `Télécharger le modèle Ollama « ${model} ».`,
      describeCommand: ({ model }) =>
        `ollama pull ${model}\n(dans ${deps.modelsDir()} — taille selon le modèle)`,
      execute: async ({ model }, context) => {
        const free = await deps.freeBytes(deps.modelsDir());
        if (free !== null && free < 5e9) {
          return fail(
            'definitive',
            `Pas assez de place : ${formatModelSize(free)} libres (il faut au moins 5 Go de marge).`,
          );
        }
        let lastPercent = -1;
        try {
          await deps.ollama().pull(
            model,
            ({ status, completed, total }) => {
              deps.onPullProgress?.(model, status, completed, total);
              const percent = total > 0 ? Math.floor((completed / total) * 100) : -1;
              if (percent !== lastPercent || total === 0) {
                lastPercent = percent;
                context.onProgress?.(percent >= 0 ? `${status} ${percent} %` : status);
              }
            },
            context.signal,
          );
        } catch (error) {
          if (context.signal?.aborted)
            return fail(
              'recoverable',
              'Téléchargement annulé (Ollama reprendra là où il s’est arrêté).',
            );
          return fail('recoverable', error instanceof Error ? error.message : String(error));
        }
        const installed = (await deps.ollama().status()).models.some((m) => m.name === model);
        return installed
          ? toolSuccess(`Modèle ${model} téléchargé et présent dans Ollama.`)
          : fail('recoverable', `Ollama ne liste pas ${model} après le téléchargement.`);
      },
    }),
    defineTool({
      name: 'dev_pull_model',
      description:
        'Télécharge un modèle de code du catalogue dans Ollama, après validation de la configuration. Toujours confirmé.',
      risk: 'confirm',
      forceConfirm: true,
      schema: z.object({ modelId: z.string().min(1).max(100) }),
      summarize: ({ modelId }) => {
        const spec = codeModelById(modelId);
        return `Télécharger le modèle de code ${spec?.label ?? modelId} (${spec ? formatModelSize(spec.downloadBytes) : 'taille inconnue'}).`;
      },
      describeCommand: ({ modelId }) => {
        const spec = codeModelById(modelId);
        return `ollama pull ${modelId}\n(${spec ? formatModelSize(spec.downloadBytes) : '?'} à télécharger dans ${deps.modelsDir()})`;
      },
      execute: async ({ modelId }, context) => {
        const spec = codeModelById(modelId);
        if (!spec)
          return fail(
            'definitive',
            `« ${modelId} » n’est pas dans le catalogue des modèles de code.`,
          );
        if (!deps.pullAllowed(modelId))
          return fail(
            'definitive',
            'Configuration non validée pour ce modèle : rien n’est téléchargé.',
          );
        const free = await deps.freeBytes(deps.modelsDir());
        if (free !== null && free < spec.downloadBytes + 5e9) {
          return fail(
            'definitive',
            `Pas assez de place : ${formatModelSize(free)} libres, il faut ${formatModelSize(spec.downloadBytes + 5e9)}.`,
          );
        }
        let lastPercent = -1;
        try {
          await deps.ollama().pull(
            modelId,
            ({ status, completed, total }) => {
              deps.onPullProgress?.(modelId, status, completed, total);
              const percent = total > 0 ? Math.floor((completed / total) * 100) : -1;
              if (percent !== lastPercent || total === 0) {
                lastPercent = percent;
                context.onProgress?.(percent >= 0 ? `${status} ${percent} %` : status);
              }
            },
            context.signal,
          );
        } catch (error) {
          if (context.signal?.aborted)
            return fail(
              'recoverable',
              'Téléchargement annulé (Ollama reprendra là où il s’est arrêté).',
            );
          return fail('recoverable', error instanceof Error ? error.message : String(error));
        }
        const installed = (await deps.ollama().status()).models.some(
          (model) => model.name === modelId,
        );
        return installed
          ? toolSuccess(`Modèle ${modelId} téléchargé et présent dans Ollama.`)
          : fail('recoverable', `Ollama ne liste pas ${modelId} après le téléchargement.`);
      },
    }),
  ];
}
