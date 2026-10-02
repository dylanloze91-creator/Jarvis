import type { BenchTaskKind } from './benchmarkTasks.js';

export interface BenchTaskResult {
  id: string;
  label: string;
  kind: BenchTaskKind;
  /** `null` : non vérifiable (tsc indisponible). */
  ok: boolean | null;
  detail: string;
  durationMs: number;
  outputTokPerSec: number | null;
  calls: number;
}

export interface BenchMetrics {
  outputTokPerSec: number | null;
  promptTokPerSec: number | null;
  /** Premier chargement du modèle (à froid). */
  loadMs: number | null;
  sizeBytes: number | null;
  sizeVramBytes: number | null;
  gpuUsedMiB: number | null;
  ramUsedBytes: number | null;
}

export interface BenchResult {
  model: string;
  expertsInRam: boolean;
  startedAt: number;
  finishedAt: number;
  tasks: BenchTaskResult[];
  metrics: BenchMetrics;
  summary: { toolCalls: string; edit: boolean | null; fix: boolean | null; passed: boolean };
}

export function summarizeBench(tasks: BenchTaskResult[]): BenchResult['summary'] {
  const toolTasks = tasks.filter((task) => task.kind === 'tool-call');
  const edit = tasks.find((task) => task.kind === 'edit')?.ok ?? null;
  const fix = tasks.find((task) => task.kind === 'fix')?.ok ?? null;
  const toolOk = toolTasks.filter((task) => task.ok).length;
  return {
    toolCalls: `${toolOk}/${toolTasks.length}`,
    edit,
    fix,
    passed: toolOk === toolTasks.length && toolTasks.length > 0 && edit === true && fix === true,
  };
}
