import { z } from 'zod';
import { defineTool, formatNote, type NotesBook } from '@jarvis/core';

/** Outils absents du catalogue tant que `notes.enabled` n'est pas vrai. */
export function createNotesTools(book: NotesBook, enabled: () => boolean) {
  const gate = { isAvailable: enabled, unavailableMessage: 'Les notes ne sont pas activées.' };
  return [
    defineTool({
      name: 'note_ajouter',
      description: "Ajoute une note ou un élément de liste. Quantité, unité et jour sont relevés s'ils sont dits.",
      risk: 'safe',
      schema: z.object({ text: z.string().min(1).max(500) }),
      ...gate,
      execute: async ({ text }) => {
        const note = await book.add(text);
        return { ok: true, content: `C'est noté : ${formatNote(note)}.` };
      },
    }),
    defineTool({
      name: 'notes_lister',
      description: 'Liste les notes qui ne sont pas encore cochées.',
      risk: 'safe',
      schema: z.object({}),
      ...gate,
      execute: async () => {
        const pending = (await book.list()).filter((note) => !note.done);
        if (pending.length === 0) return { ok: true, content: 'Aucune note.' };
        return { ok: true, content: pending.map((note) => formatNote(note)).join(' ; ') };
      },
    }),
    defineTool({
      name: 'note_cocher',
      description: 'Coche une note déjà écrite, retrouvée par un mot du texte.',
      risk: 'safe',
      schema: z.object({ query: z.string().min(1).max(200) }),
      ...gate,
      execute: async ({ query }) => {
        const note = await book.check(query);
        return note
          ? { ok: true, content: `C'est coché : ${formatNote(note)}.` }
          : { ok: false, content: `Je n'ai pas trouvé « ${query} ».` };
      },
    }),
    defineTool({
      name: 'note_effacer',
      description: "Efface une note. Confirmation obligatoire. Refusé depuis une enceinte.",
      risk: 'confirm',
      category: 'files',
      forceConfirm: true,
      isDestructive: true,
      schema: z.object({ query: z.string().min(1).max(200) }),
      summarize: ({ query }) => `Effacer la note qui contient « ${query} ».`,
      describeCommand: ({ query }) => query,
      ...gate,
      execute: async ({ query }, context) => {
        if (context.fromSpeaker) return { ok: false, content: "L'effacement se fait sur le PC ou le téléphone." };
        const note = await book.erase(query);
        return note
          ? { ok: true, content: `C'est effacé : ${formatNote(note)}.` }
          : { ok: false, content: `Je n'ai pas trouvé « ${query} ».` };
      },
    }),
  ];
}
