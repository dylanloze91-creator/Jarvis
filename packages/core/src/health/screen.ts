import type { SpeakerScreenInfo } from '../speaker/screen.js';
import type { HealthCheckId, HealthReport } from './types.js';

/** Titre et durée d'un souci du bilan affiché sur l'écran des enceintes. */
export const HEALTH_SCREEN_TITLE = 'Jarvis';
export const HEALTH_SCREEN_SECONDS = 60;

/**
 * Suit les contrôles rouges d'un bilan à l'autre : un contrôle qui **passe** au rouge donne une
 * information à afficher, une seule fois par incident. Tant qu'il reste rouge, plus rien ; revenu
 * au vert ou à l'orange puis rouge de nouveau, c'est un nouvel incident. Sans modèle, sans effet.
 */
export class HealthScreenWatch {
  private red = new Set<HealthCheckId>();

  next(report: Pick<HealthReport, 'items'>): SpeakerScreenInfo[] {
    const now = new Set<HealthCheckId>();
    const out: SpeakerScreenInfo[] = [];
    for (const item of report.items) {
      if (item.level !== 'red') continue;
      now.add(item.id);
      if (!this.red.has(item.id)) out.push({ title: HEALTH_SCREEN_TITLE, line: item.sentence, seconds: HEALTH_SCREEN_SECONDS });
    }
    this.red = now;
    return out;
  }
}
