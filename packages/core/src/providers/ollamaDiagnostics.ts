import { createMessage } from '../types.js';
import { ollamaDescriptor, OllamaProvider } from './ollama.js';
import {
  checkOllamaStatus,
  normalizeBaseUrl,
  type FetchLike,
  type OllamaModelInfo,
} from './ollamaStatus.js';
import type { ToolSchema } from './types.js';

export type OllamaDiagnosticStepId = 'server' | 'model' | 'toolCalling';

export interface OllamaDiagnosticStep {
  id: OllamaDiagnosticStepId;
  label: string;
  ok: boolean;
  /** `null` si l'étape n'a pas pu être tentée (étape précédente en échec). */
  skipped: boolean;
  message: string;
}

export interface OllamaDiagnosticResult {
  ok: boolean;
  baseUrl: string;
  model: string;
  steps: OllamaDiagnosticStep[];
}

export interface TestOllamaConnectionOptions {
  fetchImpl?: FetchLike;
  /** Délai maximum pour l'étape d'appel d'outil (le modèle peut être lent à charger). */
  toolCallingTimeoutMs?: number;
}

/**
 * Nom volontairement préfixé pour ne jamais entrer en collision avec un vrai
 * outil de Jarvis, même si l'utilisateur en ajoute un jour un qui ressemble.
 */
const DIAGNOSTIC_TOOL_NAME = 'jarvis_diagnostic_ping';
const DIAGNOSTIC_ECHO_VALUE = 'jarvis-ok';

const DIAGNOSTIC_TOOL: ToolSchema = {
  name: DIAGNOSTIC_TOOL_NAME,
  description:
    "Outil de diagnostic interne à Jarvis. Tu DOIS l'appeler immédiatement, sans écrire aucun texte.",
  parameters: {
    type: 'object',
    properties: {
      echo: {
        type: 'string',
        description: `Doit valoir exactement "${DIAGNOSTIC_ECHO_VALUE}".`,
      },
    },
    required: ['echo'],
  },
};

const DIAGNOSTIC_SYSTEM_PROMPT =
  "Tu es un système de test automatisé. Ta seule tâche est d'appeler des fonctions, jamais de répondre par du texte.";
const DIAGNOSTIC_USER_PROMPT = `Appelle immédiatement la fonction ${DIAGNOSTIC_TOOL_NAME} avec l'argument echo défini exactement à "${DIAGNOSTIC_ECHO_VALUE}". N'écris aucun texte, appelle uniquement la fonction.`;

/**
 * Le test de connexion des réglages : trois étapes qui vérifient chacune une
 * cause distincte d'échec, plutôt qu'un simple ping. La troisième — l'appel
 * d'outil réel — est la plus importante : c'est celle qui distingue un
 * modèle qui *annonce* la capacité « tools » d'un modèle qui s'en sert
 * vraiment (voir `ollamaModels.ts`, le cas documenté de qwen2.5:1.5b).
 */
export async function testOllamaConnection(
  config: { baseUrl?: string; model: string },
  options: TestOllamaConnectionOptions = {},
): Promise<OllamaDiagnosticResult> {
  const baseUrl = normalizeBaseUrl(config.baseUrl ?? ollamaDescriptor.defaultBaseUrl!);
  const steps: OllamaDiagnosticStep[] = [];

  const status = await checkOllamaStatus(baseUrl, { fetchImpl: options.fetchImpl });
  steps.push({
    id: 'server',
    label: 'Serveur Ollama',
    ok: status.status === 'detected',
    skipped: false,
    message: status.message,
  });

  if (status.status !== 'detected') {
    steps.push(skipped('model', 'Modèle installé'));
    steps.push(skipped('toolCalling', "Appel d'outils"));
    return { ok: false, baseUrl, model: config.model, steps };
  }

  const modelInfo = findModel(status.models, config.model);
  steps.push({
    id: 'model',
    label: 'Modèle installé',
    ok: Boolean(modelInfo),
    skipped: false,
    message: describeModelStep(config.model, modelInfo),
  });

  if (!modelInfo) {
    steps.push(skipped('toolCalling', "Appel d'outils"));
    return { ok: false, baseUrl, model: config.model, steps };
  }

  const toolCallingStep = await testToolCalling(baseUrl, config.model, options);
  steps.push(toolCallingStep);

  return { ok: steps.every((step) => step.ok), baseUrl, model: config.model, steps };
}

