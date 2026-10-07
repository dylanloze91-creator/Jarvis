import { describe, expect, it } from 'vitest';
import { isProjectChatDirectRequest } from './projectChatDirect.js';

describe('isProjectChatDirectRequest', () => {
  it('accepte une demande de modification claire', () => {
    expect(isProjectChatDirectRequest('Augmente la vitesse de la balle dans Pong')).toBe(true);
    expect(isProjectChatDirectRequest('Je veux que le score max soit 5')).toBe(true);
  });

  it('refuse une simple question', () => {
    expect(isProjectChatDirectRequest('Pourquoi les tests échouent ?')).toBe(false);
    expect(isProjectChatDirectRequest('Comment marche rules.ts ?')).toBe(false);
  });
});
