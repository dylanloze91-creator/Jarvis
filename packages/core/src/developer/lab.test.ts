import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
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
import { ollamaLabModel, probeLabModel, resolveWorkPath, runLabMission, type LabModel } from './labRunner.js';

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
  }, 120_000);

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
  }, 120_000);

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
  }, 120_000);

  it('accepte un chemin dans le dossier, refuse l’extérieur, signale un fichier inchangé, et exige les tests', async () => {
    const root = '/tmp/jarvis-lab-root';
    expect(resolveWorkPath(root, 'src/keel.mjs')).toEqual({
      ok: true,
      full: `${root}/src/keel.mjs`,
      relative: 'src/keel.mjs',
    });
    expect(resolveWorkPath(root, `${root}/src/keel.mjs`)).toEqual({
      ok: true,
      full: `${root}/src/keel.mjs`,
      relative: 'src/keel.mjs',
    });
    expect(resolveWorkPath(root, '/tmp/keel.js').ok).toBe(false);
    expect(resolveWorkPath(root, '/path/to/keel.mjs').ok).toBe(false);
    expect(resolveWorkPath(root, 'src/../../tmp/keel.js').ok).toBe(false);
    expect(resolveWorkPath(`${root}/work`, `${root}/work-evil/src/keel.mjs`).ok).toBe(false);
    expect(resolveWorkPath(root, 'C:\\src\\keel.mjs').ok).toBe(false);

    const winRoot = 'C:\\jarvis-lab-root';
    expect(resolveWorkPath(winRoot, 'src\\keel.mjs')).toEqual({
      ok: true,
      full: 'C:\\jarvis-lab-root\\src\\keel.mjs',
      relative: 'src/keel.mjs',
    });
    expect(resolveWorkPath(winRoot, 'C:\\jarvis-lab-root\\src\\keel.mjs')).toEqual({
      ok: true,
      full: 'C:\\jarvis-lab-root\\src\\keel.mjs',
      relative: 'src/keel.mjs',
    });
    expect(resolveWorkPath(winRoot, 'C:\\tmp\\keel.js').ok).toBe(false);
    expect(resolveWorkPath(winRoot, 'src\\..\\..\\tmp\\keel.js').ok).toBe(false);
    expect(resolveWorkPath('C:\\work', 'C:\\work-evil\\src\\keel.mjs').ok).toBe(false);

    const mission = referenceMissions().find((item) => item.id === 'l1-keel-sign')!;
    const dir = await mkdtemp(join(tmpdir(), 'jarvis-lab-path-'));
    const correct = 'export function keel(n) {\n  if (n > 0) return 1;\n  if (n < 0) return -1;\n  return 0;\n}\n';
    const insideRoot = join(dir, 'inside');
    const inside = await runLabMission({
      mission,
      model: stub({ path: join(insideRoot, 'src/keel.mjs'), content: correct }),
      arm: 'alone',
      workRoot: insideRoot,
      synthetic: true,
      maxAttempts: 1,
    });
    expect(inside.prompt).toContain('Chemins relatifs autorisés : src/keel.mjs');
    expect(inside.evidence?.status).toBe('success_verified');
    expect(inside.status).not.toBe('accepted');
    expect(await readFile(join(insideRoot, 'src/keel.mjs'), 'utf8')).toContain('return 1');

    const relativeRoot = join(dir, 'relative');
    const relativeOk = await runLabMission({
      mission,
      model: stub({ path: 'src/keel.mjs', content: correct }),
      arm: 'alone',
      workRoot: relativeRoot,
      synthetic: true,
      maxAttempts: 1,
    });
    expect(relativeOk.prompt).toContain('Chemins relatifs autorisés : src/keel.mjs');
    expect(relativeOk.evidence?.status).toBe('success_verified');
    expect(relativeOk.status).not.toBe('accepted');
    expect(await readFile(join(relativeRoot, 'src/keel.mjs'), 'utf8')).toContain('return 1');

    const beforeTmp = existsSync('/tmp/keel.js') ? readFileSync('/tmp/keel.js', 'utf8') : null;
    const outside = await runLabMission({
      mission,
      model: stub({ path: '/tmp/keel.js', content: correct }),
      arm: 'alone',
      workRoot: join(dir, 'outside'),
      synthetic: true,
      maxAttempts: 2,
    });
    expect(outside.evidence?.status).not.toBe('success_verified');
    expect(outside.attempts).toHaveLength(2);
    expect(outside.prompt).toContain('chemin refusé');
    expect(outside.prompt).toContain('Chemin autorisé : src/keel.mjs');
    expect(outside.prompt).toMatch(/expected|Expected/);
    expect(outside.prompt).not.toContain('assert.equal');
    expect(outside.prompt).not.toContain('hidden/keel.test.mjs');
    expect(await readFile(join(dir, 'outside/src/keel.mjs'), 'utf8')).toContain('return 0');
    expect(existsSync('/tmp/keel.js') ? readFileSync('/tmp/keel.js', 'utf8') : null).toBe(beforeTmp);

    const foreign = await runLabMission({
      mission,
      model: stub({ path: '/path/to/keel.mjs', content: correct }),
      arm: 'alone',
      workRoot: join(dir, 'foreign'),
      synthetic: true,
      maxAttempts: 1,
    });
    expect(foreign.evidence?.status).not.toBe('success_verified');
    expect(foreign.attempts[0]?.toolFeedback).toContain('Chemin autorisé : src/keel.mjs');
    expect(existsSync('/path/to/keel.mjs')).toBe(false);
    expect(await readFile(join(dir, 'foreign/src/keel.mjs'), 'utf8')).toContain('return 0');

    const unauthorized = await runLabMission({
      mission,
      model: stub({ path: 'src/other.mjs', content: correct }),
      arm: 'alone',
      workRoot: join(dir, 'unauthorized'),
      synthetic: true,
      maxAttempts: 1,
    });
    expect(unauthorized.evidence?.status).not.toBe('success_verified');
    expect(unauthorized.attempts[0]?.toolFeedback).toContain('Chemin autorisé : src/keel.mjs');
    expect(existsSync(join(dir, 'unauthorized/src/other.mjs'))).toBe(false);
    expect(await readFile(join(dir, 'unauthorized/src/keel.mjs'), 'utf8')).toContain('return 0');

    const oversizedMission = {
      ...mission,
      starterFiles: [
        ...mission.starterFiles,
        ...Array.from({ length: 6 }, (_, index) => ({
          path: `src/fill-${index}.txt`,
          content: 'x'.repeat(32_000),
        })),
      ],
    };
    const rollback = await runLabMission({
      mission: oversizedMission,
      model: stub({ path: 'src/keel.mjs', content: 'x'.repeat(10_000) }),
      arm: 'alone',
      workRoot: join(dir, 'rollback'),
      synthetic: true,
      maxAttempts: 1,
    });
    expect(rollback.attempts[0]?.toolFeedback).toContain('dossier de travail trop grand');
    expect(await readFile(join(dir, 'rollback/src/keel.mjs'), 'utf8')).toContain('return 0');
    expect(rollback.evidence?.status).not.toBe('success_verified');

    const unchanged = await runLabMission({
      mission,
      model: stub({ path: 'src/keel.mjs', content: mission.starterFiles[0]!.content }),
      arm: 'alone',
      workRoot: join(dir, 'same'),
      synthetic: true,
      maxAttempts: 2,
    });
    expect(unchanged.prompt).toContain('n’a pas changé');
    expect(unchanged.prompt).toContain('src/keel.mjs');
    expect(unchanged.prompt).toMatch(/expected|Expected/);
    expect(unchanged.evidence?.status).not.toBe('success_verified');
    expect(unchanged.attempts).toHaveLength(2);

    const quote = referenceMissions().find((item) => item.id === 'l3-quote-fee')!;
    const stripped = await runLabMission({
      mission: quote,
      model: stub({
        path: 'src/quote.mjs',
        content: 'export function quote(cents) {\n  return cents + fee(cents) + fee(cents);\n}\n',
      }),
      arm: 'alone',
      workRoot: join(dir, 'quote'),
      synthetic: true,
      maxAttempts: 1,
    });
    expect(stripped.evidence?.status).not.toBe('success_verified');
    const doubled = await runLabMission({
      mission: quote,
      model: stub({ path: 'src/quote.mjs', content: quote.starterFiles[1]!.content }),
      arm: 'alone',
      workRoot: join(dir, 'double'),
      synthetic: true,
      maxAttempts: 1,
    });
    expect(doubled.evidence?.status).not.toBe('success_verified');
  }, 120_000);

  it('renvoie au nouvel essai l’erreur, le chemin, la relecture, et confirme l’écriture', async () => {
    const mission = referenceMissions().find((item) => item.id === 'l1-keel-sign')!;
    const dir = await mkdtemp(join(tmpdir(), 'jarvis-lab-retry-'));
    let attempt = -1;
    const model: LabModel = {
      name: 'stub',
      digest: 'synthetic',
      async complete(input) {
        const fresh = input.messages.every((message) => message.role === 'user');
        if (fresh) attempt += 1;
        const round = input.messages.filter((message) => message.role === 'assistant').length;
        if (round > 0) return { text: '', toolCalls: [] };
        const bodies = [
          'export function keel(n) {\n  return 1;\n}\n',
          'export function keel(n) {\n  return -1;\n}\n',
          'export function keel(n) {\n  return 4;\n}\n',
        ];
        const content = bodies[attempt] ?? bodies[bodies.length - 1]!;
        return { text: '', toolCalls: [{ id: `w${attempt}`, name: 'write_file', arguments: { path: 'src/keel.mjs', content } }] };
      },
    };
    const retried = await runLabMission({
      mission,
      model,
      arm: 'alone',
      workRoot: join(dir, 'retry'),
      synthetic: true,
      maxAttempts: 3,
    });
    expect(retried.technicalSuccess).toBe(false);
    expect(retried.trainingAdmission).toBe('rejected');
    expect(retried.skillAdmission).toBe('none');
    expect(retried.prompt).toContain('src/keel.mjs');
    expect(retried.prompt).toContain('return -1');
    expect(retried.prompt).toContain('écriture confirmée');
    expect(retried.prompt).toMatch(/actual:\s*-1|actual: -1/);
    expect(retried.prompt).not.toContain('return 4');
    expect(retried.prompt).not.toContain('actual: 4');
    expect(retried.prompt).not.toContain('assert.equal');
    expect(retried.prompt).not.toContain('hidden/keel.test.mjs');
    expect(retried.attempts[2]?.filesBefore[0]?.content).toContain('return -1');
    expect(retried.attempts[1]?.filesAfter[0]?.content).toContain('return -1');
    expect(retried.files.find((file) => file.path === 'src/keel.mjs')?.content).toContain('return -1');
    expect(retried.files.find((file) => file.path === 'src/keel.mjs')?.content).not.toContain('return 4');
    expect(retried.attempts[2]?.toolFeedback).toMatch(/Régression/);

    const silent: LabModel = {
      name: 'stub',
      digest: 'synthetic',
      async complete() {
        return { text: 'je ne touche pas au fichier', toolCalls: [] };
      },
    };
    const untouched = await runLabMission({
      mission,
      model: silent,
      arm: 'alone',
      workRoot: join(dir, 'silent'),
      synthetic: true,
      maxAttempts: 2,
    });
    expect(untouched.prompt).toContain('src/keel.mjs');
    expect(untouched.prompt).toContain('return 0');
    expect(untouched.prompt).toContain('aucune écriture confirmée');
    expect(untouched.prompt).toMatch(/expected|Expected/);
    expect(untouched.prompt).not.toContain('écriture confirmée, le fichier relu a changé');
    expect(untouched.prompt).not.toContain('assert.equal');
    expect(untouched.technicalSuccess).toBe(false);

    const correct = 'export function keel(n) {\n  if (n > 0) return 1;\n  if (n < 0) return -1;\n  return 0;\n}\n';
    const passed = await runLabMission({
      mission,
      model: stub({ path: 'src/keel.mjs', content: correct }),
      arm: 'alone',
      workRoot: join(dir, 'pass'),
      synthetic: true,
      maxAttempts: 1,
    });
    expect(passed.technicalSuccess).toBe(true);
    expect(passed.evidence?.status).toBe('success_verified');
    expect(passed.status).toBe('verified');
    expect(passed.skillAdmission).toBe('none');
    expect(passed.skillAdmission).not.toBe('candidate');
    expect(passed.trainingAdmission).toBe('rejected');
    expect(passed.evidence?.staging.reason).toMatch(/un seul fichier/);
    expect(passed.evidence?.skill.reason).toMatch(/fichier d’avant/);

    const quote = referenceMissions().find((item) => item.id === 'l3-quote-fee')!;
    const fixedQuote = 'import { fee } from "./fee.mjs";\nexport function quote(cents) {\n  return cents + fee(cents);\n}\n';
    const quoted = await runLabMission({
      mission: quote,
      model: stub({ path: 'src/quote.mjs', content: fixedQuote }),
      arm: 'alone',
      workRoot: join(dir, 'quote-ok'),
      synthetic: true,
      maxAttempts: 1,
    });
    expect(quoted.technicalSuccess).toBe(true);
    expect(quoted.status).toBe('candidate');
    expect(quoted.trainingAdmission).toBe('candidate');
    expect(quoted.trainingAdmission).not.toBe('accepted');
    expect(quoted.skillAdmission).toBe('none');
    expect(quoted.evidence?.staging.reason).toMatch(/n’entre pas dans le jeu/);
  }, 120_000);

  it('une réparation ne retire pas un import encore nécessaire, sauf si le nom se résout', async () => {
    const quote = referenceMissions().find((item) => item.id === 'l3-quote-fee')!;
    const dir = await mkdtemp(join(tmpdir(), 'jarvis-lab-import-'));
    const dropping = 'export function quote(cents) {\n  return cents + fee(cents);\n}\n';
    const kept = await runLabMission({
      mission: quote,
      model: stub({ path: 'src/quote.mjs', content: dropping }),
      arm: 'alone',
      workRoot: join(dir, 'kept'),
      synthetic: true,
      maxAttempts: 2,
    });
    const quoteText = kept.files.find((file) => file.path === 'src/quote.mjs')?.content ?? '';
    expect(quoteText).toContain('import { fee } from "./fee.mjs"');
    expect(quoteText).toContain('fee(cents) + fee(cents)');
    expect(kept.technicalSuccess).toBe(false);
    expect(kept.skillAdmission).toBe('none');
    expect(kept.trainingAdmission).not.toBe('accepted');
    expect(kept.prompt).toContain('ne le résout pas');
    expect(kept.prompt).toContain('Contrôle échoué : un seul fee');
    expect(kept.prompt).toContain('actual: 220');
    expect(kept.prompt).not.toContain('assert.equal');
    expect(kept.prompt).not.toContain('hidden/quote.test.mjs');
    expect(kept.promptHasHidden).toBe(false);
    expect(kept.attempts.some((attempt) => attempt.testOutput.includes('fee is not defined'))).toBe(false);

    const localFee = 'function fee(cents) {\n  return 1;\n}\nexport function quote(cents) {\n  return cents + fee(cents);\n}\n';
    const resolved = await runLabMission({
      mission: quote,
      model: stub({ path: 'src/quote.mjs', content: localFee }),
      arm: 'alone',
      workRoot: join(dir, 'resolved'),
      synthetic: true,
      maxAttempts: 1,
    });
    const resolvedText = resolved.files.find((file) => file.path === 'src/quote.mjs')?.content ?? '';
    expect(resolvedText).not.toContain('import { fee }');
    expect(resolvedText).toContain('function fee');
    expect(resolved.technicalSuccess).toBe(false);

    const unused = 'export function quote(cents) {\n  return cents;\n}\n';
    const dropped = await runLabMission({
      mission: quote,
      model: stub({ path: 'src/quote.mjs', content: unused }),
      arm: 'alone',
      workRoot: join(dir, 'unused'),
      synthetic: true,
      maxAttempts: 1,
    });
    const droppedText = dropped.files.find((file) => file.path === 'src/quote.mjs')?.content ?? '';
    expect(droppedText).not.toContain('import { fee }');
    expect(droppedText).toContain('return cents');
    expect(dropped.technicalSuccess).toBe(false);
    expect(dropped.prompt).not.toContain('assert.equal');
  }, 120_000);

  it('dit qu’un saut de ligne seul n’est pas une correction', async () => {
    const mission = referenceMissions().find((item) => item.id === 'l1-span-clamp')!;
    const dir = await mkdtemp(join(tmpdir(), 'jarvis-lab-nl-'));
    const sameBody = 'export function span(value, low, high) {\n  return value;\n}';
    const result = await runLabMission({
      mission,
      model: stub({ path: 'src/span.mjs', content: sameBody }),
      arm: 'alone',
      workRoot: join(dir, 'nl'),
      synthetic: true,
      maxAttempts: 2,
    });
    expect(result.technicalSuccess).toBe(false);
    expect(result.prompt).toContain('Ce n’est pas une correction');
    expect(result.prompt).toContain('Contrôle échoué : sous le plancher');
    expect(result.prompt).toContain('actual: -4');
    expect(result.prompt).toContain('return value');
    expect(result.prompt).not.toContain('écriture confirmée, le fichier relu a changé');
    expect(result.prompt).not.toContain('assert.equal');
    expect(result.prompt).not.toContain('hidden/span.test.mjs');
    expect(result.promptHasHidden).toBe(false);
  }, 120_000);

  it('une régression garde les octets précédents et s’arrête', async () => {
    const mission = referenceMissions().find((item) => item.id === 'l1-keel-sign')!;
    const dir = await mkdtemp(join(tmpdir(), 'jarvis-lab-reg-'));
    let calls = 0;
    const worse: LabModel = {
      name: 'stub',
      digest: 'synthetic',
      async complete() {
        calls += 1;
        return {
          text: '',
          toolCalls: [
            {
              id: 'w',
              name: 'write_file',
              arguments: { path: 'src/keel.mjs', content: 'export function keel(n) {\n  return 4;\n}\n' },
            },
          ],
        };
      },
    };
    const result = await runLabMission({
      mission,
      model: worse,
      arm: 'alone',
      workRoot: join(dir, 'worse'),
      synthetic: true,
      maxAttempts: 2,
    });
    expect(calls).toBe(1);
    expect(result.attempts).toHaveLength(1);
    expect(result.files.find((file) => file.path === 'src/keel.mjs')?.content).toContain('return 0');
    expect(result.attempts[0]?.toolFeedback).toMatch(/3 échecs contre 2/);
    expect(result.technicalSuccess).toBe(false);
    expect(result.prompt).not.toContain('assert.equal');

    const crashed: LabModel = {
      name: 'stub',
      digest: 'synthetic',
      async complete() {
        return {
          text: '',
          toolCalls: [
            {
              id: 'w',
              name: 'write_file',
              arguments: { path: 'src/keel.mjs', content: 'export function keel(n) {\n  return ;\n}\n' },
            },
          ],
        };
      },
    };
    const syntax = await runLabMission({
      mission,
      model: crashed,
      arm: 'alone',
      workRoot: join(dir, 'syntax'),
      synthetic: true,
      maxAttempts: 2,
    });
    expect(syntax.attempts).toHaveLength(1);
    expect(syntax.files.find((file) => file.path === 'src/keel.mjs')?.content).toContain('return 0');
    expect(syntax.attempts[0]?.toolFeedback).toMatch(/Régression/);
    expect(syntax.attempts[0]?.testOutput).not.toContain('SyntaxError');
    expect(syntax.technicalSuccess).toBe(false);
  }, 120_000);

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
