import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { app } from 'electron';
import type { AuditEntry, AuditLogStore } from '@jarvis/core';

const AUDIT_FILE = 'audit-log.json';
const CAPACITY = 1000;

function userDataPath(...segments: string[]): string {
  return join(app.getPath('userData'), ...segments);
}

/**
 * Journal d'audit persistant sur disque : un fichier JSON unique, comme les
 * réglages. Chaque exécution d'outil — succès, échec ou refus — y est
 * ajoutée, jamais réécrite ni supprimée en dehors d'un vidage explicite.
 */
export class FileAuditLogStore implements AuditLogStore {
  async append(entry: AuditEntry): Promise<void> {
    const entries = await this.readAll();
    entries.push(entry);
    const trimmed = entries.length > CAPACITY ? entries.slice(entries.length - CAPACITY) : entries;
    await mkdir(userDataPath(), { recursive: true });
    await writeFile(userDataPath(AUDIT_FILE), JSON.stringify(trimmed, null, 2), 'utf8');
  }

  async list(limit?: number): Promise<AuditEntry[]> {
    const entries = await this.readAll();
    const sorted = [...entries].sort((a, b) => b.timestamp - a.timestamp);
    return limit ? sorted.slice(0, limit) : sorted;
  }

  async clear(): Promise<void> {
    await writeFile(userDataPath(AUDIT_FILE), '[]', 'utf8');
  }

  private async readAll(): Promise<AuditEntry[]> {
    try {
      const raw = await readFile(userDataPath(AUDIT_FILE), 'utf8');
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? (parsed as AuditEntry[]) : [];
    } catch {
      return [];
    }
  }
}
