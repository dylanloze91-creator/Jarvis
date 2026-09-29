import { describe, expect, it } from 'vitest';
import { cpuUsagePercent, type CpuSample } from './machineStats';

const sample = (partial: Partial<CpuSample>): CpuSample => ({
  user: 0,
  nice: 0,
  sys: 0,
  idle: 0,
  irq: 0,
  ...partial,
});

describe('cpuUsagePercent', () => {
  it('retourne null sans intervalle mesurable', () => {
    const once = [sample({ idle: 10, user: 5 })];
    expect(cpuUsagePercent(once, once)).toBeNull();
    expect(cpuUsagePercent([], [])).toBeNull();
  });

  it('calcule la part non idle', () => {
    const before = [sample({})];
    const after = [sample({ user: 25, idle: 75 })];
    expect(cpuUsagePercent(before, after)).toBe(25);
  });

  it('refuse un delta incohérent', () => {
    const before = [sample({ user: 10 })];
    const after = [sample({ user: 4 })];
    expect(cpuUsagePercent(before, after)).toBeNull();
  });
});
