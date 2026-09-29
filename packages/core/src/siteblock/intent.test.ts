import { describe, expect, it } from 'vitest';
import { extractSiteBlockIntent } from './intent.js';

describe('extractSiteBlockIntent', () => {
  it('planifie « active mon mode travail » vers une session de concentration', () => {
    expect(extractSiteBlockIntent('active mon mode travail')).toEqual({
      tool: 'siteblock_start_focus',
      args: { minutes: 60 },
    });
  });

  it('lit la durée « pendant 90 minutes »', () => {
    expect(extractSiteBlockIntent('active mon mode travail pendant 90 minutes')).toEqual({
      tool: 'siteblock_start_focus',
      args: { minutes: 90 },
    });
  });

  it('bloque Instagram par son domaine', () => {
    expect(extractSiteBlockIntent('bloque Instagram')).toEqual({
      tool: 'siteblock_add_domain',
      args: { domain: 'instagram.com' },
    });
  });

  it('bloque TikTok pendant 1 heure via le mode concentration', () => {
    expect(extractSiteBlockIntent('bloque TikTok pendant 1 heure')).toEqual({
      tool: 'siteblock_start_focus',
      args: { minutes: 60, domains: ['tiktok.com'] },
    });
  });

  it('liste les sites bloqués', () => {
    expect(extractSiteBlockIntent('quels sites sont bloqués ?')).toEqual({
      tool: 'siteblock_get_status',
      args: {},
    });
  });

  it('débloque Instagram', () => {
    expect(extractSiteBlockIntent('débloque Instagram')).toEqual({
      tool: 'siteblock_remove_domain',
      args: { domain: 'instagram.com' },
    });
  });

  it('débloque YouTube (« autorise à nouveau »)', () => {
    expect(extractSiteBlockIntent('autorise à nouveau YouTube')).toEqual({
      tool: 'siteblock_remove_domain',
      args: { domain: 'youtube.com' },
    });
  });

  it('programme un créneau de 9h à 12h', () => {
    expect(extractSiteBlockIntent('programme le blocage de 9h à 12h')).toEqual({
      tool: 'siteblock_add_period',
      args: { start: '09:00', end: '12:00', name: 'Jarvis' },
    });
  });

  it('désactive le blocage global', () => {
    expect(extractSiteBlockIntent('désactive le blocage')).toEqual({
      tool: 'siteblock_set_blocking',
      args: { enabled: false },
    });
  });

  it('n’intercepte pas une ouverture d’application ni Spotify', () => {
    expect(extractSiteBlockIntent('Lance Chrome')).toBeNull();
    expect(extractSiteBlockIntent('Lance Spotify')).toBeNull();
    expect(extractSiteBlockIntent('écouter On Verra de Nekfeu')).toBeNull();
  });
});
