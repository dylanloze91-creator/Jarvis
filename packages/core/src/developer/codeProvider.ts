import { z } from 'zod';
import { isLocalMemoryEndpoint } from '../knowledge/localUrl.js';
import type { ProviderRegistry } from '../providers/registry.js';
import type { ChatUsage, LLMProvider, OllamaCodeOptions } from '../providers/types.js';
import { createMessage } from '../types.js';
import {
  CodeModelFormatError,
  codeAnalysisSchema,
  codeEditSchema,
  debugHypothesisSchema,
  devPlanSchema,
  extractJson,
  repoUnderstandingSchema,
  reviewReportSchema,
  type CodeAnalysis,
  type CodeEdit,
  type DebugHypothesis,
  type DevPlan,
  type RepoUnderstanding,
  type ReviewReport,
  type SourceFile,
} from './codeSchemas.js';
import { runToolLoop, type ToolLoopInput, type ToolLoopResult } from './toolLoop.js';

/**
 * Fournisseur IA de code, interchangeable, posé sur le registre existant
 * (aucun nouveau client réseau). Phase 2 : Ollama local seulement ; une API
 * externe est absente (décision 6) et refusée ici.
 */
export interface CodeAIProvider {
  readonly id: 'ollama';
  readonly model: string;
  readonly baseUrl: string;
  readonly locality: 'local';
  chat(): LLMProvider;
  runTools(input: Omit<ToolLoopInput, 'provider'>): Promise<ToolLoopResult>;
  complete(input: {
    system: string;
    prompt: string;
    maxTokens?: number;
    signal?: AbortSignal;
  }): Promise<{ text: string; usage?: ChatUsage }>;
  completeJson<T>(input: {
    system: string;
    prompt: string;
    schema: z.ZodType<T>;
    signal?: AbortSignal;
  }): Promise<T>;
  analyzeCode(input: { files: SourceFile[]; question: string }): Promise<CodeAnalysis>;
  understandRepository(input: { summary: string }): Promise<RepoUnderstanding>;
  generatePlan(input: { request: string; context: string; rules: string[] }): Promise<DevPlan>;
  generateCode(input: { plan: DevPlan; files: SourceFile[] }): Promise<CodeEdit[]>;
  modifyCode(input: { file: SourceFile; instruction: string }): Promise<CodeEdit[]>;
  reviewCode(input: { diff: string; rules: string[] }): Promise<ReviewReport>;
  debug(input: { failures: string; files: SourceFile[] }): Promise<DebugHypothesis[]>;
  explainError(input: { output: string }): Promise<string>;
}

export interface CodeAIProviderConfig {
  model: string;
  provider?: string;
  baseUrl?: string;
  options?: OllamaCodeOptions;
}

export class CodeProviderRefusedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CodeProviderRefusedError';
  }
}

export const DEFAULT_OLLAMA_URL = 'http://127.0.0.1:11434';

const SYSTEM = [
  'Tu es le modèle de code de Jarvis Développeur, un assistant qui travaille sur le code de l’application Jarvis (TypeScript, Electron, React).',
  'Réponds en français. N’invente aucun fichier ni aucune fonction : appuie-toi seulement sur ce qu’on te montre.',
].join(' ');

function filesBlock(files: SourceFile[]): string {
  return files.map((file) => `--- ${file.path}\n${file.content}`).join('\n\n');
}

