import { fileURLToPath, pathToFileURL } from 'node:url';

/**
 * Faux appendice pour les tests : le même que celui qu'on lance à la main
 * (`apps/desktop/scripts/fake-appendice.mjs`), chargé ici avec ses types.
 */
export interface FakeAppendiceRequest {
  method: string;
  path: string;
  authorization?: string;
  body: Record<string, unknown>;
}

export interface FakeAppendice {
  token: string;
  origin: string;
  hello: Record<string, unknown> & { id: string; nom: string; capacites: Array<{ nom: string }> };
  nextStatus: string;
  nextMeasure: unknown;
  actionDelayMs: number;
  mute: boolean;
  emergency: boolean;
  stops: number;
  done: Array<Record<string, unknown>>;
  requests: FakeAppendiceRequest[];
  paths(): string[];
  close(): Promise<void>;
}

export interface FakeAppendiceOptions {
  token?: string;
  genre?: string;
  id?: string;
  nom?: string;
  piece?: string;
  risque?: string;
  capacites?: Array<{ nom: string; description?: string; risque?: string }>;
  hello?: Record<string, unknown>;
}

const SCRIPT = fileURLToPath(new URL('../../../scripts/fake-appendice.mjs', import.meta.url));

export async function startFakeAppendice(options: FakeAppendiceOptions = {}): Promise<FakeAppendice> {
  const module = (await import(pathToFileURL(SCRIPT).href)) as {
    startFakeAppendice(options: FakeAppendiceOptions): Promise<FakeAppendice>;
  };
  return module.startFakeAppendice(options);
}
