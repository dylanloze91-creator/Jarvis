import { isProjectChatDirectRequest } from './engine/projectChatDirect.js';

/** Phrase vocale après « Jarvis » : construire ou modifier app, jeu, outil ou code → développeur. */
const BUILD_OR_CHANGE =
  /\b(crée|créer|construis|construire|modifie|modifier|corrige|corriger|ajoute|ajouter|change|changer|développe|développer|code|coder|programme|programmer|implémente|implemente|implement|build|fixe|fix|améliore|améliorer|refactor|refactorise|mets à jour|met à jour|écris|écrire)\b/i;

const DEV_SUBJECT =
  /\b(app|appli|application|jeu|outil|programme|projet|code|script|site|page|cli|interface|fenêtre|dépôt|fichier|typescript|javascript|react|vite|godot|unity|snake|pong|tetris|monorepo|npm|electron)\b/i;

const CLASSIC_ONLY =
  /\b(météo|agenda|mail|e-?mail|spotify|chrome|actualité|musique|capture d[' ]écran|rappelle[- ]moi|recherche web)\b/i;

const BUILD_PHRASE =
  /\b(fais(-moi)?|je veux|j'aimerais|j aimerais|peux-tu|tu peux).{0,50}(un |une |mon |ma )?(jeu|appli|application|outil|programme|projet)\b/i;

export function isDeveloperVoiceIntent(text: string): boolean {
  const t = text.trim();
  if (t.length < 6) return false;
  if (/\b(quel temps|météo|temps qu['']il|il fait)\b/i.test(t)) return false;
  if (CLASSIC_ONLY.test(t) && !BUILD_OR_CHANGE.test(t) && !BUILD_PHRASE.test(t)) return false;
  if (isProjectChatDirectRequest(t) && (BUILD_OR_CHANGE.test(t) || DEV_SUBJECT.test(t) || BUILD_PHRASE.test(t)))
    return true;
  if (BUILD_PHRASE.test(t)) return true;
  if (BUILD_OR_CHANGE.test(t) && DEV_SUBJECT.test(t)) return true;
  if (/\b(mon|ma|mes)\s+(jeu|app|appli|outil|projet|programme|code)\b/i.test(t) && BUILD_OR_CHANGE.test(t))
    return true;
  return false;
}
