import { describe, expect, it } from 'vitest';
import {
  PHONE_PORT,
  cleanDeviceName,
  parseTailscaleStatus,
  phoneAppUrl,
  phoneChatRequestSchema,
  phonePairRequestSchema,
  tailscaleServeCommand,
  tailscaleServesPort,
} from './phone.js';

describe('téléphone (5.0.63)', () => {
  it('lit tailscale status --json', () => {
    const raw = JSON.stringify({
      BackendState: 'Running',
      Self: { DNSName: 'pc-de-dylan.tail1a2b.ts.net.', Online: true, TailscaleIPs: ['100.101.102.103'] },
    });
    expect(parseTailscaleStatus(raw)).toEqual({ dnsName: 'pc-de-dylan.tail1a2b.ts.net', online: true, backendState: 'Running' });
    expect(parseTailscaleStatus(JSON.stringify({ BackendState: 'NeedsLogin', Self: { DNSName: '' } }))).toEqual({
      dnsName: null,
      online: false,
      backendState: 'NeedsLogin',
    });
    expect(parseTailscaleStatus('pas du json')).toEqual({ dnsName: null, online: false, backendState: null });
  });

  it('reconnaît la publication du port par tailscale serve', () => {
    const served = JSON.stringify({
      TCP: { '443': { HTTPS: true } },
      Web: { 'pc.tail.ts.net:443': { Handlers: { '/': { Proxy: 'http://127.0.0.1:53130' } } } },
    });
    expect(tailscaleServesPort(served)).toBe(true);
    expect(tailscaleServesPort(served.replace('53130', '531300'))).toBe(false);
    expect(tailscaleServesPort(JSON.stringify({ Web: { x: { Handlers: { '/': { Proxy: 'http://localhost:53130' } } } } }))).toBe(true);
    expect(tailscaleServesPort('{}')).toBe(false);
    expect(tailscaleServesPort('')).toBe(false);
  });

  it('adresse, commande et noms', () => {
    expect(PHONE_PORT).toBe(53130);
    expect(tailscaleServeCommand()).toBe('tailscale serve --bg 53130');
    expect(phoneAppUrl('pc.tail.ts.net.')).toBe('https://pc.tail.ts.net/');
    expect(phoneAppUrl('pc.tail.ts.net', '012345')).toBe('https://pc.tail.ts.net/#code=012345');
    expect(cleanDeviceName('iPhone de Dylan <script>')).toBe('iPhone de Dylan script');
    expect(cleanDeviceName('   ')).toBe('Téléphone');
  });

  it('valide les requêtes du téléphone', () => {
    expect(phonePairRequestSchema.safeParse({ code: '123456' }).success).toBe(true);
    expect(phonePairRequestSchema.safeParse({ code: '12345' }).success).toBe(false);
    expect(phoneChatRequestSchema.safeParse({ text: '  ' }).success).toBe(false);
    expect(phoneChatRequestSchema.safeParse({ text: 'x'.repeat(4_001) }).success).toBe(false);
    expect(phoneChatRequestSchema.safeParse({ text: 'Salut', conversationId: '../../etc' }).success).toBe(false);
    expect(phoneChatRequestSchema.parse({ text: ' Salut ', conversationId: null, source: 'voice' })).toEqual({
      text: 'Salut',
      conversationId: null,
      source: 'voice',
    });
  });
});
