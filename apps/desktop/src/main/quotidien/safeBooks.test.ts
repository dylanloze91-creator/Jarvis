import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { NotesBook, RoutineBook, notesFilePath, routinesFilePath } from '@jarvis/core/quotidien/fichiers';
import { resetStateFileIncidents, safeTextStateIO, stateFileIncidents } from '../safeFile.js';

/**
 * Notes et routines avec l'écriture sûre de la 5.0.78 (comme `speakers.json`, rempli de zéros
 * après les coupures du 13 novembre) : un fichier abîmé ne doit jamais effacer la liste.
 */
describe('notes et routines en écriture sûre', () => {
  let root: string;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'jarvis-carnets-'));
    resetStateFileIncidents();
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it('garde la version précédente en .bak et la reprend si notes.json est rempli de zéros', async () => {
    const book = new NotesBook(() => notesFilePath(root), safeTextStateIO);
    await book.add('acheter du lait');
    await book.add('appeler le garage');
    const bak = JSON.parse(await readFile(`${notesFilePath(root)}.bak`, 'utf8')) as { items: unknown[] };
    expect(bak.items).toHaveLength(1);

    await writeFile(notesFilePath(root), Buffer.alloc(200));
    const after = new NotesBook(() => notesFilePath(root), safeTextStateIO);
    expect((await after.list()).map((note) => note.text)).toEqual(['acheter du lait']);
    expect(stateFileIncidents()).toEqual([
      expect.objectContaining({ file: 'notes.json', reason: 'zeros', restored: true }),
    ]);
    // Le fichier abîmé est mis de côté, jamais effacé.
    expect((await readdir(root)).some((name) => name.startsWith('notes.json.illisible'))).toBe(true);
  });

  it('un notes.json abîmé sans .bak est mis de côté, et la note suivante ne le perd pas', async () => {
    await writeFile(notesFilePath(root), '{ pas du json');
    const book = new NotesBook(() => notesFilePath(root), safeTextStateIO);
    expect(await book.list()).toEqual([]);
    await book.add('acheter du pain');
    const aside = (await readdir(root)).find((name) => name.startsWith('notes.json.illisible'));
    expect(aside).toBeDefined();
    expect(await readFile(join(root, aside as string), 'utf8')).toBe('{ pas du json');
  });

  it('les routines gardent aussi leur .bak', async () => {
    const book = new RoutineBook(() => routinesFilePath(root), safeTextStateIO);
    await book.save({ name: 'bonne nuit', steps: [] });
    await book.save({ name: 'réveil', steps: [] });
    await writeFile(routinesFilePath(root), Buffer.alloc(64));
    const after = new RoutineBook(() => routinesFilePath(root), safeTextStateIO);
    expect(await after.names()).toEqual(['bonne nuit']);
  });
});
