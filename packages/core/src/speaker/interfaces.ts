/**
 * Quelles adresses du PC on annonce aux enceintes. Les cartes virtuelles
 * (Tailscale, Radmin, WSL, Hyper-V…) sont écartées.
 */
import { isPrivateAddress } from './speaker.js';

export interface NetIface {
  name: string;
  address: string;
  /** Passerelle, si le système en donne une. Vide = on n'annonce pas. */
  gateway?: string | null;
}

export interface AnnounceDecision {
  kept: string[];
  dropped: Array<{ address: string; name: string; reason: string }>;
}

const VIRTUAL = ['vethernet', 'wsl', 'hyper-v', 'virtualbox', 'vmware', 'loopback', 'bluetooth'];

export function isTailscaleAddress(address: string): boolean {
  const match = /^100\.(\d+)\./.exec(address);
  if (!match) return false;
  const second = Number(match[1]);
  return second >= 64 && second <= 127;
}

export function isRadminAddress(address: string): boolean {
  return address.startsWith('26.');
}

function virtualName(name: string): string | null {
  const lower = name.toLowerCase();
  const hit = VIRTUAL.find((word) => lower.includes(word));
  return hit ?? null;
}

/** Interfaces privées, réelles, avec une passerelle. Une adresse par interface. */
export function announceInterfaces(ifaces: readonly NetIface[]): AnnounceDecision {
  const kept: string[] = [];
  const dropped: AnnounceDecision['dropped'] = [];
  for (const iface of ifaces) {
    const address = iface.address.trim();
    const name = iface.name;
    if (isTailscaleAddress(address)) {
      dropped.push({ address, name, reason: 'Tailscale' });
      continue;
    }
    if (isRadminAddress(address)) {
      dropped.push({ address, name, reason: 'Radmin' });
      continue;
    }
    if (!isPrivateAddress(address) || address.startsWith('127.') || address.startsWith('169.254.')) {
      dropped.push({ address, name, reason: 'pas une adresse de la maison' });
      continue;
    }
    const virtual = virtualName(name);
    if (virtual) {
      dropped.push({ address, name, reason: virtual });
      continue;
    }
    if (!iface.gateway) {
      dropped.push({ address, name, reason: 'pas de passerelle' });
      continue;
    }
    if (!kept.includes(address)) kept.push(address);
  }
  return { kept, dropped };
}

export interface MdnsQuestion {
  name: string;
  type: string;
}

export interface MdnsRecord {
  name: string;
  type: 'PTR' | 'SRV' | 'TXT' | 'A';
  data: string | { target: string; port: number } | string[];
}

const SERVICE = '_jarvis-speaker._tcp.local';

/** Réponses PTR, SRV, TXT et A pour le service de l'enceinte. Rien d'autre. */
export function mdnsAnswers(
  questions: readonly MdnsQuestion[],
  ctx: { pcId: string; port: number; addresses: readonly string[]; hostname: string },
): MdnsRecord[] {
  const host = ctx.hostname.endsWith('.local') ? ctx.hostname : `${ctx.hostname}.local`;
  const instance = `Jarvis.${SERVICE}`;
  const wants = questions.some((question) => {
    const name = question.name.toLowerCase();
    return name === SERVICE || name === instance.toLowerCase() || name === host.toLowerCase();
  });
  if (!wants) return [];
  return [
    { name: SERVICE, type: 'PTR', data: instance },
    { name: instance, type: 'SRV', data: { target: host, port: ctx.port } },
    { name: instance, type: 'TXT', data: [`pc=${ctx.pcId}`, 'v=1'] },
    ...ctx.addresses.map((address) => ({ name: host, type: 'A' as const, data: address })),
  ];
}

/** Le script de pare-feu n'accepte qu'un numéro de port. */
export function firewallPort(value: unknown): number | null {
  const port = typeof value === 'number' ? value : typeof value === 'string' && /^\d+$/.test(value) ? Number(value) : NaN;
  if (!Number.isInteger(port) || port < 1 || port > 65535) return null;
  return port;
}
