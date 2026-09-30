import { appendFile, mkdir, rename, stat } from 'node:fs/promises';
import { dirname } from 'node:path';
import { redactSecrets } from '@jarvis/core';

const MAX_LINE = 600;

/** Ligne sûre : secrets masqués, sauts de ligne et caractères de contrôle retirés, longueur bornée. */
export function sanitizeCaptureLogLine(line: string): string {
  // eslint-disable-next-line no-control-regex -- on retire justement les caractères de contrôle.
  const flat = redactSecrets(line).replace(/[\u0000-\u001f\u007f]+/g, ' ').trim();
  return flat.length > MAX_LINE ? `${flat.slice(0, MAX_LINE - 1)}…` : flat;
}

/**
 * Journal de capture du micro (durées de chaque étape, erreurs exactes) :
 * console du processus principal et `userData/logs/voice-capture.log`,
 * limité à ~256 Ko (l'ancien passe en `.1`).
 */
export class VoiceCaptureLog {
  private queue: Promise<void> = Promise.resolve();

  constructor(
    private readonly filePath: () => string,
    private readonly maxBytes = 256_000,
    private readonly print: (line: string) => void = (line) => console.log(line),
  ) {}

  append(raw: string): void {
    const line = sanitizeCaptureLogLine(raw);
    if (!line) return;
    const stamped = `${new Date().toISOString()} ${line}`;
    this.print(`[jarvis:voix] ${line}`);
    this.queue = this.queue.then(() => this.write(stamped)).catch(() => undefined);
  }

  flush(): Promise<void> {
    return this.queue;
  }

  private async write(line: string): Promise<void> {
    const file = this.filePath();
    await mkdir(dirname(file), { recursive: true });
    try {
      if ((await stat(file)).size > this.maxBytes) await rename(file, `${file}.1`);
    } catch {
      // Premier écrit : pas encore de fichier.
    }
    await appendFile(file, `${line}\n`, 'utf8');
  }
}
