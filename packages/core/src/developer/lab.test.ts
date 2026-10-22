import { spawnSync } from 'node:child_process';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { ToolCall } from '../types.js';
import {
  classifyLabRow,
  hiddenTestsIsolated,
  labBrief,
  labContamination,
  labRealExport,
  levelSound,
  nearDuplicate,
  referenceMissions,
  skillBrief,
  validateLabMission,
} from './lab.js';
import { ollamaLabModel, probeLabModel, runLabMission, type LabModel } from './labRunner.js';

function stub(write: { path: string; content: string } | null, text = ''): LabModel {
  return {
    name: 'stub',
    digest: 'synthetic',
    async complete(): Promise<{ text: string; toolCalls: ToolCall[] }> {
      if (!write) return { text, toolCalls: [] };
      return { text, toolCalls: [{ id: 'w', name: 'write_file', arguments: write }] };
    },
  };
}

describe('laboratoire de missions', () => {
  it('produit une mission valide et refuse une mission mal formée', () => {
    const missions = referenceMissions();
    expect(missions.length).toBeGreaterThanOrEqual(4);
    for (const mission of missions) expect(validateLabMission(mission)).toEqual({ ok: true });
    const broken = { ...missions[0]!, hiddenTests: [], id: 'casse' };
    expect(validateLabMission(broken).ok).toBe(false);
    const ids = new Set(missions.map((mission) => mission.id));
    expect(ids.size).toBe(missions.length);
    for (let i = 0; i < missions.length; i += 1) {
      for (let j = i + 1; j < missions.length; j += 1) {
        expect(nearDuplicate(missions[i]!, missions[j]!), `${missions[i]!.id} ${missions[j]!.id}`).toBe(false);
      }
    }
  });

  it('isole les tests cachés et détecte un doublon ou une contamination', () => {
    const mission = referenceMissions()[0]!;
    const brief = labBrief(mission);
    expect(hiddenTestsIsolated(brief, mission.hiddenTests)).toBe(true);
    expect(brief.files.some((file) => file.path.includes('hidden'))).toBe(false);
    expect(JSON.stringify(brief)).not.toContain('assert.equal');
    const copy = { ...mission, id: 'autre', goal: mission.goal };
    expect(nearDuplicate(mission, copy)).toBe(true);
    expect(nearDuplicate(mission, referenceMissions()[1]!)).toBe(false);
    expect(labContamination(mission, [{ missionId: mission.id, skillId: 's1' }])).toMatch(/compétence/);
    expect(skillBrief(['assert.equal(keel(1), 1)'], mission.hiddenTests).leaked).toBe(true);
  });

  it('fait passer et échouer, puis sépare collecté, vérifié et accepté', async () => {
    const mission = referenceMissions().find((item) => item.id === 'l1-keel-sign')!;
    const root = await mkdtemp(join(tmpdir(), 'jarvis-lab-'));
    const passed = await runLabMission({
      mission,
      model: stub({ path: 'src/keel.mjs', content: 'export function keel(n) {\n  if (n > 0) return 1;\n  if (n < 0) return -1;\n  return 0;\n}\n' }),
      arm: 'alone',
      workRoot: join(root, 'ok'),
      synthetic: true,
      maxAttempts: 1,
    });
    expect(passed.evidence?.status).toBe('success_verified');
    expect(passed.status).toBe('verified');
    expect(passed.synthetic).toBe(true);
    const failed = await runLabMission({
      mission,
      model: stub({ path: 'src/keel.mjs', content: 'export function keel(n) {\n  return 0;\n}\n' }),
      arm: 'alone',
      workRoot: join(root, 'ko'),
      synthetic: true,
      maxAttempts: 1,
    });
    expect(failed.evidence?.status).toBe('failed');
    expect(failed.status).toBe('collected');
    const accepted = classifyLabRow({
      evidence: passed.evidence && {
        ...passed.evidence,
        staging: { ...passed.evidence.staging, validationStatus: 'accepted' },
      },
      declaredSuccess: false,
      leak: false,
      duplicate: false,
      contaminated: false,
      synthetic: false,
      acceptedByGates: true,
    });
    expect(accepted.status).toBe('accepted');
    expect(new Set([failed.status, passed.status, accepted.status])).toEqual(new Set(['collected', 'verified', 'accepted']));
    const declared = classifyLabRow({
      evidence: null,
      declaredSuccess: true,
      leak: false,
      duplicate: false,
      contaminated: false,
      synthetic: false,
      acceptedByGates: false,
    });
    expect(declared).toMatchObject({ status: 'rejected', reason: expect.stringMatching(/sans preuve/) });
    const exported = labRealExport([
      { status: 'accepted', synthetic: true, evidence: passed.evidence },
      { status: 'candidate', synthetic: false, evidence: passed.evidence },
    ]);
    expect(exported.manifest.kept).toBe(0);
    const contaminated = classifyLabRow({
      evidence: passed.evidence,
      declaredSuccess: false,
      leak: false,
      duplicate: false,
      contaminated: true,
      synthetic: false,
      acceptedByGates: true,
    });
    expect(contaminated.status).toBe('rejected');
    let calls = 0;
    const blocked = await runLabMission({
      mission,
      model: {
        name: 'stub',
        digest: 'synthetic',
        async complete() {
          calls += 1;
          return { text: '', toolCalls: [] };
        },
      },
      arm: 'alone',
      workRoot: join(root, 'contam'),
      synthetic: true,
      origins: [{ missionId: mission.id, skillId: 'skill-keel' }],
    });
    expect(blocked.status).toBe('rejected');
    expect(blocked.excluded).toBe(true);
    expect(blocked.modelCalls).toBe(0);
    expect(calls).toBe(0);
  });

  it('réinitialise le dossier et relit la preuve après un autre processus', async () => {
    const mission = referenceMissions().find((item) => item.id === 'l1-keel-sign')!;
    const root = await mkdtemp(join(tmpdir(), 'jarvis-lab-reset-'));
    const work = join(root, 'work');
    await runLabMission({
      mission,
      model: stub({ path: 'src/extra.mjs', content: 'export const leftover = 1;\n' }),
      arm: 'alone',
      workRoot: work,
      synthetic: true,
      maxAttempts: 1,
    });
    const second = await runLabMission({
      mission,
      model: stub({ path: 'src/keel.mjs', content: 'export function keel(n) {\n  return n > 0 ? 1 : n < 0 ? -1 : 0;\n}\n' }),
      arm: 'alone',
      workRoot: work,
      synthetic: true,
      maxAttempts: 1,
    });
    expect(second.files.map((file) => file.path)).not.toContain('src/extra.mjs');
    expect(second.evidence?.commands[0]?.exitCode).toBe(0);
    const folder = join(root, 'journal');
    const { mkdir, writeFile } = await import('node:fs/promises');
    await mkdir(folder, { recursive: true });
    await writeFile(join(folder, 'evidence.json'), JSON.stringify(second.evidence));
    const reader = spawnSync(process.execPath, ['-e', `const fs=require('node:fs'); const data=JSON.parse(fs.readFileSync(process.argv[1],'utf8')); process.stdout.write(data.status+' '+(data.limits||[]).join(' '));`, join(folder, 'evidence.json')], { encoding: 'utf8' });
    expect(reader.status).toBe(0);
    expect(reader.stdout).toContain('success_verified');
    expect(reader.stdout).toContain('synthétique');
  });

  it('écarte un fichier de départ qui passe déjà, et n’avance pas de niveau si la preuve est fausse', async () => {
    const mission = referenceMissions().find((item) => item.id === 'l1-span-clamp')!;
    const already = {
      ...mission,
      starterFiles: [
        {
          path: 'src/span.mjs',
          content: 'export function span(value, low, high) {\n  return Math.min(high, Math.max(low, value));\n}\n',
        },
      ],
    };
    const root = await mkdtemp(join(tmpdir(), 'jarvis-lab-screen-'));
    let calls = 0;
    const screened = await runLabMission({
      mission: already,
      model: {
        name: 'stub',
        digest: 'synthetic',
        async complete() {
          calls += 1;
          return { text: '', toolCalls: [] };
        },
      },
      arm: 'alone',
      workRoot: join(root, 'green'),
      synthetic: true,
    });
    expect(screened.excluded).toBe(true);
    expect(screened.excludeReason).toMatch(/passent déjà/);
    expect(calls).toBe(0);
    expect(
      levelSound([{ excluded: false, evidenceId: 'x', promptHasHidden: true, verifiedWithoutExit: false }]),
    ).toBe(false);
    expect(
      levelSound([{ excluded: false, evidenceId: 'x', promptHasHidden: false, verifiedWithoutExit: false }]),
    ).toBe(true);
  });

  it('appelle le modèle réel, ou dit que la série est bloquée', async () => {
    const probe = await probeLabModel();
    if (!probe.ok) {
      expect(probe.reason).toMatch(/bloquée|absent/);
      return;
    }
    expect(probe.digest.startsWith('65ec06548149')).toBe(true);
    const mission = referenceMissions().find((item) => item.id === 'l1-keel-sign')!;
    const root = await mkdtemp(join(tmpdir(), 'jarvis-lab-real-'));
    const result = await runLabMission({
      mission,
      model: ollamaLabModel(probe.digest),
      arm: 'alone',
      workRoot: join(root, 'real'),
      maxAttempts: 1,
      timeoutMs: 60_000,
    });
    expect(result.modelCalls).toBeGreaterThan(0);
    expect(result.promptHasHidden).toBe(false);
    expect(result.prompt).not.toContain('assert.equal');
    expect(result.evidence?.commands.some((command) => command.exitCode !== null)).toBe(true);
    expect(result.synthetic).toBe(false);
  }, 90_000);
});
