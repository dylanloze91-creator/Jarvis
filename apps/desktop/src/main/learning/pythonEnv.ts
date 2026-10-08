import { access } from 'node:fs/promises';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { constants } from 'node:fs';

export interface PythonEnvResult {
  ok: boolean;
  error?: string;
  python?: string;
}

const ML_CHECK = [
  'import torch, peft, transformers, trl, datasets, bitsandbytes',
  'print("OK")',
].join('; ');

const PIP_PACKAGES = [
  'peft',
  'transformers',
  'trl',
  'datasets',
  'accelerate',
  'bitsandbytes',
  'sentencepiece',
  'protobuf',
];

function venvPython(venvRoot: string): string {
  return process.platform === 'win32'
    ? join(venvRoot, 'Scripts', 'python.exe')
    : join(venvRoot, 'bin', 'python');
}

async function exists(path: string): Promise<boolean> {
  try {
    await access(path, constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

function run(
  program: string,
  args: string[],
  options?: { cwd?: string; timeoutMs?: number },
): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    const child = spawn(program, args, {
      cwd: options?.cwd,
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
      env: { ...process.env, PIP_DISABLE_PIP_VERSION_CHECK: '1' },
    });
    let stdout = '';
    let stderr = '';
    child.stdout?.on('data', (c) => {
      stdout += String(c);
    });
    child.stderr?.on('data', (c) => {
      stderr += String(c);
    });
    const timer =
      options?.timeoutMs && options.timeoutMs > 0
        ? setTimeout(() => {
            child.kill();
          }, options.timeoutMs)
        : null;
    child.on('error', () => {
      if (timer) clearTimeout(timer);
      resolve({ code: 127, stdout, stderr });
    });
    child.on('close', (code) => {
      if (timer) clearTimeout(timer);
      resolve({ code: code ?? 1, stdout, stderr });
    });
  });
}

/** Interpréteur système pour créer le venv (Windows : py -3 en priorité). */
export async function resolveSystemPython(): Promise<string | null> {
  const candidates: Array<[string, string[]]> =
    process.platform === 'win32'
      ? [
          ['py', ['-3']],
          ['python', []],
          ['python3', []],
        ]
      : [
          ['python3', []],
          ['python', []],
        ];
  for (const [program, extra] of candidates) {
    const probe = await run(program, [...extra, '-c', 'import sys; print(sys.executable)'], {
      timeoutMs: 15_000,
    });
    if (probe.code === 0 && probe.stdout.trim()) return probe.stdout.trim();
  }
  return null;
}

async function ensureVenv(userData: string): Promise<PythonEnvResult> {
  const venvRoot = join(userData, 'learning', 'venv');
  const py = venvPython(venvRoot);
  if (await exists(py)) return { ok: true, python: py };

  const system = await resolveSystemPython();
  if (!system) {
    return {
      ok: false,
      error: 'Python introuvable sur ce PC (requis une fois pour l’apprentissage local).',
    };
  }

  const created = await run(system, ['-m', 'venv', venvRoot], { timeoutMs: 120_000 });
  if (created.code !== 0 || !(await exists(py))) {
    return {
      ok: false,
      error: 'Impossible de créer l’environnement Python local pour l’apprentissage.',
    };
  }
  return { ok: true, python: py };
}

async function mlDepsPresent(python: string): Promise<boolean> {
  const probe = await run(python, ['-c', ML_CHECK], { timeoutMs: 60_000 });
  return probe.code === 0 && probe.stdout.includes('OK');
}

async function pipInstall(
  python: string,
  args: string[],
  timeoutMs: number,
): Promise<{ ok: boolean; detail: string }> {
  const result = await run(python, ['-m', 'pip', 'install', ...args], { timeoutMs });
  if (result.code === 0) return { ok: true, detail: '' };
  const detail = (result.stderr || result.stdout).trim().slice(0, 400);
  return { ok: false, detail: detail || `pip (${result.code})` };
}

/**
 * Installe torch (CUDA si possible) puis peft/trl/etc. dans le venv utilisateur.
 * Tout reste sous userData ; aucune question à l’utilisateur.
 */
export async function ensureLearningPythonDeps(
  userData: string,
  onPhase?: (message: string) => void,
): Promise<PythonEnvResult> {
  const venv = await ensureVenv(userData);
  if (!venv.ok || !venv.python) return venv;

  if (await mlDepsPresent(venv.python)) {
    return { ok: true, python: venv.python };
  }

  onPhase?.('Préparation de l’apprentissage local (bibliothèques Python)…');

  const pip = await pipInstall(
    venv.python,
    ['--upgrade', 'pip', 'wheel', 'setuptools'],
    300_000,
  );
  if (!pip.ok) {
    return { ok: false, error: `Installation pip : ${pip.detail}` };
  }

  onPhase?.('Téléchargement de PyTorch (local)…');
  const torchArgs = [
    'torch',
    '--index-url',
    'https://download.pytorch.org/whl/cu124',
  ];
  let torch = await pipInstall(venv.python, torchArgs, 1_800_000);
  if (!torch.ok) {
    onPhase?.('Repli PyTorch CPU (local)…');
    torch = await pipInstall(
      venv.python,
      ['torch', '--index-url', 'https://download.pytorch.org/whl/cpu'],
      1_800_000,
    );
  }
  if (!torch.ok) {
    return { ok: false, error: `PyTorch : ${torch.detail}` };
  }

  onPhase?.('Téléchargement peft, trl, bitsandbytes…');
  const libs = await pipInstall(venv.python, PIP_PACKAGES, 1_800_000);
  if (!libs.ok) {
    return { ok: false, error: `Bibliothèques ML : ${libs.detail}` };
  }

  if (!(await mlDepsPresent(venv.python))) {
    return { ok: false, error: 'Les bibliothèques Python n’ont pas pu être vérifiées.' };
  }

  return { ok: true, python: venv.python };
}

export function learningPythonForTrain(
  userData: string,
  depsReady: boolean,
): string | undefined {
  if (!depsReady) return process.env.JARVIS_PYTHON;
  const py = venvPython(join(userData, 'learning', 'venv'));
  return py;
}
