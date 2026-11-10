import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { SPEAKER_CHRONO_MEMORY, sanitizeChronoSample, type SpeakerChronoSample } from '@jarvis/core';

/** `userData/logs/enceinte-chrono.jsonl` : durées seulement. */
export class SpeakerChronoFile {
  constructor(private readonly filePath: () => string) {}

  async readLast(): Promise<SpeakerChronoSample[]> {
    let raw = '';
    try {
      raw = await readFile(this.filePath(), 'utf8');
    } catch {
      return [];
    }
    const samples: SpeakerChronoSample[] = [];
    for (const line of raw.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      try {
        samples.push(sanitizeChronoSample(JSON.parse(trimmed) as SpeakerChronoSample));
      } catch {
        // Ligne illisible : on passe.
      }
    }
    return samples.slice(-SPEAKER_CHRONO_MEMORY);
  }

  append(line: string): void {
    void this.write(line).catch(() => undefined);
  }

  clear(): void {
    void rm(this.filePath(), { force: true }).catch(() => undefined);
  }

  private async write(line: string): Promise<void> {
    const file = this.filePath();
    await mkdir(dirname(file), { recursive: true });
    const previous = await readFile(file, 'utf8').catch(() => '');
    const lines = previous.split('\n').filter((item) => item.trim().length > 0);
    lines.push(line);
    const kept = lines.slice(-SPEAKER_CHRONO_MEMORY);
    await writeFile(file, `${kept.join('\n')}\n`, 'utf8');
  }
}
