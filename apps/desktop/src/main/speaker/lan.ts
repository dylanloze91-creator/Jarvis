/**
 * Interfaces à annoncer. Linux lit `/proc/net/route`. Windows lance `route print -4`
 * (commande fixe, sans texte venu de l'utilisateur).
 */
import { execFile } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { networkInterfaces } from 'node:os';
import { announceInterfaces, gatewaysFromProcRoute, gatewaysFromWindowsRoute, type NetIface } from '@jarvis/core';

export function interfacesFromTables(
  listed: ReadonlyArray<{ name: string; address: string }>,
  byName: Readonly<Record<string, string>>,
  byAddress: Readonly<Record<string, string>>,
): NetIface[] {
  return listed.map((iface) => {
    const gateway = byName[iface.name] ?? byAddress[iface.address] ?? null;
    return { name: iface.name, address: iface.address, gateway };
  });
}

export function readRouteText(): Promise<string> {
  if (existsSync('/proc/net/route')) return Promise.resolve(readFileSync('/proc/net/route', 'utf8'));
  if (process.platform !== 'win32') return Promise.resolve('');
  return new Promise((resolve) => {
    execFile('route', ['print', '-4'], { timeout: 4000, windowsHide: true }, (error, stdout) => {
      resolve(error ? '' : String(stdout));
    });
  });
}

export async function lanInterfaces(): Promise<NetIface[]> {
  const text = await readRouteText();
  const byName = text.includes('Iface') ? gatewaysFromProcRoute(text) : {};
  const byAddress = text.includes('0.0.0.0') ? gatewaysFromWindowsRoute(text) : {};
  const listed: Array<{ name: string; address: string }> = [];
  for (const [name, entries] of Object.entries(networkInterfaces())) {
    for (const entry of entries ?? []) {
      const family = entry.family as string | number;
      if (entry.internal) continue;
      if (family !== 'IPv4' && family !== 4) continue;
      listed.push({ name, address: entry.address });
    }
  }
  return interfacesFromTables(listed, byName, byAddress);
}

export async function keptLanAddresses(): Promise<string[]> {
  return announceInterfaces(await lanInterfaces()).kept;
}
