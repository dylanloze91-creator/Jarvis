import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { ToolManager } from '@jarvis/core';
import { applyExactEdit, createFileTools } from '../tools/fileTools.js';
import { TASK_MODEL_TOOLS, TASK_TOOLS, createTaskToolManager } from '../tools/taskTools.js';
import { ChatActivity } from './chatActivity.js';
import { previewWrite } from './preview.js';
import type { Sandbox } from './sandbox.js';
import { resolveForWrite } from './writeJail.js';

const base = mkdtempSync(join(tmpdir(), 'jarvis-write-'));
const root = join(base, 'tache');
const outside = join(base, 'dehors');
mkdirSync(join(root, 'src'), { recursive: true });
mkdirSync(outside);
writeFileSync(join(root, 'src', 'a.ts'), 'const a = 1;\nconst b = 2;\nconst a2 = 1;\n');
writeFileSync(join(root, 'src', 'crlf.ts'), 'ligne 1\r\nligne 2\r\n');
symlinkSync(outside, join(root, 'lien'));
afterAll(() => rmSync(base, { recursive: true, force: true }));

const fake = { path: root, git: async () => ({ code: 0 }) } as unknown as Sandbox;
const manager = new ToolManager().registerAll(createFileTools({ sandbox: () => fake }));
const call = (name: string, args: Record<string, unknown>) =>
  manager.execute({ id: name, name, arguments: args }, { requestConfirmation: async () => true });

describe('écriture enfermée dans la copie isolée', () => {
  it.each([
    ['../dehors/x.ts', /relatif/],
    ['C:\\Windows\\x.ts', /relatif/],
    ['/etc/passwd', /relatif/],
    ['.git/config', /git/],
    ['node_modules/x/index.js', /dépendances/],
    ['.env', /protégé/],
    ['src/con.ts', /refusé/],
    ['src/a.ts:flux', /refusé/],
    ['src/a.ts.', /refusé/],
    ['src /a.ts', /refusé/],
    ['lien/x.ts', /sort de la copie/],
  ])('refuse %s', async (path, message) => {
    await expect(resolveForWrite(root, path)).rejects.toThrow(message);
  });

  it('accepte un nouveau fichier dans un nouveau dossier', async () => {
    expect((await resolveForWrite(root, 'src/neuf/b.ts')).relative).toBe('src/neuf/b.ts');
  });

  it('créer : nouveau fichier seulement, relu', async () => {
    const created = await call('dev_create_file', {
      path: 'src/neuf/b.ts',
      content: 'export const b = 1;\n',
    });
    expect(created.status).toBe('ok');
    expect(readFileSync(join(root, 'src', 'neuf', 'b.ts'), 'utf8')).toBe('export const b = 1;\n');
    expect((await call('dev_create_file', { path: 'src/a.ts', content: 'x' })).content).toMatch(
      /existe déjà/,
    );
    expect((await call('dev_create_file', { path: 'lien/x.ts', content: 'x' })).status).toBe(
      'error',
    );
  });

  it('modifier : extrait exact et unique ; sinon un message qui aide le modèle', async () => {
    expect(
      (await call('dev_edit_file', { path: 'src/a.ts', search: 'const z', replace: 'x' })).content,
    ).toMatch(/introuvable/);
    expect(
      (await call('dev_edit_file', { path: 'src/a.ts', search: '= 1;', replace: '= 3;' })).content,
    ).toMatch(/présent 2 fois/);
    const ok = await call('dev_edit_file', {
      path: 'src/a.ts',
      search: 'const b = 2;',
      replace: 'const b = 3;',
    });
    expect(ok.status).toBe('ok');
    expect(readFileSync(join(root, 'src', 'a.ts'), 'utf8')).toBe(
      'const a = 1;\nconst b = 3;\nconst a2 = 1;\n',
    );
  });

  it('respecte les fins de ligne CRLF', async () => {
    await call('dev_edit_file', {
      path: 'src/crlf.ts',
      search: 'ligne 1\nligne 2',
      replace: 'un\ndeux',
    });
    expect(readFileSync(join(root, 'src', 'crlf.ts'), 'utf8')).toBe('un\r\ndeux\r\n');
    expect(applyExactEdit('a\nb', '', 'x')).toEqual({ ok: false, reason: 'extrait vide' });
  });

  it('supprimer : un fichier à la fois, toujours confirmé', async () => {
    const tool = manager.list().find((t) => t.name === 'dev_delete_file')!;
    expect(tool.forceConfirm).toBe(true);
    expect((await call('dev_delete_file', { path: 'src' })).content).toMatch(/dossier/);
    const refused = await manager.execute(
      { id: 'd', name: 'dev_delete_file', arguments: { path: 'src/neuf/b.ts' } },
      { requestConfirmation: async () => false },
    );
    expect(refused.status).toBe('denied');
    expect((await call('dev_delete_file', { path: 'src/neuf/b.ts' })).status).toBe('ok');
  });

  it('aperçu exact pour la carte de confirmation', async () => {
    const [edit] = await previewWrite(root, 'dev_edit_file', {
      path: 'src/a.ts',
      search: 'const b = 3;',
      replace: 'const b = 4;\nconst c = 5;',
    });
    expect(edit!.hunks[0]!.lines.map((l) => `${l.kind}:${l.text}`)).toEqual([
      'context:const a = 1;',
      'del:const b = 3;',
      'add:const b = 4;',
      'add:const c = 5;',
      'context:const a2 = 1;',
    ]);
    const [created] = await previewWrite(root, 'dev_create_file', {
      path: 'src/z.ts',
      content: 'a\nb\n',
    });
    expect(created).toMatchObject({ status: 'added', additions: 2 });
  });
});

