import type { SettingsCategoryId } from './categories.js';

export interface SettingsSearchEntry {
  category: SettingsCategoryId;
  subcategory: string;
  label: string;
  keywords: string[];
  highlight?: string;
}

/** Index de recherche dans les réglages (libellés en tutoiement). */
export const SETTINGS_SEARCH_INDEX: SettingsSearchEntry[] = [
  { category: 'moi', subcategory: 'personalization', label: 'Personnalisation', keywords: ['prénom', 'profil', 'moi'] },
  { category: 'moi', subcategory: 'know', label: 'Ce que Jarvis sait de moi', keywords: ['export', 'effacer', 'souvenirs'] },
  { category: 'moi', subcategory: 'persona', label: 'Caractère de Jarvis', keywords: ['persona', 'ton', 'accueil'] },
  { category: 'moi', subcategory: 'home-location', label: 'Chez moi', keywords: ['météo', 'lieu', 'ville'] },
  { category: 'moi', subcategory: 'knowledge', label: 'Mémoire documentaire', keywords: ['documents', 'index', 'apprentissage local'] },
  { category: 'parler', subcategory: 'voice', label: 'Voix et micro', keywords: ['micro', 'réveil', 'whisper', 'parler'] },
  { category: 'services', subcategory: 'spotify', label: 'Spotify', keywords: ['musique', 'lecture'] },
  { category: 'services', subcategory: 'google', label: 'Google', keywords: ['gmail', 'agenda', 'drive', 'mail'] },
  { category: 'services', subcategory: 'siteblock', label: 'Blocage de sites', keywords: ['siteblock', 'distraction'] },
  { category: 'services', subcategory: 'robot', label: 'Robot', keywords: ['rover', 'voiture'] },
  { category: 'services', subcategory: 'phone', label: 'Téléphone', keywords: ['tailscale', 'mobile'] },
  { category: 'services', subcategory: 'speakers', label: 'Enceintes', keywords: ['esp32', 'enceinte', 'vitesse', 'piper', 'rapide'] },
  { category: 'services', subcategory: 'developer-general', label: 'Missions depuis la discussion', keywords: ['mission', 'code', 'discussion'] },
  { category: 'services', subcategory: 'developer-advanced', label: 'Développeur avancé', keywords: ['copie', 'modèle code', 'worktree'] },
  { category: 'brain', subcategory: 'provider', label: 'Fournisseur de modèle', keywords: ['ollama', 'openai', 'clé api'] },
  { category: 'brain', subcategory: 'ollama', label: 'Ollama', keywords: ['local', 'modèles'] },
  { category: 'brain', subcategory: 'orchestra', label: 'Chef d’orchestre', keywords: ['équipes', 'orchestre'] },
  { category: 'brain', subcategory: 'model', label: 'Modèle et repli', keywords: ['qwen', 'fallback'] },
  { category: 'brain', subcategory: 'system-prompt', label: 'Consignes de base', keywords: ['prompt', 'système'] },
  { category: 'brain', subcategory: 'search', label: 'Recherche Internet', keywords: ['web', 'brave', 'tavily'] },
  { category: 'brain', subcategory: 'market', label: 'Cours de bourse', keywords: ['bourse', 'finnhub'] },
  { category: 'security', subcategory: 'tool-policies', label: 'Permissions des outils', keywords: ['confirmation', 'politique'] },
  { category: 'security', subcategory: 'audit', label: 'Journal d’audit', keywords: ['historique', 'actions'] },
  { category: 'application', subcategory: 'machine', label: 'Profil de cette machine', keywords: ['matériel', 'gpu'] },
  { category: 'application', subcategory: 'window', label: 'Fenêtre et raccourci', keywords: ['hotkey', 'ctrl', 'espace'] },
  { category: 'application', subcategory: 'updates', label: 'Mises à jour', keywords: ['version', 'installer'] },
  { category: 'application', subcategory: 'questionnaire', label: 'Questionnaire d’accueil', keywords: ['onboarding', 'accueil'] },
  { category: 'application', subcategory: 'health', label: 'Bilan de santé', keywords: ['santé', 'ollama', 'ça ne marche pas'] },
  { category: 'application', subcategory: 'backup', label: 'Sauvegarde', keywords: ['copie', 'restaurer', 'disque'] },
];
