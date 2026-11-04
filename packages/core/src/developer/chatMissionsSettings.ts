import { activeOrchestra } from '../agent/orchestra.js';
import type { Settings } from '../settings.js';

/** Missions de code depuis la discussion (5.0.68). Absent ou faux : chat inchangé. */
export function chatMissionsEnabled(settings: Settings): boolean {
  if (!settings.developer.enabled) return false;
  if (!activeOrchestra(settings)) return false;
  return settings.developer.chatMissions === true;
}
