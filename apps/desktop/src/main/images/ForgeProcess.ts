import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { run } from '../tools/platform/exec.js';
import { ForgeError, type ForgeClient } from './ForgeClient.js';

export const FORGE_LAUNCHER = 'lancer_forge.bat';
/** Premier démarrage de Forge : chargement de PyTorch et du serveur, 30 à 90 s sur ce PC. */
export const FORGE_START_TIMEOUT_MS = 4 * 60_000;

export interface ForgeProcessDeps {
  /** Pour les tests : remplace le lancement réel. */
  spawnImpl?: (command: string, args: string[], options: { cwd: string }) => ChildProcess;
  /** Pour les tests : remplace `taskkill`. */
  killTreeImpl?: (pid: number) => Promise<void>;
  sleep?: (ms: number) => Promise<void>;
  log?: (line: string) => void;
}

/**
 * Lance et arrête Forge pour Jarvis. Forge déjà allumé (lancé par l'utilisateur) :
 * on s'en sert sans y toucher et on ne l'arrête jamais ; seul un Forge lancé par
 * Jarvis est arrêté après l'image.
 */
export class ForgeProcess {
  private child: ChildProcess | null = null;
  private stderrTail = '';

  constructor(
    private readonly forgeDir: string,
    private readonly client: ForgeClient,
    private readonly deps: ForgeProcessDeps = {},
  ) {}

  get launcherPath(): string {
    return join(this.forgeDir, FORGE_LAUNCHER);
  }

  launcherExists(): boolean {
    return existsSync(this.launcherPath);
  }

  startedByJarvis(): boolean {
    return this.child !== null && this.child.exitCode === null;
  }

  /**
   * S'assure que l'API répond. `already` : Forge tournait déjà ; `started` : lancé ici.
   * Échec : `ForgeError` avec les dernières lignes d'erreur de Forge.
   */
  async ensureRunning(onProgress?: (message: string) => void, signal?: AbortSignal): Promise<'already' | 'started'> {
    if (await this.client.ping()) return 'already';
    if (!this.launcherExists()) {
      throw new ForgeError('unreachable', `Forge n’est pas installé : ${this.launcherPath} est introuvable (voir Réglages → Images).`);
    }
    onProgress?.('Je démarre Forge (le programme qui fabrique les images), environ une minute…');
    this.stderrTail = '';
    const spawnImpl = this.deps.spawnImpl ?? defaultSpawn;
    this.child = spawnImpl('cmd.exe', ['/d', '/c', FORGE_LAUNCHER], { cwd: this.forgeDir });
    this.child.stderr?.on('data', (chunk: Buffer) => this.remember(chunk.toString('utf8')));
    this.child.stdout?.on('data', (chunk: Buffer) => this.remember(chunk.toString('utf8')));
    this.child.on('exit', (code) => this.deps.log?.(`[images] Forge s’est arrêté (code ${code ?? '?'}).`));
    const sleep = this.deps.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
    const deadline = Date.now() + FORGE_START_TIMEOUT_MS;
    while (Date.now() < deadline) {
      if (signal?.aborted) {
        await this.stop();
        throw new ForgeError('cancelled', 'Démarrage de Forge annulé.');
      }
      if (this.child.exitCode !== null) {
        const detail = this.stderrTail.trim();
        this.child = null;
        throw new ForgeError('unreachable', 'Forge s’est arrêté pendant son démarrage.', detail);
      }
      if (await this.client.ping(2_000)) return 'started';
      await sleep(2_000);
    }
    const detail = this.stderrTail.trim();
    await this.stop();
    throw new ForgeError('timeout', 'Forge n’a pas démarré en quatre minutes.', detail);
  }

  /** Arrête le Forge lancé par Jarvis (toute l'arborescence : cmd, Python). Sans effet sinon. */
  async stop(): Promise<void> {
    const child = this.child;
    this.child = null;
    if (!child || child.exitCode !== null || !child.pid) return;
    const killTree = this.deps.killTreeImpl ?? defaultKillTree;
    try {
      await killTree(child.pid);
    } catch (error) {
      this.deps.log?.(`[images] arrêt de Forge : ${error instanceof Error ? error.message : String(error)}`);
      try {
        child.kill('SIGKILL');
      } catch {
        // déjà parti
      }
    }
  }

  private remember(text: string): void {
    this.stderrTail = `${this.stderrTail}${text}`.slice(-2_000);
  }
}

function defaultSpawn(command: string, args: string[], options: { cwd: string }): ChildProcess {
  return spawn(command, args, { cwd: options.cwd, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
}

async function defaultKillTree(pid: number): Promise<void> {
  if (process.platform === 'win32') {
    const result = await run('taskkill', ['/PID', String(pid), '/T', '/F'], { timeoutMs: 15_000 });
    if (result.code !== 0) throw new Error(result.stderr || result.stdout || `taskkill code ${result.code}`);
    return;
  }
  process.kill(-pid, 'SIGTERM');
}
