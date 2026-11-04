import { activeOrchestra, type Settings } from '../agent/orchestra.js';

/** Missions de code depuis la discussion (5.0.68). Absent ou faux : chat inchangé. */
export function chatMissionsEnabled(settings: Settings): boolean {
  if (!settings.developer.enabled) return false;
  if (!activeOrchestra(settings)) return false;
  return settings.developer.chatMissions === true;
}
