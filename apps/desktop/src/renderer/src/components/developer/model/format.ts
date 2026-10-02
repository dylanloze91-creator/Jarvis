import type { BenchResult, Prediction } from '@jarvis/core';

const nf = (digits: number) =>
  new Intl.NumberFormat('fr-FR', { maximumFractionDigits: digits, minimumFractionDigits: 0 });

/** Go décimaux, comme Ollama et l’Explorateur de fichiers pour les téléchargements. */
export function gb(bytes: number | null | undefined, digits = 1): string {
  if (bytes === null || bytes === undefined) return '—';
  return `${nf(digits).format(bytes / 1e9)} Go`;
}

export function tokRange(range: { low: number; high: number } | [number, number]): string {
  const [low, high] = Array.isArray(range) ? range : [range.low, range.high];
  const digits = high < 10 ? 1 : 0;
  return `${nf(digits).format(low)}–${nf(digits).format(high)} jetons/s`;
}

export function tokValue(value: number | null): string {
  return value === null ? '—' : `${nf(1).format(value)} jetons/s`;
}

export const PLACEMENT_LABEL: Record<Prediction['placement'], string> = {
  gpu: 'tout sur la carte graphique',
  split: 'partagé carte / RAM',
  'experts-in-ram': 'experts en RAM, reste sur la carte',
  ram: 'processeur et RAM',
};

export function percent(completed: number, total: number): number {
  return total > 0 ? Math.min(100, Math.round((completed / total) * 100)) : 0;
}

/** Pour « modification » et « correction » (féminin). */
export function verdict(value: boolean | null): string {
  return value === null ? 'non vérifiable' : value ? 'réussie' : 'ratée';
}

/** « Incomplet » : rien de raté, mais la modification ou la correction n’a pas pu être vérifiée (pas de tsc). */
export function benchStatus(bench: BenchResult): 'passed' | 'incomplete' | 'failed' {
  if (bench.summary.passed) return 'passed';
  return bench.tasks.some((task) => task.ok === false) ? 'failed' : 'incomplete';
}

export function benchFor(
  benches: BenchResult[],
  modelId: string,
  expertsInRam?: boolean,
): BenchResult | null {
  const matching = benches.filter(
    (bench) =>
      bench.model === modelId &&
      (expertsInRam === undefined || bench.expertsInRam === expertsInRam),
  );
  return matching.sort((a, b) => b.finishedAt - a.finishedAt)[0] ?? null;
}

export function dateTime(at: number): string {
  return new Date(at).toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' });
}