function findModel(models: OllamaModelInfo[], name: string): OllamaModelInfo | undefined {
  return models.find((model) => model.name === name || model.name === `${name}:latest`);
}

function describeModelStep(name: string, model: OllamaModelInfo | undefined): string {
  if (!model) {
    return `« ${name} » n'est pas installé sur ce serveur. Lance « ollama pull ${name} », puis relance ce test.`;
  }
  const toolsNote = model.supportsTools
    ? 'capacité « tools » annoncée par Ollama'
    : 'AUCUNE capacité « tools » annoncée par Ollama pour ce modèle';
  return `« ${name} » est installé (${model.parameterSize}, quantization ${model.quantizationLevel}, ${toolsNote}).`;
}

async function testToolCalling(
  baseUrl: string,
  model: string,
  options: TestOllamaConnectionOptions,
): Promise<OllamaDiagnosticStep> {
  const provider = new OllamaProvider({ provider: 'ollama', model, baseUrl });
  const controller = new AbortController();
  const timeoutMs = options.toolCallingTimeoutMs ?? 45_000;
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const events = provider.streamChat({
      system: DIAGNOSTIC_SYSTEM_PROMPT,
      messages: [createMessage('user', DIAGNOSTIC_USER_PROMPT)],
      tools: [DIAGNOSTIC_TOOL],
      temperature: 0.1,
      signal: controller.signal,
    });

    for await (const event of events) {
      if (event.type === 'tool_call' && event.call.name === DIAGNOSTIC_TOOL_NAME) {
        return {
          id: 'toolCalling',
          label: "Appel d'outils",
          ok: true,
          skipped: false,
          message: describeToolCallSuccess(event.call.arguments),
        };
      }
      if (event.type === 'error') {
        return {
          id: 'toolCalling',
          label: "Appel d'outils",
          ok: false,
          skipped: false,
          message: event.message,
        };
      }
    }

    return {
      id: 'toolCalling',
      label: "Appel d'outils",
      ok: false,
      skipped: false,
      message:
        'Le modèle a répondu sans jamais appeler la fonction demandée, malgré une consigne explicite. ' +
        "C'est le signe qu'il annonce peut-être la capacité « tools » sans s'en servir de façon fiable : " +
        'choisis un autre modèle pour les actions qui dépendent des outils (voir les recommandations).',
    };
  } catch (error) {
    if (controller.signal.aborted) {
      return {
        id: 'toolCalling',
        label: "Appel d'outils",
        ok: false,
        skipped: false,
        message: `Le modèle n'a pas répondu dans le délai de ${Math.round(timeoutMs / 1000)} s. Sur CPU ou avec un modèle volumineux, c'est parfois normal — réessaie, ou choisis un modèle plus petit.`,
      };
    }
    return {
      id: 'toolCalling',
      label: "Appel d'outils",
      ok: false,
      skipped: false,
      message: error instanceof Error ? error.message : String(error),
    };
  } finally {
    clearTimeout(timer);
  }
}

function describeToolCallSuccess(args: Record<string, unknown>): string {
  if (args.echo === DIAGNOSTIC_ECHO_VALUE) {
    return "L'appel d'outil fonctionne : le modèle a appelé la fonction demandée avec l'argument exact attendu.";
  }
  return (
    "L'appel d'outil fonctionne : le modèle a appelé la fonction demandée avec un appel structuré valide " +
    `(argument reçu : ${JSON.stringify(args.echo)} au lieu de la valeur exacte demandée — sans conséquence pour la fiabilité globale).`
  );
}

function skipped(id: OllamaDiagnosticStepId, label: string): OllamaDiagnosticStep {
  return { id, label, ok: false, skipped: true, message: 'Non testé — étape précédente en échec.' };
}
