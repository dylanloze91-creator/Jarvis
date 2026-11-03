import { describe, expect, it } from 'vitest';
import { TRIEUR_BASE_CANDIDATES } from './candidates.js';

describe('trieur candidats modèle de base', () => {
  it('propose trois tailles 1–4B avec lien de licence Hugging Face', () => {
    expect(TRIEUR_BASE_CANDIDATES).toHaveLength(3);
    expect(TRIEUR_BASE_CANDIDATES.map((c) => c.id)).toEqual(['qwen2.5-1.5b', 'qwen3-1.7b', 'qwen3-4b']);
    for (const candidate of TRIEUR_BASE_CANDIDATES) {
      expect(candidate.license).toBe('Apache-2.0');
      expect(candidate.licenseUrl).toMatch(/^https:\/\/huggingface\.co\/Qwen\/.+\/raw\/main\/LICENSE$/);
      expect(candidate.qlora6Go.length).toBeGreaterThan(10);
    }
  });

  it('fiches Qwen3 base sur Hugging Face : Apache-2.0 (vérif en ligne 2026-11-03)', async () => {
    const urls = TRIEUR_BASE_CANDIDATES.filter((c) => c.id.startsWith('qwen3')).map((c) => c.licenseUrl);
    expect(urls).toHaveLength(2);
    for (const url of urls) {
      const response = await fetch(url);
      expect(response.ok, url).toBe(true);
      const text = await response.text();
      expect(text).toContain('Apache License');
      expect(text).toContain('Version 2.0');
    }
  });
});
