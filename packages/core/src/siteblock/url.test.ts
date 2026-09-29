import { describe, expect, it } from 'vitest';
import { checkSiteBlockBaseUrl, DEFAULT_SITEBLOCK_BASE_URL } from './url.js';

describe('checkSiteBlockBaseUrl', () => {
  it('accepte le défaut loopback', () => {
    expect(checkSiteBlockBaseUrl(DEFAULT_SITEBLOCK_BASE_URL)).toEqual({
      ok: true,
      origin: DEFAULT_SITEBLOCK_BASE_URL,
    });
  });

  it('accepte localhost et ::1', () => {
    expect(checkSiteBlockBaseUrl('http://localhost:18741').ok).toBe(true);
    expect(checkSiteBlockBaseUrl('http://[::1]:18741').ok).toBe(true);
  });

  it('refuse une adresse distante ou un autre protocole', () => {
    expect(checkSiteBlockBaseUrl('https://example.com').ok).toBe(false);
    expect(checkSiteBlockBaseUrl('http://192.168.1.10:18741').ok).toBe(false);
    expect(checkSiteBlockBaseUrl('file:///etc/hosts').ok).toBe(false);
  });
});
