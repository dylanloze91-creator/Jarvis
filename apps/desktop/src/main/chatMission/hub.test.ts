import { describe, expect, it, vi } from 'vitest';
import { parseSettings } from '@jarvis/core';
import type { DeveloperController } from '../developer/controller.js';
import { ChatMissionHub } from './hub.js';

function settingsWithCodeModel() {
  const base = parseSettings({});
  return { ...base, developer: { ...base.developer, enabled: true, codeModel: 'qwen2.5-coder:7b' } };
}

function fakeDeveloper(options: { busy?: () => boolean } = {}) {
  let next = 1;
  const startMission = vi.fn(async () => ({ mission: { id: `m${next++}`, status: 'running' } }));
  const developer = {
    startMission,
    state: () => ({ mission: options.busy?.() ? { id: 'autre', status: 'running' } : null }),
  } as unknown as DeveloperController;
  return { developer, startMission };
}

describe('ChatMissionHub.launchProposal', () => {
  it('un double clic ne lance qu’une seule mission', async () => {
    const { developer, startMission } = fakeDeveloper();
    const hub = new ChatMissionHub({ getSettings: settingsWithCodeModel, developer: () => developer });
    const { payload } = hub.recordProposal({ type: 'modifier', objectif: 'Ajouter un bouton Exporter' });

    const [first, second] = await Promise.all([
      hub.launchProposal(payload.proposalId, 'jarvis'),
      hub.launchProposal(payload.proposalId, 'jarvis'),
    ]);

    expect(startMission).toHaveBeenCalledTimes(1);
    expect([first.ok, second.ok].sort()).toEqual([false, true]);
    const refused = first.ok ? second : first;
    expect(refused.ok ? '' : refused.notice).toMatch(/déjà lancée/);
  });

  it('refuse si une autre mission a démarré entre la proposition et le clic', async () => {
    let busy = false;
    const { developer, startMission } = fakeDeveloper({ busy: () => busy });
    const hub = new ChatMissionHub({ getSettings: settingsWithCodeModel, developer: () => developer });
    const { payload } = hub.recordProposal({ type: 'corriger', objectif: 'Corriger le calcul du total' });

    busy = true;
    const result = await hub.launchProposal(payload.proposalId, 'jarvis');

    expect(result.ok).toBe(false);
    expect(result.ok ? '' : result.notice).toMatch(/déjà en cours/);
    expect(startMission).not.toHaveBeenCalled();
    // La carte reste lançable une fois l'autre mission finie.
    busy = false;
    expect((await hub.launchProposal(payload.proposalId, 'jarvis')).ok).toBe(true);
  });

  it('une proposition refusée ne se lance plus', async () => {
    const { developer, startMission } = fakeDeveloper();
    const hub = new ChatMissionHub({ getSettings: settingsWithCodeModel, developer: () => developer });
    const { payload } = hub.recordProposal({ type: 'documenter', objectif: 'Documenter la voix Piper' });

    hub.declineProposal(payload.proposalId);
    const result = await hub.launchProposal(payload.proposalId, 'jarvis');

    expect(result.ok).toBe(false);
    expect(startMission).not.toHaveBeenCalled();
  });
});
