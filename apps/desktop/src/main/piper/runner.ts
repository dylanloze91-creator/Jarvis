import { spawn } from 'node:child_process';
import { readFile, rm, writeFile } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { normalizePiperStdinText, type PiperVoiceDefinition } from '@jarvis/core';

export interface PiperRunRequest {
  binaryPath: string;
  modelPath: string;
  espeakDataDir: string;
  voice: PiperVoiceDefinition;
  text: string;
  timeoutMs?: number;
}

export interface PiperRunner {
  synthesize(request: PiperRunRequest): Promise<Uint8Array>;
}

const DEFAULT_TIMEOUT_MS = 120_000;

function writeStdinSafely(
  child: ReturnType<typeof spawn>,
  payload: string,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const stdin = child.stdin;
    if (!stdin) {
      reject(new Error('Entrée standard Piper indisponible.'));
      return;
    }
    let settled = false;
    const finish = (error?: Error): void => {
      if (settled) return;
      settled = true;
      if (error) reject(error);
      else resolve();
    };
    const onError = (error: Error): void => {
      finish(error);
    };
    stdin.on('error', onError);
    try {
      stdin.write(payload, 'utf8', (writeError) => {
        if (writeError) {
          finish(writeError);
          return;
        }
        stdin.end((endError: Error | null | undefined) => {
          if (endError) finish(endError);
          else finish();
        });
      });
    } catch (error) {
      finish(error instanceof Error ? error : new Error(String(error)));
    }
  });
}

/** Lance le binaire Piper précompilé : texte sur l'entrée standard, jamais en argument. */
export class ProcessPiperRunner implements PiperRunner {
  async synthesize(request: PiperRunRequest): Promise<Uint8Array> {
    const stamp = randomBytes(6).toString('hex');
    const outputPath = join(tmpdir(), `jarvis-piper-${stamp}.wav`);
    try {
      await this.runProcess(request, outputPath);
      return new Uint8Array(await readFile(outputPath));
    } finally {
      await rm(outputPath, { force: true }).catch(() => undefined);
    }
  }

  private runProcess(request: PiperRunRequest, outputPath: string): Promise<void> {
    const line = normalizePiperStdinText(request.text);
    if (!line) return Promise.reject(new Error('Texte vide après normalisation.'));
    const args = [
      '--model',
      request.modelPath,
      '--output_file',
      outputPath,
      '--speaker',
      String(request.voice.speaker),
      '--espeak_data',
      request.espeakDataDir,
      '--quiet',
    ];
    return new Promise((resolve, reject) => {
      const child = spawn(request.binaryPath, args, {
        cwd: join(request.binaryPath, '..'),
        stdio: ['pipe', 'ignore', 'pipe'],
        windowsHide: true,
      });
      let stderr = '';
      let stdinSettled = false;
      child.stderr.setEncoding('utf8');
      child.stderr.on('data', (chunk: string) => {
        stderr += chunk;
      });
      const timer = setTimeout(() => {
        child.kill('SIGKILL');
        reject(new Error('La synthèse Piper a dépassé le délai.'));
      }, request.timeoutMs ?? DEFAULT_TIMEOUT_MS);
      const fail = (error: Error): void => {
        clearTimeout(timer);
        reject(error);
      };
      child.on('error', (error) => {
        fail(error);
      });
      void writeStdinSafely(child, `${line}\n`).then(
        () => {
          stdinSettled = true;
        },
        (error: unknown) => {
          stdinSettled = true;
          child.kill('SIGKILL');
          fail(error instanceof Error ? error : new Error(String(error)));
        },
      );
      child.on('close', (code) => {
        clearTimeout(timer);
        if (!stdinSettled) {
          fail(new Error(`Piper s'est arrêté avant la fin de l'écriture stdin (code ${code}).`));
          return;
        }
        if (code === 0) resolve();
        else reject(new Error(`Piper a échoué (code ${code}) : ${stderr.trim().slice(0, 300) || 'erreur inconnue'}`));
      });
    });
  }
}

/** Retourne un WAV PCM mono minimal (silence) pour les tests sans binaire. */
export class FakePiperRunner implements PiperRunner {
  constructor(private readonly bytes: Uint8Array | (() => Uint8Array)) {}

  async synthesize(_request: PiperRunRequest): Promise<Uint8Array> {
    return typeof this.bytes === 'function' ? this.bytes() : this.bytes;
  }
}

/** Écrit le texte dans un fichier temporaire si besoin de tests d'intégration sans shell. */
export async function writeTempText(text: string): Promise<{ path: string; cleanup: () => Promise<void> }> {
  const stamp = randomBytes(6).toString('hex');
  const filePath = join(tmpdir(), `jarvis-piper-text-${stamp}.txt`);
  await writeFile(filePath, text, { encoding: 'utf8', mode: 0o600 });
  return {
    path: filePath,
    async cleanup() {
      await rm(filePath, { force: true }).catch(() => undefined);
    },
  };
}
