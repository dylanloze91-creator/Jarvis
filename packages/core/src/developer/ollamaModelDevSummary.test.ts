import { describe, expect, it } from 'vitest';
import { summarizeOllamaModelForDeveloper } from './ollamaModelDevSummary.js';

describe('summarizeOllamaModelForDeveloper', () => {
  it('utilise le catalogue code pour les modèles connus', () => {
    expect(summarizeOllamaModelForDeveloper('qwen3.5:4b')).toMatch(/rapides/i);
  });

  it('reconnaît les modèles embedding', () => {
    expect(summarizeOllamaModelForDeveloper('nomic-embed-text')).toMatch(/Embeddings/i);
  });

  it('tient compte de supportsTools', () => {
    expect(summarizeOllamaModelForDeveloper('custom:7b', { supportsTools: true })).toMatch(
      /outils/i,
    );
    expect(summarizeOllamaModelForDeveloper('custom:7b', { supportsTools: false })).toMatch(
      /peu fiables/i,
    );
  });
});
