import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { EDIT_MARKER, FIX_MARKER, PLAN_MARKER } from '@jarvis/core';
import type { ChatBody, Reply } from '../models/fakeOllama.testkit.js';

/**
 * Dépôt d'essai qui passe la vérification de copie de travail : vrais
 * scripts npm (typecheck, test, lint) en Node pur, sans dépendance.
 * Un échec de test existe déjà avant toute tâche.
 */
export function createFixtureRepo(path: string): void {
  const write = (rel: string, text: string) => {
    mkdirSync(join(path, rel, '..'), { recursive: true });
    writeFileSync(join(path, rel), text);
  };
  write(
    'package.json',
    `${JSON.stringify(
      {
        name: 'jarvis',
        version: '0.0.0',
        private: true,
        scripts: {
          typecheck: 'node scripts/check.mjs',
          test: 'node scripts/test.mjs',
          lint: 'node scripts/check.mjs',
        },
      },
      null,
      2,
    )}\n`,
  );
  write(
    'package-lock.json',
    `${JSON.stringify({ name: 'jarvis', version: '0.0.0', lockfileVersion: 3, requires: true, packages: { '': { name: 'jarvis', version: '0.0.0' } } }, null, 2)}\n`,
  );
  write('apps/desktop/package.json', '{ "name": "@jarvis/desktop", "version": "0.4.25" }\n');
  write('.gitignore', 'node_modules/\n');
  write('src/index.ts', 'export {};\n');
  write(
    'scripts/check.mjs',
    `import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
const walk = (d) => readdirSync(d).flatMap((f) => { const p = join(d, f); return statSync(p).isDirectory() ? walk(p) : [p]; });
const bad = walk('src').filter((f) => readFileSync(f, 'utf8').includes('TYPE_ERROR'));
for (const f of bad) console.log(f.split('\\\\').join('/') + "(1,1): error TS2322: Type 'string' is not assignable to type 'number'.");
process.exit(bad.length ? 2 : 0);
`,
  );
  write(
    'scripts/test.mjs',
    `import { existsSync } from 'node:fs';
console.log(' FAIL  src/old.test.ts > ancien > échoue déjà');
const ok = existsSync('src/version.ts');
console.log('      Tests  1 failed | ' + (ok ? 2 : 1) + ' passed (' + (ok ? 3 : 2) + ')');
process.exit(1);
`,
  );
  const git = (...args: string[]) => execFileSync('git', args, { cwd: path, encoding: 'utf8' });
  git('init', '-q', '-b', 'main');
  git('remote', 'add', 'origin', 'https://github.com/dylanloze91-creator/Jarvis.git');
  git('add', '-A');
  git('-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-qm', 'départ');
}

export interface ScriptOptions {
  /** Appelé au deuxième tour de la modification : le test y simule un tour de chat. */
  onEditRound?: (round: number) => void;
  /** Le modèle ne corrige jamais : la tâche doit s'arrêter après trois essais. */
  neverFix?: boolean;
}

/** Modèle de code scripté : lit, planifie, crée un fichier avec une erreur de type, puis la corrige. */
export function taskScript(options: ScriptOptions = {}) {
  return (body: ChatBody): Reply => {
    const system = body.messages.find((m) => m.role === 'system')?.content ?? '';
    const done = body.messages.filter((m) => m.role === 'tool').length;
    if (system.includes(PLAN_MARKER)) {
      if (done === 0) return { call: { name: 'dev_search_files', arguments: { query: 'src' } } };
      const plan = {
        resume: 'Ajouter la constante VERSION et l’exporter.',
        criteres: ['aucun nouvel échec'],
        fichiers: [
          { chemin: 'src/version.ts', action: 'creer', pourquoi: 'constante' },
          { chemin: 'src/index.ts', action: 'modifier', pourquoi: 'export' },
          { chemin: 'package.json', action: 'modifier', pourquoi: 'description' },
        ],
        tests: ['test'],
      };
      return { content: `Plan :\n\`\`\`json\n${JSON.stringify(plan)}\n\`\`\`` };
    }
    if (system.includes(EDIT_MARKER)) {
      options.onEditRound?.(done + 1);
      const steps = [
        { name: 'dev_read_file', arguments: { path: 'src/index.ts' } },
        {
          name: 'dev_create_file',
          arguments: {
            path: 'src/version.ts',
            content:
              'export const VERSION = "1.0.0"; // TYPE_ERROR\nexport const ping = () => fetch("https://example.com");\n',
          },
        },
        {
          name: 'dev_edit_file',
          arguments: {
            path: 'src/index.ts',
            search: 'export {};',
            replace: "export { VERSION } from './version.js';",
          },
        },
        {
          name: 'dev_edit_file',
          arguments: {
            path: 'package.json',
            search: '"private": true',
            replace: '"private": true,\n  "description": "essai"',
          },
        },
      ];
      const next = steps[done];
      return next ? { call: next } : { content: 'Modifications faites.' };
    }
    if (system.includes(FIX_MARKER)) {
      if (options.neverFix) return { content: 'Je ne vois pas le problème.' };
      const steps = [
        { name: 'dev_read_file', arguments: { path: 'src/version.ts' } },
        {
          name: 'dev_edit_file',
          arguments: { path: 'src/version.ts', search: ' // TYPE_ERROR', replace: '' },
        },
      ];
      const next = steps[done];
      return next ? { call: next } : { content: 'Corrigé.' };
    }
    return { content: 'Je ne sais pas.' };
  };
}
