import { codeModelById, type CodeModelRole } from './codeModels.js';
import {
  OLLAMA_RTX2060_6GB_RECOMMENDATIONS,
  type OllamaRecommendationRole,
} from '../providers/ollamaModels.js';
import type { OllamaModelInfo } from '../providers/ollamaStatus.js';

const CODE_ROLE_SUMMARY: Record<CodeModelRole, string> = {
  default: 'Code agentique et missions dev exigeantes.',
  fallback: 'Repli code si le modèle principal manque.',
  fast: 'Itérations rapides : plateforme 2D et petits projets.',
  quality: 'Plans difficiles, plus lent — plutôt en arrière-plan.',
};

const RECOMMENDATION_ROLE_SUMMARY: Record<OllamaRecommendationRole, string> = {
  default: 'Chat et outils Jarvis : base fiable au quotidien.',
  performance: 'Plus capable, plus lourd — à réserver aux tâches difficiles.',
  'a-eviter': 'Trop léger pour l’appel d’outils fiable.',
};

/**
 * Une ligne en français sous le nom Ollama dans l’onglet Développeur.
 * Ne prétend pas qu’un modèle est installé : décrit seulement l’usage attendu.
 */
export function summarizeOllamaModelForDeveloper(
  name: string,
  info?: Pick<OllamaModelInfo, 'supportsTools' | 'parameterSize'>,
): string {
  const catalog = codeModelById(name);
  if (catalog) return CODE_ROLE_SUMMARY[catalog.role];

  const rec = OLLAMA_RTX2060_6GB_RECOMMENDATIONS.find((entry) => entry.model === name);
  if (rec) return RECOMMENDATION_ROLE_SUMMARY[rec.role];

  const lower = name.toLowerCase();
  if (lower.includes('embed') || lower.startsWith('nomic-') || lower.includes('bge-')) {
    return 'Embeddings et recherche — pas pour générer du code dev.';
  }
  if (lower.includes('vision') || lower.includes('llava') || lower.includes('bakllava')) {
    return 'Vision et images — pas le choix principal pour coder.';
  }
  if (lower.includes('coder') || lower.includes('-code') || lower.includes('codestral')) {
    return 'Orienté génération et correction de code.';
  }
  if (lower.includes('deepseek')) {
    return 'Raisonnement et code — selon la variante installée.';
  }
  if (info?.supportsTools === false) {
    return 'Texte et conversation — outils dev peu fiables.';
  }
  if (info?.supportsTools) {
    return 'Génération avec appel d’outils possible pour le dev.';
  }
  return 'Modèle local — usage selon sa documentation Ollama.';
}
