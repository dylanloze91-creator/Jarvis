import { describe, expect, it } from 'vitest';
import { createMessage } from '@jarvis/core';
import { toItems } from './useChat';

describe('conversation rouverte depuis l’historique', () => {
  it('affiche « refusé » pour une action refusée, pas « terminé »', () => {
    const items = toItems([
      createMessage('user', 'Supprime /tmp/a.txt'),
      createMessage('tool', "L'utilisateur a refusé cette action. Ne la retente pas sans son accord.", {
        toolName: 'delete_file',
        toolStatus: 'denied',
      }),
      createMessage('tool', 'Chemin introuvable : /tmp/b.txt', {
        toolName: 'delete_file',
        toolStatus: 'error',
      }),
    ]);
    expect(items.filter((item) => item.kind === 'tool').map((item) => item.status)).toEqual([
      'denied',
      'error',
    ]);
  });

  it('reconnaît un refus dans un historique enregistré avant le statut', () => {
    const items = toItems([
      createMessage('tool', "L'utilisateur a refusé cette action. Ne la retente pas sans son accord.", {
        toolName: 'delete_file',
      }),
      createMessage('tool', 'Dossier créé : C:\\Users\\dex\\Documents\\A', { toolName: 'create_folder' }),
    ]);
    expect(items.map((item) => item.kind === 'tool' && item.status)).toEqual(['denied', 'ok']);
  });
});
