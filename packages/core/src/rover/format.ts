/**
 * Formes renvoyées par le service du robot (`jarvis_rover`, Raspberry Pi) et
 * phrases françaises qui en sont tirées. Pur : testé sans réseau.
 */

export type RoverMovementStatus = 'en_cours' | 'termine' | 'interrompu' | 'remplace' | 'bloque' | 'erreur';

export interface RoverMovementState {
  id: number;
  type: 'avancer' | 'tourner' | 'conduire' | string;
  parametres: Record<string, unknown>;
  statut: RoverMovementStatus | string;
  message: string;
  mesure: { distance_m?: number; ecart_m?: number; angle_deg?: number; ecart_deg?: number; rayon_m?: number };
  duree_s: number | null;
}

export interface RoverState {
  mode: string;
  pose: { x_m: number; y_m: number; cap_deg: number };
  distance_totale_m: number;
  vitesse_m_s: number;
  vitesse_mesuree_m_s: number;
  braquage_deg: number;
  batterie: { tension_v: number; courant_a: number } | null;
  arret_urgence: boolean;
  mouvement: RoverMovementState | null;
  dernier_mouvement: RoverMovementState | null;
  alertes: string[];
  limites: {
    vitesse_max_m_s: number;
    braquage_max_deg: number;
    distance_max_m: number;
    rayon_braquage_min_m: number;
  };
}

function num(value: number, digits = 2): string {
  return value.toLocaleString('fr-FR', { maximumFractionDigits: digits });
}

function distanceText(meters: number): string {
  const abs = Math.abs(meters);
  return abs < 1 ? `${num(abs * 100, 1)} cm` : `${num(abs)} m`;
}

/** Résumé affiché dans la carte de confirmation d'un déplacement en ligne droite. */
export function formatRoverMove(distanceM: number, speedMS?: number): string {
  const direction = distanceM >= 0 ? 'Avancer' : 'Reculer';
  const speed = speedMS ? ` à ${num(speedMS)} m/s` : '';
  return `${direction} de ${distanceText(distanceM)}${speed}`;
}

/** Résumé affiché dans la carte de confirmation d'un virage. */
export function formatRoverTurn(angleDeg: number, reverse = false, speedMS?: number): string {
  const side = angleDeg >= 0 ? 'à gauche' : 'à droite';
  const way = reverse ? ' en marche arrière' : '';
  const speed = speedMS ? ` à ${num(speedMS)} m/s` : '';
  return `Tourner ${side} de ${num(Math.abs(angleDeg), 0)}°${way}${speed}`;
}

/** Phrase pour le modèle à partir d'un mouvement fini (ou en cours). */
export function describeRoverMovement(movement: RoverMovementState): string {
  const parts: string[] = [];
  const m = movement.mesure ?? {};
  if (typeof m.distance_m === 'number') parts.push(`distance mesurée ${distanceText(m.distance_m)}`);
  if (typeof m.angle_deg === 'number') parts.push(`virage mesuré ${num(m.angle_deg, 1)}°`);
  if (typeof m.ecart_m === 'number' && Math.abs(m.ecart_m) >= 0.005) parts.push(`écart ${distanceText(m.ecart_m)}`);
  if (typeof m.ecart_deg === 'number' && Math.abs(m.ecart_deg) >= 0.5) parts.push(`écart ${num(m.ecart_deg, 1)}°`);
  const label: Record<string, string> = {
    en_cours: 'en cours',
    termine: 'terminé',
    interrompu: 'interrompu',
    remplace: 'remplacé par un autre ordre',
    bloque: 'bloqué',
    erreur: 'en erreur',
  };
  const status = label[movement.statut] ?? movement.statut;
  const detail = parts.length ? ` (${parts.join(', ')})` : '';
  const message = movement.message ? ` ${movement.message}` : '';
  return `Mouvement ${status}${detail}.${message}`.trim();
}

/** État du robot en une ou deux phrases. */
export function describeRoverState(state: RoverState): string {
  const lines: string[] = [];
  lines.push(state.mode === 'simulation' ? 'Robot en simulation (aucun moteur réel).' : 'Robot connecté au matériel.');
  if (state.batterie) lines.push(`Batterie ${num(state.batterie.tension_v, 1)} V.`);
  if (state.arret_urgence) lines.push('Arrêt d’urgence actif.');
  if (state.mouvement && state.mouvement.statut === 'en_cours') {
    lines.push(`En mouvement (${state.mouvement.type}).`);
  } else {
    lines.push('À l’arrêt.');
  }
  lines.push(
    `Position depuis le démarrage : x ${num(state.pose.x_m)} m, y ${num(state.pose.y_m)} m, cap ${num(state.pose.cap_deg, 0)}°.`,
  );
  for (const alert of state.alertes ?? []) lines.push(alert);
  return lines.join(' ');
}
