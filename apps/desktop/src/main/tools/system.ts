import { statfs } from 'node:fs/promises';
import os from 'node:os';
import { app } from 'electron';
import { z } from 'zod';
import { defineTool } from '@jarvis/core';

/**
 * Outil de lecture seule : aucun effet de bord, donc aucune confirmation.
 * Il sert de gabarit pour les futurs outils d'inspection (processus, fenêtre
 * active, journaux d'erreurs).
 */
export const getSystemInfoTool = defineTool({
  name: 'get_system_info',
  description:
    "Retourne l'état de l'ordinateur : système, processeur, charge, mémoire vive et espace disque. À utiliser dès que l'utilisateur demande comment se porte sa machine ou pourquoi elle est lente.",
  risk: 'safe',
  schema: z.object({}),
  execute: async () => {
    const totalMemory = os.totalmem();
    const freeMemory = os.freemem();
    const cpus = os.cpus();
    const disk = await readDisk();

    const lines = [
      `Système : ${os.type()} ${os.release()} (${os.arch()})`,
      `Machine : ${os.hostname()}`,
      `Processeur : ${cpus[0]?.model?.trim() ?? 'inconnu'} — ${cpus.length} cœurs logiques`,
      `Charge moyenne (1 min) : ${os.loadavg()[0]?.toFixed(2) ?? 'n/d'}`,
      `Mémoire : ${formatBytes(totalMemory - freeMemory)} utilisés sur ${formatBytes(totalMemory)} (${percent(totalMemory - freeMemory, totalMemory)} occupés)`,
      disk
        ? `Disque (${disk.path}) : ${formatBytes(disk.used)} utilisés sur ${formatBytes(disk.total)} (${formatBytes(disk.free)} libres)`
        : 'Disque : information indisponible',
      `Temps depuis le démarrage : ${formatDuration(os.uptime())}`,
    ];

    return {
      ok: true,
      content: lines.join('\n'),
      data: { totalMemory, freeMemory, cpuCount: cpus.length, disk },
    };
  },
});

async function readDisk(): Promise<{ path: string; total: number; free: number; used: number } | null> {
  const target = app.getPath('home');
  try {
    const stats = await statfs(target);
    const total = Number(stats.blocks) * stats.bsize;
    const free = Number(stats.bavail) * stats.bsize;
    return { path: target, total, free, used: total - free };
  } catch {
    return null;
  }
}

function formatBytes(bytes: number): string {
  const units = ['o', 'Ko', 'Mo', 'Go', 'To'];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value.toFixed(value >= 10 || unit === 0 ? 0 : 1)} ${units[unit]}`;
}

function percent(part: number, total: number): string {
  if (total === 0) return '0 %';
  return `${Math.round((part / total) * 100)} %`;
}

function formatDuration(seconds: number): string {
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  if (days > 0) return `${days} j ${hours} h`;
  if (hours > 0) return `${hours} h ${minutes} min`;
  return `${minutes} min`;
}
