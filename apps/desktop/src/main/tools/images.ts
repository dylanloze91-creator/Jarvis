import { z } from 'zod';
import {
  IMAGE_PROJECTS,
  defineTool,
  guessPersonCount,
  guessSubjectType,
  resolveRenderStyle,
  toolFailure,
  toolSuccess,
  type ChatAttachment,
  type RegisteredTool,
  type ToolResult,
} from '@jarvis/core';
import { ForgeError } from '../images/ForgeClient.js';
import { describeDirectResult, describeImagesResult, type ImagesService } from '../images/ImagesService.js';

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
  /**
   * Le message de l'utilisateur en cours (texte mot pour mot et photos jointes), posé par la session
   * de chat : le modèle de langage n'a pas à le recopier. Absent ou vide : l'outil le dit.
   */
  currentTurn?: () => { text: string; attachments?: ChatAttachment[] } | null;
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
        'Pour toute demande d’image, appelle cet outil. Tu n’as pas à rédiger de prompt : Jarvis Imager reçoit la demande de l’utilisateur telle quelle (mot pour mot, depuis la discussion) et s’occupe de tout (traduction, modèle, taille, retouches). Indique seulement le projet si l’utilisateur le nomme (jarvis, vx, drivers-ink, perso). Prend une à trois minutes : le modèle de langage est déchargé puis rechargé automatiquement. Renvoie les chemins des fichiers créés.',
      risk: 'safe',
      schema: z.object({
        projet: z.enum(IMAGE_PROJECTS).default('perso').describe('jarvis, vx (vidéo, 16:9 ou 9:16), drivers-ink (sticker vinyle) ou perso. perso si rien ne l’indique.'),
        photoDeBase: z
          .string()
          .max(500)
          .optional()
          .describe('Chemin d’une photo de départ (celui donné par « Photo jointe ») : l’image est faite à partir d’elle. Facultatif : Jarvis la retrouve seul.'),
        fidelite: z
          .number()
          .min(0)
          .max(1)
          .optional()
          .describe('Avec une photo de départ : à quel point rester proche de la photo, 0 (tout réinventer) à 1 (presque copier). 0,45 par défaut.'),
      }),
      summarize: ({ projet, photoDeBase }) => {
        const text = deps.currentTurn?.()?.text?.trim() ?? '';
        return `Jarvis Imager : une image pour le projet ${projet}${photoDeBase ? ' à partir de ta photo' : ''}, ta demande telle quelle${text ? ` : « ${text.length > 80 ? `${text.slice(0, 80)}…` : text} »` : ''}.`;
      },
      execute: async ({ projet, photoDeBase, fidelite }, context) => {
        const turn = deps.currentTurn?.() ?? null;
        const text = turn?.text?.trim() ?? '';
        if (!text) {
          return toolFailure('definitive', 'Jarvis Imager n’a pas reçu la demande de l’utilisateur (aucun message en cours) : rien n’a été généré.', 'currentTurn absent');
        }
        const photo = photoDeBase?.trim() || turn?.attachments?.find((attachment) => attachment.kind === 'image')?.path;
        const progress = { ...(context.onProgress ? { onProgress: context.onProgress } : {}), ...(context.signal ? { signal: context.signal } : {}) };
        try {
          if (photo) {
            // Photo de départ (image vers image) : le chemin d'avant, avec les règles d'Imager et le type deviné par mots.
            const personCount = guessPersonCount(text);
            const result = await service.generate(
              {
                prompt: text,
                project: projet,
                subjectType: guessSubjectType(text),
                ...(personCount ? { personCount } : {}),
                render: resolveRenderStyle(undefined, text),
                initImage: { path: photo, ...(fidelite !== undefined ? { fidelity: fidelite } : {}) },
              },
              progress,
            );
            const first = result.files[0];
            if (first && deps.openPath && service.settings().openAfterGeneration) await deps.openPath(first.png).catch(() => undefined);
            return toolSuccess(describeImagesResult(result), result);
          }
          // Sans photo : mode direct, la demande mot pour mot complétée par les règles d'Imager (jamais réécrite par un modèle).
          const result = await service.generateDirect({ prompt: text, negative: '', project: projet }, progress);
          const first = result.files[0];
          if (first && deps.openPath && service.settings().openAfterGeneration) await deps.openPath(first.png).catch(() => undefined);
          return toolSuccess(describeDirectResult(result), result);
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
