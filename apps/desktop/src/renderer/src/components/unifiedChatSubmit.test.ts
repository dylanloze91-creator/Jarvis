import { describe, expect, it } from 'vitest';
import { parseSettings, type AtelierEtat } from '@jarvis/core';
import { messagesPourAtelier, unifiedChatSubmitTarget } from './unifiedChatSubmit';

/**
 * Essai du 24 novembre dans Jarvis Test : « Fais une fenêtre pour l'écran sur le dessus », dit avec
 * une boîte à l'écran, ouvrait le panneau Développeur (verbe « fais » + « fenêtre ») au lieu de
 * percer la boîte. L'atelier passe maintenant avant, dans Jarvis Test seulement.
 */
const settings = parseSettings({ developer: { enabled: true } });
const piece: Extract<AtelierEtat, { etape: 'piece' }> = {
  etape: 'piece',
  gabarit: 'boite',
  nom: 'boîte',
  dossier: 'boite-1',
  versionChoisie: 1,
  plateau: { x: 250, y: 250 },
  versions: [{ numero: 1, valeurs: { longueur: 80, largeur: 50, hauteur: 30 }, fiche: '', mesures: [], taille: [80, 50, 30], stl: 'v1.stl' }],
};
const items = [
  { kind: 'user', id: 'u1', text: 'Fais-moi une boîte de 80 par 50 par 30' },
  { kind: 'assistant', id: 'a1', text: 'Boîte de 80 × 50 × 30 mm.', streaming: false },
  { kind: 'atelier', id: 'atelier-a1', etat: piece },
];

describe('discussion unifiée : atelier avant le panneau Développeur', () => {
  const phrase = "Fais une fenêtre pour l'écran sur le dessus";

  it('sans atelier (Jarvis Live), la décision d’avant ne change pas', () => {
    // C'est l'aiguillage d'avant qui prenait la phrase pour une appli.
    expect(unifiedChatSubmitTarget(phrase, settings)).toBe('developer');
    expect(unifiedChatSubmitTarget(phrase, settings, null)).toBe('developer');
  });

  it('pièce à l’écran : la phrase part à la discussion (l’atelier)', () => {
    expect(unifiedChatSubmitTarget(phrase, settings, messagesPourAtelier(items))).toBe('chat');
  });

  it('une vraie demande d’appli garde le panneau Développeur', () => {
    const appli = 'Crée une application avec une fenêtre de connexion';
    expect(unifiedChatSubmitTarget(appli, settings, messagesPourAtelier(items))).toBe(unifiedChatSubmitTarget(appli, settings));
  });

  it('la pièce suit la réponse dans les messages relus par l’atelier', () => {
    expect(messagesPourAtelier(items)).toEqual([{ role: 'user' }, { role: 'assistant' }, { role: 'assistant', atelier: piece }]);
  });
});
