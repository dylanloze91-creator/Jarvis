import { spawn, type ChildProcessByStdio } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Readable, Writable } from 'node:stream';
import { normalizePiperStdinText } from '@jarvis/core';
import type { PiperRunRequest, PiperRunner } from './runner.js';

/**
 * Piper 2023.11.14-2, un processus par voix.
 *
 * `--output_raw` existe (README, « Streaming Audio ») mais le PCM brut n'a
 * aucune marque de fin entre deux phrases tant que le processus reste ouvert :
 * on ne peut pas savoir où s'arrête l'audio. `--json-input` lit une ligne JSON
 * à la fois et, avec `output_file`, écrit le WAV puis affiche son chemin sur
 * la sortie standard avant de lire la ligne suivante
 * (`src/cpp/main.cpp` de l'étiquette 2023.11.14-2, `cout << outputPath`).
 * Le modèle reste chargé. Texte sur stdin, jamais en argument.
 *
 * https://github.com/rhasspy/piper/blob/2023.11.14-2/README.md
 * https://github.com/rhasspy/piper/blob/2023.11.14-2/src/cpp/main.cpp
 */

type PiperChild = ChildProcessByStdio<Writable, Readable, Readable>;

interface Slot {
  child: PiperChild;
  queue: Promise<void>;
  dead: boolean;
}

const SENTENCE_TIMEOUT_MS = 30_000;

export class ResidentPiper {
  private readonly slots = new Map<string, Slot>();
  private readonly spawnProcess: typeof spawn;

  constructor(
    private readonly deps: {
      fallback: PiperRunner;
      spawnProcess?: typeof spawn;
    },
  ) {
    this.spawnProcess = deps.spawnProcess ?? spawn;
  }

  /** Lance le processus (le modèle se charge avant la première ligne). */
  prepare(request: PiperRunRequest): void {
    this.ensure(request, false);
  }

  async synthesize(request: PiperRunRequest): Promise<Uint8Array> {
    try {
      return await this.ask(request, false);
    } catch {
      this.drop(request);
      try {
        return await this.ask(request, true);
      } catch {
        this.drop(request);
        return this.deps.fallback.synthesize(request);
      }
    }
  }

  async stop(): Promise<void> {
    const slots = [...this.slots.values()];
    this.slots.clear();
    await Promise.all(slots.map((slot) => this.end(slot)));
  }

  private key(request: PiperRunRequest): string {
    return `${request.modelPath}\0${request.voice.id}\0${request.voice.speaker}`;
  }

  private drop(request: PiperRunRequest): void {
    const key = this.key(request);
    const slot = this.slots.get(key);
    if (!slot) return;
    this.slots.delete(key);
    void this.end(slot);
  }

  private ensure(request: PiperRunRequest, relaunch: boolean): Slot {
    const key = this.key(request);
    const existing = this.slots.get(key);
    if (existing && !existing.dead && !relaunch) return existing;
    if (existing) {
      this.slots.delete(key);
      void this.end(existing);
    }
    const child = this.spawnProcess(
      request.binaryPath,
      [
        '--model',
        request.modelPath,
        '--json-input',
        '--espeak_data',
        request.espeakDataDir,
        '--speaker',
        String(request.voice.speaker),
        '--quiet',
      ],
      {
        cwd: join(request.binaryPath, '..'),
        stdio: ['pipe', 'pipe', 'pipe'],
        windowsHide: true,
      },
    ) as PiperChild;
    const slot: Slot = { child, queue: Promise.resolve(), dead: false };
    child.stderr.on('data', () => undefined);
    child.on('error', () => {
      slot.dead = true;
    });
    child.on('exit', () => {
      slot.dead = true;
    });
    this.slots.set(key, slot);
    return slot;
  }

  private ask(request: PiperRunRequest, relaunch: boolean): Promise<Uint8Array> {
    const slot = this.ensure(request, relaunch);
    const run = slot.queue.then(() => this.once(slot, request));
    slot.queue = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }

  private once(slot: Slot, request: PiperRunRequest): Promise<Uint8Array> {
    if (slot.dead || slot.child.exitCode !== null) {
      slot.dead = true;
      return Promise.reject(new Error('Piper s’est arrêté.'));
    }
    const text = normalizePiperStdinText(request.text);
    if (!text) return Promise.reject(new Error('Texte vide après normalisation.'));
    const outputPath = join(tmpdir(), `jarvis-piper-${randomBytes(6).toString('hex')}.wav`);
    const payload = `${JSON.stringify({
      text,
      speaker_id: request.voice.speaker,
      output_file: outputPath,
    })}\n`;
    return new Promise((resolve, reject) => {
      let settled = false;
      const fail = (error: Error): void => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        slot.child.stdout.off('data', onData);
        slot.dead = true;
        reject(error);
      };
      const timer = setTimeout(() => {
        slot.child.kill('SIGKILL');
        fail(new Error('La synthèse Piper a dépassé le délai.'));
      }, request.timeoutMs ?? SENTENCE_TIMEOUT_MS);
      let buffer = '';
      const onData = (chunk: Buffer | string): void => {
        buffer += typeof chunk === 'string' ? chunk : chunk.toString('utf8');
        const newline = buffer.indexOf('\n');
        if (newline < 0) return;
        const announced = buffer.slice(0, newline).trim() || outputPath;
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        slot.child.stdout.off('data', onData);
        void readFile(announced)
          .then((bytes) => {
            void rm(outputPath, { force: true }).catch(() => undefined);
            resolve(new Uint8Array(bytes));
          })
          .catch((error: unknown) => {
            slot.dead = true;
            reject(error instanceof Error ? error : new Error(String(error)));
          });
      };
      slot.child.stdout.on('data', onData);
      slot.child.once('exit', () => {
        if (!settled) fail(new Error('Piper s’est arrêté.'));
      });
      slot.child.stdin.write(payload, (error) => {
        if (error) fail(error);
      });
    });
  }

  private end(slot: Slot): Promise<void> {
    slot.dead = true;
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        slot.child.kill('SIGKILL');
        resolve();
      }, 400);
      slot.child.once('exit', () => {
        clearTimeout(timer);
        resolve();
      });
      slot.child.stdin.end();
    });
  }
}
