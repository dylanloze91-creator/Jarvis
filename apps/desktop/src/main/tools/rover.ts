import { z } from 'zod';
import {
  defineTool,
  describeRoverMovement,
  describeRoverState,
  formatRoverMove,
  formatRoverTurn,
  toolFailure,
  toolSuccess,
  type RegisteredTool,
  type RoverMovementState,
  type ToolResult,
} from '@jarvis/core';
import { RoverError, type RoverClient } from '../rover/RoverClient.js';

export const ROVER_NOT_CONFIGURED_MESSAGE =
  'Le robot n’est pas réglé : ajoute son adresse et son jeton dans Réglages → Robot.';

function failure(error: unknown): ToolResult {
  if (error instanceof RoverError) {
    const detail = `${error.kind}: ${error.detail ?? error.message}`;
    switch (error.kind) {
      case 'refused':
        return toolFailure('definitive', `Le robot refuse : ${error.message}`, detail);
      case 'bad_request':
        return toolFailure('definitive', `Ordre invalide pour le robot : ${error.message}`, detail);
      case 'unreachable':
        return toolFailure('recoverable', `${error.message} Un arrêt a été envoyé par précaution.`, detail);
      case 'timeout':
        return toolFailure('timeout', `${error.message} Un arrêt a été envoyé par précaution.`, detail);
      case 'cancelled':
        return toolFailure('cancelled', 'Mouvement annulé : le robot a reçu l’ordre de s’arrêter.', detail);
      default:
        return toolFailure('missing_dependency', error.message, detail);
    }
  }
  const message = error instanceof Error ? error.message : String(error);
  return toolFailure('definitive', 'Le robot a rencontré une erreur.', message);
}

/** « terminé » seulement si la mesure du robot l'atteste ; tout autre statut est dit tel quel. */
async function movementResult(robot: RoverClient, movement: RoverMovementState): Promise<ToolResult> {
  const text = describeRoverMovement(movement);
  if (movement.statut === 'termine') return toolSuccess(text, movement);
  if (movement.statut === 'en_cours') {
    // Le service a rendu la main avant la fin : on ne laisse pas le robot rouler seul.
    await robot.stop().catch(() => undefined);
    return toolFailure('timeout', `${text} Le mouvement a pris trop de temps : robot arrêté.`, 'statut en_cours', movement);
  }
  const outcome = movement.statut === 'bloque' || movement.statut === 'erreur' ? 'definitive' : 'cancelled';
  return toolFailure(outcome, text, `statut ${movement.statut}`, movement);
}

const speed = z
  .number()
  .positive('La vitesse doit être positive (le signe de la distance donne le sens).')
  .max(1, 'Vitesse trop grande : 1 m/s au plus (le robot plafonne à 0,3 m/s).')
  .optional()
  .describe('Vitesse en m/s (facultatif ; le robot plafonne à sa vitesse maximale, 0,3 m/s par défaut).');

/**
 * Outils du robot Jarvis Rover. Absents du catalogue tant qu'aucune adresse
 * n'est réglée, et proposés au modèle seulement sur un tour qui parle du robot
 * (`agent.ts`). Lecture et arrêts : `safe` (un « stop » ne doit jamais attendre
 * un clic). Mouvements : `confirm` sans catégorie, aucune politique ne les
 * retire. Relâcher l'arrêt d'urgence : `forceConfirm`.
 */