describe('gestionnaire d’outils d’une tâche (jamais passé au chat)', () => {
  it('catalogue et niveaux : supprimer, revenir en arrière, jeter et télécharger toujours confirmés', () => {
    const tasks = createTaskToolManager({
      run: async () => {
        throw new Error('pas de commande ici');
      },
      logsDir: () => base,
      sandbox: () => null,
      setSandbox: () => undefined,
      repoRoot: () => null,
      worktreeRoot: () => null,
      node: async () => null,
      freeBytes: async () => null,
      listSandboxes: async () => [],
    });
    expect(tasks.list().map((t) => [t.name, t.risk, t.forceConfirm])).toEqual(
      TASK_TOOLS.map((name) => [
        name,
        name.startsWith('dev_read') || name.startsWith('dev_search') ? 'safe' : 'confirm',
        ['dev_delete_file', 'dev_rollback', 'dev_discard_sandbox', 'dev_install_sandbox'].includes(
          name,
        ),
      ]),
    );
    expect(TASK_MODEL_TOOLS).not.toContain('dev_rollback');
    expect(TASK_MODEL_TOOLS).not.toContain('dev_run_tests');
  });
});

describe('décision 5 : signal des tours de chat', () => {
  it('attend la fin du tour puis la fenêtre de suite', async () => {
    let now = 1_000;
    const chat = new ChatActivity(() => now);
    expect(chat.busy).toBe(false);
    chat.begin();
    expect(chat.busy).toBe(true);
    let resumed = false;
    const waiting = chat.whenIdle(0).then(() => {
      resumed = true;
    });
    await new Promise((r) => setTimeout(r, 10));
    expect(resumed).toBe(false);
    now = 2_000;
    chat.end();
    await waiting;
    expect(resumed).toBe(true);
    expect(chat.wantsPriority(500)).toBe(true);
    now = 3_000;
    expect(chat.wantsPriority(500)).toBe(false);
  });

  it('l’annulation interrompt l’attente', async () => {
    const chat = new ChatActivity();
    chat.begin();
    const controller = new AbortController();
    const waiting = chat.whenIdle(0, controller.signal);
    controller.abort();
    await expect(waiting).rejects.toThrow('Annulé.');
  });
});
