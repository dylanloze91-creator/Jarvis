import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseSettings } from '@jarvis/core';
import { VALIDATION_FILE } from '@jarvis/core/trieur/validation';
import { appendTeamValidation, canOfferTeamValidation } from './teamValidation.js';

describe('validation en direct des équipes', () => {
  it('reste inactive sans dossier ni interrupteur', () => {
    const settings = parseSettings({
      orchestra: { enabled: true, brain: 'qwen2.5:7b', teamValidation: true },
    });
    expect(canOfferTeamValidation(settings)).toBe(false);
  });

  it('écrit valide.jsonl quand le dossier est configuré', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'jarvis-valide-'));
    const settings = parseSettings({
      orchestra: {
        enabled: true,
        brain: 'qwen2.5:7b',
        trieurDataDir: dir,
        teamValidation: true,
      },
    });
    expect(canOfferTeamValidation(settings)).toBe(true);
    const result = await appendTeamValidation(settings, {
      phrase: 'Ouvre Chrome',
      context: 'Demande : Ouvre Chrome\nÉquipe :',
      proposedTeam: 'pc',
      chosenTeam: 'pc',
      path: 'express',
    });
    expect(result).toEqual({ ok: true });
    const raw = await readFile(join(dir, VALIDATION_FILE), 'utf8');
    const line = JSON.parse(raw.trim());
    expect(line.statut).toBe('confirme');
    expect(line.equipe).toBe('pc');
    expect(line.phrase).toBe('Ouvre Chrome');
  });

  it('marque une correction', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'jarvis-valide-'));
    const settings = parseSettings({
      orchestra: {
        enabled: true,
        brain: 'qwen2.5:7b',
        trieurDataDir: dir,
        teamValidation: true,
      },
    });
    await appendTeamValidation(settings, {
      phrase: 'Cherche sur le web',
      context: 'Demande : Cherche sur le web\nÉquipe :',
      proposedTeam: 'web',
      chosenTeam: 'google',
      path: 'cerveau',
    });
    const raw = await readFile(join(dir, VALIDATION_FILE), 'utf8');
    expect(JSON.parse(raw.trim()).statut).toBe('corrige');
  });
});
