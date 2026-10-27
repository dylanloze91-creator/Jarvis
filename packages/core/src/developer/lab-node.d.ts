/** Types locaux du laboratoire. Le paquet n’embarque pas @types/node. */
declare module 'node:child_process' {
  export interface LabSpawnResult {
    status: number | null;
    stdout?: string;
    stderr?: string;
    error?: Error;
  }
  export function spawnSync(
    command: string,
    args: readonly string[],
    options: {
      cwd?: string;
      encoding: 'utf8';
      timeout?: number;
      env?: { PATH?: string };
    },
  ): LabSpawnResult;
}

/** 5.0.56 : dossier temporaire du générateur d'exercices. */
declare module 'node:fs/promises' {
  export function mkdtemp(prefix: string): Promise<string>;
}
declare module 'node:os' {
  export function tmpdir(): string;
}
