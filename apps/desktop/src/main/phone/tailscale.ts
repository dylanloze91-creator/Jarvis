import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { parseTailscaleStatus, tailscaleServesPort, type TailscaleSelf } from '@jarvis/core';

/**
 * 5.0.63 — lecture seule de Tailscale : deux commandes **fixes** (`tailscale status --json`,
 * `tailscale serve status --json`), sans shell et sans aucun paramètre venu de l'interface.
 * Jarvis ne change jamais la configuration de Tailscale : la publication (`tailscale serve --bg
 * 53130`) est montrée à l'utilisateur, qui la tape lui-même une fois.
 */
export interface TailscaleState extends TailscaleSelf {
  installed: boolean;
  /** Le port de Jarvis est publié en HTTPS (`null` : inconnu, Tailscale absent ou arrêté). */
  served: boolean | null;
}

export type TailscaleRunner = (args: readonly string[]) => Promise<string>;

function tailscaleProgram(): string {
  if (process.platform === 'win32') {
    const programFiles = process.env.ProgramFiles ?? 'C:\\Program Files';
    const installed = join(programFiles, 'Tailscale', 'tailscale.exe');
    if (existsSync(installed)) return installed;
  }
  return 'tailscale';
}

export const runTailscale: TailscaleRunner = (args) =>
  new Promise((resolve, reject) => {
    execFile(
      tailscaleProgram(),
      [...args],
      { timeout: 5_000, windowsHide: true, maxBuffer: 2 * 1024 * 1024 },
      (error, stdout) => {
        if (error && !stdout) reject(error);
        else resolve(String(stdout));
      },
    );
  });

export async function readTailscale(port: number, run: TailscaleRunner = runTailscale): Promise<TailscaleState> {
  let statusRaw: string;
  try {
    statusRaw = await run(['status', '--json']);
  } catch (error) {
    const missing = (error as NodeJS.ErrnoException).code === 'ENOENT';
    return { installed: !missing, dnsName: null, online: false, backendState: null, served: null };
  }
  const self = parseTailscaleStatus(statusRaw);
  if (!self.online) return { installed: true, ...self, served: null };
  let served: boolean | null = null;
  try {
    served = tailscaleServesPort(await run(['serve', 'status', '--json']), port);
  } catch {
    served = null;
  }
  return { installed: true, ...self, served };
}
