import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it, vi } from 'vitest';

const userData = mkdtempSync(join(tmpdir(), 'jarvis-catalog-rover-'));

vi.mock('electron', () => ({
  app: { getPath: () => userData, getVersion: () => '5.0.53', isPackaged: false },
  shell: { openExternal: async () => undefined },
  desktopCapturer: {},
  screen: {},
  clipboard: {},
  nativeImage: {},
}));

const core = await import('@jarvis/core');
const { createToolManager } = await import('./index.js');
const { SpotifyBridge } = await import('../media/SpotifyBridge.js');
const { SiteBlockBridge } = await import('../siteblock/SiteBlockBridge.js');
const { PersonalizationStore } = await import('../personalization.js');
const { KnowledgeStore } = await import('../knowledge.js');
const { RoverClient } = await import('../rover/RoverClient.js');

afterAll(() => rmSync(userData, { recursive: true, force: true }));

const ROVER_TOOLS = [
  'rover_status',
  'rover_move',
  'rover_turn',
  'rover_stop',
  'rover_emergency_stop',
  'rover_release_emergency',
];

function catalog(values: Record<string, unknown>, withRover: boolean) {
  const settings = core.parseSettings(values);
  const getSettings = () => settings;
  return createToolManager({
    getSettings,
    searchRegistry: core.createDefaultSearchRegistry(),
    marketDataRegistry: core.createDefaultMarketDataRegistry(),
    spotify: new SpotifyBridge(getSettings),
    siteBlock: new SiteBlockBridge(getSettings),
    personalization: new PersonalizationStore(),
    knowledge: new KnowledgeStore({ getUserDataPath: () => userData }),
    ...(withRover ? { rover: new RoverClient(getSettings) } : {}),
  });
}

const PROFILES = {
  complet: {},
  modeste: { machine: { profile: 'modest', cpuOnly: true, measureFailed: false, detected: '8 Go', chosen: 'modeste' } },
};

describe.each(Object.entries(PROFILES))('catalogue %s et robot', (_label, base) => {
  it('sans adresse de robot, le modèle voit exactement le catalogue d’avant', () => {
    const before = catalog(base, false).schemas();
    expect(catalog(base, true).schemas()).toEqual(before);
    expect(catalog({ ...base, roverBaseUrl: '', roverToken: 'x' }, true).schemas()).toEqual(before);
    // Une adresse Internet n'active rien.
    expect(catalog({ ...base, roverBaseUrl: 'https://robot.example.com' }, true).schemas()).toEqual(before);
    expect(before.some((schema) => schema.name.startsWith('rover_'))).toBe(false);
  });

  it('adresse réglée : les six outils du robot s’ajoutent à la fin, sans rien retirer ni changer', () => {
    const old = catalog(base, false);
    const before = old.schemas().map((schema) => schema.name);
    const manager = catalog({ ...base, roverBaseUrl: 'http://jarvis-rover.local:8765', roverToken: 't' }, true);
    const after = manager.schemas().map((schema) => schema.name);
    expect(after.slice(0, before.length)).toEqual(before);
    expect(after.slice(before.length)).toEqual(ROVER_TOOLS);
    const previous = new Map(old.list().map((tool) => [tool.name, tool]));
    for (const tool of manager.list().filter((entry) => !entry.name.startsWith('rover_'))) {
      expect({ risk: tool.risk, category: tool.category, forceConfirm: tool.forceConfirm }).toEqual({
        risk: previous.get(tool.name)?.risk,
        category: previous.get(tool.name)?.category,
        forceConfirm: previous.get(tool.name)?.forceConfirm,
      });
    }
  });
});
