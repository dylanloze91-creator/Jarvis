import { existsSync } from 'node:fs';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createMessage, ecrireStlBinaire, MoonrakerClient, SPEAKER_CANNOT_START, type AtelierEtat, type ChatMessage } from '@jarvis/core';
import { FakeMoonraker } from '../../../../../packages/core/src/quotidien/fakeMoonraker.testkit.js';
import { dossierAtelier, lireFichierAtelier } from './atelierPC.js';
import {
  ATELIER_FILE_ABSENTE,
  ATELIER_FILE_AUTO,
  ATELIER_IMPRIMANTE_ABSENTE,
  ATELIER_SANS_OPENSCAD,
  tourAtelier,
  type AtelierDeps,
  type ImprimanteAtelier,
} from './tourAtelier.js';

/** Pavé plein fermé de L × W × H (12 triangles). */
function pave(L: number, W: number, H: number): Uint8Array {
  const p = [
    [0, 0, 0], [L, 0, 0], [L, W, 0], [0, W, 0],
    [0, 0, H], [L, 0, H], [L, W, H], [0, W, H],
  ] as const;
  const faces = [
    [0, 2, 1], [0, 3, 2], [4, 5, 6], [4, 6, 7],
    [0, 1, 5], [0, 5, 4], [1, 2, 6], [1, 6, 5],
    [2, 3, 7], [2, 7, 6], [3, 0, 4], [3, 4, 7],
  ];
  return ecrireStlBinaire(faces.flatMap((f) => f.flatMap((i) => [...p[i]!])));
}

let racine: string;
let rendus: string[];
let tranches: string[];

/** Faux OpenSCAD : un pavé plein aux cotes du premier `cube([…])` de la pièce. */
function deps(extra: Partial<AtelierDeps> = {}, imprimante: ImprimanteAtelier | null = null): AtelierDeps {
  return {
    racine,
    jour: () => '2026-11-23',
    volume: async () => ({ x: 250, y: 250, z: 250 }),
    imprimante: () => imprimante,
    programmes: {
      openscad: () => 'openscad.com',
      rendreStl: async (_exe, scad, stl) => {
        rendus.push(stl);
        const m = /cube\(\[([\d.]+), ([\d.]+), ([\d.]+)\]\)/.exec(await readFile(scad, 'utf8'))!;
        await writeFile(stl, pave(Number(m[1]), Number(m[2]), Number(m[3])));
        return { ok: true, message: 'Pièce dessinée.' };
      },
      rendreImage: async () => ({ ok: false }),
      trancher: async (stl, sortie) => {
        tranches.push(stl);
        const gcode = join(racine, 'plate_1.gcode');
        await writeFile(gcode, '; G-code de test\n');
        expect(sortie).toContain('-tranche');
        return {
          ok: true,
          message: 'Fichier préparé.',
          gcode,
          infos: {
            secondes: 1020, dureeTexte: '17m 0s', filamentMm: 1400, filamentG: 4.3, filamentCm3: 3.4, couches: 100,
            hauteurMax: 30, trancheur: 'OrcaSlicer 2.4.2', plateau: 'Cool Plate', imprimante: null, reglage: null,
            filament: 'Generic PETG', saveur: 'klipper', buse: 245, lit: 60, objets: [],
          },
        };
      },
    },
    ...extra,
  };
}

/**
 * Fausse imprimante : le vrai client Moonraker sur le faux Moonraker du cœur, dont la file d'attente
 * suit `job_queue.py` (ajout sans lancement, passage automatique, chargement au démarrage).
 */
class FausseImprimante extends MoonrakerClient implements ImprimanteAtelier {
  envois: { name: string; print: boolean }[] = [];
  constructor(etat = 'standby', readonly fake = new FakeMoonraker()) {
    super('http://printer.local:7125', 'synthetique-test-cle', fake.fetch);
    if (etat !== 'standby') fake.status = { ...fake.status, state: etat, filename: 'en-cours-synthetique-test.gcode', progress: 0.4 };
  }
  override async upload(name: string, bytes: Uint8Array, print: boolean): Promise<void> {
    this.envois.push({ name, print });
    await super.upload(name, bytes, print);
  }
}

