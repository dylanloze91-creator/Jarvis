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
/**
 * Les petits modèles oublient parfois `prompt` et mettent la description dans `style`, surtout
 * avec une photo : on reconstruit une description plutôt que de refuser trois fois de suite.
 */
export function effectivePrompt(prompt: string | undefined, style: string | undefined, photoDeBase: string | undefined): string | null {
  const text = prompt?.trim() ?? '';
  if (text.length >= 3) return text;
  const styleText = style?.trim() ?? '';
  if (photoDeBase) return styleText ? `${styleText}, same subject as the photo, high quality` : 'the same subject as the photo, faithful, high quality';
  return styleText.length >= 3 ? styleText : null;
}

export interface ImagesToolsDeps {
  /** Ouvre le fichier dans la visionneuse (processus principal : `shell.openPath`). Absent : rien n'est ouvert. */
  openPath?: (path: string) => Promise<string | void>;
}

export function createImagesTools(service: ImagesService, deps: ImagesToolsDeps = {}): RegisteredTool[] {
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
        prompt: z
          .string()
          .max(1500)
          .optional()
          .describe('Description de l’image en anglais : sujet, style, lumière, cadrage. Obligatoire sans photo ; avec photoDeBase, décris le résultat voulu (ex. « manga style portrait of the same person »).'),
        projet: z.enum(IMAGE_PROJECTS).default('perso').describe('jarvis, vx, drivers-ink ou perso.'),
        nombre: z.number().int().min(1).max(MAX_IMAGES_PER_REQUEST).default(1).describe('Nombre d’images (1 à 4).'),
        format: z.string().max(20).optional().describe('carre, paysage, portrait, 16:9, 9:16 ou LARGEURxHAUTEUR. Absent : format par défaut du projet.'),
        style: z.string().max(200).optional().describe('Style libre ajouté au prompt (« watercolor », « pixel art »…).'),
        lora: z.string().max(120).optional().describe('Nom d’un LoRA installé dans Forge (sans extension), facultatif.'),
        poidsLora: z.number().min(0.1).max(1.5).optional().describe('Poids du LoRA (0,8 par défaut).'),
        graine: z.number().int().min(0).optional().describe('Graine pour refaire la même image ; absente = aléatoire.'),
        negatif: z.string().max(600).optional().describe('Ce que l’image ne doit pas contenir, en plus des règles du projet.'),
        photoDeBase: z
          .string()
          .max(500)
          .optional()
          .describe('Chemin d’une photo de départ (celui donné par « Photo jointe ») : l’image est faite à partir d’elle.'),
        fidelite: z
          .number()
          .min(0)
          .max(1)
          .optional()
          .describe('Avec photoDeBase : à quel point rester proche de la photo, 0 (tout réinventer) à 1 (presque copier). 0,45 par défaut.'),
      }),
      summarize: ({ prompt, style, projet, nombre, photoDeBase }) => {
        const text = effectivePrompt(prompt, style, photoDeBase) ?? '(sans description)';
        return `Génère ${nombre > 1 ? `${nombre} images` : 'une image'} pour le projet ${projet}${photoDeBase ? ' à partir de ta photo' : ''} : « ${text.length > 80 ? `${text.slice(0, 80)}…` : text} ».`;
      },
      execute: async ({ prompt, projet, nombre, format, style, lora, poidsLora, graine, negatif, photoDeBase, fidelite }, context) => {
        const finalPrompt = effectivePrompt(prompt, style, photoDeBase);
        if (!finalPrompt) {
          return toolFailure('definitive', 'Il manque la description de l’image : rappelle generer_image avec le champ prompt (en anglais).', 'prompt absent');
        }
        try {
          const result = await service.generate(
            {
              prompt: finalPrompt,
              project: projet,
              count: nombre,
              ...(format ? { format } : {}),
              ...(style ? { style } : {}),
              ...(lora ? { lora: { name: lora, ...(poidsLora !== undefined ? { weight: poidsLora } : {}) } } : {}),
              ...(graine !== undefined ? { seed: graine } : {}),
              ...(negatif ? { negative: negatif } : {}),
              ...(photoDeBase ? { initImage: { path: photoDeBase, ...(fidelite !== undefined ? { fidelity: fidelite } : {}) } } : {}),
            },
            { ...(context.onProgress ? { onProgress: context.onProgress } : {}), ...(context.signal ? { signal: context.signal } : {}) },
          );
          // Ouvrir la première image dans la visionneuse : confort, jamais bloquant.
          const first = result.files[0];
          if (first && deps.openPath && service.settings().openAfterGeneration) {
            await deps.openPath(first.png).catch(() => undefined);
          }
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