export function createCodeAIProvider(
  registry: ProviderRegistry,
  config: CodeAIProviderConfig,
): CodeAIProvider {
  const providerId = config.provider ?? 'ollama';
  if (providerId !== 'ollama') {
    throw new CodeProviderRefusedError(
      `Fournisseur « ${providerId} » refusé : le modèle de code reste local (Ollama). Aucune API externe (décision 6).`,
    );
  }
  const baseUrl = (config.baseUrl?.trim() || DEFAULT_OLLAMA_URL).replace(/\/+$/, '');
  if (!isLocalMemoryEndpoint(baseUrl)) {
    throw new CodeProviderRefusedError(
      `Adresse « ${baseUrl} » refusée : seul un serveur Ollama sur ce PC ou le réseau local est accepté.`,
    );
  }
  const llm = registry.create({
    provider: 'ollama',
    model: config.model,
    baseUrl,
    ollama: config.options ?? {},
  });

  const complete: CodeAIProvider['complete'] = async ({ system, prompt, maxTokens, signal }) => {
    let text = '';
    let usage: ChatUsage | undefined;
    for await (const event of llm.streamChat({
      system,
      messages: [createMessage('user', prompt)],
      temperature: 0,
      maxTokens,
      signal,
    })) {
      if (event.type === 'text') text += event.delta;
      else if (event.type === 'done') usage = event.usage;
      else if (event.type === 'error') throw new Error(event.message);
    }
    return { text, usage };
  };

  const completeJson: CodeAIProvider['completeJson'] = async ({
    system,
    prompt,
    schema,
    signal,
  }) => {
    const { text } = await complete({
      system: `${system}\nRéponds uniquement par du JSON valide, sans texte autour.`,
      prompt,
      signal,
    });
    const parsed = schema.safeParse(extractJson(text));
    if (!parsed.success)
      throw new CodeModelFormatError(
        `Réponse hors format : ${parsed.error.issues[0]?.message ?? 'invalide'}.`,
        text,
      );
    return parsed.data;
  };

  return {
    id: 'ollama',
    model: config.model,
    baseUrl,
    locality: 'local',
    chat: () => llm,
    runTools: (input) => runToolLoop({ ...input, provider: llm }),
    complete,
    completeJson,
    analyzeCode: ({ files, question }) =>
      completeJson({
        system: SYSTEM,
        prompt: `Question : ${question}\nFichiers :\n${filesBlock(files)}\nFormat : {"answer": "...", "files": ["chemins cités"]}`,
        schema: codeAnalysisSchema,
      }),
    understandRepository: ({ summary }) =>
      completeJson({
        system: SYSTEM,
        prompt: `Résume l’architecture à partir de ce relevé :\n${summary}\nFormat : {"summary": "...", "layers": ["..."], "risks": ["..."]}`,
        schema: repoUnderstandingSchema,
      }),
    generatePlan: ({ request, context, rules }) =>
      completeJson({
        system: SYSTEM,
        prompt: `Demande : ${request}\nRègles :\n- ${rules.join('\n- ')}\nContexte :\n${context}\nFormat : {"summary": "...", "files": ["..."], "steps": ["..."], "tests": ["..."], "touchesCore": false}`,
        schema: devPlanSchema,
      }),
    generateCode: ({ plan, files }) =>
      completeJson({
        system: SYSTEM,
        prompt: `Plan : ${JSON.stringify(plan)}\nFichiers :\n${filesBlock(files)}\nFormat : [{"path": "...", "search": "texte exact", "replace": "..."}]`,
        schema: z.array(codeEditSchema),
      }),
    modifyCode: ({ file, instruction }) =>
      completeJson({
        system: SYSTEM,
        prompt: `Consigne : ${instruction}\n${filesBlock([file])}\nFormat : [{"path": "${file.path}", "search": "texte exact", "replace": "..."}]`,
        schema: z.array(codeEditSchema),
      }),
    reviewCode: ({ diff, rules }) =>
      completeJson({
        system: SYSTEM,
        prompt: `Relis ce diff. Signale tout retrait de confirmation, secret en clair, dépendance ajoutée, chemin du cœur.\nRègles :\n- ${rules.join('\n- ')}\nDiff :\n${diff}\nFormat : {"verdict": "ok" | "à revoir" | "refusé", "findings": [{"severity": "info" | "avertissement" | "bloquant", "file": "...", "message": "..."}]}`,
        schema: reviewReportSchema,
      }),
    debug: ({ failures, files }) =>
      completeJson({
        system: SYSTEM,
        prompt: `Échecs :\n${failures}\nFichiers :\n${filesBlock(files)}\nFormat : [{"cause": "...", "file": "...", "fix": "..."}]`,
        schema: z.array(debugHypothesisSchema),
      }),
    explainError: async ({ output }) =>
      (
        await complete({
          system: SYSTEM,
          prompt: `Explique en deux phrases simples cette erreur :\n${output.slice(0, 6_000)}`,
          maxTokens: 200,
        })
      ).text.trim(),
  };
}
