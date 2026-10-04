import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import type { DiffFile, DiffLine } from '@jarvis/core';
import { applyExactEdit } from '../tools/fileTools.js';
import { resolveForWrite } from './writeJail.js';

const MAX_PREVIEW_LINES = 200;

function lines(text: string): string[] {
  const parts = text.replace(/\r\n/g, '\n').split('\n');
  return parts.length > 1 && parts[parts.length - 1] === '' ? parts.slice(0, -1) : parts;
}

function file(
  path: string,
  status: DiffFile['status'],
  body: DiffLine[],
  header: string,
): DiffFile {
  return {
    path,
    oldPath: null,
    status,
    binary: false,
    additions: body.filter((l) => l.kind === 'add').length,
    deletions: body.filter((l) => l.kind === 'del').length,
    hunks: [{ header, lines: body.slice(0, MAX_PREVIEW_LINES) }],
  };
}

/**
 * Diff exact d'une écriture demandée, pour la carte de confirmation : un
 * remplacement exact se montre tel quel, avec trois lignes de contexte.
 */
export async function previewWrite(
  root: string,
  tool: string,
  args: Record<string, unknown>,
): Promise<DiffFile[]> {
  const path = typeof args.path === 'string' ? args.path : '';
  let target;
  try {
    target = await resolveForWrite(root, path);
  } catch {
    return [];
  }
  const current = existsSync(target.absolute) ? await readFile(target.absolute, 'utf8') : null;
  if (tool === 'dev_create_file') {
    const added = lines(String(args.content ?? '')).map((text, i): DiffLine => ({
      kind: 'add',
      text,
      oldLine: null,
      newLine: i + 1,
    }));
    return [file(target.relative, 'added', added, `@@ -0,0 +1,${added.length} @@`)];
  }
  if (current === null) return [];
  if (tool === 'dev_delete_file') {
    const removed = lines(current).map((text, i): DiffLine => ({
      kind: 'del',
      text,
      oldLine: i + 1,
      newLine: null,
    }));
    return [file(target.relative, 'deleted', removed, `@@ -1,${removed.length} +0,0 @@`)];
  }
  if (tool === 'dev_write_file') {
    const old = lines(current.replace(/\r\n/g, '\n'));
    const fresh = lines(String(args.content ?? '').replace(/\r\n/g, '\n'));
    const body: DiffLine[] = [
      ...old.map((text, i): DiffLine => ({ kind: 'del', text, oldLine: i + 1, newLine: null })),
      ...fresh.map((text, i): DiffLine => ({ kind: 'add', text, oldLine: null, newLine: i + 1 })),
    ];
    return [file(target.relative, 'modified', body, `@@ -1,${old.length} +1,${fresh.length} @@`)];
  }
  if (tool !== 'dev_edit_file') return [];
  const search = String(args.search ?? '');
  const replace = String(args.replace ?? '');
  const normalized = current.replace(/\r\n/g, '\n');
  const needle = search.replace(/\r\n/g, '\n');
  const edit = applyExactEdit(normalized, needle, replace.replace(/\r\n/g, '\n'));
  if (!edit.ok) return [];
  const index = normalized.indexOf(needle);
  const prefix = normalized.slice(0, index);
  const first = prefix === '' ? 0 : lines(prefix).length - (prefix.endsWith('\n') ? 0 : 1);
  const lastOld = lines(normalized.slice(0, index + needle.length)).length - 1;
  const all = lines(normalized);
  const updated = lines(edit.text);
  const removed = all.slice(first, lastOld + 1);
  const added = updated.slice(first, lastOld + 1 + (updated.length - all.length));
  const before = all.slice(Math.max(0, first - 3), first);
  const after = all.slice(lastOld + 1, lastOld + 4);
  const body: DiffLine[] = [];
  let oldLine = first - before.length + 1;
  let newLine = oldLine;
  for (const text of before)
    body.push({ kind: 'context', text, oldLine: oldLine++, newLine: newLine++ });
  for (const text of removed) body.push({ kind: 'del', text, oldLine: oldLine++, newLine: null });
  for (const text of added) body.push({ kind: 'add', text, oldLine: null, newLine: newLine++ });
  for (const text of after)
    body.push({ kind: 'context', text, oldLine: oldLine++, newLine: newLine++ });
  const header = `@@ -${first - before.length + 1},${before.length + removed.length + after.length} +${first - before.length + 1},${before.length + added.length + after.length} @@`;
  return [file(target.relative, 'modified', body, header)];
}
