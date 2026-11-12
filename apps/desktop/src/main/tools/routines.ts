import { z } from 'zod';
import { defineTool, runRoutineSteps, type RoutineBook, type RoutineStep, type ToolManager } from '@jarvis/core';

export interface RoutineToolDeps {
  book: RoutineBook;
  isAvailable: () => boolean;
  tools: () => ToolManager;
  /** Étape qui n'est pas un outil (le briefing). */
  extra?: (step: RoutineStep) => Promise<{ ok: boolean; content: string } | null>;
}

/** Présent dans le catalogue seulement si les routines sont activées et qu'il en existe une. */
export function createRoutineTools(deps: RoutineToolDeps) {
  return [
    defineTool({
      name: 'lancer_routine',
      description: "Lance une routine déjà enregistrée, étape par étape, avec les confirmations habituelles de chaque outil.",
      risk: 'safe',
      schema: z.object({ name: z.string().min(1).max(80) }),
      isAvailable: deps.isAvailable,
      unavailableMessage: 'Aucune routine enregistrée.',
      execute: async ({ name }, context) => {
        const routine = await deps.book.find(name);
        if (!routine) return { ok: false, content: `Je n'ai pas de routine ${name}.` };
        const detail = await runRoutineSteps(routine.steps, async (step) => {
          const special = deps.extra ? await deps.extra(step) : null;
          if (special) return special;
          if (step.tool === 'briefing') return { ok: false, content: "Le briefing n'est pas activé." };
          const outcome = await deps.tools().execute(
            { id: `routine-${step.tool}`, name: step.tool, arguments: step.args },
            context,
          );
          return { ok: outcome.status === 'ok', content: outcome.content };
        });
        return { ok: true, content: `Routine ${routine.name} : ${detail}.` };
      },
    }),
  ];
}
