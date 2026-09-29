import os from 'node:os';

/** CPU, RAM et version lus sur la machine. `null` = pas encore connu. */
export interface MachineSnapshot {
  cpuPercent: number | null;
  logicalCores: number | null;
  ramUsedBytes: number | null;
  ramTotalBytes: number | null;
  version: string | null;
}

/** Instantané CPU tel que renvoyé par `os.cpus()[].times`. */
export interface CpuSample {
  user: number;
  nice: number;
  sys: number;
  idle: number;
  irq: number;
}

/**
 * Charge CPU entre deux relevés. `null` si l'intervalle est vide ou
 * incohérent : on n'invente pas 0 %.
 */
export function cpuUsagePercent(
  before: readonly CpuSample[],
  after: readonly CpuSample[],
): number | null {
  if (before.length === 0 || before.length !== after.length) return null;
  let idle = 0;
  let total = 0;
  for (let index = 0; index < after.length; index += 1) {
    const start = before[index];
    const end = after[index];
    if (!start || !end) return null;
    const idleDelta = end.idle - start.idle;
    const totalDelta =
      end.user -
      start.user +
      (end.nice - start.nice) +
      (end.sys - start.sys) +
      idleDelta +
      (end.irq - start.irq);
    if (idleDelta < 0 || totalDelta < 0) return null;
    idle += idleDelta;
    total += totalDelta;
  }
  if (total <= 0) return null;
  const percent = (1 - idle / total) * 100;
  if (!Number.isFinite(percent)) return null;
  return Math.max(0, Math.min(100, Math.round(percent)));
}

function toSample(cpu: os.CpuInfo): CpuSample {
  return {
    user: cpu.times.user,
    nice: cpu.times.nice,
    sys: cpu.times.sys,
    idle: cpu.times.idle,
    irq: cpu.times.irq,
  };
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

export async function readMachineSnapshot(
  version: string | null | undefined,
): Promise<MachineSnapshot> {
  const before = os.cpus().map(toSample);
  await delay(200);
  const after = os.cpus().map(toSample);
  const total = os.totalmem();
  const free = os.freemem();
  const used = total - free;
  const trimmed = typeof version === 'string' ? version.trim() : '';
  return {
    cpuPercent: cpuUsagePercent(before, after),
    logicalCores: after.length > 0 ? after.length : null,
    ramUsedBytes: Number.isFinite(used) && used >= 0 ? used : null,
    ramTotalBytes: Number.isFinite(total) && total > 0 ? total : null,
    version: trimmed.length > 0 ? trimmed : null,
  };
}
