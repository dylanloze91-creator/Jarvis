/**
 * Lecture du réseau sans élévation. Réparer et « Privé » ne partent que sur un clic,
 * avec Start-Process -Verb RunAs, et un seul nombre déjà vérifié.
 */
import { spawn } from 'node:child_process';
import { diagnosticLines, firewallPort, homeInterface, parseNetStatus, privateIndex, type NetProfile } from '@jarvis/core';

export interface RepairDeps {
  /** Lecture seule. Ne doit pas élever. */
  readStatus: () => Promise<string>;
  elevate: (script: string, args: string[]) => Promise<void>;
}

export type RepairOutcome = { ok: true } | { ok: false; sentence: string };

export interface SpeakerNetView {
  lines: Array<{ id: string; ok: boolean; sentence: string }>;
  homeIndex: number | null;
  homeName: string | null;
  notice: string | null;
}

/** Assemble le panneau à partir du JSON lu. N'élève rien. */
export async function collectSpeakerNet(input: {
  platform: NodeJS.Platform;
  read: () => Promise<string>;
  bridgeRunning: boolean;
  kept: readonly string[];
  speakers: ReadonlyArray<{ name: string; lastHelloAt: number | null }>;
  now: number;
}): Promise<SpeakerNetView> {
  let notice: string | null = null;
  let tcp = false;
  let udp = false;
  let home: NetProfile | null = null;
  if (input.platform !== 'win32') {
    notice = 'Ce contrôle est prévu pour Windows.';
  } else {
    try {
      const parsed = parseNetStatus(await input.read());
      if (!parsed) notice = "Je n'arrive pas à lire le réseau.";
      else {
        tcp = parsed.tcp53131;
        udp = parsed.udp5353;
        home = homeInterface(parsed.profiles, input.kept);
      }
    } catch {
      notice = "Je n'arrive pas à lire le réseau.";
    }
  }
  const lines = diagnosticLines({
    bridgeRunning: input.bridgeRunning,
    firewallTcp: tcp,
    firewallMdns: udp,
    networkPrivate: home?.category === 'Private',
    kept: input.kept,
    dropped: [],
    speakers: input.speakers,
    now: input.now,
  });
  return {
    lines,
    homeIndex: home && home.category !== 'Private' ? home.index : null,
    homeName: home?.name ?? null,
    notice,
  };
}

export function isWindowsRefusal(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /cancel|refus|annul|1223|800704C7/i.test(message);
}

/** La lecture n'appelle jamais `elevate`. */
export async function readOnlyStatus(deps: RepairDeps): Promise<string> {
  return deps.readStatus();
}

export async function repairFirewall(port: unknown, script: string, deps: RepairDeps): Promise<RepairOutcome> {
  const valid = firewallPort(port);
  if (valid === null) return { ok: false, sentence: 'Port refusé.' };
  return elevate(script, ['-Port', String(valid)], deps);
}

export async function repairPrivate(
  index: unknown,
  home: NetProfile | null,
  script: string,
  deps: RepairDeps,
): Promise<RepairOutcome> {
  const valid = privateIndex(index, home);
  if (valid === null) return { ok: false, sentence: 'Je ne touche pas à cette interface.' };
  return elevate(script, ['-InterfaceIndex', String(valid)], deps);
}

async function elevate(script: string, args: string[], deps: RepairDeps): Promise<RepairOutcome> {
  try {
    await deps.elevate(script, args);
    return { ok: true };
  } catch (error) {
    if (isWindowsRefusal(error)) return { ok: false, sentence: "Windows n'a pas donné l'accord." };
    return { ok: false, sentence: "La réparation n'a pas abouti." };
  }
}

/**
 * Lettres (accentuées comprises : un dossier d'utilisateur « Zoé », « Jérôme »), chiffres et la
 * ponctuation d'un chemin Windows. Ni apostrophe, ni guillemet, ni `$`, ni backtick, ni point-virgule.
 */
export function psQuote(value: string): string {
  if (!/^[\p{L}\p{N}_.\\: ()\-/]+$/u.test(value)) throw new Error('argument refusé');
  return `'${value.replace(/'/g, "''")}'`;
}

/**
 * Un Windows réglé par défaut (politique « Restricted ») refuse tout fichier .ps1.
 * Les trois scripts de Jarvis sont constants et livrés avec lui : `Bypass` pour ce seul lancement,
 * comme la voix des enceintes (`synth.ts`). La politique de la machine n'est pas modifiée.
 */
const SCRIPT_FLAGS = ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass'] as const;

/** Arguments de la lecture seule (sans élévation). */
export function statusArgs(script: string): string[] {
  return [...SCRIPT_FLAGS, '-File', script];
}

/**
 * Un argument qui contient un espace (le chemin du script dans « Program Files », ou un dossier
 * « Nouveau dossier ») est mis entre guillemets doubles à l'intérieur de l'élément : Start-Process
 * recolle ses arguments avec des espaces, sans les protéger. Sans ces guillemets, « Réparer » ouvrait
 * la fenêtre d'accord de Windows puis ne faisait rien (vu le 12 novembre 2026 sur le PC de l'utilisateur).
 * psQuote refuse déjà les guillemets, donc l'argument ne peut pas en sortir.
 */
function elevateArgument(value: string): string {
  const quoted = psQuote(value);
  return /\s/.test(value) ? `'"${value}"'` : quoted;
}

/**
 * Commande qui demande l'accord de Windows puis lance le script, avec les seuls arguments donnés.
 * Le code de sortie du script élevé est rendu (-PassThru) : un script qui échoue n'est plus « réparé ».
 */
export function elevateCommand(script: string, args: readonly string[]): string {
  const list = [...SCRIPT_FLAGS, '-File', script, ...args].map(elevateArgument).join(',');
  return `$p = Start-Process -FilePath powershell.exe -Verb RunAs -Wait -PassThru -ArgumentList ${list}; exit $p.ExitCode`;
}

/** Vrai lancement. Les tests passent un faux `elevate` et n'appellent pas ceci. */
export async function elevateScript(script: string, args: string[]): Promise<void> {
  await runPowerShell(['-NoProfile', '-NonInteractive', '-Command', elevateCommand(script, args)]);
}

export function readStatusScript(script: string): Promise<string> {
  return runPowerShell(statusArgs(script));
}

function runPowerShell(args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn('powershell.exe', args, { windowsHide: true });
    let out = '';
    let err = '';
    child.stdout?.on('data', (chunk: Buffer) => {
      out += chunk.toString();
    });
    child.stderr?.on('data', (chunk: Buffer) => {
      err += chunk.toString();
    });
    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) resolve(out.trim());
      else reject(new Error(err.trim() || `code ${code ?? 'inconnu'}`));
    });
  });
}
