import type { z } from 'zod';
import type { CodeAIProvider } from '../codeProvider.js';
import { CodeModelFormatError, extractJson } from '../codeSchemas.js';
import type { ChatUsage } from '../../providers/types.js';
import type { ToolManager } from '../../tools/manager.js';
import { addUsage, toolView, type ToolLoopCall } from '../toolLoop.js';
import type { SpecialistRole } from './roles.js';

export interface SpecialistCall<T> {
  role: SpecialistRole;
  system: string;
  prompt: string;
  schema: z.ZodType<T>;
  /** Outils montrés au modèle ; absent = réponse directe, sans outil. */
  tools?: Pick<ToolManager, 'schemas' | 'execute'>;
  maxRounds?: number;
  signal?: AbortSignal;
  beforeRound?: (round: number) => Promise<void>;
}

export interface SpecialistRun<T> {
  role: SpecialistRole;
  model: string;
  output: T;
  rounds: number;
  calls: ToolLoopCall[];
  usage: ChatUsage;
  retried: boolean;
}

export class SpecialistError extends Error {
  constructor(
    readonly role: SpecialistRole,
    message: string,
  ) {
    super(message);
    this.name = 'SpecialistError';
  }
}

const EMPTY_USAGE: ChatUsage = {
  promptTokens: 0,
  promptMs: 0,
  outputTokens: 0,
  outputMs: 0,
  loadMs: 0,
  totalMs: 0,
};

function parse<T>(schema: z.ZodType<T>, text: string): T {
  const parsed = schema.safeParse(extractJson(text));
  if (!parsed.success)
    throw new CodeModelFormatError(
      `Réponse hors format : ${parsed.error.issues.map((i) => `${i.path.join('.') || 'racine'} ${i.message}`).join(' ; ')}`,
      text,
    );
  return parsed.data;
}

async function turn(
  code: CodeAIProvider,
  call: SpecialistCall<unknown>,
  system: string,
  prompt: string,
  withTools: boolean,
): Promise<{ text: string; rounds: number; calls: ToolLoopCall[]; usage: ChatUsage }> {
  if (call.tools) {
    const loop = await code.runTools({
      tools: withTools ? call.tools : toolView(call.tools, []),
      system,
      prompt,
      maxRounds: withTools ? (call.maxRounds ?? 10) : 1,
      signal: call.signal,
      beforeRound: call.beforeRound,
    });
    if (loop.stoppedBy === 'error')
      throw new SpecialistError(call.role, `Le modèle n’a pas répondu : ${loop.error}`);
    return { text: loop.finalText, rounds: loop.rounds, calls: loop.calls, usage: loop.usage };
  }
  await call.beforeRound?.(1);
  const { text, usage } = await code.complete({ system, prompt, signal: call.signal });
  return { text, rounds: 1, calls: [], usage: usage ?? EMPTY_USAGE };
}

/**
 * Un spécialiste : consigne, outils autorisés, sortie JSON validée par son
 * schéma, une relance au plus si le format est faux. Le rôle ne dépend
 * d'aucun modèle : c'est le fournisseur passé qui porte le modèle.
 */
export async function runSpecialist<T>(
  code: CodeAIProvider,
  call: SpecialistCall<T>,
): Promise<SpecialistRun<T>> {
  const system = `${call.system}\nTermine par un seul bloc JSON, sans texte après.`;
  const first = await turn(code, call as SpecialistCall<unknown>, system, call.prompt, true);
  try {
    return {
      role: call.role,
      model: code.model,
      output: parse(call.schema, first.text),
      rounds: first.rounds,
      calls: first.calls,
      usage: first.usage,
      retried: false,
    };
  } catch (error) {
    if (!(error instanceof CodeModelFormatError)) throw error;
    const retry = await turn(
      code,
      call as SpecialistCall<unknown>,
      system,
      `${call.prompt}\n\nTa réponse précédente n’était pas au bon format (${error.message}). Réponds seulement par le bloc JSON demandé.`,
      false,
    );
    try {
      return {
        role: call.role,
        model: code.model,
        output: parse(call.schema, retry.text),
        rounds: first.rounds + retry.rounds,
        calls: [...first.calls, ...retry.calls],
        usage: addUsage(first.usage, retry.usage),
        retried: true,
      };
    } catch (again) {
      if (again instanceof CodeModelFormatError)
        throw new SpecialistError(
          call.role,
          `Réponse hors format après une relance : ${again.message}`,
        );
      throw again;
    }
  }
}
