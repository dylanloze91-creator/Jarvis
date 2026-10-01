import { z } from 'zod';
import { debugLog } from '../security/debugLog.js';
import { redactSecrets, redactValue } from '../security/redact.js';
import type { ToolCall, ToolCallOutcome, ToolDecision } from '../types.js';
import type { ToolSchema } from '../providers/types.js';
import { defaultCategoryPolicies, requiresConfirmation } from './permissions.js';
import { classifyThrownError, outcomeFromResult, presentUserContent } from './outcome.js';
import type {
  RegisteredTool,
  ToolContext,
  ToolDefinition,
  ToolOutcomeKind,
  ToolResult,
  RiskLevel,
} from './types.js';

/**
 * Convertit une définition typée en outil homogène : le schéma Zod devient à la
 * fois le contrat exposé au modèle et le validateur des arguments reçus.
 */
export function defineTool<S extends z.ZodType>(definition: ToolDefinition<S>): RegisteredTool {
  // La confirmation et la politique voient les mêmes valeurs que `execute` :
  // sans ça, un argument omis par le modèle arrivait sans son défaut
  // (« Capturer l'écran n°NaN »).
  const withDefaults = (input: unknown): unknown => {
    const parsed = definition.schema.safeParse(input ?? {});
    return parsed.success ? parsed.data : input;
  };
  const isDestructive = normalizeDestructive(definition.isDestructive);
  const availability = definition.isAvailable
    ? {
        isAvailable: definition.isAvailable,
        unavailableMessage: () => resolveUnavailableMessage(definition.name, definition.unavailableMessage),
      }
    : {};

  return {
    ...availability,
    name: definition.name,
    description: definition.description,
    risk: definition.risk,
    category: definition.category,
    forceConfirm: definition.forceConfirm ?? false,
    isDestructive: (input) => isDestructive(withDefaults(input)),
    jsonSchema: toJsonSchema(definition.schema),
    summarize: (input) =>
      definition.summarize?.(withDefaults(input) as z.infer<S>) ??
      describeFallback(definition.name, input),
    describeCommand: (input) => definition.describeCommand?.(withDefaults(input) as z.infer<S>),
    run: async (input, context) => {
      const parsed = definition.schema.safeParse(input ?? {});
      if (!parsed.success) {
        return {
          ok: false,
          outcome: 'definitive' as const,
          content: `Arguments invalides pour « ${definition.name} » : ${formatIssues(parsed.error)}`,
          technicalDetail: redactSecrets(parsed.error.message),
        };
      }
      return definition.execute(parsed.data as z.infer<S>, context);
    },
  };
}

function resolveUnavailableMessage(
  name: string,
  message: string | (() => string) | undefined,
): string {
  const text = typeof message === 'function' ? message() : message;
  return text?.trim() || `L'outil « ${name} » n'est pas disponible pour le moment. Aucune action n'a été effectuée.`;
}

function isToolAvailable(tool: RegisteredTool): boolean {
  if (!tool.isAvailable) return true;
  try {
    return tool.isAvailable();
  } catch {
    return false;
  }
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

  /** Catalogue transmis au modèle : les outils `denied` et indisponibles en sont exclus. */
  schemas(): ToolSchema[] {
    return this.list()
      .filter((tool) => tool.risk !== 'denied' && isToolAvailable(tool))
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
        arguments: redactArguments(call.arguments),
        decision: 'blocked',
        durationMs: Date.now() - startedAt,
        outcome: 'definitive',
      });
    }

    if (tool.risk === 'denied') {
      return this.finish(events, {
        callId: call.id,
        name: call.name,
        status: 'denied',
        content: `L'outil « ${call.name} » est désactivé par la politique de sécurité.`,
        arguments: redactArguments(call.arguments),
        decision: 'blocked',
        durationMs: Date.now() - startedAt,
        category: tool.category,
        outcome: 'definitive',
      });
    }

    if (!isToolAvailable(tool)) {
      return this.finish(events, {
        callId: call.id,
        name: call.name,
        status: 'error',
        content: tool.unavailableMessage?.() ?? resolveUnavailableMessage(call.name, undefined),
        arguments: redactArguments(call.arguments),
        decision: 'blocked',
        durationMs: Date.now() - startedAt,
        category: tool.category,
        outcome: 'missing_dependency',
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
            arguments: redactArguments(call.arguments),
            decision,
            durationMs: Date.now() - startedAt,
            category: tool.category,
            outcome: 'cancelled',
          });
        }
      }
    }

    events.onStart?.(call, tool);

    let result: ToolResult;
    try {
      if (context.signal?.aborted) {
        result = {
          ok: false,
          outcome: 'cancelled',
          content: "L'opération a été annulée.",
          technicalDetail: 'AbortSignal déjà annulé',
        };
      } else {
        result = await tool.run(call.arguments, context);
      }
    } catch (error) {
      const classified = classifyThrownError(error);
      result = {
        ok: false,
        outcome: classified.outcome,
        content: classified.userMessage,
        technicalDetail: classified.technicalDetail,
      };
    }

    const outcomeKind: ToolOutcomeKind = outcomeFromResult(result);
    const content = presentUserContent({ ...result, outcome: outcomeKind });
    const technicalDetail = result.technicalDetail ? redactSecrets(result.technicalDetail) : undefined;
    debugLog(context.debug === true, 'tool', `${call.name} ${outcomeKind}`, {
      technicalDetail,
      arguments: call.arguments,
    });

    return this.finish(events, {
      callId: call.id,
      name: call.name,
      status: result.ok ? 'ok' : 'error',
      content,
      arguments: redactArguments(call.arguments),
      decision,
      durationMs: Date.now() - startedAt,
      category: tool.category,
      outcome: outcomeKind,
      technicalDetail,
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

function redactArguments(value: Record<string, unknown>): Record<string, unknown> {
  return redactValue(value) as Record<string, unknown>;
}
