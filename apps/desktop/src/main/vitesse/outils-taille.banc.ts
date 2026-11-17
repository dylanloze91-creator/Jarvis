/**
 * Taille de ce que chaque équipe reçoit comme outils (noms, descriptions, paramètres).
 *
 *   npx vitest run --config vitest.banc.config.ts src/main/vitesse/outils-taille.banc.ts
 *
 * Aucun modèle, aucun réseau : le catalogue est celui de l'appli, avec les réglages de Jarvis
 * Test (lus, jamais écrits). Les jetons sont estimés à 3,5 caractères par jeton.
 */
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, expect, it, vi } from 'vitest';

const userData = mkdtempSync(join(tmpdir(), 'jarvis-banc-outils-'));

vi.mock('electron', () => ({
  app: { getPath: () => userData, getVersion: () => 'banc', isPackaged: false },
  shell: { openExternal: async () => undefined, openPath: async () => '' },
  desktopCapturer: {},
  screen: {},
  clipboard: {},
  nativeImage: {},
}));

const core = await import('@jarvis/core');
const { createToolManager } = await import('../tools/index.js');
const { SpotifyBridge } = await import('../media/SpotifyBridge.js');
const { SiteBlockBridge } = await import('../siteblock/SiteBlockBridge.js');
const { PersonalizationStore } = await import('../personalization.js');
const { KnowledgeStore } = await import('../knowledge.js');

afterAll(() => rmSync(userData, { recursive: true, force: true }));

const CHARS_PER_TOKEN = 3.5;

it('taille des outils par équipe', () => {
  const raw = JSON.parse(readFileSync(join(process.env.APPDATA ?? '', 'Jarvis Test', 'settings.json'), 'utf8')) as Record<string, unknown>;
  delete raw.images;
  delete raw.developer;
  const settings = core.parseSettings(raw);
  const getSettings = () => settings;
  const tools = createToolManager({
    getSettings,
    searchRegistry: core.createWebSearchRegistry(),
    marketDataRegistry: core.createDefaultMarketDataRegistry(),
    spotify: new SpotifyBridge(getSettings),
    siteBlock: new SiteBlockBridge(getSettings),
    personalization: new PersonalizationStore(),
    knowledge: new KnowledgeStore({ getUserDataPath: () => userData }),
  });
  const schemas = tools.schemas();
  const size = (value: unknown): number => JSON.stringify(value).length;
  console.log('[outils] équipe | outils | caractères | jetons estimés | consigne de l’équipe (caractères)');
  for (const team of core.availableTeams(schemas.map((tool) => tool.name))) {
    const own = schemas.filter((tool) => core.teamHasTool(team, tool.name));
    const chars = own.reduce((sum, tool) => sum + size(tool), 0);
    console.log(
      `[outils] ${team} | ${own.length} | ${chars} | ${Math.round(chars / CHARS_PER_TOKEN)} | ${core.TEAM_SPECS[team].prompt.length}`,
    );
    for (const tool of [...own].sort((a, b) => size(b) - size(a)).slice(0, 3)) {
      console.log(`[outils]   ${tool.name} : ${size(tool)} caractères, dont ${tool.description.length} de description`);
    }
  }
  expect(schemas.length).toBeGreaterThan(0);
});
