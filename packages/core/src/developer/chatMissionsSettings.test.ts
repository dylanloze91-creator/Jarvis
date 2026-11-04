import { describe, expect, it } from 'vitest';
import { parseSettings } from '../settings.js';
import { chatMissionsEnabled } from './chatMissionsSettings.js';

describe('Développeur — missions depuis la discussion', () => {
  it('réglage absent ou faux : comportement identique', () => {
    expect(chatMissionsEnabled(parseSettings({ provider: 'ollama' }))).toBe(false);
    expect(
      chatMissionsEnabled(
        parseSettings({
          provider: 'ollama',
          developer: { enabled: true, repoPath: 'C:\\dev\\Jarvis' },
          orchestra: { enabled: true, brain: 'qwen2.5:7b' },
        }),
      ),
    ).toBe(false);
    expect(
      chatMissionsEnabled(
        parseSettings({
          provider: 'ollama',
          developer: { enabled: true, repoPath: 'C:\\dev\\Jarvis', chatMissions: false },
          orchestra: { enabled: true, brain: 'qwen2.5:7b' },
        }),
      ),
    ).toBe(false);
  });

  it('actif seulement si Développeur et chef d’orchestre sont activés', () => {
    expect(
      chatMissionsEnabled(
        parseSettings({
          provider: 'ollama',
          developer: { enabled: true, repoPath: 'C:\\dev\\Jarvis', chatMissions: true },
          orchestra: { enabled: false, brain: 'qwen2.5:7b' },
        }),
      ),
    ).toBe(false);
    expect(
      chatMissionsEnabled(
        parseSettings({
          provider: 'ollama',
          developer: { enabled: false, chatMissions: true },
          orchestra: { enabled: true, brain: 'qwen2.5:7b' },
        }),
      ),
    ).toBe(false);
    expect(
      chatMissionsEnabled(
        parseSettings({
          provider: 'ollama',
          developer: { enabled: true, repoPath: 'C:\\dev\\Jarvis', chatMissions: true },
          orchestra: { enabled: true, brain: 'qwen2.5:7b' },
        }),
      ),
    ).toBe(true);
  });

  it('parseSettings({}) ne gagne pas la clé chatMissions', () => {
    const dev = parseSettings({}).developer;
    expect('chatMissions' in dev).toBe(false);
  });
});
