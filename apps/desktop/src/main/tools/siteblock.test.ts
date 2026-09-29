import { describe, expect, it, vi } from 'vitest';
import { requiresConfirmation, type ToolContext } from '@jarvis/core';
import { createSiteBlockTools } from './siteblock.js';
import type { SiteBlockBridge, SiteBlockStatus } from '../siteblock/SiteBlockBridge.js';

function fakeStatus(overrides: Partial<SiteBlockStatus> = {}): SiteBlockStatus {
  return {
    ok: true,
    blockingEnabled: true,
    blockingActiveNow: true,
    status: 'active',
    enforcement: 'hosts',
    domains: ['instagram.com'],
    periods: [],
    focus: { active: true, until: '2026-09-24T22:00:00.000Z' },
    lockout: { active: false, until: null, minutes: 0 },
    ...overrides,
  };
}

function fakeBridge(overrides: Partial<SiteBlockBridge> = {}): SiteBlockBridge {
  return {
    status: vi.fn(async () => fakeStatus()),
    setBlocking: vi.fn(async (enabled: boolean) =>
      fakeStatus({ blockingActiveNow: enabled, blockingEnabled: enabled }),
    ),
    addDomain: vi.fn(async () => fakeStatus()),
    removeDomain: vi.fn(async () => fakeStatus({ domains: [] })),
    startFocus: vi.fn(async () => fakeStatus()),
    stopFocus: vi.fn(async () => fakeStatus({ focus: { active: false, until: null } })),
    addPeriod: vi.fn(async () => fakeStatus()),
    removePeriod: vi.fn(async () => fakeStatus()),
    connectionStatus: vi.fn(async () => ({ configured: true, reachable: true })),
    ...overrides,
  } as unknown as SiteBlockBridge;
}

function fakeContext(): ToolContext {
  return { requestConfirmation: async () => true };
}

describe('createSiteBlockTools', () => {
  it('déclare huit outils : lecture safe, mutations confirm + forceConfirm', () => {
    const tools = createSiteBlockTools({ siteBlock: fakeBridge() });
    expect(tools.map((tool) => tool.name)).toEqual([
      'siteblock_get_status',
      'siteblock_set_blocking',
      'siteblock_add_domain',
      'siteblock_remove_domain',
      'siteblock_start_focus',
      'siteblock_stop_focus',
      'siteblock_add_period',
      'siteblock_remove_period',
    ]);

    expect(tools[0]?.risk).toBe('safe');
    expect(tools[0]?.forceConfirm).toBe(false);
    for (const tool of tools.slice(1)) {
      expect(tool.risk).toBe('confirm');
      expect(tool.forceConfirm).toBe(true);
      expect(tool.category).toBe('apps');
      expect(
        requiresConfirmation(tool, {}, {
          apps: 'never',
          files: 'never',
          capture: 'never',
          shell: 'never',
        }),
      ).toBe(true);
    }
  });

  it('siteblock_start_focus appelle le pont avec la durée demandée', async () => {
    const siteBlock = fakeBridge();
    const tools = createSiteBlockTools({ siteBlock });
    const tool = tools.find((item) => item.name === 'siteblock_start_focus')!;

    const result = await tool.run({ minutes: 90, domains: ['tiktok.com'] }, fakeContext());

    expect(siteBlock.startFocus).toHaveBeenCalledWith(90, ['tiktok.com']);
    expect(result.ok).toBe(true);
    expect(result.content).toContain('90 minutes');
  });

  it('refuse un horaire invalide pour une période', async () => {
    const tools = createSiteBlockTools({ siteBlock: fakeBridge() });
    const tool = tools.find((item) => item.name === 'siteblock_add_period')!;
    const result = await tool.run({ start: '9h', end: '25:00' }, fakeContext());
    expect(result.ok).toBe(false);
    expect(result.content).toMatch(/Arguments invalides/);
  });

  it('propage une erreur du pont sans prétendre que le blocage a changé', async () => {
    const siteBlock = fakeBridge({
      addDomain: vi.fn(async () => {
        throw new Error('Impossible de joindre SiteBlock. Vérifie que SiteBlock est lancé sur ce PC.');
      }),
    });
    const tools = createSiteBlockTools({ siteBlock });
    const tool = tools.find((item) => item.name === 'siteblock_add_domain')!;
    const result = await tool.run({ domain: 'instagram.com' }, fakeContext());
    expect(result.ok).toBe(false);
    expect(result.content).toContain('Impossible de joindre SiteBlock');
  });
});
