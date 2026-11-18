import { z } from 'zod';
import {
  appendiceParamsSchema,
  defineTool,
  stopAllSentence,
  toolFailure,
  toolSuccess,
  type RegisteredTool,
} from '@jarvis/core';
import type { AppendiceService } from '../appendices/service.js';

export const APPENDICES_STATE_TOOL = 'appendices_etat';
export const APPENDICE_ACTION_TOOL = 'appendice_action';
export const APPENDICES_STOP_TOOL = 'appendices_stop';
export const APPENDICE_EMERGENCY_TOOL = 'appendice_arret_urgence';
export const APPENDICE_RELEASE_TOOL = 'appendice_relacher_urgence';

export const APPENDICES_UNAVAILABLE = 'Aucun appendice n’est relié à Jarvis Test (Réglages → Appendices).';

const target = z.string().min(1).max(60).describe('Nom ou identifiant de l’appendice, tel qu’il apparaît dans appendices_etat.');

/**
 * Outils des appendices de Jarvis (Jarvis Test seulement). Absents du catalogue tant que le
 * registre est coupé ou vide.
 *
 * Réglage prudent, tant que les décisions de l'utilisateur ne sont pas prises : **chaque action
 * demande une carte** (`forceConfirm` : aucune politique ne la retire, et une carte venue d'une
 * enceinte est refusée d'office). Lire l'état, arrêter et activer l'arrêt d'urgence n'attendent
 * jamais. Relâcher l'arrêt d'urgence demande une carte.
 */
export function createAppendiceTools(service: AppendiceService): RegisteredTool[] {
  const available = {
    isAvailable: () => service.available(),
    unavailableMessage: APPENDICES_UNAVAILABLE,
  };

  return [
    defineTool({
      ...available,
      name: APPENDICES_STATE_TOOL,
      description:
        'Liste les appendices reliés à Jarvis (bras, capteurs, lampes…), leur état relu à l’instant et ce que chacun sait faire. À appeler avant de demander une action.',
      risk: 'safe',
      schema: z.object({}),
      execute: async (_input, context) => {
        const text = await service.describe(context.signal);
        return text ? toolSuccess(text) : toolFailure('missing_dependency', APPENDICES_UNAVAILABLE, 'registre vide');
      },
    }),
    defineTool({
      ...available,
      name: APPENDICE_ACTION_TOOL,
      description:
        'Demande une action à un appendice (une de ses capacités) et attend son résultat. L’utilisateur doit donner son accord sur une carte à chaque fois. « Terminé » n’est dit que si l’appendice l’a mesuré.',
      risk: 'confirm',
      forceConfirm: true,
      isDestructive: false,
      schema: z.object({
        appendice: target,
        capacite: z
          .string()
          .regex(/^[a-z][a-z0-9_]{0,31}$/, 'Nom de capacité invalide.')
          .describe('Nom exact d’une capacité de cet appendice (par exemple « saisir »).'),
        parametres: appendiceParamsSchema.optional().describe('Paramètres simples de l’action (nombres, textes courts, vrai/faux). Facultatif.'),
      }),
      summarize: ({ appendice, capacite, parametres }) => {
        const found = service.resolve(appendice);
        const name = 'error' in found ? appendice : found.piece ? `${found.nom} (${found.piece})` : found.nom;
        const values = Object.entries(parametres ?? {})
          .map(([key, value]) => `${key} = ${value}`)
          .join(', ');
        return `${name} : ${capacite}${values ? ` (${values})` : ''}.`;
      },
      describeCommand: ({ appendice, capacite, parametres }) => {
        const found = service.resolve(appendice);
        const origin = 'error' in found ? '(appendice inconnu)' : found.baseUrl;
        return `POST ${origin}/api/${capacite} ${JSON.stringify(parametres ?? {})}`;
      },
      execute: async ({ appendice, capacite, parametres }, context) => {
        const found = service.resolve(appendice);
        if ('error' in found) return toolFailure('definitive', found.error, 'appendice introuvable');
        return service.action(found, capacite, parametres ?? {}, context.signal);
      },
    }),
    defineTool({
      // Disponible dès qu'il y a quelque chose à arrêter, même registre coupé : un arrêt passe toujours.
      isAvailable: () => service.canStop(),
      unavailableMessage: APPENDICES_UNAVAILABLE,
      name: APPENDICES_STOP_TOOL,
      description:
        'Arrête tout de suite l’action en cours d’un appendice, ou de tous si aucun n’est nommé (« arrête tout »). N’attend aucun accord.',
      risk: 'safe',
      schema: z.object({ appendice: target.optional() }),
      execute: async ({ appendice }) => {
        if (appendice) {
          const found = service.resolve(appendice);
          if ('error' in found) return toolFailure('definitive', found.error, 'appendice introuvable');
          const result = await service.stopOne(found);
          const sentence = stopAllSentence([result]);
          return result.ok ? toolSuccess(sentence, [result]) : toolFailure('recoverable', sentence, result.detail ?? 'pas de réponse', [result]);
        }
        const results = await service.stopAll();
        if (!results) return toolFailure('missing_dependency', 'Rien à arrêter : aucun appendice relié.', 'aucune cible');
        const sentence = stopAllSentence(results);
        return results.every((result) => result.ok)
          ? toolSuccess(sentence, results)
          : toolFailure('recoverable', sentence, results.filter((result) => !result.ok).map((result) => `${result.name}: ${result.detail ?? ''}`).join(' | '), results);
      },
    }),
    defineTool({
      ...available,
      name: APPENDICE_EMERGENCY_TOOL,
      description:
        'Arrêt d’urgence d’un appendice : il se verrouille et refuse tout ordre jusqu’à ce qu’on le relâche. Pour un danger ou un comportement anormal. N’attend aucun accord.',
      risk: 'safe',
      schema: z.object({ appendice: target }),
      execute: async ({ appendice }) => {
        const found = service.resolve(appendice);
        if ('error' in found) return toolFailure('definitive', found.error, 'appendice introuvable');
        return service.emergency(found, true);
      },
    }),
    defineTool({
      ...available,
      name: APPENDICE_RELEASE_TOOL,
      description:
        'Relâche l’arrêt d’urgence d’un appendice (il peut de nouveau agir). Seulement si l’utilisateur le demande explicitement.',
      risk: 'confirm',
      forceConfirm: true,
      isDestructive: true,
      schema: z.object({ appendice: target }),
      summarize: ({ appendice }) => `Relâcher l’arrêt d’urgence de ${appendice}.`,
      describeCommand: ({ appendice }) => {
        const found = service.resolve(appendice);
        return `POST ${'error' in found ? '(appendice inconnu)' : found.baseUrl}/api/arret_urgence actif=false`;
      },
      execute: async ({ appendice }) => {
        const found = service.resolve(appendice);
        if ('error' in found) return toolFailure('definitive', found.error, 'appendice introuvable');
        return service.emergency(found, false);
      },
    }),
  ];
}
