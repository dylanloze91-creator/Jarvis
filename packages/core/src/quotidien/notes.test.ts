import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseSettings } from '../settings.js';
import { NotesBook, expressNoteReply, noteIntent, notesFilePath, parseNoteBody } from './notes.js';

describe('notes et liste', () => {
  it('parseSettings({}) ne gagne pas la clé notes', () => {
    expect(parseSettings({})).not.toHaveProperty('notes');
  });

  it('relève quantité, unité et jour (synthetique-test)', () => {
    expect(parseNoteBody('3 paquets de liteaux pour lundi')).toEqual({
      text: 'liteaux',
      quantity: 3,
      unit: 'paquets',
      day: 'lundi',
    });
    expect(parseNoteBody('appeler le plombier')).toMatchObject({
      text: 'appeler le plombier',
      quantity: null,
      unit: null,
      day: null,
    });
  });

  it('phrases express : ajout, liste, cocher ; une phrase plus longue n’est pas prise', () => {
    expect(noteIntent("Jarvis, note : 3 paquets de liteaux pour lundi")).toEqual({
      kind: 'add',
      body: '3 paquets de liteaux pour lundi',
    });
    expect(noteIntent('rajoute à ma liste du ruban')).toEqual({ kind: 'add', body: 'du ruban' });
    expect(noteIntent("qu'est-ce que j'ai noté ?")).toEqual({ kind: 'list' });
    expect(noteIntent("c'est bon pour les liteaux")).toEqual({ kind: 'check', query: 'les liteaux' });
    expect(noteIntent("Le film d'hier, note : 3 paquets")).toBeNull();
  });

  it('téléphone ajoute, enceinte lit et coche, enceinte n’efface pas', async () => {
    const root = await mkdtemp(join(tmpdir(), 'jarvis-notes-'));
    const book = new NotesBook(() => notesFilePath(root));
    const added = await expressNoteReply(book, noteIntent('note : 3 paquets de liteaux pour lundi')!, 'telephone');
    expect(added).toBe("C'est noté : 3 paquets de liteaux, pour lundi.");
    const listed = await expressNoteReply(book, noteIntent("qu'est-ce que j'ai noté ?")!, 'enceinte');
    expect(listed).toContain('liteaux');
    const erased = await expressNoteReply(book, { kind: 'erase', query: 'liteaux' }, 'enceinte');
    expect(erased).toMatch(/PC ou le téléphone/);
    expect(await book.pendingLabels()).toHaveLength(1);
    const checked = await expressNoteReply(book, noteIntent("c'est bon pour les liteaux")!, 'enceinte');
    expect(checked).toMatch(/^C'est coché/);
    expect(await book.pendingLabels()).toEqual([]);
    const phoneErase = await expressNoteReply(book, { kind: 'erase', query: 'liteaux' }, 'telephone');
    expect(phoneErase).toBeNull();
    const raw = await readFile(notesFilePath(root), 'utf8');
    expect(raw).not.toContain('.tmp');
  });
});
