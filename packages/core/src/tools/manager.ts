import { z } from 'zod';
import type { ToolCall, ToolCallOutcome, ToolDecision } from '../types.js';
import type { ToolSchema } from '../providers/types.js';
import { defaultCategoryPolicies, requiresConfirmation } from './permissions.js';
import type {
  RegisteredTool,
  ToolContext,
  ToolDefinition,
  ToolResult,
  RiskLevel,
} from './types.js';

/**
 * Convertit une définition typée en outil homogène : le schéma Zod devient à la
 * fois le contrat exposé au modèle et le validateur des arguments reçus.
 */
export function defineTool<S extends z.ZodType>(definition: ToolDefinition<S>): RegisteredTool {
  const isDestructive = normalizeDestructive(definition.isDestructive);

  return {
    name: definition.name,
    description: definition.description,
    risk: definition.risk,
    category: definition.category,
    forceConfirm: definition.forceConfirm ?? false,
    isDestructive,
    jsonSchema: toJsonSchema(definition.schema),
    summarize: (input) =>
      definition.summarize?.(input as z.infer<S>) ?? describeFallback(definition.name, input),
    describeCommand: (input) => definition.describeCommand?.(input as z.infer<S>),
    run: async (input, context) => {
      const parsed = definition.schema.safeParse(input ?? {});
      if (!parsed.success) {
        return {
          ok: false,
          content: `Arguments invalides pour « ${definition.name} » : ${formatIssues(parsed.error)}`,
        };
      }
      return definition.execute(parsed.data as z.infer<S>, context);
    },
  };
}

function normalizeDestructive<S extends z.ZodType>(
  isDestructive: ToolDefinition<S>['isDestructive'],
): (input: unknown) => boolean {
  if (typeof isDestructive === 'function') {
    return (input) => isDestructive(input as z.infer<S>);
  }
  const flag = Boolean(isDestructive);
  return () => flag;
}

export interface ToolExecutionEvents {
  onStart?: (call: ToolCall, tool: RegisteredTool) => void;
  onFinish?: (outcome: ToolCallOutcome) => void;
}

/**
 * Seul point de passage entre l'IA et le système. Le modèle ne reçoit que les
 * outils enregistrés et actifs, et ses arguments sont revalidés avant toute
 * exécution : Utilisateur → Assistant IA → Tool Manager → Outils → Windows.
 *
 * Chaque exécution — qu'elle réussisse, échoue ou soit refusée — produit un
 * `ToolCallOutcome` complet (arguments, décision, durée) afin d'alimenter le
 * journal d'audit sans que l'appelant ait à reconstituer ce contexte.
 */
export class ToolManager {
  private readonly tools = new Map<string, RegisteredTool>();

  register(tool: RegisteredTool): this {
    if (this.tools.has(tool.name)) {
      throw new Error(`Outil déjà enregistré : ${tool.name}`);
    }
    this.tools.set(tool.name, tool);
    return this;
  }

  registerAll(tools: RegisteredTool[]): this {
    for (const tool of tools) this.register(tool);
    return this;
  }

  get(name: string): RegisteredTool | undefined {
    return this.tools.get(name);
  }

  list(): RegisteredTool[] {
    return [...this.tools.values()];
  }

  riskOf(name: string): RiskLevel | undefined {
    return this.tools.get(name)?.risk;
  }

  /** Catalogue transmis au modèle : les outils `denied` en sont exclus. */
  schemas(): ToolSchema[] {
    return this.list()
      .filter((tool) => tool.risk !== 'denied')
      .map((tool) => ({
        name: tool.name,
        description: tool.description,
        parameters: tool.jsonSchema,
      }));
  }

  async execute(
    call: ToolCall,
    context: ToolContext,
    events: ToolExecutionEvents = {},
  ): Promise<ToolCallOutcome> {
    const startedAt = Date.now();
    const tool = this.tools.get(call.name);

    if (!tool) {
      return this.finish(events, {
        callId: call.id,
        name: call.name,
        status: 'error',
        content: `Outil inconnu : « ${call.name} ». Aucune action n'a été effectuée.`,
        arguments: call.arguments,
        decision: 'blocked',
        durationMs: Date.now() - startedAt,
      });
    }

    if (tool.risk === 'denied') {
      return this.finish(events, {
        callId: call.id,
        name: call.name,
        status: 'denied',
        content: `L'outil « ${call.name} » est désactivé par la politique de sécurité.`,
        arguments: call.arguments,
        decision: 'blocked',
        durationMs: Date.now() - startedAt,
        category: tool.category,
      });
    }

    let decision: ToolDecision = 'auto';

    if (tool.risk === 'confirm') {
      const policies = context.policies ?? defaultCategoryPolicies;
      if (requiresConfirmation(tool, call.arguments, policies)) {
        const approved = await context.requestConfirmation({
          callId: call.id,
          toolName: tool.name,
          title: tool.name,
          details: tool.summarize(call.arguments),
          command: tool.describeCommand(call.arguments),
          forced: tool.forceConfirm,
        });
        decision = approved ? 'approved' : 'refused';
        if (!approved) {
          return this.finish(events, {
            callId: call.id,
            name: call.name,
            status: 'denied',
            content: "L'utilisateur a refusé cette action. Ne la retente pas sans son accord.",
            arguments: call.arguments,
            decision,
            durationMs: Date.now() - startedAt,
            category: tool.category,
          });
        }
      }
    }

    events.onStart?.(call, tool);

    let result: ToolResult;
    try {
      result = await tool.run(call.arguments, context);
    } catch (error) {
      result = { ok: false, content: `Échec de l'outil : ${describeError(error)}` };
    }

    return this.finish(events, {
      callId: call.id,
      name: call.name,
      status: result.ok ? 'ok' : 'error',
      content: result.content,
      arguments: call.arguments,
      decision,
      durationMs: Date.now() - startedAt,
      category: tool.category,
    });
  }

  private finish(events: ToolExecutionEvents, outcome: ToolCallOutcome): ToolCallOutcome {
    events.onFinish?.(outcome);
    return outcome;
  }
}

function toJsonSchema(schema: z.ZodType): Record<string, unknown> {
  const generated = z.toJSONSchema(schema, { target: 'draft-7', io: 'input' }) as Record<
    string,
    unknown
  >;
  delete generated.$schema;
  return { type: 'object', properties: {}, ...generated };
}

function formatIssues(error: z.ZodError): string {
  return error.issues
    .map((issue) => `${issue.path.join('.') || '(racine)'} — ${issue.message}`)
    .join(' ; ');
}

function describeFallback(name: string, input: unknown): string {
  const args = JSON.stringify(input ?? {}, null, 2);
  return `Exécuter « ${name} » avec :\n${args}`;
}

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
