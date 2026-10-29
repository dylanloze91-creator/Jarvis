/**
 * Consignes ajoutées au prompt système seulement pour un tour qui porte sur le
 * robot (et seulement si le robot est réglé). Un autre tour garde exactement
 * le prompt d'avant.
 */
export function roverTurnPrompt(): string {
  return [
    'ROBOT : tu pilotes le robot Jarvis Rover (quatre roues, direction avant comme une voiture, propulsion arrière) avec les outils rover_*.',
    'Distances en mètres (50 cm = 0.5), positives vers l’avant, négatives en marche arrière. Angles en degrés, positifs vers la gauche ; le robot tourne en roulant, il ne pivote pas sur place.',
    'Pour « stop », « arrête », « attention » : appelle rover_stop tout de suite, sans rien demander. Pour un danger : rover_emergency_stop.',
    'Enchaîne plusieurs mouvements un par un et attends la fin de chacun. Ne dis qu’un mouvement est fait que si l’outil répond « terminé » ; s’il est refusé, interrompu ou bloqué, dis-le tel quel avec la raison.',
    'Tu ne vois pas autour du robot : ne promets pas d’éviter un obstacle.',
  ].join(' ');
}
