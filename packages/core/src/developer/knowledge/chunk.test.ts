import { describe, expect, it } from 'vitest';
import { chunkMarkdownFile, parseManualFrontmatter } from './chunk.js';

describe('parseManualFrontmatter', () => {
  it('lit tags et templateId', () => {
    const raw = `---
tags: [vitest, all]
templateId: web-game
---
## Corps`;
    const { meta, body } = parseManualFrontmatter(raw);
    expect(meta.tags).toEqual(['vitest', 'all']);
    expect(meta.templateId).toBe('web-game');
    expect(body).toContain('## Corps');
  });
});

describe('chunkMarkdownFile', () => {
  it('découpe par titres ##', () => {
    const md = `## Alpha\nligne a\n\n## Beta\nligne b`;
    const chunks = chunkMarkdownFile('test.md', md, 500);
    expect(chunks).toHaveLength(2);
    expect(chunks[0]!.section).toBe('Alpha');
    expect(chunks[1]!.text).toContain('ligne b');
  });

  it('subdivise les sections longues', () => {
    const md = `## Long\n${'x'.repeat(1500)}`;
    const chunks = chunkMarkdownFile('long.md', md, 400);
    expect(chunks.length).toBeGreaterThan(1);
  });
});