export function createRoverTools(robot: RoverClient): RegisteredTool[] {
  const available = {
    isAvailable: () => robot.isConfigured(),
    unavailableMessage: ROVER_NOT_CONFIGURED_MESSAGE,
  };

  return [
    defineTool({
      ...available,
      name: 'rover_status',
      description:
        'État du robot : simulation ou matériel, batterie, mouvement en cours, position depuis le démarrage, arrêt d’urgence, alertes.',
      risk: 'safe',
      schema: z.object({}),
      execute: async (_input, context) => {
        try {
          const state = await robot.state(context.signal);
          return toolSuccess(describeRoverState(state), state);
        } catch (error) {
          return failure(error);
        }
      },
    }),
    defineTool({
      ...available,
      name: 'rover_move',
      description:
        'Fait rouler le robot en ligne droite et attend la fin. distanceM en mètres : positif = avancer, négatif = reculer (50 cm = 0.5). Renvoie la distance réellement mesurée.',
      risk: 'confirm',
      isDestructive: false,
      schema: z.object({
        distanceM: z
          .number()
          .min(-5, 'Au plus 5 m par ordre : enchaîne plusieurs mouvements.')
          .max(5, 'Au plus 5 m par ordre : enchaîne plusieurs mouvements.')
          .describe('Distance en mètres, négative pour reculer.'),
        speedMS: speed,
      }),
      summarize: ({ distanceM, speedMS }) => `${formatRoverMove(distanceM, speedMS)}.`,
      describeCommand: ({ distanceM, speedMS }) =>
        `POST /api/avancer distance_m=${distanceM}${speedMS ? ` vitesse_m_s=${speedMS}` : ''}`,
      execute: async ({ distanceM, speedMS }, context) => {
        try {
          return await movementResult(robot, await robot.move({ distanceM, speedMS }, context.signal));
        } catch (error) {
          return failure(error);
        }
      },
    }),
    defineTool({
      ...available,
      name: 'rover_turn',
      description:
        'Fait tourner le robot en roulant (braquage des roues avant, pas de rotation sur place) et attend la fin. angleDeg : changement de cap en degrés, positif = gauche, négatif = droite. reverse : tourner en marche arrière.',
      risk: 'confirm',
      isDestructive: false,
      schema: z.object({
        angleDeg: z
          .number()
          .min(-360, 'Un tour complet (360°) au plus par ordre.')
          .max(360, 'Un tour complet (360°) au plus par ordre.')
          .describe('Degrés, positif vers la gauche.'),
        reverse: z.boolean().optional().describe('Vrai pour tourner en reculant.'),
        speedMS: speed,
      }),
      summarize: ({ angleDeg, reverse, speedMS }) => `${formatRoverTurn(angleDeg, reverse, speedMS)}.`,
      describeCommand: ({ angleDeg, reverse, speedMS }) =>
        `POST /api/tourner angle_deg=${angleDeg}${reverse ? ' marche_arriere=true' : ''}${speedMS ? ` vitesse_m_s=${speedMS}` : ''}`,
      execute: async ({ angleDeg, reverse, speedMS }, context) => {
        try {
          return await movementResult(robot, await robot.turn({ angleDeg, reverse, speedMS }, context.signal));
        } catch (error) {
          return failure(error);
        }
      },
    }),
    defineTool({
      ...available,
      name: 'rover_stop',
      description: 'Arrête le robot en douceur tout de suite (« stop », « arrête-toi »). Sans confirmation.',
      risk: 'safe',
      schema: z.object({}),
      execute: async () => {
        try {
          await robot.stop();
          return toolSuccess('Robot arrêté.');
        } catch (error) {
          return failure(error);
        }
      },
    }),
    defineTool({
      ...available,
      name: 'rover_emergency_stop',
      description:
        'Arrêt d’urgence : coupe les moteurs immédiatement et bloque tout mouvement jusqu’à ce qu’on le relâche. Pour un danger ou un comportement anormal.',
      risk: 'safe',
      schema: z.object({}),
      execute: async () => {
        try {
          await robot.emergency(true);
          return toolSuccess('Arrêt d’urgence activé : moteurs coupés, mouvements bloqués.');
        } catch (error) {
          return failure(error);
        }
      },
    }),
    defineTool({
      ...available,
      name: 'rover_release_emergency',
      description:
        'Relâche l’arrêt d’urgence du robot (les mouvements redeviennent possibles). Seulement si l’utilisateur le demande explicitement.',
      risk: 'confirm',
      forceConfirm: true,
      isDestructive: true,
      schema: z.object({}),
      summarize: () => 'Relâcher l’arrêt d’urgence du robot.',
      describeCommand: () => 'POST /api/arret_urgence actif=false',
      execute: async () => {
        try {
          await robot.emergency(false);
          return toolSuccess('Arrêt d’urgence relâché : le robot peut de nouveau bouger.');
        } catch (error) {
          return failure(error);
        }
      },
    }),
  ];
}
