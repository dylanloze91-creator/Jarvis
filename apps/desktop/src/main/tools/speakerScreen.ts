import { z } from 'zod';
import {
  SPEAKER_SCREEN_LINE_MAX_BYTES,
  SPEAKER_SCREEN_TITLE_MAX_BYTES,
  SPEAKER_SCREEN_TOOL,
  defineTool,
  speakerScreenSeconds,
  speakerScreenText,
  toolFailure,
  toolSuccess,
  type RegisteredTool,
  type SpeakerScreenInfo,
} from '@jarvis/core';

/** Ce que l'outil attend du pont des enceintes. */
export interface SpeakerScreenPort {
  /** Noms des enceintes reliées ; vide si le pont est coupé ou sans enceinte. */
  linkedNames(): string[];
  /** Met l'information en attente pour une enceinte (son nom) ou pour « toutes ». Rend le nombre d'enceintes servies. */
  show(target: string, info: SpeakerScreenInfo): number;
}

export const SPEAKER_SCREEN_UNAVAILABLE = 'Aucune enceinte n’est reliée à Jarvis : rien à afficher.';
/** L'enceinte ne lit l'écran qu'à son prochain contact avec le PC (toutes les 30 s) : 60 s laissent le temps d'arriver. */
export const SPEAKER_SCREEN_TOOL_SECONDS = 60;
const ALL = 'toutes';

/**
 * Affiche une information courte sur l'écran des enceintes. `safe` : rien n'est modifié sur le PC
 * et l'information s'efface seule. Absent du catalogue tant qu'aucune enceinte n'est reliée.
 */
export function createSpeakerScreenTools(port: SpeakerScreenPort): RegisteredTool[] {
  return [
    defineTool({
      name: SPEAKER_SCREEN_TOOL,
      description:
        'Affiche une information courte sur le petit écran d’une enceinte Jarvis (ou de toutes) : un titre de quelques mots et une ligne. Elle apparaît au prochain contact de l’enceinte avec le PC (30 secondes au plus) et s’efface seule. Seulement quand l’utilisateur demande d’afficher quelque chose sur une enceinte.',
      risk: 'safe',
      isAvailable: () => port.linkedNames().length > 0,
      unavailableMessage: SPEAKER_SCREEN_UNAVAILABLE,
      schema: z.object({
        // Facultatif pour la validation seulement : qwen2.5:7b met parfois le texte dans « ligne » sans
        // titre (essais du 17 novembre 2026) ; la ligne sert alors de titre.
        titre: z.string().max(120).optional().describe('Titre court, quelques mots (47 octets au plus, coupé au-delà).'),
        ligne: z.string().max(300).optional().describe('Une ligne de détail (95 octets au plus, coupée au-delà). Facultatif.'),
        enceinte: z.string().max(60).optional().describe('Nom de l’enceinte (« chambre »), ou « toutes ». Toutes si rien n’est précisé.'),
        secondes: z.number().min(1).max(300).optional().describe('Durée d’affichage en secondes, 300 au plus. 60 si rien n’est précisé.'),
      }),
      summarize: ({ titre, ligne, enceinte }) =>
        `Afficher « ${titre?.trim() || ligne?.trim() || ''} » sur ${enceinte && enceinte.trim().toLowerCase() !== ALL ? `l’enceinte ${enceinte.trim()}` : 'les enceintes'}.`,
      execute: async (input) => {
        const { enceinte, secondes } = input;
        const titre = input.titre?.trim() || input.ligne?.trim() || '';
        const ligne = input.titre?.trim() ? input.ligne : '';
        const title = speakerScreenText(titre, SPEAKER_SCREEN_TITLE_MAX_BYTES);
        if (!title) return toolFailure('definitive', 'Le titre est vide : rien n’a été affiché.', 'titre vide après nettoyage');
        const line = speakerScreenText(ligne ?? '', SPEAKER_SCREEN_LINE_MAX_BYTES);
        const seconds = speakerScreenSeconds(secondes ?? SPEAKER_SCREEN_TOOL_SECONDS);
        const target = enceinte?.trim() || ALL;
        const count = port.show(target, { title, line, seconds });
        if (count === 0) {
          const names = port.linkedNames();
          return toolFailure(
            'definitive',
            names.length > 0
              ? `Je n’ai pas d’enceinte nommée « ${target} ». Enceintes reliées : ${names.join(', ')}. Rien n’a été affiché.`
              : SPEAKER_SCREEN_UNAVAILABLE,
            `cible ${target}`,
          );
        }
        const where = count === 1 ? '1 enceinte' : `${count} enceintes`;
        const shown = line ? `« ${title} » — « ${line} »` : `« ${title} »`;
        const cut = title !== titre.trim() || line !== (ligne ?? '').trim() ? ' Le texte était trop long : il a été coupé.' : '';
        return toolSuccess(
          `Envoyé à ${where} : ${shown}, pendant ${seconds} s. L’écran l’affichera au prochain contact de l’enceinte avec le PC (30 secondes au plus) ; je ne peux pas vérifier qu’il est bien affiché.${cut}`,
          { enceintes: count, titre: title, ligne: line, secondes: seconds },
        );
      },
    }),
  ];
}
