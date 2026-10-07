/** Décision mémorisée quand l’utilisateur accorde un moteur graphique dans le chat. */
export const GRAPHICS_ENGINE_GRANT_DECISION =
  'Accès moteur graphique accordé dans le chat (téléchargement et lancement autorisés pour ce projet).';

const AFFIRMATIVE =
  /^(oui|ok|yes|yep|vas[- ]?y|go|d[' ]?accord|autorisé|autorise|tu peux|je te l[' ]?accorde|c[' ]?est bon)\b/i;

const ENGINE_WORDS =
  /\b(godot|unity|unreal|ue\d|moteur graphique|game engine|graphics engine|cryengine)\b/i;

const ENGINE_PROGRAM =
  /\b(unity|unity hub|unrealeditor|ue4editor|ue5editor|epicgameslauncher)\b/i;

const GODOT_PROGRAM = /\bgodot[\w._-]*/i;

const ENGINE_INSTALL =
  /\b(winget\s+install\s+.*(godot|unity|unreal)|choco\s+install\s+.*(godot|unity)|steamcmd.*(unity|unreal))\b/i;

/** L’utilisateur accorde l’accès moteur par un simple oui dans le fil (réponse à Jarvis). */
export function userGrantsGraphicsEngineInMessage(
  userText: string,
  lastAssistantContent?: string,
): boolean {
  const t = userText.trim();
  if (!AFFIRMATIVE.test(t)) return false;
  if (ENGINE_WORDS.test(t)) return true;
  const assistant = lastAssistantContent?.trim() ?? '';
  if (assistant && ENGINE_WORDS.test(assistant) && AFFIRMATIVE.test(t)) return true;
  if (assistant && /\b(télécharger|installer|lancer).{0,40}moteur\b/i.test(assistant)) return true;
  return false;
}

export function hasGraphicsEngineGrant(
  granted: boolean,
  decisions: readonly string[],
): boolean {
  if (granted) return true;
  return decisions.some((d) => d.includes('moteur graphique') && /accord/i.test(d));
}

export function graphicsEngineChatPromptLine(
  granted: boolean,
  decisions: readonly string[],
): string {
  const ok = hasGraphicsEngineGrant(granted, decisions);
  if (ok) {
    return 'Moteur graphique : l’utilisateur a accordé l’accès dans ce chat — tu peux proposer téléchargement ou lancement (Godot, Unity, Unreal…) si le projet en a besoin. Pas de page Réglages pour cela.';
  }
  return 'Moteur graphique : sans un « oui » explicite de l’utilisateur dans cette discussion, ne télécharge ni ne lance aucun moteur (Godot, Unity, Unreal…). Si besoin, demande l’accord ici ; un simple oui suffit (outil dev_project_chat_grant_graphics_engine).';
}

/** Commande qui télécharge ou lance un moteur graphique externe. */
export function commandTargetsGraphicsEngine(command: string): boolean {
  const c = command.toLowerCase();
  if (ENGINE_PROGRAM.test(c) || GODOT_PROGRAM.test(c)) return true;
  if (ENGINE_INSTALL.test(c)) return true;
  if (/\b(steam|epic games launcher)\b/.test(c) && ENGINE_WORDS.test(c)) return true;
  return false;
}
