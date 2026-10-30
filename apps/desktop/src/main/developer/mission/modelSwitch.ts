import type { OllamaStatusResult } from '@jarvis/core';
import type { RunningModel } from '../models/ollamaApi.js';

/** 20 s pour lister ou décharger. La génération de code garde ses propres plafonds. */
export const MODEL_PREP_TIMEOUT_MS = 20_000;

export type ModelSwitchFailure = 'timeout' | 'load' | 'call';

export class ModelSwitchError extends Error {
  constructor(
    message: string,
    readonly kind: ModelSwitchFailure,
    readonly model: string,
  ) {
    super(message);
    this.name = 'ModelSwitchError';
  }
}

export interface ModelSwitchApi {
  status(): Promise<OllamaStatusResult>;
  running(signal?: AbortSignal): Promise<RunningModel[]>;
  unload(model: string, signal?: AbortSignal): Promise<boolean>;
}

export interface ModelSwitchLog {
  (line: string): void;
}

/**
 * Un seul modèle chargé. `Promise.race` n’annule pas tout seul : le signal
 * est transmis au client, et un appel encore en vol bloque le suivant.
 */
export function createModelSwitch(): {
  switchTo(input: {
    api: ModelSwitchApi;
    model: string;
    timeoutMs?: number;
    log: ModelSwitchLog;
  }): Promise<void>;
} {
  let tail: Promise<void> = Promise.resolve();
  const inflight = new Set<Promise<unknown>>();

  const call = async <T>(
    label: string,
    model: string,
    timeoutMs: number,
    op: (signal: AbortSignal) => Promise<T>,
  ): Promise<T> => {
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        controller.abort();
        reject(
          new ModelSwitchError(
            `Délai dépassé (${Math.round(timeoutMs / 1000)} s) : ${label}`,
            'timeout',
            model,
          ),
        );
      }, timeoutMs);
    });
    const work = op(controller.signal);
    const tracked = work.then(
      () => undefined,
      () => undefined,
    );
    inflight.add(tracked);
    void tracked.finally(() => inflight.delete(tracked));
    try {
      return await Promise.race([work, timeout]);
    } finally {
      if (timer) clearTimeout(timer);
    }
  };

  return {
    switchTo(input) {
      const timeoutMs = input.timeoutMs ?? MODEL_PREP_TIMEOUT_MS;
      const run = tail.then(() => prepare(input.api, input.model, timeoutMs, input.log, call));
      tail = run.then(
        () => undefined,
        () => Promise.allSettled([...inflight]).then(() => undefined),
      );
      return run;
    },
  };
}

async function prepare(
  api: ModelSwitchApi,
  model: string,
  timeoutMs: number,
  log: ModelSwitchLog,
  call: <T>(
    label: string,
    model: string,
    timeoutMs: number,
    op: (signal: AbortSignal) => Promise<T>,
  ) => Promise<T>,
): Promise<void> {
  const started = Date.now();
  log(`Préparation du modèle ${model}`);
  const status = await call('état d’Ollama', model, timeoutMs, () => api.status());
  if (status.status !== 'detected') {
    throw new ModelSwitchError(
      `Ollama injoignable pendant la préparation de « ${model} » : ${status.message}`,
      'call',
      model,
    );
  }
  if (!status.models.some((item) => item.name === model)) {
    throw new ModelSwitchError(`Modèle non installé : ${model}`, 'load', model);
  }
  const running = await call('liste des modèles chargés', model, timeoutMs, (signal) =>
    api.running(signal),
  );
  for (const loaded of running) {
    if (!loaded.name || loaded.name === model) continue;
    const freed = await unloadOnce(api, loaded.name, timeoutMs, log, call);
    if (!freed) {
      throw new ModelSwitchError(
        `Déchargement refusé : ${loaded.name}`,
        'load',
        loaded.name,
      );
    }
  }
  const after = await call('vérification des modèles chargés', model, timeoutMs, (signal) =>
    api.running(signal),
  );
  const others = after.filter((item) => item.name && item.name !== model);
  if (others.length) {
    throw new ModelSwitchError(
      `Modèle encore chargé : ${others.map((item) => item.name).join(', ')}`,
      'load',
      others[0]!.name,
    );
  }
  log(
    `Modèle prêt ${model} (${Date.now() - started} ms). Les autres modèles chargés ont été libérés.`,
  );
}

async function unloadOnce(
  api: ModelSwitchApi,
  name: string,
  timeoutMs: number,
  log: ModelSwitchLog,
  call: <T>(
    label: string,
    model: string,
    timeoutMs: number,
    op: (signal: AbortSignal) => Promise<T>,
  ) => Promise<T>,
): Promise<boolean> {
  try {
    const ok = await call(`déchargement de ${name}`, name, timeoutMs, (signal) =>
      api.unload(name, signal),
    );
    if (!ok) log(`Échec du déchargement : ${name}`);
    return ok;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    log(`Échec du déchargement : ${name} — ${message}`);
    throw error;
  }
}
