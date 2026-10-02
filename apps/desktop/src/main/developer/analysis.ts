import {
  buildArchitectureReport,
  type ArchitectureFacts,
  type CodeLocation,
  type ToolCallOutcome,
} from '@jarvis/core';
import type { DevStepStatus } from '../../shared/developerIpc.js';

export const ANALYSIS_STEPS = [
  { id: 'status', label: 'État de la copie (git status)' },
  { id: 'files', label: 'Fichiers suivis par git' },
  { id: 'lines', label: 'Taille du code' },
  { id: 'packages', label: 'Paquets npm' },
  { id: 'tools', label: 'Outils du chat' },
  { id: 'core', label: 'Agent, confirmations, réglages, IPC' },
  { id: 'report', label: 'Rapport' },
] as const;

export interface AnalysisDeps {
  /** Appel d'un outil du gestionnaire développeur (journalisé). */
  call(name: string, args?: Record<string, unknown>): Promise<ToolCallOutcome>;
  step(id: string, status: DevStepStatus, detail?: string): void;
  signal: AbortSignal;
  now(): Date;
}

interface Match {
  file: string;
  line: number;
  text: string;
}

class AnalysisError extends Error {}

/** Lecture seule, par les outils du gestionnaire développeur : chaque lecture est vérifiée et journalisée. */
export async function analyzeArchitecture(deps: AnalysisDeps): Promise<string> {
  const run = async <T>(
    id: string,
    work: () => Promise<{ value: T; detail: string }>,
  ): Promise<T> => {
    if (deps.signal.aborted) throw new DOMException('Analyse annulée.', 'AbortError');
    deps.step(id, 'running');
    try {
      const { value, detail } = await work();
      deps.step(id, 'done', detail);
      return value;
    } catch (error) {
      deps.step(id, 'failed', error instanceof Error ? error.message : String(error));
      throw error;
    }
  };
  const data = async <T>(name: string, args: Record<string, unknown>): Promise<T> => {
    const outcome = await deps.call(name, args);
    if (outcome.status !== 'ok') throw new AnalysisError(outcome.content);
    return outcome.data as T;
  };
  // Expressions ancrées en début de ligne : les chaînes de recherche citées dans le code (ce fichier compris) ne comptent pas.
  const find = async (pattern: string): Promise<Match[]> =>
    (
      await data<{ matches: Match[] }>('dev_search_code', {
        pattern,
        regex: true,
        maxResults: 2_000,
      })
    ).matches;
  const first = (matches: Match[]): CodeLocation | null => {
    const hit = matches.find((match) => !/\.test\.[a-z]+$/.test(match.file));
    return hit ? { file: hit.file, line: hit.line } : null;
  };

  const status = await run('status', async () => {
    const value = await data<{ branch: string | null; commit: string | null; files: unknown[] }>(
      'dev_git_status',
      {},
    );
    return {
      value,
      detail: `branche ${value.branch ?? '?'}, ${value.files.length} fichier(s) modifié(s)`,
    };
  });
  const files = await run('files', async () => {
    const value = (await data<{ files: string[] }>('dev_search_files', { maxResults: 10_000 }))
      .files;
    return { value, detail: `${value.length} fichiers` };
  });
  const lineCounts = await run('lines', async () => {
    const value = (
      await data<{ counts: Record<string, number> }>('dev_search_code', { mode: 'count' })
    ).counts;
    return {
      value,
      detail: `${Object.values(value).reduce((sum, n) => sum + n, 0)} lignes de texte`,
    };
  });
  const packages = await run('packages', async () => {
    const manifests = files.filter(
      (file) => file === 'package.json' || /^(apps|packages)\/[^/]+\/package\.json$/.test(file),
    );
    const value: ArchitectureFacts['packages'] = [];
    for (const manifest of manifests) {
      const json = JSON.parse(
        (await data<{ text: string }>('dev_read_file', { path: manifest, maxChars: 100_000 })).text,
      ) as Record<string, unknown>;
      const keys = (field: string) =>
        Object.keys((json[field] as Record<string, unknown> | undefined) ?? {});
      value.push({
        path: manifest.replace(/\/?package\.json$/, ''),
        name: typeof json.name === 'string' ? json.name : manifest,
        version: typeof json.version === 'string' ? json.version : null,
        dependencies: keys('dependencies').length,
        devDependencies: keys('devDependencies').length,
        scripts: keys('scripts'),
      });
    }
    return { value, detail: value.map((pkg) => pkg.name).join(', ') };
  });
  const tools = await run('tools', async () => {
    const registry = first(await find('^export function createToolManager\\('));
    const toolsDir = registry
      ? registry.file.slice(0, registry.file.lastIndexOf('/') + 1)
      : 'apps/desktop/src/main/tools/';
    const perFile = new Map<string, number>();
    for (const match of await find('defineTool\\(\\{')) {
      if (/\.test\.[a-z]+$/.test(match.file) || !match.file.startsWith(toolsDir)) continue;
      perFile.set(match.file, (perFile.get(match.file) ?? 0) + 1);
    }
    const value = { registry, definitions: [...perFile].map(([file, count]) => ({ file, count })) };
    return { value, detail: registry ? `registre : ${registry.file}` : 'registre introuvable' };
  });
  const core = await run('core', async () => {
    const ipcFile = files.find((file) => file.endsWith('src/shared/ipc.ts')) ?? null;
    let channels = 0;
    if (ipcFile) {
      const text = (
        await data<{ text: string }>('dev_read_file', { path: ipcFile, maxChars: 100_000 })
      ).text;
      channels = (text.match(/^\s+[A-Za-z0-9]+: '[a-z0-9-]+:[a-z0-9-]+',?\s*$/gm) ?? []).length;
    }
    const value = {
      agent: first(await find('^export class Agent ')),
      settings: first(await find('^export const settingsSchema ')),
      toolManager: first(await find('^export class ToolManager ')),
      confirmationCard: files.find((file) => file.endsWith('/ConfirmationCard.tsx')) ?? null,
      ipc: ipcFile ? { file: ipcFile, channels } : null,
    };
    return { value, detail: value.agent ? `agent : ${value.agent.file}` : 'agent introuvable' };
  });
  return run('report', async () => {
    const desktop = packages.find((pkg) => pkg.name === '@jarvis/desktop');
    const facts: ArchitectureFacts = {
      version: desktop?.version ?? null,
      branch: status.branch,
      head: status.commit,
      dirtyFiles: status.files.length,
      files,
      lineCounts,
      packages,
      toolRegistry: tools.registry,
      toolDefinitions: tools.definitions,
      ...core,
    };
    return { value: buildArchitectureReport(facts, deps.now()), detail: 'prêt' };
  });
}
