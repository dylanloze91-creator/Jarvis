import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildHealthReport, type HealthFacts } from '@jarvis/core';
import {
  blankReason,
  jsonParser,
  readStateFile,
  resetStateFileIncidents,
  stateFileIncidents,
  writeStateFile,
} from './safeFile.js';
import { SpeakerStore } from './speaker/store.js';
import { PhoneStore } from './phone/store.js';
import { collectHealthReport } from './health/collect.js';
import { parseSettings } from '@jarvis/core';

/** Ce que la coupure du 13 novembre 2026 a laissé : `speakers.json` = 413 octets nuls. */
const ZEROS = Buffer.alloc(413, 0);

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'jarvis-ecriture-sure-'));
  resetStateFileIncidents();
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

const quiet = { log: () => undefined };
const json = { parse: jsonParser() };

describe('écriture sûre des fichiers d’état', () => {
  it('reconnaît un fichier vide ou rempli de zéros', () => {
    expect(blankReason(ZEROS)).toBe('zeros');
    expect(blankReason(Buffer.alloc(0))).toBe('empty');
    expect(blankReason(Buffer.from('{}'))).toBeNull();
  });

  it('garde la version précédente en .bak et ne laisse aucun temporaire', async () => {
    const target = join(dir, 'etat.json');
    await writeStateFile(target, '{"v":1}', json);
    await writeStateFile(target, '{"v":2}', json);
    expect(await readFile(target, 'utf8')).toBe('{"v":2}');
    expect(await readFile(`${target}.bak`, 'utf8')).toBe('{"v":1}');
    expect((await readdir(dir)).filter((name) => name.endsWith('.tmp'))).toEqual([]);
  });

  it('un fichier de zéros ne remplace jamais la dernière bonne copie', async () => {
    const target = join(dir, 'etat.json');
    await writeStateFile(target, '{"v":1}', json);
    await writeStateFile(target, '{"v":2}', json); // .bak = v1
    await writeFile(target, ZEROS); // coupure
    await writeStateFile(target, '{"v":3}', json);
    expect(await readFile(`${target}.bak`, 'utf8')).toBe('{"v":1}');
  });

  it('un fichier à moitié écrit (illisible) ne devient jamais la copie de secours', async () => {
    const target = join(dir, 'etat.json');
    await writeStateFile(target, '{"v":1}', json);
    await writeStateFile(target, '{"v":2}', json); // .bak = v1
    await writeFile(target, '{"v":2, "enceintes": [{"nom": "cham'); // coupé en plein milieu
    await writeStateFile(target, '{"v":3}', json);
    expect(await readFile(`${target}.bak`, 'utf8')).toBe('{"v":1}');
    expect(await readFile(target, 'utf8')).toBe('{"v":3}');
  });

  it('le lecteur du fichier décide : un JSON valable que le lecteur refuse ne devient pas le .bak', async () => {
    const target = join(dir, 'etat.json');
    const objet = {
      parse: jsonParser((data) => {
        if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error('objet attendu');
        return data;
      }),
    };
    await writeStateFile(target, '{"v":1}', objet);
    await writeStateFile(target, '{"v":2}', objet); // .bak = v1
    await writeFile(target, '[]'); // JSON lisible, mais pas un état
    await writeStateFile(target, '{"v":3}', objet);
    expect(await readFile(`${target}.bak`, 'utf8')).toBe('{"v":1}');
  });

  it('sans .bak demandé : aucun fichier .bak', async () => {
    const target = join(dir, 'etat.json');
    await writeStateFile(target, '{"v":1}', { keepBackup: false });
    await writeStateFile(target, '{"v":2}', { keepBackup: false });
    expect((await readdir(dir)).filter((name) => name.endsWith('.bak'))).toEqual([]);
  });

  it('fichier rempli de zéros : mis de côté, .bak repris et réécrit, incident noté', async () => {
    const target = join(dir, 'etat.json');
    await writeStateFile(target, '{"v":1}', json);
    await writeStateFile(target, '{"v":2}', json);
    await writeFile(target, ZEROS);

    const read = await readStateFile(target, jsonParser<{ v: number }>(), quiet);
    expect(read.status).toBe('restored');
    expect(read.status === 'restored' && read.value).toEqual({ v: 1 });
    // Le fichier abîmé est gardé tel quel, jamais effacé.
    expect(await readFile(join(dir, 'etat.json.illisible'))).toEqual(ZEROS);
    // La version reprise est remise à sa place.
    expect(await readFile(target, 'utf8')).toBe('{"v":1}');
    expect(stateFileIncidents()).toEqual([
      expect.objectContaining({ file: 'etat.json', reason: 'zeros', restored: true, setAside: 'etat.json.illisible' }),
    ]);
  });

  it('sans .bak lisible : « abîmé », et une seconde copie abîmée n’écrase pas la première', async () => {
    const target = join(dir, 'etat.json');
    await writeFile(target, ZEROS);
    expect((await readStateFile(target, jsonParser(), quiet)).status).toBe('damaged');
    await writeFile(target, '{pas du json');
    const second = await readStateFile(target, jsonParser(), quiet);
    expect(second.status).toBe('damaged');
    const names = await readdir(dir);
    expect(names).toContain('etat.json.illisible');
    expect(names.some((name) => name.startsWith('etat.json.illisible-'))).toBe(true);
    expect(await readFile(join(dir, 'etat.json.illisible'))).toEqual(ZEROS);
  });

  it('fichier absent : « absent », le .bak n’est pas ressuscité (réinitialisation voulue)', async () => {
    const target = join(dir, 'etat.json');
    await writeFile(`${target}.bak`, '{"v":1}');
    expect((await readStateFile(target, jsonParser(), quiet)).status).toBe('absent');
    expect(stateFileIncidents()).toEqual([]);
  });
});

