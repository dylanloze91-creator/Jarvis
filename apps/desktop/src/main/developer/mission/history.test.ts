import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { rename as realRename } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createMission, judgeMissionEvidence } from '@jarvis/core';
import { afterEach, describe, expect, it } from 'vitest';
import {
  JOURNAL_KEPT_LINE,
  JOURNAL_MISSING_LINE,
  MissionStore,
  creationJournalBanner,
  gameFolderWritten,
  isJournalLock,
} from './history.js';

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function eperm(pathNote: string): NodeJS.ErrnoException {
  const error = new Error(
    `EPERM: operation not permitted, rename '${pathNote}' -> '${pathNote.replace(/\.tmp$/, '')}'`,
  ) as NodeJS.ErrnoException;
  error.code = 'EPERM';
  return error;
}

function finishedMission() {
  const mission = createMission({
    id: '2026-10-15-54d91468',
    projectId: 'nouveau-projet',
    kind: 'new-project',
    request: 'Crée un jeu de plateforme 2D',
    skipQuestions: true,
    now: 1_700_000_000_000,
  });
  mission.status = 'finished';
  mission.verdict = 'success';
  mission.summary = 'Superviseur : 6 agent(s) terminés.';
  return mission;
}

describe('journal de mission sous EPERM', () => {
  it('réessaie le rename après EPERM et garde une création réussie', async () => {
    const root = mkdtempSync(join(tmpdir(), 'jarvis-journal-'));
    roots.push(root);
    const game = join(root, 'jeu');
    mkdirSync(join(game, 'src'), { recursive: true });
    writeFileSync(join(game, 'package.json'), '{"name":"jeu"}\n');
    writeFileSync(join(game, 'src', 'level.ts'), 'export const level = 1;\n');
    expect(gameFolderWritten(game)).toBe(true);

    const windowsPath =
      'C:\\Users\\dylan\\AppData\\Roaming\\@jarvis\\desktop\\developer\\projects\\nouveau-projet\\missions\\2026-10-15-54d91468.json.21.tmp';
    let renames = 0;
    const store = new MissionStore(() => join(root, 'data'), {
      sleep: async () => undefined,
      rename: async (from, to) => {
        renames += 1;
        if (renames < 4) throw eperm(windowsPath);
        await realRename(from, to);
      },
    });

    const mission = finishedMission();
    const mode = await store.save(mission);
    expect(mode).toBe('renamed');
    expect(renames).toBe(4);

    const loaded = await store.load(mission.projectId, mission.id);
    expect(loaded?.status).toBe('finished');
    expect(loaded?.verdict).toBe('success');
    expect(loaded?.summary).toBe(mission.summary);
    const file = readFileSync(
      join(root, 'data', 'nouveau-projet', 'missions', `${mission.id}.json`),
      'utf8',
    );
    expect(file).toContain('"verdict": "success"');
    expect(file).not.toContain('AppData');
  });

  it('un rename toujours EPERM enregistre sur place et la bannière reste une réussite', async () => {
    const root = mkdtempSync(join(tmpdir(), 'jarvis-journal-'));
    roots.push(root);
    const game = join(root, 'jeu');
    mkdirSync(join(game, 'src'), { recursive: true });
    writeFileSync(join(game, 'package.json'), '{"name":"jeu"}\n');
    writeFileSync(join(game, 'src', 'level.ts'), 'export const level = 1;\n');

    const windowsPath =
      'C:\\Users\\dylan\\AppData\\Roaming\\@jarvis\\desktop\\developer\\projects\\nouveau-projet\\missions\\2026-10-15-54d91468.json.21.tmp';
    const store = new MissionStore(() => join(root, 'data'), {
      sleep: async () => undefined,
      rename: async () => {
        throw eperm(windowsPath);
      },
    });

    const mission = finishedMission();
    const mode = await store.save(mission);
    expect(mode).toBe('in-place');
    const loaded = await store.load(mission.projectId, mission.id);
    expect(loaded?.verdict).toBe('success');
    expect(loaded?.status).toBe('finished');
    const target = join(root, 'data', 'nouveau-projet', 'missions', `${mission.id}.json`);
    const file = readFileSync(target, 'utf8');
    expect(file).toContain('"verdict": "success"');
    expect(file).not.toContain('.tmp');
    expect(existsSync(join(game, 'package.json'))).toBe(true);
    expect(existsSync(join(game, 'src', 'level.ts'))).toBe(true);
    const busy = new Error('EBUSY: resource busy or locked, rename') as NodeJS.ErrnoException;
    busy.code = 'EBUSY';
    expect(isJournalLock(busy)).toBe(true);

    const banner = creationJournalBanner({
      ok: true,
      folderWritten: gameFolderWritten(game),
      levelWritten: true,
      journalNote: JOURNAL_KEPT_LINE,
      summary: mission.summary,
    });
    expect(banner.kept).toBe(true);
    expect(banner.text).toMatch(/Jeu écrit/);
    expect(banner.text).toMatch(/Aperçu ouvert/);
    expect(banner.text).not.toMatch(/AppData|[A-Za-z]:\\/);

    const crashed = creationJournalBanner({
      ok: false,
      folderWritten: true,
      levelWritten: false,
      summary: eperm(windowsPath).message,
    });
    expect(crashed.kept).toBe(false);
    expect(crashed.retry).toBe(true);
    expect(crashed.text).not.toMatch(/Jeu écrit/);
    expect(crashed.text).toMatch(/gabarit/);
    expect(crashed.text).not.toMatch(/AppData|[A-Za-z]:\\/);

    const empty = creationJournalBanner({
      ok: false,
      folderWritten: false,
      levelWritten: false,
      summary: eperm(windowsPath).message,
    });
    expect(empty.kept).toBe(false);
    expect(empty.failedShort).toBe(true);
    expect(empty.text).toBe(JOURNAL_MISSING_LINE);
    expect(empty.text).not.toMatch(/AppData|[A-Za-z]:\\/);
  });

  it('si l’écriture sur place est aussi verrouillée, l’erreur ne contient pas de chemin', async () => {
    const root = mkdtempSync(join(tmpdir(), 'jarvis-journal-'));
    roots.push(root);
    const store = new MissionStore(() => join(root, 'data'), {
      sleep: async () => undefined,
      rename: async () => {
        throw eperm('C:\\Users\\dylan\\AppData\\missions\\a.json.1.tmp');
      },
      writeFile: async (path) => {
        if (path.endsWith('.tmp')) return;
        const error = new Error(`EPERM: operation not permitted, open '${path}'`) as NodeJS.ErrnoException;
        error.code = 'EPERM';
        throw error;
      },
    });
    await expect(store.save(finishedMission())).rejects.toThrow(/^Journal de mission verrouillé\.$/);
  });

  it('un rename qui ne revient pas libère la file au lieu de laisser la mission en attente', async () => {
    const root = mkdtempSync(join(tmpdir(), 'jarvis-journal-'));
    roots.push(root);
    const store = new MissionStore(() => join(root, 'data'), {
      deadlineMs: 80,
      sleep: async () => undefined,
      rename: () => new Promise(() => {}),
    });
    const started = Date.now();
    await expect(store.save(finishedMission())).rejects.toThrow(/^Journal de mission verrouillé\.$/);
    await expect(store.save(finishedMission())).rejects.toThrow(/^Journal de mission verrouillé\.$/);
    expect(Date.now() - started).toBeLessThan(1_000);
  });

  it('un déplacement dont le retrait ne revient pas ne bloque pas l’enregistrement suivant', async () => {
    const root = mkdtempSync(join(tmpdir(), 'jarvis-journal-'));
    roots.push(root);
    const store = new MissionStore(() => join(root, 'data'), {
      deadlineMs: 80,
      sleep: async () => undefined,
      rm: () => new Promise(() => {}),
    });
    const mission = finishedMission();
    mission.projectId = 'jeu-plateforme-2d';
    const started = Date.now();
    await expect(store.move(mission, 'nouveau-projet')).rejects.toThrow(
      /^Journal de mission verrouillé\.$/,
    );
    expect(Date.now() - started).toBeLessThan(1_000);
    const loaded = await store.load(mission.projectId, mission.id);
    expect(loaded?.status).toBe('finished');
    const again = Date.now();
    await expect(store.save(mission)).resolves.toBe('renamed');
    expect(Date.now() - again).toBeLessThan(1_000);
  });

  it('relit le dossier de preuve après un autre processus', async () => {
    const root = mkdtempSync(join(tmpdir(), 'jarvis-evidence-store-'));
    roots.push(root);
    const mission = finishedMission();
    mission.evidence = judgeMissionEvidence({
      id: mission.id,
      at: mission.createdAt,
      goal: mission.request,
      passCriteria: ['le niveau n’est plus le gabarit'],
      kind: 'non-code',
      declaredSuccess: true,
      checks: [
        {
          name: 'niveau relu',
          kind: 'criterion',
          required: true,
          ran: true,
          passed: true,
          exitCode: null,
          testsRan: null,
        },
      ],
      finalResult: 'niveau relu',
    });
    const store = new MissionStore(() => join(root, 'data'));
    await store.save(mission);
    const folder = join(root, 'data', mission.projectId, 'missions', mission.id);
    expect(existsSync(join(folder, 'evidence.json'))).toBe(true);
    expect(existsSync(join(folder, 'diff.txt'))).toBe(true);
    const reader = spawnSync(
      process.execPath,
      [
        '-e',
        `const fs=require('node:fs'); const data=JSON.parse(fs.readFileSync(process.argv[1],'utf8')); if(data.finalResult.includes('secret')||JSON.stringify(data).includes('ghp_')) process.exit(2); process.stdout.write(data.status);`,
        join(folder, 'evidence.json'),
      ],
      { encoding: 'utf8' },
    );
    expect(reader.status).toBe(0);
    expect(reader.stdout).toBe('success_verified');
    const restarted = new MissionStore(() => join(root, 'data'));
    const loaded = await restarted.load(mission.projectId, mission.id);
    expect(loaded?.evidence?.status).toBe('success_verified');
    expect(loaded?.verdict).toBe('success');
  });
});