/** Joue une phrase comme la session : réponse ajoutée avec son état. */
async function dire(
  messages: ChatMessage[],
  text: string,
  d: AtelierDeps,
  options: { place?: 'fenetre' | 'enceinte'; confirm?: (s: string) => Promise<boolean> } = {},
): Promise<{ texte: string; etat?: AtelierEtat } | null> {
  const sortie = await tourAtelier(
    { text, messages, place: options.place ?? 'fenetre', confirm: options.confirm ?? (async () => false) },
    d,
  );
  messages.push(createMessage('user', text));
  if (sortie) messages.push({ ...createMessage('assistant', sortie.texte), ...(sortie.etat ? { atelier: sortie.etat } : {}) });
  return sortie;
}

beforeEach(async () => {
  racine = await mkdtemp(join(tmpdir(), 'jarvis-atelier-'));
  rendus = [];
  tranches = [];
});
afterEach(async () => {
  await rm(racine, { recursive: true, force: true });
});

describe('atelier dans la discussion, côté PC', () => {
  it('de la phrase à la pièce, puis une nouvelle version (l’ancienne gardée)', async () => {
    const messages: ChatMessage[] = [];
    const d = deps();
    const v1 = await dire(messages, 'Fais-moi une boîte de 80 par 50 par 30', d);
    expect(v1?.texte).toContain('Boîte de 80 × 50 × 30 mm.');
    expect(v1?.texte).toContain('imprime-la');
    expect(v1?.etat).toMatchObject({ etape: 'piece', dossier: 'boite-2026-11-23-1', versionChoisie: 1, plateau: { x: 250, y: 250 } });

    const v2 = await dire(messages, 'plus haute', d);
    expect(v2?.texte).toContain('Version 2 (Hauteur : 30 mm → 38 mm)');
    const etat = v2?.etat;
    if (etat?.etape !== 'piece') throw new Error('pas de pièce');
    expect(etat.versions.map((v) => v.numero)).toEqual([1, 2]);
    expect(existsSync(join(racine, 'boite-2026-11-23-1', 'v1.stl'))).toBe(true);
    expect(existsSync(join(racine, 'boite-2026-11-23-1', 'v2.stl'))).toBe(true);
    expect(existsSync(join(racine, 'boite-2026-11-23-1', 'v2.scad'))).toBe(true);

    // Deuxième pièce le même jour : autre dossier.
    const autre = await dire(messages, 'Fais-moi une boîte de 40 par 40 par 20', d);
    expect(autre?.etat).toMatchObject({ dossier: 'boite-2026-11-23-2' });
  });

  it('questions une à la fois, puis la pièce', async () => {
    const messages: ChatMessage[] = [];
    const q = await dire(messages, 'Fais-moi un support de téléphone', deps());
    expect(q?.etat).toMatchObject({ etape: 'question', mesure: 'angle' });
    expect(rendus).toHaveLength(0);
    expect(await dire(messages, 'Quelle heure est-il ?', deps())).toBeNull();
    // La question est passée : une autre réponse est venue entre-temps (ici, simulée).
    messages.push(createMessage('assistant', 'Il est 16 h.'));
    expect(await dire(messages, '70', deps())).toBeNull();
  });

  it('plus grande que la surface réglée : refusée, rien de rendu', async () => {
    const sortie = await dire([], 'Fais-moi une boîte de 280 par 100 par 40', deps());
    expect(sortie?.texte).toContain('250 × 250 × 250');
    expect(sortie?.etat).toBeUndefined();
    expect(rendus).toHaveLength(0);
  });

  it('sans OpenSCAD : dit, rien inventé', async () => {
    const sortie = await dire([], 'Fais-moi une boîte de 80 par 50 par 30', deps({ programmes: { ...deps().programmes, openscad: () => null } }));
    expect(sortie).toEqual({ texte: ATELIER_SANS_OPENSCAD });
  });

  it('imprimer : tranche, carte avec temps, filament et plaque, puis Moonraker', async () => {
    const imprimante = new FausseImprimante();
    const d = deps({}, imprimante);
    const messages: ChatMessage[] = [];
    await dire(messages, 'Fais-moi une boîte de 80 par 50 par 30', d);
    let carte = '';
    const sortie = await dire(messages, 'Imprime-la', d, {
      confirm: async (texte) => {
        carte = texte;
        return true;
      },
    });
    expect(carte).toBe(
      "Lancer l'impression de « boîte », version 1. Environ 17 min et 4,3 g de filament (1,40 m). Plaque : Cool Plate, lit 60 °C, buse 245 °C, filament Generic PETG. Vérifie que le plateau est vide.",
    );
    expect(imprimante.envois).toEqual([{ name: 'boite-2026-11-23-1-v1.gcode', print: true }]);
    expect(sortie?.texte).toBe('Impression lancée : boite-2026-11-23-1-v1.gcode.');
    if (sortie?.etat?.etape !== 'piece') throw new Error('pas de pièce');
    expect(sortie.etat.versions[0]).toMatchObject({ temps: '17m 0s', filament: '4,3 g' });
  });

  it('carte refusée : rien envoyé', async () => {
    const imprimante = new FausseImprimante();
    const d = deps({}, imprimante);
    const messages: ChatMessage[] = [];
    await dire(messages, 'Fais-moi une boîte de 80 par 50 par 30', d);
    const sortie = await dire(messages, 'imprime la version 1', d, { confirm: async () => false });
    expect(sortie?.texte).toBe("Rien n'a été lancé.");
    expect(imprimante.envois).toEqual([]);
  });

  it('« imprime-la » pendant une impression : carte « Ajouter à la file d’attente », envoi sans lancer, file relue', async () => {
    const imprimante = new FausseImprimante('printing');
    const d = deps({}, imprimante);
    const messages: ChatMessage[] = [];
    await dire(messages, 'Fais-moi une boîte de 80 par 50 par 30', d);
    let carte = '';
    const sortie = await dire(messages, 'Imprime-la', d, {
      confirm: async (texte) => {
        carte = texte;
        return true;
      },
    });
    expect(carte).toMatch(/^L'imprimante est occupée\. Ajouter à la file d'attente « boîte », version 1\. Environ 17 min/);
    expect(carte).toContain('Rien ne sera lancé');
    expect(imprimante.envois).toEqual([{ name: 'boite-2026-11-23-1-v1.gcode', print: false }]);
    expect(imprimante.fake.queue.map((j) => j.filename)).toEqual(['boite-2026-11-23-1-v1.gcode']);
    expect(imprimante.fake.queueState).toBe('paused');
    // L'impression en cours n'a pas bougé, et rien n'a été lancé ni relancé.
    expect(imprimante.fake.status).toMatchObject({ state: 'printing', filename: 'en-cours-synthetique-test.gcode' });
    expect(imprimante.fake.calls).not.toContain('POST /printer/print/start');
    expect(imprimante.fake.calls).not.toContain('POST /server/job_queue/start');
    expect(imprimante.fake.calls.filter((c) => c.startsWith('POST /printer/'))).toEqual([]);
    // Relue après l'ajout.
    expect(imprimante.fake.calls.slice(-1)).toEqual(['GET /server/job_queue/status']);
    expect(sortie?.texte).toBe(
      "« boîte », version 1, est dans la file d'attente : boite-2026-11-23-1-v1.gcode. Rien n'est lancé, la file reste en pause. Quand le plateau sera vide, dis-moi « le plateau est vide, lance la suivante ».",
    );
    // Fin de l'impression en cours : la file en pause ne lance rien toute seule.
    imprimante.fake.finishPrint();
    expect(imprimante.fake.status.state).toBe('complete');
    expect(imprimante.fake.queue).toHaveLength(1);
  });

  it('« mets-la dans la file » : carte refusée, rien envoyé ; deuxième pièce derrière la première', async () => {
    const imprimante = new FausseImprimante('printing');
    const d = deps({}, imprimante);
    const messages: ChatMessage[] = [];
    await dire(messages, 'Fais-moi une boîte de 80 par 50 par 30', d);
    const non = await dire(messages, 'Mets-la dans la file', d, { confirm: async () => false });
    expect(non?.texte).toBe("Rien n'a été ajouté à la file.");
    expect(imprimante.envois).toEqual([]);
    expect(imprimante.fake.queue).toEqual([]);

    let carte = '';
    await dire(messages, 'mets la version 1 dans la file d’attente', d, { confirm: async (t) => ((carte = t), true) });
    expect(carte).toMatch(/^Ajouter à la file d'attente « boîte », version 1\./);
    await dire(messages, 'plus haute', d);
    const deux = await dire(messages, 'ajoute-la à la file', d, { confirm: async () => true });
    expect(deux?.texte).toContain('version 2, est dans la file d\'attente (place 2 sur 2)');
    expect(imprimante.fake.queue.map((j) => j.filename)).toEqual(['boite-2026-11-23-1-v1.gcode', 'boite-2026-11-23-1-v2.gcode']);
  });

  it('même version deux fois : un nouveau nom, jamais le fichier en cours écrasé', async () => {
    const imprimante = new FausseImprimante('printing');
    imprimante.fake.status = { ...imprimante.fake.status, filename: 'boite-2026-11-23-1-v1.gcode' };
    imprimante.fake.files.push({ path: 'boite-2026-11-23-1-v1.gcode', size: 10 });
    const d = deps({}, imprimante);
    const messages: ChatMessage[] = [];
    await dire(messages, 'Fais-moi une boîte de 80 par 50 par 30', d);
    await dire(messages, 'Mets-la dans la file', d, { confirm: async () => true });
    expect(imprimante.envois).toEqual([{ name: 'boite-2026-11-23-1-v1-2.gcode', print: false }]);
    expect(imprimante.fake.status.filename).toBe('boite-2026-11-23-1-v1.gcode');
  });

  it('passage automatique ou chargement au démarrage réglés : refus avant la carte, rien envoyé', async () => {
    for (const reglage of [{ automatic_transition: 'True' }, { load_on_startup: 'true' }]) {
      const imprimante = new FausseImprimante('printing');
      imprimante.fake.jobQueue = reglage;
      const d = deps({}, imprimante);
      const messages: ChatMessage[] = [];
      await dire(messages, 'Fais-moi une boîte de 80 par 50 par 30', d);
      let carte = false;
      const sortie = await dire(messages, 'Imprime-la', d, { confirm: async () => ((carte = true), true) });
      expect(sortie?.texte).toBe(ATELIER_FILE_AUTO);
      expect(carte).toBe(false);
      expect(imprimante.envois).toEqual([]);
    }
    const sansFile = new FausseImprimante('printing');
    sansFile.fake.jobQueue = null;
    const messages: ChatMessage[] = [];
    await dire(messages, 'Fais-moi une boîte de 80 par 50 par 30', deps({}, sansFile));
    expect((await dire(messages, 'Imprime-la', deps({}, sansFile), { confirm: async () => true }))?.texte).toBe(ATELIER_FILE_ABSENTE);
    expect(sansFile.envois).toEqual([]);
  });

  it('file laissée « ready » par quelqu’un : mise en pause avant l’ajout, l’impression en cours continue', async () => {
    const imprimante = new FausseImprimante('printing');
    imprimante.fake.queueState = 'ready';
    const d = deps({}, imprimante);
    const messages: ChatMessage[] = [];
    await dire(messages, 'Fais-moi une boîte de 80 par 50 par 30', d);
    const sortie = await dire(messages, 'Imprime-la', d, { confirm: async () => true });
    expect(imprimante.fake.calls.indexOf('POST /server/job_queue/pause')).toBeLessThan(imprimante.fake.calls.indexOf('POST /server/files/upload'));
    expect(imprimante.fake.queueState).toBe('paused');
    expect(imprimante.fake.status.state).toBe('printing');
    expect(sortie?.texte).toContain("J'ai mis la file en pause");
  });

  it('« le plateau est vide, lance la suivante » : seule façon de relancer, après une carte, imprimante libre', async () => {
    const imprimante = new FausseImprimante('printing');
    const d = deps({}, imprimante);
    const messages: ChatMessage[] = [];
    await dire(messages, 'Fais-moi une boîte de 80 par 50 par 30', d);
    await dire(messages, 'Imprime-la', d, { confirm: async () => true });

    // Sans « plateau vide », rien n'est relancé.
    expect(await dire(messages, 'lance la suivante', d, { confirm: async () => true })).toBeNull();
    // Impression encore en cours : refus, sans carte.
    let carte = '';
    const tot = await dire(messages, 'Le plateau est vide, lance la suivante', d, { confirm: async (t) => ((carte = t), true) });
    expect(tot?.texte).toContain('encore en cours');
    expect(carte).toBe('');
    // Fin, carte refusée : rien.
    imprimante.fake.finishPrint();
    const non = await dire(messages, 'Le plateau est vide, lance la suivante', d, { confirm: async () => false });
    expect(non?.texte).toBe("Rien n'a été lancé.");
    expect(imprimante.fake.status.state).toBe('complete');
    // Depuis une enceinte : jamais.
    expect((await dire(messages, 'Le plateau est vide, lance la suivante', d, { place: 'enceinte', confirm: async () => true }))?.texte).toBe(SPEAKER_CANNOT_START);
    // Accord : lancée directement, retirée de la file, la file reste en pause.
    const oui = await dire(messages, 'Jarvis, le plateau est vide, lance la suivante', d, { confirm: async (t) => ((carte = t), true) });
    expect(carte).toContain('boite-2026-11-23-1-v1.gcode');
    expect(oui?.texte).toBe('Impression lancée : boite-2026-11-23-1-v1.gcode.');
    expect(imprimante.fake.status).toMatchObject({ state: 'printing', filename: 'boite-2026-11-23-1-v1.gcode' });
    expect(imprimante.fake.queue).toEqual([]);
    expect(imprimante.fake.queueState).toBe('paused');
    expect(imprimante.fake.calls).not.toContain('POST /server/job_queue/start');
    // File vide ensuite.
    imprimante.fake.finishPrint();
    expect((await dire(messages, 'le plateau est vide, lance la suivante', d, { confirm: async () => true }))?.texte).toContain('vide');
  });

  it('jamais depuis une enceinte, et imprimante non réglée : le fichier est prêt, rien envoyé', async () => {
    const messages: ChatMessage[] = [];
    await dire(messages, 'Fais-moi une boîte de 80 par 50 par 30', deps());
    const enceinte = await dire(messages, 'Imprime-la', deps({}, new FausseImprimante()), { place: 'enceinte' });
    expect(enceinte?.texte).toBe(SPEAKER_CANNOT_START);
    expect(tranches).toHaveLength(0);
    messages.pop();
    messages.pop();
    const sansImprimante = await dire(messages, 'Imprime-la', deps());
    expect(sansImprimante?.texte).toContain(ATELIER_IMPRIMANTE_ABSENTE);
  });

  it('la fenêtre ne lit que les fichiers des pièces', async () => {
    const messages: ChatMessage[] = [];
    await dire(messages, 'Fais-moi une boîte de 80 par 50 par 30', deps());
    const stl = await lireFichierAtelier('boite-2026-11-23-1', 'v1.stl', racine);
    expect(stl.byteLength).toBeGreaterThan(84);
    await expect(lireFichierAtelier('..', 'v1.stl', racine)).rejects.toThrow('refusé');
    await expect(lireFichierAtelier('boite-2026-11-23-1', 'v1.scad', racine)).rejects.toThrow('refusé');
    await expect(lireFichierAtelier('boite-2026-11-23-1', '..\\..\\secret.stl', racine)).rejects.toThrow('refusé');
    expect(dossierAtelier('a/b', racine)).toBeNull();
    expect(dossierAtelier('boite-2026-11-23-1', racine)).toBe(join(racine, 'boite-2026-11-23-1'));
  });
});
