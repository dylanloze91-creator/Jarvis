const PLATFORMER =
  /\b(plateforme|platformer|side[- ]scroller|vue de côté|vue de cote|2d.*plateforme|jeu de plateforme)\b/i;
export function isPlatformerRequest(request: string): boolean {
  return PLATFORMER.test(request);
}

/** Requête de recherche web avant le code (méthode Développeur 5.0.27). */
export function webResearchQueryForRequest(request: string): string {
  const t = request.trim();
  if (isPlatformerRequest(t)) {
    return 'jeu plateforme 2D vue de côté canvas JavaScript structure niveau saut gravité bonnes pratiques';
  }
  if (/\b(winforms|\.exe|windows|wpf)\b/i.test(t)) {
    return 'application Windows desktop .NET WinForms structure testée bonnes pratiques';
  }
  if (/\b(react|site web|application web|vite)\b/i.test(t)) {
    return 'application web React Vite structure projet bonnes pratiques';
  }
  if (/\b(cli|ligne de commande|outil)\b/i.test(t)) {
    return 'outil CLI Node.js TypeScript structure tests bonnes pratiques';
  }
  return `${t.slice(0, 120)} bonnes pratiques architecture`;
}

/** Une ligne française pour le chat à partir des extraits web. */
export function webResearchChatLine(request: string, snippets: string): string {
  const text = snippets.replace(/\s+/g, ' ').trim().slice(0, 400);
  if (isPlatformerRequest(request)) {
    const hint = text.includes('canvas') || text.includes('gravité') || text.includes('gravity')
      ? 'canvas, gravité, plateformes et boucle de jeu'
      : 'structure classique d’un jeu 2D vue de côté (canvas, physique simple, niveau)';
    return `Recherche web : je garde l’approche ${hint} — pas un autre type de jeu.`;
  }
  const kept = text.length > 40 ? text.slice(0, 140).trim() + '…' : 'une structure éprouvée pour ce type de projet';
  return `Recherche web : je garde ${kept}`;
}

/** Lignes visibles dans le chat : qui fait quoi (spécialistes existants). */
export function developerAgentSplitChatLines(request: string): string[] {
  const jeu = /\b(jeu|jeux|game|plateforme|platformer)\b/i.test(request);
  return [
    'Équipe : le Raisonneur clarifie l’objectif ; le Chercheur web note une méthode fiable ; l’Architecte choisit le gabarit ; le Codeur écrit ; le Testeur et le Relecteur vérifient que ça tourne.',
    jeu
      ? 'Rôles : Chercheur web → méthode ; Architecte → gabarit jeu ; Codeur → niveau et code ; Testeur → tests ; Relecteur → relecture du diff.'
      : 'Rôles : Chercheur web → méthode ; Architecte → gabarit ; Codeur → fichiers ; Testeur → tests ; Relecteur → relecture du diff.',
  ];
}

export function defaultDesktopShortcutLabel(projectName: string): string {
  const clean = projectName.trim() || 'Projet';
  return `Jarvis — ${clean}`.slice(0, 120);
}

/** Message unique pour le chat quand le dossier prévu n’était pas utilisable. */
export function folderRedirectChatLine(redirectedFrom: string, newId: string): string {
  return `Le dossier « ${redirectedFrom} » n’est pas vide ou pas sûr : le projet est créé dans « ${newId} ».`;
}
