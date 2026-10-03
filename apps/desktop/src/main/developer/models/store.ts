import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import type { BenchResult, Calibration, RealBenchResult } from '@jarvis/core';
import type { CodeModelState } from '../../../shared/developerIpc.js';

/** Ce qui doit survivre à un redémarrage : étalonnage, validation, confirmation des variables, résultats du banc. */
export interface StoredCodeModel {
  calibration: Calibration | null;
  validation: CodeModelState['validation'];
  expertsConfirmedAt: number | null;
  benches: BenchResult[];
  realBenches: RealBenchResult[];
}

const EMPTY: StoredCodeModel = {
  calibration: null,
  validation: null,
  expertsConfirmedAt: null,
  benches: [],
  realBenches: [],
};

export class CodeModelStore {
  private cache: StoredCodeModel | null = null;

  constructor(private readonly path: () => string) {}

  async load(): Promise<StoredCodeModel> {
    if (this.cache) return this.cache;
    try {
      const data = JSON.parse(await readFile(this.path(), 'utf8')) as Partial<StoredCodeModel>;
      this.cache = {
        calibration: data.calibration ?? null,
        validation: data.validation ?? null,
        expertsConfirmedAt:
          typeof data.expertsConfirmedAt === 'number' ? data.expertsConfirmedAt : null,
        benches: Array.isArray(data.benches) ? data.benches : [],
        realBenches: Array.isArray(data.realBenches) ? data.realBenches : [],
      };
    } catch {
      this.cache = { ...EMPTY };
    }
    return this.cache;
  }

  async update(patch: Partial<StoredCodeModel>): Promise<StoredCodeModel> {
    const next = { ...(await this.load()), ...patch };
    this.cache = next;
    const target = this.path();
    await mkdir(dirname(target), { recursive: true });
    const temporary = `${target}.tmp`;
    await writeFile(temporary, JSON.stringify(next, null, 2));
    await rename(temporary, target);
    return next;
  }
}