describe('speakers.json rempli de zéros (cas du 13 novembre)', () => {
  it('l’enceinte et sa clé reviennent depuis le .bak', async () => {
    const path = join(dir, 'speakers.json');
    const first = new SpeakerStore(() => path);
    await first.load();
    await first.setEnabled(true);
    const created = await first.addSpeaker('chambre'); // deuxième écriture : la première part en .bak
    await first.setEnabled(true); // troisième : le .bak contient l'enceinte
    expect(first.verify(created.token)).not.toBeNull();

    await writeFile(path, ZEROS); // coupure de courant

    const after = new SpeakerStore(() => path);
    await after.load();
    expect(after.verify(created.token)).toMatchObject({ name: 'chambre' });
    expect(await readFile(join(dir, 'speakers.json.illisible'))).toEqual(ZEROS);
    expect(stateFileIncidents()).toEqual([expect.objectContaining({ file: 'speakers.json', restored: true })]);
  });

  it('phone.json : même chemin', async () => {
    const path = join(dir, 'phone.json');
    const first = new PhoneStore(() => path);
    await first.load();
    await first.setEnabled(true);
    const created = await first.addDevice('iPhone');
    await first.setEnabled(true); // le .bak contient le téléphone relié
    await writeFile(path, ZEROS);
    const after = new PhoneStore(() => path);
    await after.load();
    expect(after.verify(created.token)).toMatchObject({ name: 'iPhone' });
    expect(stateFileIncidents()).toEqual([expect.objectContaining({ file: 'phone.json', restored: true })]);
  });
});

describe('bilan de santé', () => {
  const base: HealthFacts = {
    ollama: 'skip', models: 'skip', voice: 'skip', piper: 'skip', spotify: 'skip', google: 'skip',
    phone: 'skip', speakers: 'skip', robot: 'skip', printer: 'skip', disk: 'skip', backup: 'skip', vault: 'skip',
  };

  it('sans fichier abîmé : aucune ligne', () => {
    expect(buildHealthReport({ ...base }, 0).items).toEqual([]);
    expect(buildHealthReport({ ...base, files: { damaged: [] } }, 0).items).toEqual([]);
  });

  it('une ligne orange si le .bak a été repris, rouge sinon', () => {
    const report = buildHealthReport(
      {
        ...base,
        files: {
          damaged: [
            { file: 'speakers.json', restored: true, setAside: 'speakers.json.illisible' },
            { file: 'phone.json', restored: false, setAside: 'phone.json.illisible' },
          ],
        },
      },
      0,
    );
    expect(report.items.map((entry) => [entry.id, entry.level])).toEqual([
      ['files', 'orange'],
      ['files', 'red'],
    ]);
    expect(report.items[0]?.sentence).toContain('speakers.json était abîmé');
    expect(report.items[0]?.sentence).toContain('version précédente');
    expect(report.issues).toBe(2);
  });

  it('le collecteur reprend les fichiers abîmés notés au démarrage', async () => {
    const report = await collectHealthReport(
      parseSettings({}),
      {
        ollama: async () => ({ reachable: true, models: [] }),
        voiceMissing: async () => 0,
        piperReady: async () => true,
        spotify: async () => ({ tokenOk: true, speakerVisible: null }),
        google: async () => ({ connected: false, needsReconsent: false }),
        phoneEnabled: () => false,
        phonePublished: async () => false,
        speakersEnabled: () => false,
        speakersHeard: async () => false,
        robotReachable: async () => false,
        printerConfigured: () => false,
        printerReachable: async () => false,
        diskFree: async () => 100 * 1024 ** 3,
        backupState: async () => ({ lastAt: null, ok: true }),
        vaultReady: async () => ({ encryptionAvailable: true, unreadable: false }),
        damagedFiles: () => [{ file: 'speakers.json', restored: true, setAside: 'speakers.json.illisible' }],
      },
      0,
    );
    expect(report.items.some((entry) => entry.id === 'files' && entry.level === 'orange')).toBe(true);
  });
});
