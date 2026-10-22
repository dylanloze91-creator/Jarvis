import { spawnSync } from 'node:child_process';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { evidenceFromTask, exportStagedEvidence, judgeMissionEvidence, recheckStoredEvidence, type EvidenceCheck, type MissionEvidence } from './evidence.js';

function check(over: Partial<EvidenceCheck> & Pick<EvidenceCheck, 'name'>): EvidenceCheck {
  return {
    kind: 'test',
    required: true,
    ran: true,
    passed: true,
    exitCode: 0,
    testsRan: 4,
    codeVersion: 'same',
    ...over,
  };
}

function programming(over: Parameters<typeof judgeMissionEvidence>[0] = {}): MissionEvidence {
  const diff = 'src/a.ts\nsrc/b.ts\n';
  return judgeMissionEvidence({
    id: 'm1',
    at: 1,
    goal: 'corriger le total et le libellé',
    passCriteria: ['les tests du projet passent'],
    kind: 'programming',
    declaredSuccess: true,
    filesCreated: [],
    filesChanged: ['src/a.ts', 'src/b.ts'],
    filesDeleted: [],
    diff,
    deliveredPaths: ['src/a.ts', 'src/b.ts'],
    checks: [check({ name: 'test', codeVersion: undefined })],
    commands: [{ command: 'npm test', exitCode: 0, excerpt: '4 tests réussis' }],
    finalResult: '4 tests au vert sur cette version.',
    ...over,
  });
}

