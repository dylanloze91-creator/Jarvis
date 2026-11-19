import { activeOrchestra } from '../agent/orchestra.js';
import type { Settings } from '../settings.js';

/** Missions de code depuis la discussion (5.0.68). Absent ou faux : chat inchangé. */
export function chatMissionsEnabled(settings: Settings, options: { easyDeveloper?: boolean } = {}): boolean {
  if (!settings.developer.enabled) return false;
  if (!activeOrchestra(settings)) return false;
  // Jarvis Développeur facile (Jarvis Test) : la discussion qui fait tout est active dès que le
  // mode Développeur l'est, sans l'interrupteur à part.
  return settings.developer.chatMissions === true || options.easyDeveloper === true;
}
