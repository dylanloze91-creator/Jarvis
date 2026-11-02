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
/** Délai laissé à un arrêt propre (SIGTERM) avant de forcer (SIGKILL). */
export const KILL_GRACE_MS = 1_000;

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
      // 5.0.64 (revue, point 4) : sous Windows, `kill` n'atteint que le processus lancé
      // (souvent `cmd.exe`) ; le programme qu'il a démarré continuait alors que l'outil
      // annonçait « commande interrompue ». Et un `taskkill /T` lancé après SIGTERM ne
      // retrouvait plus le parent, donc plus l'arborescence : taskkill passe en premier,
      // tant que le parent existe ; s'il échoue, le chemin d'avant (SIGTERM puis SIGKILL).
      if (process.platform === 'win32' && child.pid) {
        killTreeWindows(child.pid, terminateGracefully);
        return;
      }
      terminateGracefully();
    }, timeoutMs);

    /** Chemin historique (seul chemin hors Windows) : SIGTERM, puis SIGKILL une seconde plus tard. */
    function terminateGracefully() {
      if (settled) return;
      child.kill('SIGTERM');
      setTimeout(() => {
        if (settled) return;
        child.kill('SIGKILL');
      }, KILL_GRACE_MS);
    }

    function killTreeWindows(pid: number, onFailure: () => void) {
      let decided = false;
      const fail = () => {
        if (decided) return;
        decided = true;
        onFailure();
      };
      let killer: ReturnType<typeof spawn>;
      try {
        killer = spawn('taskkill', ['/PID', String(pid), '/T', '/F'], {
          windowsHide: true,
          stdio: 'ignore',
        });
      } catch {
        fail();
        return;
      }
      killer.on('error', fail);
      killer.on('close', (code) => {
        if (code !== 0) {
          fail();
          return;
        }
        decided = true;
        // taskkill a dit « ok » : le `close` de l'enfant suit. Filet si ce n'était pas le
        // cas, pour ne jamais laisser `run` pendu.
        setTimeout(() => {
          if (!settled) child.kill('SIGKILL');
        }, KILL_GRACE_MS);
      });
    }

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
