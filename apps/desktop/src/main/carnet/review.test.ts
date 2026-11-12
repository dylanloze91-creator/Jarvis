import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { entryFromDetection } from '@jarvis/core';
import { CarnetFile } from './file.js';
import { CarnetHub } from './hub.js';

/**
 * Revue et interrupteur. Phrases synthétiques marquées synthetique-test.
 * La phrase du dimanche a speak: false : elle n'est pas dite.
 */
const dirs: string[] = [];

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function temp(): string {
  const dir = mkdtempSync(join(tmpdir(), 'jarvis-carnet-revue-'));
  dirs.push(dir);
  return dir;
}

describe('carnet — revue sur le PC (synthetique-test)', () => {
  it('synthetique-test Test note, Live est coupé, le dimanche ne se dit pas', async () => {
    const sunday = new Date(2026, 10, 15, 12, 0, 0);
    const dir = temp();
    const file = new CarnetFile(() => dir);
    const test = new CarnetHub('test', file);
    await file.append(
      entryFromDetection({
        id: 'rate-1',
        at: sunday.getTime() - 60_000,
        edition: 'test',
        place: { kind: 'fenetre' },
        conversationId: 'conv',
        detection: {
          type: 'correction',
          rule: 'correction-classify',
          userText: 'Non, c’est faux',
          replyText: 'Il est 3 heures.',
          team: null,
          model: null,
          how: null,
          tools: [],
          durations: {},
        },
      }),
    );
    const first = await test.view(sunday);
    expect(first.settings.enabled).toBe(true);
    expect(first.groups).toHaveLength(1);
    expect(first.sunday).toMatchObject({
      speak: false,
      text: "Cette semaine, j'ai noté 1 raté. Tu veux les voir ?",
    });
    await test.acknowledgeSunday(first.sunday!.day);
    expect((await test.view(sunday)).sunday).toBeNull();

    const liveDir = temp();
    const live = new CarnetHub('live', new CarnetFile(() => liveDir));
    expect(live.enabled()).toBe(false);
    await live.updateSettings({ enabled: true });
    expect(live.enabled()).toBe(true);
    const saved = JSON.parse(readFileSync(join(liveDir, 'carnet', 'reglages.json'), 'utf8')) as {
      enabled: boolean;
    };
    expect(saved.enabled).toBe(true);

    await test.dismiss(['rate-1']);
    const after = await test.view(sunday);
    expect(after.groups).toEqual([]);
    expect(after.falseAlarms['correction-classify']).toBe(1);
  });
});
