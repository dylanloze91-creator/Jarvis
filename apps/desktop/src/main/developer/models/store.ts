import { jsonParser, readStateFile, writeStateFile } from '../../safeFile.js';
import type { BenchResult, Calibration, ModelRunRecord, RealBenchResult } from '@jarvis/core';
import type { CodeModelState } from '../../../shared/developerIpc.js';

/** Ce qui doit survivre à un redémarrage : étalonnage, validation, confirmation des variables, résultats du banc. */
export interface StoredCodeModel {
  calibration: Calibration | null;
  validation: CodeModelState['validation'];
  expertsConfirmedAt: number | null;
  benches: BenchResult[];
  realBenches: RealBenchResult[];
  modelRuns: ModelRunRecord[];
}

const EMPTY: StoredCodeModel = {
  calibration: null,
  validation: null,
  expertsConfirmedAt: null,
  benches: [],
  realBenches: [],
  modelRuns: [],
};

/** Même lecteur à la lecture et pour juger la version précédente avant d'en faire le `.bak`. */
const parseCodeModelFile = jsonParser((value) => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('objet attendu');
  return value as Partial<StoredCodeModel>;
});

export class CodeModelStore {
  private cache: StoredCodeModel | null = null;
  private writeChain: Promise<void> = Promise.resolve();

  constructor(private readonly path: () => string) {}

  /** Écritures sérialisées : évite les courses entre enregistrements de runs. */
  async serializedUpdate(patch: Partial<StoredCodeModel>): Promise<StoredCodeModel> {
    const run = this.writeChain.then(() => this.update(patch));
    this.writeChain = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }

  async load(): Promise<StoredCodeModel> {
    if (this.cache) return this.cache;
    try {
      const read = await readStateFile(this.path(), parseCodeModelFile);
      if (read.status !== 'ok' && read.status !== 'restored') throw new Error('absent');
      const data = read.value;
      this.cache = {
        calibration: data.calibration ?? null,
        validation: data.validation ?? null,
        expertsConfirmedAt:
          typeof data.expertsConfirmedAt === 'number' ? data.expertsConfirmedAt : null,
        benches: Array.isArray(data.benches) ? data.benches : [],
        realBenches: Array.isArray(data.realBenches) ? data.realBenches : [],
        modelRuns: Array.isArray(data.modelRuns) ? data.modelRuns : [],
      };
    } catch {
      this.cache = { ...EMPTY };
    }
    return this.cache;
  }

  async update(patch: Partial<StoredCodeModel>): Promise<StoredCodeModel> {
    const next = { ...(await this.load()), ...patch };
    this.cache = next;
    await writeStateFile(this.path(), JSON.stringify(next, null, 2), { parse: parseCodeModelFile });
    return next;
  }
}
