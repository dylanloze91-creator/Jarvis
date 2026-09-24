import { describe, expect, it } from 'vitest';
import {
  OLLAMA_RTX2060_6GB_RECOMMENDATIONS,
  getOllamaDefaultRecommendation,
} from './ollamaModels.js';

describe('OLLAMA_RTX2060_6GB_RECOMMENDATIONS', () => {
  it('propose exactement une recommandation par défaut', () => {
    const defaults = OLLAMA_RTX2060_6GB_RECOMMENDATIONS.filter((entry) => entry.role === 'default');
    expect(defaults).toHaveLength(1);
    expect(getOllamaDefaultRecommendation()).toBe(defaults[0]);
  });

  it('marque le choix par défaut comme tenant sur 6 Go, et l’option performance comme débordant', () => {
    const byRole = Object.fromEntries(
      OLLAMA_RTX2060_6GB_RECOMMENDATIONS.map((entry) => [entry.role, entry]),
    );
    expect(byRole.default?.fitsOn6GbVram).toBe(true);
    expect(byRole.performance?.fitsOn6GbVram).toBe(false);
  });

  it('chaque recommandation a une commande d’installation cohérente avec son modèle', () => {
    for (const entry of OLLAMA_RTX2060_6GB_RECOMMENDATIONS) {
      expect(entry.pullCommand).toBe(`ollama pull ${entry.model}`);
    }
  });

  it('les tailles de téléchargement sont des mesures réelles positives, pas des zéros par défaut', () => {
    for (const entry of OLLAMA_RTX2060_6GB_RECOMMENDATIONS) {
      expect(entry.downloadSizeGb).toBeGreaterThan(0);
    }
  });
});
