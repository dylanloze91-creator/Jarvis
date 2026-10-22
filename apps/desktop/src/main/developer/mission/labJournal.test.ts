import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { labRealExport, referenceMissions } from '../../../../../../packages/core/src/developer/lab.js';
import {
  labJournalMission,
  ollamaLabModel,
  probeLabModel,
  runLabBatch,
  runLabMission,
  type LabModel,
} from '../../../../../../packages/core/src/developer/labRunner.js';
import { MissionStore } from './history.js';

const EVIDENCE_ROOT =
  '/cursor/stores/bc-3a2e3f44-8967-432c-8f56-deb24a216831/files/laboratoire-missions-5.0.52';

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function passingStub(): LabModel {
  return {
    name: 'stub',
    digest: 'synthetic',
    async complete() {
      return {
        text: '',
        toolCalls: [
          {
            id: 'w',
            name: 'write_file',
            arguments: {
              path: 'src/keel.mjs',
              content: 'export function keel(n) {\n  return n > 0 ? 1 : n < 0 ? -1 : 0;\n}\n',
            },
          },
        ],
      };
    },
  };
}

describe('journal du laboratoire', () => {
  it('relit la preuve après un nouveau magasin et un autre processus', async () => {
    const root = mkdtempSync(join(tmpdir(), 'jarvis-lab-journal-'));
    roots.push(root);
    const mission = referenceMissions().find((item) => item.id === 'l1-keel-sign');
    expect(mission).toBeTruthy();
    const result = await runLabMission({
      mission: mission!,
      model: passingStub(),
      arm: 'alone',
      workRoot: join(root, 'work'),
      synthetic: true,
      maxAttempts: 1,
    });
    const state = labJournalMission(mission!, result, 1_700_000_000_000);
    expect(state?.evidence?.status).toBe('success_verified');
    expect(state?.evidence?.limits.join(' ')).toMatch(/synthétique/);
    const store = new MissionStore(() => join(root, 'data'));
    await store.save(state!);
    const reloaded = await new MissionStore(() => join(root, 'data')).load('laboratoire', state!.id);
    expect(reloaded?.evidence?.status).toBe('success_verified');
    expect(reloaded?.verdict).toBe('success');
    const evidencePath = join(root, 'data', 'laboratoire', 'missions', state!.id, 'evidence.json');
    const reader = spawnSync(
      process.execPath,
      [
        '-e',
        `const fs=require('node:fs'); const data=JSON.parse(fs.readFileSync(process.argv[1],'utf8')); process.stdout.write(data.status+' '+(data.limits||[]).join(' '));`,
        evidencePath,
      ],
      { encoding: 'utf8' },
    );
    expect(reader.status).toBe(0);
    expect(reader.stdout).toContain('success_verified');
    expect(reader.stdout).toContain('synthétique');
  });

  const measure = process.env.JARVIS_LAB_BATCH === '1' ? it : it.skip;
  measure(
    'mesure le lot sur le modèle déjà installé et le journal existant',
    async () => {
      const probe = await probeLabModel();
      mkdirSync(EVIDENCE_ROOT, { recursive: true });
      if (!probe.ok) {
        writeFileSync(join(EVIDENCE_ROOT, 'blocked.json'), JSON.stringify({ blocked: true, reason: probe.reason }, null, 2));
        throw new Error(probe.reason);
      }
      const root = mkdtempSync(join(tmpdir(), 'jarvis-lab-batch-'));
      roots.push(root);
      const started = Date.now();
      const store = new MissionStore(() => join(EVIDENCE_ROOT, 'journal'));
      const batch = await runLabBatch({
        model: ollamaLabModel(probe.digest),
        workParent: root,
        records: [],
        journalSave: async (mission) => {
          await store.save(mission);
          console.log(`${mission.id} ${mission.evidence?.status ?? 'sans preuve'} ${mission.summary ?? ''}`);
        },
      });
      const rows = batch.rows.map(({ prompt, ...row }) => row);
      writeFileSync(
        join(EVIDENCE_ROOT, 'batch.json'),
        JSON.stringify(
          {
            model: probe.name,
            digest: probe.digest,
            startedAt: new Date(started).toISOString(),
            durationMs: Date.now() - started,
            levels: batch.levels,
            rows,
            export: labRealExport([]),
          },
          null,
          2,
        ),
      );
      mkdirSync(join(EVIDENCE_ROOT, 'prompts'), { recursive: true });
      for (const row of batch.rows) {
        writeFileSync(join(EVIDENCE_ROOT, 'prompts', `${row.id}-${row.arm}.txt`), row.prompt);
        expect(row.prompt).not.toContain('assert.equal');
        expect(row.promptHasHidden).toBe(false);
        expect(row.synthetic).toBe(false);
        if (!row.excluded) {
          expect(row.modelCalls).toBeGreaterThan(0);
          expect(row.evidenceId).toBeTruthy();
          expect(row.exitCode).not.toBeNull();
        }
      }
      expect(batch.levels[1].ran).toBe(true);
      if (!batch.levels[1].sound) expect(batch.levels[2].ran).toBe(false);
      if (!batch.levels[2].sound) expect(batch.levels[3].ran).toBe(false);
      const kept = labRealExport(
        batch.rows
          .filter((row) => row.status === 'accepted')
          .map((row) => ({ status: row.status, synthetic: row.synthetic, evidence: null })),
      );
      expect(kept.manifest.kept).toBe(0);
      const again = new MissionStore(() => join(EVIDENCE_ROOT, 'journal'));
      const visible = batch.rows.filter((row) => row.evidenceId);
      expect(visible.length).toBeGreaterThan(0);
      for (const row of visible) {
        const loaded = await again.load('laboratoire', `${row.id}-${row.arm}`);
        expect(loaded?.evidence?.id).toBe(`${row.id}-${row.arm}`);
      }
    },
    1_200_000,
  );
});
