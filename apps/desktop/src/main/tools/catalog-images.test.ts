import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it, vi } from 'vitest';

const userData = mkdtempSync(join(tmpdir(), 'jarvis-catalog-images-'));

vi.mock('electron', () => ({
  app: { getPath: () => userData, getVersion: () => '5.0.70', isPackaged: false },
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
const { ImagesService } = await import('../images/ImagesService.js');

afterAll(() => rmSync(userData, { recursive: true, force: true }));

const IMAGE_TOOLS = ['generer_image', 'images_etat'];

function catalog(values: Record<string, unknown>, withImages: boolean) {
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
    ...(withImages ? { images: new ImagesService({ getSettings }) } : {}),
  });
}

const PROFILES = {
  complet: {},
  modeste: { machine: { profile: 'modest', cpuOnly: true, measureFailed: false, detected: '8 Go', chosen: 'modeste' } },
};

describe.each(Object.entries(PROFILES))('catalogue %s et module images', (_label, base) => {
  it('module absent ou coupé : le modèle voit exactement le catalogue d’avant', () => {
    const before = catalog(base, false).schemas();
    expect(catalog(base, true).schemas()).toEqual(before);
    expect(catalog({ ...base, images: { enabled: false } }, true).schemas()).toEqual(before);
    expect(before.some((schema) => IMAGE_TOOLS.includes(schema.name))).toBe(false);
  });

  it('module activé : les deux outils s’ajoutent à la fin, sans rien retirer ni changer', () => {
    const old = catalog(base, false);
    const before = old.schemas().map((schema) => schema.name);
    const manager = catalog({ ...base, images: { enabled: true } }, true);
    const after = manager.schemas().map((schema) => schema.name);
    expect(after.slice(0, before.length)).toEqual(before);
    expect(after.slice(before.length)).toEqual(IMAGE_TOOLS);
    const previous = new Map(old.list().map((tool) => [tool.name, tool]));
    for (const tool of manager.list().filter((entry) => !IMAGE_TOOLS.includes(entry.name))) {
      expect({ risk: tool.risk, category: tool.category, forceConfirm: tool.forceConfirm }).toEqual({
        risk: previous.get(tool.name)?.risk,
        category: previous.get(tool.name)?.category,
        forceConfirm: previous.get(tool.name)?.forceConfirm,
      });
    }
    const generer = manager.list().find((tool) => tool.name === 'generer_image');
    expect(generer).toMatchObject({ risk: 'safe' });
    expect(core.availableTeams(after)).toContain('images');
  });
});
