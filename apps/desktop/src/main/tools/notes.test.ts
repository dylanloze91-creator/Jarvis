import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { NotesBook, ToolManager, notesFilePath, type ToolContext } from '@jarvis/core';
import { describe, expect, it } from 'vitest';
import { createNotesTools } from './notes.js';

async function book() {
  const root = await mkdtemp(join(tmpdir(), 'jarvis-notes-tools-'));
  return new NotesBook(() => notesFilePath(root));
}

describe('outils notes', () => {
  it('le catalogue ne les montre que si les notes sont activées', async () => {
    const notes = await book();
    const off = new ToolManager().registerAll(createNotesTools(notes, () => false));
    expect(off.schemas().map((schema) => schema.name)).toEqual([]);
    const on = new ToolManager().registerAll(createNotesTools(notes, () => true));
    expect(on.schemas().map((schema) => schema.name)).toEqual([
      'note_ajouter',
      'notes_lister',
      'note_cocher',
      'note_effacer',
    ]);
  });

  it('effacer demande un clic, et une enceinte n’efface pas', async () => {
    const notes = await book();
    await notes.add('3 paquets de liteaux pour lundi');
    const manager = new ToolManager().registerAll(createNotesTools(notes, () => true));
    const call = { id: 'e1', name: 'note_effacer', arguments: { query: 'liteaux' } };
    let asked = 0;
    const refuse: ToolContext = {
      requestConfirmation: async () => {
        asked += 1;
        return false;
      },
    };
    const refused = await manager.execute(call, refuse);
    expect(asked).toBe(1);
    expect(refused.status).not.toBe('ok');
    expect(await notes.pendingLabels()).toHaveLength(1);
    const speaker: ToolContext = { fromSpeaker: true, requestConfirmation: async () => true };
    const blocked = await manager.execute(call, speaker);
    expect(blocked.content).toMatch(/PC ou le téléphone/);
    expect(await notes.pendingLabels()).toHaveLength(1);
    const allow: ToolContext = { requestConfirmation: async () => true };
    const done = await manager.execute(call, allow);
    expect(done.status).toBe('ok');
    expect(await notes.pendingLabels()).toEqual([]);
  });
});