describe('preuves de mission', () => {
  it('vérifie un succès seulement quand les tests ont tourné', () => {
    const evidence = programming();
    expect(evidence.status).toBe('success_verified');
    expect(evidence.declaredSuccess).toBe(true);
    expect(evidence.staging.validationStatus).toBe('candidate');
    expect(exportStagedEvidence([evidence]).manifest.kept).toBe(0);
  });

  it('refuse un test requis rouge', () => {
    const evidence = programming({
      checks: [check({ name: 'test', passed: false, exitCode: 1, reason: '1 test en échec' })],
      commands: [{ command: 'npm test', exitCode: 1 }],
    });
    expect(evidence.status).toBe('failed');
    expect(evidence.staging.reason).toMatch(/analyse/);
  });

  it('laisse non vérifié un succès déclaré sans exécution', () => {
    const evidence = programming({
      checks: [check({ name: 'test', ran: false, passed: null, exitCode: null, testsRan: null, reason: 'tests non lancés' })],
      commands: [{ command: 'npm test', exitCode: null }],
    });
    expect(evidence.status).toBe('unverified');
    expect(JSON.stringify(evidence.commands)).not.toMatch(/exécutée|a tourné/);
  });

  it('marque une commande en échec', () => {
    const evidence = judgeMissionEvidence({
      id: 'cmd',
      at: 2,
      goal: 'publier le paquet',
      passCriteria: ['la commande se termine à zéro'],
      kind: 'programming',
      declaredSuccess: false,
      filesChanged: ['src/a.ts', 'src/b.ts'],
      diff: 'src/a.ts\nsrc/b.ts\n',
      deliveredPaths: ['src/a.ts', 'src/b.ts'],
      checks: [check({ name: 'publish', kind: 'command', passed: false, exitCode: 1, testsRan: null, reason: 'code 1' })],
      commands: [{ command: 'npm publish', exitCode: 1 }],
    });
    expect(evidence.status).toBe('failed');
  });

  it('accepte une mission non code dont les critères ont été observés', () => {
    const evidence = judgeMissionEvidence({
      id: 'question',
      at: 3,
      goal: 'expliquer le module de citations',
      passCriteria: ['au moins une citation relue dans le dépôt'],
      kind: 'non-code',
      declaredSuccess: true,
      checks: [
        {
          name: 'citations relues',
          kind: 'criterion',
          required: true,
          ran: true,
          passed: true,
          exitCode: null,
          testsRan: 2,
          reason: '2 citations retrouvées dans les fichiers',
        },
      ],
      finalResult: '2 citations retrouvées.',
    });
    expect(evidence.status).toBe('success_verified');
    expect(evidence.checks.some((item) => item.kind === 'test')).toBe(false);
  });

  it('annule, détecte un doublon, et n’exporte pas une candidate', () => {
    const cancelled = judgeMissionEvidence({
      id: 'stop',
      at: 4,
      goal: 'ajouter un écran',
      passCriteria: ['les tests passent'],
      kind: 'programming',
      cancelled: true,
      declaredSuccess: true,
    });
    expect(cancelled.status).toBe('cancelled');
    const first = programming();
    const second = programming({ id: 'm2', seenFingerprints: [first.fingerprint] });
    expect(second.staging.validationStatus).toBe('rejected');
    expect(second.staging.reason).toMatch(/doublon/);
    const exported = exportStagedEvidence([first, second, cancelled]);
    expect(exported.manifest.kept).toBe(0);
    expect(exported.manifest.readyForFinetune).toBe(false);
  });

  it('ne met pas de secret dans la preuve', () => {
    const evidence = programming({
      goal: 'corriger le total avec la clé ghp_abcdefghijklmnopqrstuvwxyz',
      finalResult: 'écrire à ada@example.com puis relire les tests',
    });
    const text = JSON.stringify(evidence);
    expect(text).not.toContain('ghp_');
    expect(text).not.toContain('ada@example.com');
  });

  it('relit la preuve après la fin du processus qui l’a écrite', async () => {
    const evidence = programming();
    const dir = await mkdtemp(join(tmpdir(), 'jarvis-evidence-'));
    const writer = spawnSync(
      process.execPath,
      [
        '-e',
        `const fs=require('node:fs'); fs.mkdirSync(process.argv[1],{recursive:true}); fs.writeFileSync(process.argv[1]+'/evidence.json', process.argv[2]);`,
        dir,
        JSON.stringify(evidence),
      ],
      { encoding: 'utf8' },
    );
    expect(writer.status).toBe(0);
    const reader = spawnSync(
      process.execPath,
      [
        '-e',
        `const fs=require('node:fs'); const data=JSON.parse(fs.readFileSync(process.argv[1]+'/evidence.json','utf8')); process.stdout.write(data.status);`,
        dir,
      ],
      { encoding: 'utf8' },
    );
    expect(reader.stdout).toBe('success_verified');
    const onDisk = JSON.parse(await readFile(join(dir, 'evidence.json'), 'utf8')) as MissionEvidence;
    expect(onDisk.id).toBe(evidence.id);
  });

  it('garde deux groupes proches dans le même jeu quand ils sont acceptés', () => {
    const left = programming({ id: 'left' });
    const right = programming({ id: 'right', goal: 'autre problème de lecture de fichier et de nom' });
    for (const row of [left, right]) {
      row.staging.validationStatus = 'accepted';
    }
    const third = programming({ id: 'third', goal: 'documenter le module de livraison du paquet' });
    third.staging.validationStatus = 'accepted';
    third.staging.source = {
      ...left.staging.source!,
      id: 'third',
      group: 'autre-groupe',
      task: third.goal,
      context: 'documentation du livrable dans deux fichiers',
    };
    right.staging.source = { ...right.staging.source!, id: 'right', group: left.fingerprint };
    const exported = exportStagedEvidence([left, right, third]);
    const a = exported.manifest.rows.find((row) => row.id === 'left');
    const b = exported.manifest.rows.find((row) => row.id === 'right');
    expect(a?.split).toBe(b?.split);
    expect(exported.manifest.readyForFinetune).toBe(false);
  });

  it('construit la preuve depuis une tâche réelle, et refuse des tests jamais lancés', () => {
    const diff = 'src/game.ts\nsrc/score.ts\n';
    const green = evidenceFromTask({
      id: 'tache',
      at: 5,
      goal: 'le score augmente',
      criteria: ['npm test'],
      declaredVerdict: 'success',
      files: [
        { path: 'src/game.ts', status: 'modified' },
        { path: 'src/score.ts', status: 'modified' },
      ],
      diffText: diff,
      plannedChecks: ['test'],
      runs: [
        {
          label: 'Après modification',
          ok: true,
          results: [{ suite: 'test', command: 'npm test', exitCode: 0, summary: '4 tests réussis', failures: [] }],
        },
      ],
    });
    expect(green.status).toBe('success_verified');
    expect(green.checksNotRun.some((line) => line.includes('types'))).toBe(true);
    const missing = evidenceFromTask({
      id: 'vide',
      at: 6,
      goal: 'le score augmente',
      criteria: ['npm test'],
      declaredVerdict: 'success',
      files: [
        { path: 'src/game.ts', status: 'modified' },
        { path: 'src/score.ts', status: 'modified' },
      ],
      diffText: diff,
      plannedChecks: ['test'],
      runs: [],
    });
    expect(missing.status).toBe('unverified');
  });

  it('relit le dossier et ignore un succès écrit à la main', () => {
    const kept = programming();
    expect(recheckStoredEvidence(kept).status).toBe('success_verified');
    const declared = evidenceFromTask({
      id: 'declare',
      at: 7,
      goal: 'le score augmente encore',
      criteria: ['npm test'],
      declaredVerdict: 'success',
      files: [
        { path: 'src/game.ts', status: 'modified' },
        { path: 'src/score.ts', status: 'modified' },
      ],
      diffText: 'src/game.ts\nsrc/score.ts\n',
      plannedChecks: ['test'],
      runs: [],
    });
    const tampered = { ...declared, status: 'success_verified' as const };
    expect(recheckStoredEvidence(tampered).status).toBe('unverified');
    const counted = evidenceFromTask({
      id: 'dotnet',
      at: 8,
      goal: 'compter les mots du fichier',
      criteria: ['dotnet test'],
      declaredVerdict: 'success',
      files: [
        { path: 'src/Word.cs', status: 'modified' },
        { path: 'tests/WordTests.cs', status: 'modified' },
      ],
      diffText: 'src/Word.cs\ntests/WordTests.cs\n',
      plannedChecks: ['test'],
      runs: [
        {
          label: 'Après modification',
          ok: true,
          results: [
            {
              suite: 'test',
              command: 'dotnet test',
              exitCode: 0,
              summary: 'réussi',
              failures: [],
              excerpt: 'Passed!  - Failed: 0, Passed: 3',
            },
          ],
        },
      ],
    });
    expect(counted.status).toBe('success_verified');
    expect(counted.checks.find((item) => item.name === 'test')?.testsRan).toBe(3);
  });
});
