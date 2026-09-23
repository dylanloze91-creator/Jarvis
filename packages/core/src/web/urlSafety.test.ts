import { describe, expect, it } from 'vitest';
import { checkUrlSafety, isPrivateIpAddress } from './urlSafety.js';

describe('checkUrlSafety', () => {
  it('autorise une adresse publique classique', () => {
    expect(checkUrlSafety('https://fr.wikipedia.org/wiki/Nvidia')).toEqual({ allowed: true });
  });

  it('refuse une URL invalide', () => {
    expect(checkUrlSafety('pas une url').allowed).toBe(false);
  });

  it('refuse les protocoles autres que http/https', () => {
    const result = checkUrlSafety('file:///etc/passwd');
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain('Protocole');
  });

  it('refuse localhost et ses variantes', () => {
    expect(checkUrlSafety('http://localhost/api').allowed).toBe(false);
    expect(checkUrlSafety('http://127.0.0.1:8080').allowed).toBe(false);
    expect(checkUrlSafety('http://[::1]/').allowed).toBe(false);
  });

  it('refuse les plages privées classiques', () => {
    expect(checkUrlSafety('http://10.0.0.5/').allowed).toBe(false);
    expect(checkUrlSafety('http://192.168.1.1/').allowed).toBe(false);
    expect(checkUrlSafety('http://172.16.0.1/').allowed).toBe(false);
    expect(checkUrlSafety('http://169.254.169.254/latest/meta-data').allowed).toBe(false);
  });

  it('refuse les domaines internes', () => {
    expect(checkUrlSafety('http://printer.local/').allowed).toBe(false);
    expect(checkUrlSafety('http://intranet.internal/').allowed).toBe(false);
  });

  it('accepte une adresse IPv4 publique', () => {
    expect(checkUrlSafety('http://93.184.216.34/').allowed).toBe(true);
  });
});

describe('isPrivateIpAddress', () => {
  it('détecte les plages IPv4 privées', () => {
    expect(isPrivateIpAddress('10.1.2.3')).toBe(true);
    expect(isPrivateIpAddress('172.31.0.1')).toBe(true);
    expect(isPrivateIpAddress('192.168.0.1')).toBe(true);
    expect(isPrivateIpAddress('127.0.0.1')).toBe(true);
    expect(isPrivateIpAddress('100.64.0.1')).toBe(true);
  });

  it('détecte les plages IPv6 privées et de lien local', () => {
    expect(isPrivateIpAddress('::1')).toBe(true);
    expect(isPrivateIpAddress('fe80::1')).toBe(true);
    expect(isPrivateIpAddress('fd00::1')).toBe(true);
  });

  it('laisse passer les adresses publiques', () => {
    expect(isPrivateIpAddress('8.8.8.8')).toBe(false);
    expect(isPrivateIpAddress('2001:4860:4860::8888')).toBe(false);
  });
});
