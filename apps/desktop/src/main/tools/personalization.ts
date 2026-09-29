import { z } from 'zod';
import { defineTool } from '@jarvis/core';
import type { PersonalizationStore } from '../personalization.js';

const scopeSchema = z.enum(['assistant', 'user']);

function summary(profile: {
  assistant: Record<string, string>;
  user: Record<string, string>;
  rules: string[];
}): string {
  const assistant = Object.entries(profile.assistant).map(([k, v]) => `${k}=${v}`);
  const user = Object.entries(profile.user).map(([k, v]) => `${k}=${v}`);
  return (
    [
      assistant.length ? `Assistant : ${assistant.join(', ')}` : '',
      user.length ? `Utilisateur : ${user.join(', ')}` : '',
      profile.rules.length ? `Règles : ${profile.rules.join(' | ')}` : '',
    ]
      .filter(Boolean)
      .join('\n') || 'Aucune personnalisation enregistrée.'
  );
}

export function createPersonalizationTools(store: PersonalizationStore) {
  const getTool = defineTool({
    name: 'get_jarvis_personalization',
    description:
      'Lit la personnalisation persistante de Jarvis et les préférences de l’utilisateur.',
    risk: 'safe',
    schema: z.object({}),
    execute: async () => {
      const profile = await store.get();
      return { ok: true, content: summary(profile), data: profile };
    },
  });

  const setTool = defineTool({
    name: 'set_jarvis_personalization',
    description:
      'Enregistre durablement une préférence de l’utilisateur ou une caractéristique de la personnalité de Jarvis. À utiliser lorsque l’utilisateur demande explicitement de retenir, mémoriser ou adopter une préférence.',
    risk: 'confirm',
    category: 'apps',
    isDestructive: false,
    schema: z.object({
      scope: scopeSchema,
      key: z.string().min(1).max(80),
      value: z.string().min(1).max(1000),
    }),
    summarize: ({ scope, key, value }) =>
      `Enregistrer la personnalisation ${scope}.${key} = « ${value} ».`,
    execute: async ({ scope, key, value }) => {
      const profile = await store.set(scope, key, value);
      return {
        ok: true,
        content: `Personnalisation enregistrée : ${scope}.${key}.`,
        data: profile,
      };
    },
  });

  const ruleTool = defineTool({
    name: 'add_jarvis_personalization_rule',
    description:
      'Ajoute une règle comportementale persistante pour Jarvis. À utiliser uniquement lorsque l’utilisateur demande explicitement de la retenir pour les futures conversations.',
    risk: 'confirm',
    category: 'apps',
    isDestructive: false,
    schema: z.object({
      rule: z.string().min(1).max(1000),
    }),
    summarize: ({ rule }) => `Ajouter une règle permanente à Jarvis : « ${rule} ».`,
    execute: async ({ rule }) => {
      const profile = await store.addRule(rule);
      return {
        ok: true,
        content: 'Règle de personnalisation enregistrée.',
        data: profile,
      };
    },
  });

  const forgetTool = defineTool({
    name: 'forget_jarvis_personalization',
    description: 'Supprime une préférence persistante précise de Jarvis.',
    risk: 'confirm',
    category: 'apps',
    isDestructive: true,
    schema: z.object({
      scope: scopeSchema,
      key: z.string().min(1).max(80),
    }),
    summarize: ({ scope, key }) => `Supprimer la personnalisation ${scope}.${key}.`,
    execute: async ({ scope, key }) => {
      const profile = await store.forget(scope, key);
      return {
        ok: true,
        content: `Personnalisation supprimée : ${scope}.${key}.`,
        data: profile,
      };
    },
  });

  const resetTool = defineTool({
    name: 'reset_jarvis_personalization',
    description: 'Efface toute la personnalisation persistante de Jarvis.',
    risk: 'confirm',
    category: 'apps',
    isDestructive: true,
    schema: z.object({}),
    summarize: () => 'Effacer toute la personnalisation persistante de Jarvis.',
    execute: async () => {
      await store.reset();
      return {
        ok: true,
        content: 'Toute la personnalisation persistante de Jarvis a été effacée.',
      };
    },
  });

  return [getTool, setTool, ruleTool, forgetTool, resetTool];
}
