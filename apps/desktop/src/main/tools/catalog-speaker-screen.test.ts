import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it, vi } from 'vitest';

const userData = mkdtempSync(join(tmpdir(), 'jarvis-catalog-ecran-'));

vi.mock('electron', () => ({
  app: { getPath: () => userData, getVersion: () => '5.0.78', isPackaged: false },
  shell: { openExternal: async () => undefined },
  desktopCapturer: {},
  screen: {},
  clipboard: {},
  nativeImage: {},
}));

const core = await import('@jarvis/core');
const { createToolManager } = await import('./index.js');
const { createSpeakerScreenTools } = await import('./speakerScreen.js');
const { SpotifyBridge } = await import('../media/SpotifyBridge.js');
const { SiteBlockBridge } = await import('../siteblock/SiteBlockBridge.js');
const { PersonalizationStore } = await import('../personalization.js');
const { KnowledgeStore } = await import('../knowledge.js');

afterAll(() => rmSync(userData, { recursive: true, force: true }));

type Shown = { target: string; info: { title: string; line?: string; seconds?: number } };

function fakePort(names: string[]) {
  const shown: Shown[] = [];
  return {
    shown,
    port: {
      linkedNames: () => names,
      show: (target: string, info: Shown['info']) => {
        shown.push({ target, info });
        if (target === 'toutes') return names.length;
        return names.some((name) => name.toLowerCase() === target.toLowerCase()) ? 1 : 0;
      },
    },
  };
}

function catalog(values: Record<string, unknown>, names: string[] | null) {
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
    ...(names ? { speakerScreen: fakePort(names).port } : {}),
  });
}

const PROFILES = {
  complet: {},
  modeste: { machine: { profile: 'modest', cpuOnly: true, measureFailed: false, detected: '8 Go', chosen: 'modeste' } },
};

describe.each(Object.entries(PROFILES))('catalogue %s et écran des enceintes', (_label, base) => {
  it('sans enceinte reliée, le modèle voit exactement le catalogue d’avant', () => {
    const before = catalog(base, null).schemas();
    expect(catalog(base, []).schemas()).toEqual(before);
    expect(before.some((schema) => schema.name === 'afficher_sur_enceinte')).toBe(false);
  });

  it('une enceinte reliée : un seul outil s’ajoute à la fin, sans rien retirer ni changer', () => {
    const before = catalog(base, null).schemas();
    const after = catalog(base, ['Chambre']).schemas();
    expect(after.slice(0, before.length)).toEqual(before);
    expect(after.slice(before.length).map((schema) => schema.name)).toEqual(['afficher_sur_enceinte']);
  });
});

describe('outil afficher_sur_enceinte', () => {
  const run = async (names: string[], args: Record<string, unknown>) => {
    const fake = fakePort(names);
    const manager = new core.ToolManager().register(createSpeakerScreenTools(fake.port)[0]!);
    const result = await manager.execute({ id: 'appel', name: 'afficher_sur_enceinte', arguments: args }, {} as never);
    return { result, shown: fake.shown };
  };

  it('est sûr (aucune carte) et envoie à toutes les enceintes, 60 s, si rien n’est précisé', async () => {
    const tool = createSpeakerScreenTools(fakePort(['Chambre']).port)[0]!;
    expect(tool.risk).toBe('safe');
    const { result, shown } = await run(['Chambre', 'Salon'], { titre: 'Dîner', ligne: 'À table !' });
    expect(result.status).toBe('ok');
    expect(shown).toEqual([{ target: 'toutes', info: { title: 'Dîner', line: 'À table !', seconds: 60 } }]);
    expect(result.content).toContain('2 enceintes');
    // Honnête : l'affichage n'est pas vérifié depuis le PC.
    expect(result.content).toContain('je ne peux pas vérifier');
  });

  it('vise une enceinte par son nom, avec la durée demandée', async () => {
    const { result, shown } = await run(['Chambre', 'Salon'], { titre: 'Minuteur', enceinte: 'chambre', secondes: 120 });
    expect(result.status).toBe('ok');
    expect(shown).toEqual([{ target: 'chambre', info: { title: 'Minuteur', line: '', seconds: 120 } }]);
    expect(result.content).toContain('1 enceinte');
  });

  it('nom inconnu : échec dit tel quel, avec les enceintes reliées', async () => {
    const { result } = await run(['Chambre'], { titre: 'Test', enceinte: 'Cuisine' });
    expect(result.status).toBe('error');
    expect(result.content).toContain('« Cuisine »');
    expect(result.content).toContain('Chambre');
    expect(result.content).toContain('Rien n’a été affiché');
  });

  it('texte mis dans « ligne » sans titre (vu avec qwen2.5:7b) : la ligne sert de titre', async () => {
    const ok = await run(['Chambre'], { ligne: 'Test', enceinte: 'chambre' });
    expect(ok.result.status).toBe('ok');
    expect(ok.shown).toEqual([{ target: 'chambre', info: { title: 'Test', line: '', seconds: 60 } }]);
    const inconnue = await run(['Chambre'], { ligne: 'Test', enceinte: 'cuisine' });
    expect(inconnue.result.status).toBe('error');
    expect(inconnue.result.content).toContain('« cuisine »');
    expect(inconnue.result.content).toContain('Chambre');
    const vide = await run(['Chambre'], { enceinte: 'chambre' });
    expect(vide.result.status).toBe('error');
    expect(vide.shown).toEqual([]);
  });

  it('un texte trop long est coupé avant l’envoi, et la réponse le dit', async () => {
    const { result, shown } = await run(['Chambre'], { titre: 'é'.repeat(40), ligne: 'Deux\nlignes' });
    expect(result.status).toBe('ok');
    expect(shown[0]!.info).toEqual({ title: 'é'.repeat(23), line: 'Deux lignes', seconds: 60 });
    expect(result.content).toContain('coupé');
  });

  it('sans enceinte reliée, l’outil répond indisponible et n’envoie rien', async () => {
    const { result, shown } = await run([], { titre: 'Test' });
    expect(result.status).toBe('error');
    expect(shown).toEqual([]);
  });
});
