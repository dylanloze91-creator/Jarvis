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
