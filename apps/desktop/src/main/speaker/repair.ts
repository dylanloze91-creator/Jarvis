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

function psQuote(value: string): string {
  if (!/^[\w.\\: ()\-/]+$/.test(value)) throw new Error('argument refusé');
  return `'${value.replace(/'/g, "''")}'`;
}

/** Vrai lancement. Les tests passent un faux `elevate` et n'appellent pas ceci. */
export async function elevateScript(script: string, args: string[]): Promise<void> {
  const list = ['-NoProfile', '-NonInteractive', '-File', script, ...args].map(psQuote).join(',');
  const command = `Start-Process -FilePath powershell.exe -Verb RunAs -Wait -ArgumentList ${list}`;
  await runPowerShell(['-NoProfile', '-NonInteractive', '-Command', command]);
}

export function readStatusScript(script: string): Promise<string> {
  return runPowerShell(['-NoProfile', '-NonInteractive', '-File', script]);
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
