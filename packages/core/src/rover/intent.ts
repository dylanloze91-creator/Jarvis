import type { ChatMessage } from '../types.js';

export function isRoverToolName(name: string): boolean {
  return name.startsWith('rover_');
}

function normalize(text: string): string {
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[’']/g, "'");
}

/** Le robot nommé : « le robot », « le rover », « la voiture »… */
const ROVER_NAMES = [/\brobots?\b/, /\brovers?\b/, /\bvoiture\b/, /\bchassis\b/];

/** Ordres de conduite sans nom du robot : « avance de 50 cm », « tourne à gauche de 90° ». */
const DRIVING = [
  /\b(?:avance|avancer|recule|reculer|roule|rouler)\b.*\b\d+(?:[.,]\d+)?\s*(?:cm|centimetres?|m|metres?|mm)\b/,
  /\b(?:tourne|tourner|braque|braquer|pivote|pivoter)\b.*\b(?:gauche|droite)\b.*\b\d+\s*(?:°|degres?)/,
  /\b(?:tourne|tourner|braque|braquer|pivote|pivoter)\b.*\b\d+\s*(?:°|degres?)\b.*\b(?:gauche|droite)\b/,
  /\bdemi-tour\b/,
  /\barret d'urgence\b/,
];

/**
 * Demande qui concerne le robot. Sert uniquement à proposer les outils
 * `rover_*` au modèle pour ce tour : sans robot réglé, ils restent hors
 * catalogue de toute façon.
 */
export function looksLikeRoverIntent(prompt: string): boolean {
  const text = normalize(prompt.trim());
  if (!text) return false;
  return ROVER_NAMES.some((pattern) => pattern.test(text)) || DRIVING.some((pattern) => pattern.test(text));
}

/**
 * Un suivi (« encore 20 cm », « stop ») garde les outils du robot si l'un des
 * deux échanges précédents s'en est servi.
 */
export function recentlyUsedRoverTools(conversation: ChatMessage[], userTurns = 2): boolean {
  let seenUsers = 0;
  for (let index = conversation.length - 1; index >= 0; index -= 1) {
    const message = conversation[index];
    if (!message) continue;
    if (message.role === 'user') {
      seenUsers += 1;
      if (seenUsers > userTurns) return false;
      continue;
    }
    if (message.toolCalls?.some((call) => isRoverToolName(call.name))) return true;
    if (message.role === 'tool' && message.toolName && isRoverToolName(message.toolName)) return true;
  }
  return false;
}
