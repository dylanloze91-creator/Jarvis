import { z } from 'zod';
import {
  IMAGE_PROJECTS,
  IMAGE_SUBJECT_TYPES,
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
        'Confie une image à Jarvis Imager (Stable Diffusion XL en local, dans Forge). Transmets la demande de l’utilisateur telle quelle (demande), le projet (jarvis, vx pour la vidéo en 16:9 ou 9:16, drivers-ink pour un sticker vinyle, perso), le type de sujet (personne, objet, paysage, logo-sticker, scene, autre) et le nombre de personnes s’il y en a : Imager écrit lui-même la consigne finale en anglais, choisit le modèle, la taille native et les retouches visages et mains. Prend une à trois minutes : le modèle de langage est déchargé puis rechargé automatiquement. Renvoie les chemins des fichiers créés.',
      risk: 'safe',
      schema: z.object({
        demande: z
          .string()
          .max(1500)
          .optional()
          .describe('Ce que l’utilisateur veut voir, dans ses mots (français accepté). Imager le traduit et l’enrichit. Obligatoire sauf si prompt ou photoDeBase est donné.'),
        type: z
          .enum(IMAGE_SUBJECT_TYPES)
          .optional()
          .describe('Ce que représente l’image : personne (une ou plusieurs), objet, paysage, logo-sticker, scene (plusieurs personnes dans un décor), autre.'),
        nombrePersonnes: z.number().int().min(1).max(6).optional().describe('Nombre de personnes voulu dans l’image, si la demande en parle.'),
        agrandir: z.boolean().optional().describe('Vrai si l’utilisateur veut une grande image : générée en taille native puis agrandie ×2.'),
        prompt: z
          .string()
          .max(1500)
          .optional()
          .describe('Facultatif : description déjà en anglais (sujet, scène). Avec photoDeBase, décris le résultat voulu (ex. « manga style portrait of the same person »).'),
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
      summarize: ({ demande, prompt, style, projet, nombre, photoDeBase, type }) => {
        const text = effectivePrompt(demande ?? prompt, style, photoDeBase) ?? '(sans description)';
        return `Jarvis Imager : ${nombre > 1 ? `${nombre} images` : 'une image'} pour le projet ${projet}${type ? ` (${type})` : ''}${photoDeBase ? ' à partir de ta photo' : ''} : « ${text.length > 80 ? `${text.slice(0, 80)}…` : text} ».`;
      },
      execute: async ({ demande, type, nombrePersonnes, agrandir, prompt, projet, nombre, format, style, lora, poidsLora, graine, negatif, photoDeBase, fidelite }, context) => {
        const finalPrompt = effectivePrompt(demande?.trim() || prompt, style, photoDeBase);
        if (!finalPrompt) {
          return toolFailure('definitive', 'Il manque la demande : rappelle generer_image avec le champ demande (les mots de l’utilisateur).', 'demande absente');
        }
        try {
          const result = await service.generate(
            {
              prompt: finalPrompt,
              project: projet,
              count: nombre,
              ...(type ? { subjectType: type } : {}),
              ...(nombrePersonnes !== undefined ? { personCount: nombrePersonnes } : {}),
              ...(agrandir ? { upscale: true } : {}),
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
      description: 'État de Jarvis Imager : Forge installé et allumé ou non, modèles SDXL présents et modèle actif, retouche ADetailer, LoRA disponibles, dossier des images, fichiers de réglages.',
      risk: 'safe',
      schema: z.object({}),
      execute: async () => {
        try {
          const status = await service.status();
          const lines = [
            `Forge : ${status.launcherFound ? `installé dans ${status.forgeDir}` : `introuvable dans ${status.forgeDir}`}, ${status.forgeRunning ? 'allumé' : 'éteint (Jarvis le lancera au besoin)'}.`,
            `Modèles SDXL présents : ${status.checkpoints.length ? status.checkpoints.map((c) => c.label).join(', ') : 'aucun'} ; modèle actif : ${status.activeCheckpoint ?? 'aucun'}${status.vaeFound ? ' ; VAE fp16 présent' : ''}.`,
            `Retouche visages et mains (ADetailer) : ${status.adetailerInstalled ? 'installée' : 'non installée'}.`,
            `LoRA disponibles : ${status.loras.length ? status.loras.join(', ') : status.forgeRunning ? 'aucun' : 'inconnus tant que Forge est éteint'}.`,
            `Images rangées dans ${status.outputRoot} ; réglages par projet : ${status.presetsPath} ; règles Imager : ${status.rulesPath}.`,
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
