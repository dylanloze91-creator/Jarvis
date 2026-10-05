import type { ManualChunk, ManualChunkMeta } from './types.js';
import type { ProjectTemplateId } from '../engine/templates.js';

const FRONTMATTER = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/;

/** Découpe grossière du frontmatter YAML (clés simples, listes courtes). */
export function parseManualFrontmatter(raw: string): { meta: ManualChunkMeta; body: string } {
  const match = FRONTMATTER.exec(raw);
  if (!match) return { meta: { tags: [] }, body: raw };
  const meta: ManualChunkMeta = { tags: [] };
  for (const line of match[1]!.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const kv = /^([\w-]+):\s*(.*)$/.exec(trimmed);
    if (!kv) continue;
    const key = kv[1]!;
    const value = kv[2]!.trim();
    if (key === 'tags') {
      meta.tags = value
        .replace(/^\[|\]$/g, '')
        .split(',')
        .map((t) => t.trim().replace(/^['"]|['"]$/g, ''))
        .filter(Boolean);
    } else if (key === 'templateId' && value) {
      meta.templateId = value as ProjectTemplateId;
    } else if (key === 'errorCodes') {
      meta.errorCodes = value
        .replace(/^\[|\]$/g, '')
        .split(',')
        .map((t) => t.trim().replace(/^['"]|['"]$/g, ''))
        .filter(Boolean);
    } else if (key === 'language' && value) {
      meta.language = value.replace(/^['"]|['"]$/g, '');
    }
  }
  return { meta, body: raw.slice(match[0].length) };
}

const SECTION = /^##\s+(.+)$/;

/**
 * Découpe un fichier Markdown en sections (titres `##`). Chaque section peut
 * être subdivisée si elle dépasse `maxChars`.
 */
export function chunkMarkdownFile(
  source: string,
  content: string,
  maxChars = 1_200,
): ManualChunk[] {
  const { meta: fileMeta, body } = parseManualFrontmatter(content);
  const lines = body.split(/\r?\n/);
  const sections: Array<{ title: string; lines: string[] }> = [];
  let current: { title: string; lines: string[] } | null = null;
  for (const line of lines) {
    const head = SECTION.exec(line);
    if (head) {
      if (current) sections.push(current);
      current = { title: head[1]!.trim(), lines: [] };
      continue;
    }
    if (!current) {
      current = { title: source.replace(/\.md$/i, ''), lines: [] };
    }
    current.lines.push(line);
  }
  if (current) sections.push(current);

  const out: ManualChunk[] = [];
  for (const section of sections) {
    const text = section.lines.join('\n').trim();
    if (!text) continue;
    const parts = splitLong(text, maxChars);
    for (const [i, part] of parts.entries()) {
      const sectionTitle = parts.length > 1 ? `${section.title} (${i + 1}/${parts.length})` : section.title;
      const id = hash(`${source}:${sectionTitle}:${part.slice(0, 80)}`);
      out.push({
        id,
        source,
        section: sectionTitle,
        text: part,
        meta: { ...fileMeta, tags: [...fileMeta.tags] },
      });
    }
  }
  return out;
}

function splitLong(text: string, maxChars: number): string[] {
  if (text.length <= maxChars) return [text];
  const parts: string[] = [];
  let start = 0;
  while (start < text.length) {
    let end = Math.min(start + maxChars, text.length);
    if (end < text.length) {
      const breakAt = text.lastIndexOf('\n\n', end);
      if (breakAt > start + maxChars * 0.4) end = breakAt;
    }
    parts.push(text.slice(start, end).trim());
    start = end;
  }
  return parts.filter(Boolean);
}

function hash(value: string): string {
  let h = 2_166_136_261;
  for (let i = 0; i < value.length; i += 1) {
    h ^= value.charCodeAt(i);
    h = Math.imul(h, 16_777_619);
  }
  return (h >>> 0).toString(16).padStart(8, '0');
}
