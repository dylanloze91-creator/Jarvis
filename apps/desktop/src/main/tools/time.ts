import { z } from 'zod';
import { defineTool } from '@jarvis/core';

/** Heure du PC. Réservé au profil modeste : le catalogue complet de 0.4.25 ne l’enregistre pas. */
export const getCurrentTimeTool = defineTool({
  name: 'get_current_time',
  description:
    "Donne la date et l’heure actuelles de l’ordinateur. À utiliser dès que l’utilisateur demande l’heure, la date ou le jour.",
  risk: 'safe',
  schema: z.object({}),
  execute: async () => {
    const now = new Date();
    const formatted = new Intl.DateTimeFormat('fr-FR', {
      dateStyle: 'full',
      timeStyle: 'medium',
    }).format(now);
    return { ok: true, content: `Il est ${formatted}.` };
  },
});
