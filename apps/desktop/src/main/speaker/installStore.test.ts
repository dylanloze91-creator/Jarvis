import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { SpeakerStore } from './store.js';

function store(): { speakers: SpeakerStore; path: string } {
  const dir = mkdtempSync(join(tmpdir(), 'jarvis-enceintes-'));
  const path = join(dir, 'speakers.json');
  return { speakers: new SpeakerStore(() => path), path };
}

describe('enceinte en attente', () => {
  it('lit un ancien fichier et garde ses champs', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'jarvis-enceintes-'));
    const path = join(dir, 'speakers.json');
    const { writeFileSync } = await import('node:fs');
    writeFileSync(
      path,
      JSON.stringify({
        enabled: true,
        speakers: [{ id: 'ancienne', name: 'Chambre', createdAt: 10, tokenHash: 'ab'.repeat(32) }],
      }),
    );
    const kept = new SpeakerStore(() => path);
    await kept.load();
    expect(kept.speakers()).toEqual([{ id: 'ancienne', name: 'Chambre', createdAt: 10 }]);
    expect(kept.pcId).toMatch(/^[0-9a-f]{8}$/);
    expect(readFileSync(path, 'utf8')).not.toContain('pending');
  });

  it('retire l’entrée en attente si on abandonne', async () => {
    const { speakers, path } = store();
    const begun = await speakers.beginInstall('Salon', 'AA:BB:CC:DD:EE:FF');
    expect(begun.token).toMatch(/^[0-9a-f]{64}$/);
    expect(begun.replaced).toBe(false);
    expect(speakers.verify(begun.token)?.pending).toBe(true);
    const raw = readFileSync(path, 'utf8');
    expect(raw).not.toContain(begun.token);
    expect(await speakers.abandonInstall(begun.speaker.id)).toBe(true);
    expect(speakers.speakers()).toEqual([]);
    expect(speakers.verify(begun.token)).toBeNull();
  });

  it('le remplacement change la clé et l’ancienne est refusée seulement après confirmation', async () => {
    const { speakers } = store();
    const first = await speakers.beginInstall('Chambre', 'aa:bb:cc:dd:ee:ff');
    await speakers.commitInstall(first.speaker.id, '5.0.64');
    const again = await speakers.beginInstall('Autre', 'aa:bb:cc:dd:ee:ff');
    expect(again.replaced).toBe(true);
    expect(again.speaker.name).toBe('Chambre');
    expect(speakers.verify(first.token)?.id).toBe(first.speaker.id);
    expect(speakers.verify(again.token)?.id).toBe(first.speaker.id);
    await speakers.commitInstall(first.speaker.id, '5.0.75');
    expect(speakers.verify(first.token)).toBeNull();
    expect(speakers.verify(again.token)?.fw).toBe('5.0.75');
    expect(speakers.verify(again.token)?.pending).toBeFalsy();
  });
});
