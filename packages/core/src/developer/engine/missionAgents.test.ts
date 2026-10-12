import { describe, expect, it } from 'vitest';
import { developerAgentFinished, developerAgentStarted } from './missionAgents.js';

describe('missionAgents', () => {
  it('formate début et fin en français', () => {
    expect(developerAgentStarted('web', 'cherche une méthode')).toMatch(/▶ Chercheur web/);
    expect(developerAgentFinished('testeur', 'tests OK')).toMatch(/✓ Testeur/);
  });
});
