const PLATFORMER =
  /\b(plateforme|platformer|side[- ]scroller|vue de côté|vue de cote|2d.*plateforme|jeu de plateforme)\b/i;
export function isPlatformerRequest(request: string): boolean {
  return PLATFORMER.test(request);
}

/** Titre de projet affiché et dossier pour une demande plateforme 2D (5.0.29). */
export function platformerProjectTitle(): string {
  return 'Jeu de plateforme 2D';
}

/** Retire un titre de marque : les agents voient un jeu de plateforme, pas ce nom. */
export function briefWithoutTrademark(text: string): string {
  if (!/\bmario\b/i.test(text)) return text.trim();
  return text
    .replace(/\bsuper\s+mario\b/gi, 'jeu de plateforme 2D')
    .replace(/\bmario\b/gi, 'jeu de plateforme 2D')
    .replace(/(?:jeu de plateforme 2D\s*){2,}/gi, 'jeu de plateforme 2D ')
    .replace(/\s{2,}/g, ' ')
    .trim();
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

export function defaultDesktopShortcutLabel(projectName: string): string {
  const clean = projectName.trim() || 'Projet';
  return `Jarvis — ${clean}`.slice(0, 120);
}

/** Message unique pour le chat quand le dossier prévu n’était pas utilisable. */
export function folderRedirectChatLine(redirectedFrom: string, newId: string): string {
  return `Le dossier « ${redirectedFrom} » n’est pas vide ou pas sûr : le projet est créé dans « ${newId} ».`;
}
