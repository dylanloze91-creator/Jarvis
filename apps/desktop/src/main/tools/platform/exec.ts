import { spawn } from 'node:child_process';

export interface RunOptions {
  cwd?: string;
  timeoutMs?: number;
  /** Active l'interprétation par le shell système (pipes, redirections…). */
  shell?: boolean;
  maxOutputChars?: number;
}

export interface RunResult {
  code: number | null;
  signal: NodeJS.Signals | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
  truncated: boolean;
}

const DEFAULT_TIMEOUT_MS = 30_000;
const DEFAULT_MAX_OUTPUT = 8_000;

/**
 * Exécute une commande sans jamais lancer d'exception : le code de retour, la
 * sortie (tronquée si besoin) et un éventuel dépassement de délai sont
 * toujours renvoyés à l'appelant, qui décide comment les présenter. C'est le
 * point de passage bas niveau utilisé par `run_command` et par les outils
 * internes (liste des processus, résolution d'applications…) qui ont besoin
 * d'invoquer une commande système.
 */
export function run(
  command: string,
  args: string[] = [],
  options: RunOptions = {},
): Promise<RunResult> {
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const maxOutput = options.maxOutputChars ?? DEFAULT_MAX_OUTPUT;

  return new Promise((resolve) => {
    const child = spawn(command, args, {
      cwd: options.cwd,
      shell: options.shell ?? false,
      windowsHide: true,
    });

    let stdout = '';
    let stderr = '';
    let timedOut = false;
    let settled = false;

    const timer = setTimeout(() => {
      timedOut = true;
      child.kill('SIGTERM');
      // Laisse une seconde pour un arrêt propre avant de forcer.
      setTimeout(() => {
        if (!settled) child.kill('SIGKILL');
      }, 1000);
    }, timeoutMs);

    child.stdout?.on('data', (chunk: Buffer) => {
      stdout += chunk.toString('utf8');
    });
    child.stderr?.on('data', (chunk: Buffer) => {
      stderr += chunk.toString('utf8');
    });

    child.on('error', (error) => {
      settled = true;
      clearTimeout(timer);
      stderr += (stderr ? '\n' : '') + `Échec du lancement : ${error.message}`;
      resolve(finalize());
    });

    child.on('close', (code, signal) => {
      settled = true;
      clearTimeout(timer);
      resolve(finalize(code, signal));
    });

    function finalize(code: number | null = null, signal: NodeJS.Signals | null = null): RunResult {
      const combinedLength = stdout.length + stderr.length;
      const truncated = combinedLength > maxOutput;
      return {
        code,
        signal,
        stdout: clip(stdout.replace(/^\uFEFF/, ''), maxOutput),
        stderr: clip(stderr, maxOutput),
        timedOut,
        truncated,
      };
    }
  });
}

function clip(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max)}\n… (sortie tronquée)` : text;
}

/**
 * Sans ça, Windows PowerShell 5.1 écrit sur un tube dans la page de code OEM
 * (850 en français) : « é » arrive illisible une fois décodé en UTF-8.
 */
export const POWERSHELL_UTF8_PREAMBLE =
  'try { [Console]::OutputEncoding = [System.Text.Encoding]::UTF8 } catch {}';

/**
 * Exécute un script PowerShell (Windows uniquement) avec `-NoProfile` et
 * `-NonInteractive` pour éviter tout profil utilisateur ou invite bloquante.
 */
export function runPowerShell(script: string, options: RunOptions = {}): Promise<RunResult> {
  return run(
    'powershell.exe',
    [
      '-NoProfile',
      '-NonInteractive',
      '-ExecutionPolicy',
      'Bypass',
      '-Command',
      `${POWERSHELL_UTF8_PREAMBLE}\n${script}`,
    ],
    options,
  );
}

/** Échappe une valeur pour l'insérer dans une chaîne PowerShell entre guillemets simples. */
export function psQuote(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}
