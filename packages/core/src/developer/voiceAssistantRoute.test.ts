import { describe, expect, it } from 'vitest';
import { isDeveloperVoiceIntent } from './voiceAssistantRoute.js';

describe('isDeveloperVoiceIntent', () => {
  it('garde une question classique', () => {
    expect(isDeveloperVoiceIntent('Quel temps fait-il demain ?')).toBe(false);
    expect(isDeveloperVoiceIntent('Ouvre Chrome')).toBe(false);
    expect(isDeveloperVoiceIntent('Lis mes emails')).toBe(false);
  });

  it('route vers développeur pour construire ou modifier', () => {
    expect(isDeveloperVoiceIntent('Crée un jeu Snake dans le navigateur')).toBe(true);
    expect(isDeveloperVoiceIntent('Modifie mon application pour ajouter un bouton')).toBe(true);
    expect(isDeveloperVoiceIntent('Corrige le bug dans mon projet TypeScript')).toBe(true);
    expect(isDeveloperVoiceIntent('Je veux une petite appli pour renommer des photos')).toBe(true);
  });
});
