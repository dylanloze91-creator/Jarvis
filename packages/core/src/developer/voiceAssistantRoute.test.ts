import { describe, expect, it } from 'vitest';
import { parseSettings } from '../settings.js';
import { isDeveloperVoiceIntent, shouldOpenDeveloperPanelForChatInput } from './voiceAssistantRoute.js';

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

  it('G-code et code postal ne comptent pas comme verbe coder (5.0.69)', () => {
    expect(
      isDeveloperVoiceIntent('Il faut envoyer un fichier G-code vers l imprimante 3D'),
    ).toBe(false);
    expect(isDeveloperVoiceIntent('Quel est le code postal de Lyon ?')).toBe(false);
    expect(isDeveloperVoiceIntent('Scanne ce QR code sur l emballage')).toBe(false);
  });

  it('verbes accentués en tête reconnus (5.0.69)', () => {
    expect(isDeveloperVoiceIntent('Écris-moi un script pour trier mes photos')).toBe(true);
    expect(isDeveloperVoiceIntent('Crée une appli CLI simple')).toBe(true);
    expect(isDeveloperVoiceIntent('Améliore mon petit jeu Pong')).toBe(true);
  });
});

describe('shouldOpenDeveloperPanelForChatInput (5.0.69)', () => {
  const missionsOn = parseSettings({
    provider: 'ollama',
    orchestra: { enabled: true, brain: 'qwen2.5:7b' },
    developer: { enabled: true, repoPath: 'C:\\dev\\Jarvis', chatMissions: true },
  });

  const missionsOff = parseSettings({
    provider: 'ollama',
    developer: { enabled: true, repoPath: 'C:\\dev\\Jarvis' },
  });

  it('missions depuis la discussion : jamais de bascule vers Développeur', () => {
    expect(
      shouldOpenDeveloperPanelForChatInput('Crée un script Python pour Mainsail', missionsOn),
    ).toBe(false);
    expect(
      shouldOpenDeveloperPanelForChatInput(
        'Non, c est faux. Envoie un fichier G-code, pas du M3U',
        missionsOn,
      ),
    ).toBe(false);
  });

  it('correction ou préférence : rester dans la discussion même sans missions', () => {
    expect(
      shouldOpenDeveloperPanelForChatInput(
        "Non, c'est faux. Il faut envoyer un fichier G-code vers l'imprimante",
        missionsOff,
      ),
    ).toBe(false);
    expect(shouldOpenDeveloperPanelForChatInput('Retiens que je préfère les réponses courtes', missionsOff)).toBe(
      false,
    );
    expect(shouldOpenDeveloperPanelForChatInput("C'est faux, corrige l'objectif", missionsOff)).toBe(false);
  });

  it('réglage coupé : ordre de dev classique si one-off', () => {
    expect(shouldOpenDeveloperPanelForChatInput('Crée un jeu Snake dans le navigateur', missionsOff)).toBe(true);
  });
});
