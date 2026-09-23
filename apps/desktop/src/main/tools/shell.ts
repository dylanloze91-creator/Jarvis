import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import { join } from 'node:path';
import { z } from 'zod';
import { defineTool } from '@jarvis/core';
import { psQuote, run, runPowerShell, type RunResult } from './platform/exec.js';

const schema = z.object({
  command: z
    .string()
    .min(1)
    .max(4000)
    .describe('Exécutable ou commande à lancer (sans ses arguments si `args` est utilisé).'),
  args: z
    .array(z.string())
    .max(64)
    .default([])
    .describe('Arguments séparés — méthode recommandée, elle exclut toute interprétation shell.'),
  cwd: z.string().optional().describe('Dossier de travail. Par défaut, le dossier personnel.'),
  useShell: z
    .boolean()
    .default(false)
    .describe(
      'Interpréter `command` via le shell système (nécessaire pour les pipes `|`, redirections `>`, variables…). Laissé à `false` par défaut : aucune interprétation implicite.',
    ),
  elevate: z
    .boolean()
    .default(false)
    .describe(
      'Exécuter avec les privilèges administrateur (UAC sur Windows, sudo non interactif ailleurs).',
    ),
  timeoutMs: z
    .number()
    .int()
    .min(1000)
    .max(300_000)
    .default(30_000)
    .describe("Délai maximal d'exécution en millisecondes avant interruption forcée."),
});

export const runCommandTool = defineTool({
  name: 'run_command',
  description:
    "Exécute une commande shell arbitraire sur la machine de l'utilisateur, avec délai d'expiration, sortie tronquée et code de retour. Outil le plus puissant : à réserver aux cas où aucun outil dédié ne convient. Élévation administrateur disponible via `elevate`.",
  risk: 'confirm',
  category: 'shell',
  forceConfirm: true,
  isDestructive: true,
  schema,
  summarize: ({ command, args, elevate, useShell }) =>
    [
      `Exécuter : ${commandLine(command, args)}`,
      elevate ? '⚠ Avec élévation administrateur.' : null,
      useShell ? '(interprétée par le shell système)' : null,
    ]
      .filter(Boolean)
      .join(' '),
  describeCommand: ({ command, args, elevate }) =>
    `${elevate ? '[ADMIN] ' : ''}${commandLine(command, args)}`,
  execute: async ({ command, args, cwd, useShell, elevate, timeoutMs }) => {
    const workingDir = cwd || os.homedir();

    if (elevate) {
      return process.platform === 'win32'
        ? executeElevatedWindows(command, args, workingDir, timeoutMs)
        : executeElevatedPosix(command, args, workingDir, timeoutMs);
    }

    const result = useShell
      ? await run(commandLine(command, args), [], { cwd: workingDir, timeoutMs, shell: true })
      : await run(command, args, { cwd: workingDir, timeoutMs, shell: false });

    return formatResult(result);
  },
});

function commandLine(command: string, args: string[]): string {
  return [command, ...args].join(' ').trim();
}

function formatResult(result: RunResult): { ok: boolean; content: string; data: unknown } {
  const ok = result.code === 0 && !result.timedOut;
  const lines = [
    `Code de retour : ${result.code === null ? 'inconnu' : result.code}${result.signal ? ` (signal ${result.signal})` : ''}`,
  ];
  if (result.timedOut) lines.push(`⏱ Délai dépassé : la commande a été interrompue.`);
  if (result.stdout.trim()) lines.push(`--- sortie standard ---\n${result.stdout.trim()}`);
  if (result.stderr.trim()) lines.push(`--- sortie d'erreur ---\n${result.stderr.trim()}`);
  if (result.truncated) lines.push('(sortie tronquée)');

  return {
    ok,
    content: lines.join('\n'),
    data: { code: result.code, signal: result.signal, timedOut: result.timedOut },
  };
}

async function executeElevatedWindows(
  command: string,
  args: string[],
  cwd: string,
  timeoutMs: number,
): Promise<{ ok: boolean; content: string; data?: unknown }> {
  const dir = await mkdtemp(join(os.tmpdir(), 'jarvis-cmd-'));
  const outFile = join(dir, 'stdout.txt');
  const errFile = join(dir, 'stderr.txt');

  const innerScript = [
    `Set-Location -Path ${psQuote(cwd)}`,
    `& ${psQuote(command)} ${args.map(psQuote).join(' ')} 1> ${psQuote(outFile)} 2> ${psQuote(errFile)}`,
    'exit $LASTEXITCODE',
  ].join('; ');

  const encoded = Buffer.from(innerScript, 'utf16le').toString('base64');

  const outerScript = `
$proc = Start-Process -FilePath 'powershell.exe' -ArgumentList @('-NoProfile','-NonInteractive','-WindowStyle','Hidden','-EncodedCommand','${encoded}') -Verb RunAs -PassThru -Wait
$stdout = if (Test-Path ${psQuote(outFile)}) { Get-Content ${psQuote(outFile)} -Raw -ErrorAction SilentlyContinue } else { '' }
$stderr = if (Test-Path ${psQuote(errFile)}) { Get-Content ${psQuote(errFile)} -Raw -ErrorAction SilentlyContinue } else { '' }
[PSCustomObject]@{ exitCode = $proc.ExitCode; stdout = $stdout; stderr = $stderr } | ConvertTo-Json -Compress
`.trim();

  try {
    const result = await runPowerShell(outerScript, { timeoutMs: timeoutMs + 15_000 });
    if (result.timedOut) {
      return { ok: false, content: "⏱ Délai dépassé pendant l'élévation administrateur." };
    }
    if (result.code !== 0) {
      return {
        ok: false,
        content: `Élévation refusée ou échouée (UAC annulé, ou erreur) : ${result.stderr || result.stdout || 'raison inconnue'}`,
      };
    }
    const parsed = JSON.parse(result.stdout || '{}') as {
      exitCode: number;
      stdout: string;
      stderr: string;
    };
    return formatResult({
      code: parsed.exitCode ?? null,
      signal: null,
      stdout: parsed.stdout ?? '',
      stderr: parsed.stderr ?? '',
      timedOut: false,
      truncated: false,
    });
  } catch (error) {
    return { ok: false, content: `Échec de l'élévation administrateur : ${describeError(error)}` };
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => undefined);
  }
}

async function executeElevatedPosix(
  command: string,
  args: string[],
  cwd: string,
  timeoutMs: number,
): Promise<{ ok: boolean; content: string; data?: unknown }> {
  // `-n` refuse toute invite de mot de passe : jamais de blocage silencieux en
  // attente d'une saisie que Jarvis ne pourrait pas fournir.
  const result = await run('sudo', ['-n', command, ...args], { cwd, timeoutMs });
  if (result.code === 1 && /password is required|a password is required/i.test(result.stderr)) {
    return {
      ok: false,
      content:
        'Élévation impossible : sudo exige un mot de passe et Jarvis ne peut pas le fournir de façon non interactive. Configure `sudo NOPASSWD` pour cette commande, ou exécute-la manuellement dans un terminal.',
    };
  }
  return formatResult(result);
}

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
