/** Demande d’action claire dans la discussion projet → exécution directe (code seul, sans mission). */
const ACTION_VERBS =
  /\b(ajoute|ajouter|change|changer|modifie|modifier|corrige|corriger|crée|créer|construis|construire|build|implement|implémente|implemente|augmente|augmenter|réduis|reduis|diminue|retire|supprime|enlève|enleve|mets|met|fais|fait|passe|rend|jouable|jouer|fixe|fix)\b/i;

const SOFT_INTENT =
  /\b(il faut|je veux|je voudrais|j'aimerais|j aimerais|besoin de|peux-tu faire|tu peux faire|fais en sorte)\b/i;

const PURE_QUESTION =
  /^\s*(pourquoi|comment|est-ce que|qu'est-ce|c'est quoi|explique|dis-moi|peux-tu m'expliquer)\b/i;

export function isProjectChatDirectRequest(text: string): boolean {
  const t = text.trim();
  if (t.length < 10) return false;
  if (PURE_QUESTION.test(t)) return false;
  const looksLikeQuestion = /\?\s*$/.test(t) && !ACTION_VERBS.test(t) && !SOFT_INTENT.test(t);
  if (looksLikeQuestion) return false;
  return ACTION_VERBS.test(t) || SOFT_INTENT.test(t);
}
