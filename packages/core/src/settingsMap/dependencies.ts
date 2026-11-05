import { activeOrchestra } from '../agent/orchestra.js';
import type { Settings } from '../settings.js';

export interface SettingsDependencyHint {
  id: string;
  /** Afficher le bandeau quand cette condition est vraie (besoin non satisfait). */
  when: (settings: Settings) => boolean;
  message: string;
}

export const SETTINGS_DEPENDENCY_HINTS: SettingsDependencyHint[] = [
  {
    id: 'chat-missions',
    when: (s) => s.developer.chatMissions === true && (!s.developer.enabled || !activeOrchestra(s)),
    message:
      'Les missions depuis la discussion demandent Jarvis développeur activé et le chef d’orchestre (Réglages → Cerveau).',
  },
  {
    id: 'persona-orchestra',
    when: (s) => s.persona?.enabled === true && !activeOrchestra(s),
    message: 'Le caractère de Jarvis ne s’applique qu’avec le chef d’orchestre (Réglages → Cerveau).',
  },
  {
    id: 'orchestra-ollama',
    when: (s) => s.orchestra?.enabled === true && s.provider !== 'ollama',
    message: 'Le chef d’orchestre fonctionne avec Ollama : choisis Ollama comme fournisseur.',
  },
];
