import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { findLiveDir, liveDirCandidates } from './liveDir.js';

describe('dossier de Jarvis Live', () => {
  const appData = join('C:', 'Users', 'quelquun', 'AppData', 'Roaming');

  it('cherche d’abord le dossier du paquet (@jarvis/desktop), là où Live écrit vraiment', () => {
    expect(liveDirCandidates(appData)).toEqual([join(appData, '@jarvis', 'desktop'), join(appData, 'Jarvis')]);
  });

  it('prend @jarvis/desktop quand il existe', async () => {
    const present = new Set([join(appData, '@jarvis', 'desktop'), join(appData, 'Jarvis')]);
    expect(await findLiveDir(appData, async (path) => present.has(path))).toBe(join(appData, '@jarvis', 'desktop'));
  });

  it('se rabat sur Jarvis, puis sur rien', async () => {
    expect(await findLiveDir(appData, async (path) => path === join(appData, 'Jarvis'))).toBe(join(appData, 'Jarvis'));
    expect(await findLiveDir(appData, async () => false)).toBeNull();
  });

  it('ne prend jamais le dossier de Jarvis Test', () => {
    expect(liveDirCandidates(appData)).not.toContain(join(appData, 'Jarvis Test'));
  });
});
