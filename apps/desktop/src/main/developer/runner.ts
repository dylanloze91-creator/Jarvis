import { spawn, type ChildProcess } from 'node:child_process';
import { classifyCommand, type CommandSafetyContext } from '@jarvis/core';
import { devPlatform } from './platform/index.js';

export interface RunSpec {
  program: string;
  args: string[];
  cwd: string;
  timeoutMs: number;
  env?: NodeJS.ProcessEnv;
  signal?: AbortSignal;
  onLine?: (line: string) => void;
  /** Octets gardés par flux (la fin de la sortie). */
  maxBytes?: number;
  /** Commande telle qu'affichée et classée (par défaut : programme + arguments). */
  display?: string;
  context?: CommandSafetyContext;
}

export interface RunOutcome {
  display: string;
  code: number | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
  cancelled: boolean;
  truncated: boolean;
  /** Le programme n'a pas pu démarrer (introuvable…). */
  error: string | null;
}

export type Runner = (spec: RunSpec) => Promise<RunOutcome>;

export class CommandRefusedError extends Error {
  constructor(
    readonly display: string,
    readonly reasons: string[],
  ) {
    super(`Commande refusée par le tri de sécurité : ${display} (${reasons.join(' ; ')})`);
    this.name = 'CommandRefusedError';
  }
}

export function displayCommand(program: string, args: string[]): string {
  const base = program.split(/[\\/]/).pop() ?? program;
  return [base, ...args]
    .map((part) => (/[\s"]/.test(part) || part === '' ? `"${part.replace(/"/g, '\\"')}"` : part))
    .join(' ');
}

/** Toute l'arborescence du processus, selon le système (voir `platform/`). */
export function killTree(child: ChildProcess, platform: NodeJS.Platform = process.platform): void {
  devPlatform(platform).killTree(child);
}

function gitSubcommand(args: string[]): string {
  for (let i = 0; i < args.length; i += 1) {
    const value = args[i]!;
    if (value === '-c' || value === '-C') i += 1;
    else if (!value.startsWith('-')) return value.toLowerCase();
  }
  return '';
}

/** Raisons de refus, ou null. L'affichage ne peut pas cacher la vraie commande. */
export function refusalOf(
  spec: Pick<RunSpec, 'program' | 'args' | 'context'>,
  display: string,
): string[] | null {
  const safety = classifyCommand(display, spec.context ?? {});
  if (safety.level === 'denied') return safety.reasons;
  const program = (spec.program.split(/[\\/]/).pop() ?? '').replace(/\.exe$/i, '').toLowerCase();
  if (program === 'git') {
    const shown = gitSubcommand(display.split(/\s+/).slice(1));
    const actual = gitSubcommand(spec.args);
    if (shown !== actual)
      return [`la commande affichée (git ${shown}) n’est pas celle lancée (git ${actual})`];
  }
  if (program === 'node' && /npm-cli\.js$/i.test(spec.args[0] ?? '')) {
    const npm = classifyCommand(displayCommand('npm', spec.args.slice(1)), spec.context ?? {});
    if (npm.level === 'denied') return npm.reasons;
  }
  return null;
}

class Tail {
  private text = '';
  truncated = false;
  constructor(private readonly max: number) {}
  push(chunk: string): void {
    this.text += chunk;
    if (this.text.length > this.max) {
      this.text = this.text.slice(this.text.length - this.max);
      this.truncated = true;
    }
  }
  value(): string {
    return this.text;
  }
}

/**
 * Lance un programme sans shell, avec des arguments fixes. Le tri de sécurité
 * est refait ici : une commande refusée ne démarre jamais, même par erreur.
 */
export const runProcess: Runner = (spec) => {
  const display = spec.display ?? displayCommand(spec.program, spec.args);
  const refusal = refusalOf(spec, display);
  if (refusal) return Promise.reject(new CommandRefusedError(display, refusal));

  return new Promise<RunOutcome>((resolve) => {
    const max = spec.maxBytes ?? 200_000;
    const stdout = new Tail(max);
    const stderr = new Tail(max);
    let timedOut = false;
    let cancelled = false;
    let pending = '';
    const child = spawn(spec.program, spec.args, {
      cwd: spec.cwd,
      env: spec.env ?? process.env,
      shell: false,
      windowsHide: true,
      detached: devPlatform().spawnDetached,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const lines = (chunk: string): void => {
      if (!spec.onLine) return;
      pending += chunk;
      const parts = pending.split(/\r?\n|\r/);
      pending = parts.pop() ?? '';
      for (const line of parts) if (line.trim()) spec.onLine(line);
    };
    child.stdout?.setEncoding('utf8').on('data', (chunk: string) => {
      stdout.push(chunk);
      lines(chunk);
    });
    child.stderr?.setEncoding('utf8').on('data', (chunk: string) => {
      stderr.push(chunk);
      lines(chunk);
    });
    const timer = setTimeout(() => {
      timedOut = true;
      killTree(child);
    }, spec.timeoutMs);
    const onAbort = (): void => {
      cancelled = true;
      killTree(child);
    };
    if (spec.signal?.aborted) onAbort();
    else spec.signal?.addEventListener('abort', onAbort, { once: true });
    let done = false;
    const finish = (code: number | null, error: string | null): void => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      spec.signal?.removeEventListener('abort', onAbort);
      if (pending.trim()) spec.onLine?.(pending);
      resolve({
        display,
        code,
        stdout: stdout.value(),
        stderr: stderr.value(),
        timedOut,
        cancelled,
        truncated: stdout.truncated || stderr.truncated,
        error,
      });
    };
    child.on('error', (error) => finish(null, error.message));
    child.on('close', (code) => finish(code, null));
  });
};
