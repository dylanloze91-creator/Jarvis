import os from 'node:os';
import { z } from 'zod';
import { defineTool } from '@jarvis/core';
import { run, runPowerShell } from './platform/exec.js';

const sortBySchema = z.enum(['cpu', 'memory', 'name']);

interface ProcessInfo {
  pid: number;
  name: string;
  /** `null` quand la mesure n'est pas disponible sur la plateforme. */
  cpu: number | null;
  cpuUnit: '%' | 's CPU cumulées';
  memoryMb: number | null;
}

export const listProcessesTool = defineTool({
  name: 'list_processes',
  description:
    "Liste les processus en cours d'exécution avec leur consommation CPU et mémoire. Utilise `filter` pour chercher une application précise, `sortBy`/`limit` pour trier et restreindre la liste.",
  risk: 'safe',
  schema: z.object({
    filter: z
      .string()
      .max(100)
      .optional()
      .describe('Sous-chaîne du nom de processus à rechercher (insensible à la casse).'),
    sortBy: sortBySchema.default('cpu').describe('Critère de tri : cpu, memory ou name.'),
    limit: z
      .number()
      .int()
      .min(1)
      .max(200)
      .default(20)
      .describe('Nombre maximum de processus renvoyés.'),
  }),
  execute: async ({ filter, sortBy, limit }) => {
    let processes: ProcessInfo[];
    try {
      processes = await listProcesses();
    } catch (error) {
      return { ok: false, content: `Impossible de lister les processus : ${describeError(error)}` };
    }

    const filtered = filter
      ? processes.filter((p) => p.name.toLowerCase().includes(filter.toLowerCase()))
      : processes;
    const sorted = sortProcesses(filtered, sortBy).slice(0, limit);

    if (sorted.length === 0) {
      return {
        ok: true,
        content: filter
          ? `Aucun processus ne correspond à « ${filter} ».`
          : 'Aucun processus trouvé.',
        data: { processes: [] },
      };
    }

    const lines = sorted.map(
      (p) => `${p.name} (PID ${p.pid}) — CPU ${formatCpu(p)}, mémoire ${formatMemory(p.memoryMb)}`,
    );

    return {
      ok: true,
      content: [`${sorted.length} processus (tri : ${sortBy}) :`, ...lines].join('\n'),
      data: { processes: sorted },
    };
  },
});

async function listProcesses(): Promise<ProcessInfo[]> {
  return process.platform === 'win32' ? listProcessesWindows() : listProcessesPosix();
}

async function listProcessesWindows(): Promise<ProcessInfo[]> {
  const script =
    'Get-Process | Select-Object Id,ProcessName,CPU,WorkingSet | ConvertTo-Json -Compress';
  const result = await runPowerShell(script, { timeoutMs: 15_000 });
  if (result.code !== 0 || result.timedOut) {
    throw new Error(result.stderr || 'PowerShell indisponible.');
  }
  const parsed = JSON.parse(result.stdout || '[]') as
    Record<string, unknown> | Record<string, unknown>[];
  const rows = Array.isArray(parsed) ? parsed : [parsed];
  return rows.map((row) => ({
    pid: Number(row.Id),
    name: String(row.ProcessName ?? 'inconnu'),
    // `Get-Process` ne renvoie pas de pourcentage instantané, seulement un
    // temps CPU cumulé depuis le démarrage du processus.
    cpu: typeof row.CPU === 'number' ? row.CPU : null,
    cpuUnit: 's CPU cumulées',
    memoryMb: typeof row.WorkingSet === 'number' ? row.WorkingSet / (1024 * 1024) : null,
  }));
}

async function listProcessesPosix(): Promise<ProcessInfo[]> {
  const result = await run('ps', ['-Ao', 'pid,pcpu,pmem,comm', '--no-headers'], {
    timeoutMs: 10_000,
  });
  if (result.code !== 0) {
    throw new Error(result.stderr || `ps a échoué (code ${result.code}).`);
  }
  const totalMemMb = os.totalmem() / (1024 * 1024);
  return result.stdout
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const [pid, cpu, mem, ...rest] = line.split(/\s+/);
      const memPercent = Number(mem);
      return {
        pid: Number(pid),
        name: rest.join(' ') || 'inconnu',
        cpu: Number(cpu),
        cpuUnit: '%' as const,
        memoryMb: Number.isNaN(memPercent) ? null : (memPercent / 100) * totalMemMb,
      };
    });
}

function sortProcesses(
  processes: ProcessInfo[],
  sortBy: z.infer<typeof sortBySchema>,
): ProcessInfo[] {
  const copy = [...processes];
  if (sortBy === 'name') return copy.sort((a, b) => a.name.localeCompare(b.name));
  if (sortBy === 'memory') return copy.sort((a, b) => (b.memoryMb ?? 0) - (a.memoryMb ?? 0));
  return copy.sort((a, b) => (b.cpu ?? 0) - (a.cpu ?? 0));
}

function formatCpu(p: ProcessInfo): string {
  return p.cpu === null ? 'n/d' : `${p.cpu.toFixed(1)} ${p.cpuUnit}`;
}

function formatMemory(mb: number | null): string {
  return mb === null ? 'n/d' : `${mb.toFixed(0)} Mo`;
}

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
