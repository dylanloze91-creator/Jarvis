import { z } from 'zod';
import {
  IMAGE_PROJECTS,
  MAX_IMAGES_PER_REQUEST,
  defineTool,
  toolFailure,
  toolSuccess,
  type RegisteredTool,
  type ToolResult,
} from '@jarvis/core';
import { ForgeError } from '../images/ForgeClient.js';
import { describeImagesResult, type ImagesService } from '../images/ImagesService.js';

export const IMAGES_DISABLED_MESSAGE = 'Le module images est coupé : active-le dans Réglages → Images (il faut Forge installé dans C:\\dev\\Forge).';

function failure(error: unknown): ToolResult {
  if (error instanceof ForgeError) {
    const detail = `${error.kind}: ${error.detail ?? error.message}`;
    switch (error.kind) {
      case 'cancelled':
        return toolFailure('cancelled', 'Génération annulée. Le modèle de langage est rechargé.', detail);
      case 'timeout':
        return toolFailure('timeout', `${error.message} Le modèle de langage est rechargé.`, detail);
      case 'unreachable':
        return toolFailure('recoverable', `${error.message} Vérifie Forge (Réglages → Images → Tester). Le modèle de langage est rechargé.`, detail);
      default:
        return toolFailure('definitive', `${error.message} Le modèle de langage est rechargé.`, detail);
    }
  }
  const message = error instanceof Error ? error.message : String(error);
  return toolFailure('definitive', 'La génération d’image a échoué. Le modèle de langage est rechargé.', message);
}

/**
 * Outils du module images. Absents du catalogue tant que `images.enabled` est faux.
 * `safe` : générer une image n'a rien d'irréversible ; l'outil prévient l'utilisateur
 * (`onProgress`) que le modèle de langage est déchargé le temps de l'image.
 */
export function createImagesTools(service: ImagesService): RegisteredTool[] {
  const available = {
    isAvailable: () => service.isEnabled(),
    unavailableMessage: IMAGES_DISABLED_MESSAGE,
  };

  return [
    defineTool({
      ...available,
      name: 'generer_image',
      description:
        'Génère une image en local avec Stable Diffusion (Forge, modèle SDXL) à partir d’un prompt descriptif en anglais. Projets : jarvis, vx (vidéo : 16:9 miniature, 9:16 short), drivers-ink (sticker vinyle : fond blanc, contours nets, version noir et blanc produite aussi), perso. Prend une à deux minutes : le modèle de langage est déchargé puis rechargé automatiquement. Renvoie les chemins des fichiers créés.',
      risk: 'safe',
      schema: z.object({
        prompt: z.string().min(3).max(1500).describe('Description de l’image en anglais : sujet, style, lumière, cadrage.'),
        projet: z.enum(IMAGE_PROJECTS).default('perso').describe('jarvis, vx, drivers-ink ou perso.'),
        nombre: z.number().int().min(1).max(MAX_IMAGES_PER_REQUEST).default(1).describe('Nombre d’images (1 à 4).'),
        format: z.string().max(20).optional().describe('carre, paysage, portrait, 16:9, 9:16 ou LARGEURxHAUTEUR. Absent : format par défaut du projet.'),
        style: z.string().max(200).optional().describe('Style libre ajouté au prompt (« watercolor », « pixel art »…).'),
        lora: z.string().max(120).optional().describe('Nom d’un LoRA installé dans Forge (sans extension), facultatif.'),
        poidsLora: z.number().min(0.1).max(1.5).optional().describe('Poids du LoRA (0,8 par défaut).'),
        graine: z.number().int().min(0).optional().describe('Graine pour refaire la même image ; absente = aléatoire.'),
        negatif: z.string().max(600).optional().describe('Ce que l’image ne doit pas contenir, en plus des règles du projet.'),
      }),
      summarize: ({ prompt, projet, nombre }) =>
        `Génère ${nombre > 1 ? `${nombre} images` : 'une image'} pour le projet ${projet} : « ${prompt.length > 80 ? `${prompt.slice(0, 80)}…` : prompt} ».`,
      execute: async ({ prompt, projet, nombre, format, style, lora, poidsLora, graine, negatif }, context) => {
        try {
          const result = await service.generate(
            {
              prompt,
              project: projet,
              count: nombre,
              ...(format ? { format } : {}),
              ...(style ? { style } : {}),
              ...(lora ? { lora: { name: lora, ...(poidsLora !== undefined ? { weight: poidsLora } : {}) } } : {}),
              ...(graine !== undefined ? { seed: graine } : {}),
              ...(negatif ? { negative: negatif } : {}),
            },
            { ...(context.onProgress ? { onProgress: context.onProgress } : {}), ...(context.signal ? { signal: context.signal } : {}) },
          );
          return toolSuccess(describeImagesResult(result), result);
        } catch (error) {
          return failure(error);
        }
      },
    }),
    defineTool({
      ...available,
      name: 'images_etat',
      description: 'État du module images : Forge installé et allumé ou non, modèle SDXL présent, LoRA disponibles, dossier des images, fichier des réglages par projet.',
      risk: 'safe',
      schema: z.object({}),
      execute: async () => {
        try {
          const status = await service.status();
          const lines = [
            `Forge : ${status.launcherFound ? `installé dans ${status.forgeDir}` : `introuvable dans ${status.forgeDir}`}, ${status.forgeRunning ? 'allumé' : 'éteint (Jarvis le lancera au besoin)'}.`,
            `Modèle SDXL : ${status.checkpointFound ? 'présent' : 'absent (models/Stable-diffusion/sd_xl_base_1.0.safetensors)'}${status.vaeFound ? ', VAE fp16 présent' : ''}.`,
            `LoRA disponibles : ${status.loras.length ? status.loras.join(', ') : status.forgeRunning ? 'aucun' : 'inconnus tant que Forge est éteint'}.`,
            `Images rangées dans ${status.outputRoot} ; réglages par projet : ${status.presetsPath}.`,
          ];
          if (status.error) lines.push(`Attention : ${status.error}`);
          return toolSuccess(lines.join('\n'), status);
        } catch (error) {
          return failure(error);
        }
      },
    }),
  ];
}
