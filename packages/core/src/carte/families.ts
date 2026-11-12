/**
 * Classement d'une demande par règles, sans modèle.
 * Une seule liste : la première famille qui correspond l'emporte.
 * Les sujets précis sont avant « code », pour qu'un script Klipper
 * reste de l'impression 3D.
 */

export const FAMILLES = [
  'impression 3D',
  'CAO et 3D',
  'électronique et enceinte',
  'musique',
  'bourse et argent',
  'météo et agenda',
  'images',
  'vinyle et stickers',
  'chantier',
  'code',
  'recherche',
  'quotidien',
  'Jarvis lui-même',
  'conversation',
  'autre',
] as const;

export type Famille = (typeof FAMILLES)[number];

export const LANGAGES = [
  'TypeScript',
  'JavaScript',
  'Python',
  'PowerShell',
  'C ou C++',
  'G-code et Klipper',
  'HTML et CSS',
  'SQL',
  'Bash',
  'autre',
] as const;

export type Langage = (typeof LANGAGES)[number];

export interface Classement {
  famille: Famille;
  langage: Langage | null;
}

const EXTENSIONS: Record<string, Langage> = {
  ts: 'TypeScript',
  tsx: 'TypeScript',
  mts: 'TypeScript',
  cts: 'TypeScript',
  js: 'JavaScript',
  jsx: 'JavaScript',
  mjs: 'JavaScript',
  cjs: 'JavaScript',
  py: 'Python',
  ps1: 'PowerShell',
  c: 'C ou C++',
  h: 'C ou C++',
  cpp: 'C ou C++',
  hpp: 'C ou C++',
  cc: 'C ou C++',
  hh: 'C ou C++',
  ino: 'C ou C++',
  gcode: 'G-code et Klipper',
  html: 'HTML et CSS',
  htm: 'HTML et CSS',
  css: 'HTML et CSS',
  scss: 'HTML et CSS',
  sql: 'SQL',
  sh: 'Bash',
  bash: 'Bash',
};

const BALISES: Record<string, Langage> = {
  ts: 'TypeScript',
  typescript: 'TypeScript',
  tsx: 'TypeScript',
  js: 'JavaScript',
  javascript: 'JavaScript',
  jsx: 'JavaScript',
  py: 'Python',
  python: 'Python',
  ps1: 'PowerShell',
  powershell: 'PowerShell',
  pwsh: 'PowerShell',
  c: 'C ou C++',
  cpp: 'C ou C++',
  cxx: 'C ou C++',
  h: 'C ou C++',
  hpp: 'C ou C++',
  arduino: 'C ou C++',
  ino: 'C ou C++',
  gcode: 'G-code et Klipper',
  html: 'HTML et CSS',
  css: 'HTML et CSS',
  sql: 'SQL',
  bash: 'Bash',
  sh: 'Bash',
  shell: 'Bash',
  zsh: 'Bash',
};

/** Minuscules, sans accent, apostrophes unifiées, espaces simples. */
export function plier(texte: string): string {
  return texte
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .replace(/[’']/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

function ajouter(hits: Map<Langage, number>, langage: Langage, n = 1): void {
  hits.set(langage, (hits.get(langage) ?? 0) + n);
}

function indicesLangage(pli: string): Map<Langage, number> {
  const hits = new Map<Langage, number>();
  for (const match of pli.matchAll(/```([a-z0-9#+.-]+)/g)) {
    const balise = match[1] ?? '';
    const langage = BALISES[balise];
    if (langage) ajouter(hits, langage);
  }
  for (const match of pli.matchAll(/(?:^|[^a-z0-9_])[a-z0-9_-]{1,80}\.([a-z0-9]+)\b/g)) {
    const ext = match[1] ?? '';
    const langage = EXTENSIONS[ext];
    if (langage) ajouter(hits, langage);
  }
  if (/\btypescript\b/.test(pli)) ajouter(hits, 'TypeScript');
  if (/\bjavascript\b/.test(pli)) ajouter(hits, 'JavaScript');
  if (/\bpython\b/.test(pli)) ajouter(hits, 'Python');
  if (/\bpowershell\b|\bpwsh\b/.test(pli)) ajouter(hits, 'PowerShell');
  if (/\barduino\b|\besp-idf\b|\besp32\b/.test(pli)) ajouter(hits, 'C ou C++');
  if (/\bg-?codes?\b|\bklipper\b|\bmoonraker\b/.test(pli)) ajouter(hits, 'G-code et Klipper');
  if (/\bhtml\b|\bcss\b/.test(pli)) ajouter(hits, 'HTML et CSS');
  if (/\bsql\b/.test(pli)) ajouter(hits, 'SQL');
  if (/\bbash\b/.test(pli)) ajouter(hits, 'Bash');
  return hits;
}

function meilleurLangage(hits: Map<Langage, number>): Langage | null {
  let best: Langage | null = null;
  let bestN = 0;
  for (const langage of LANGAGES) {
    if (langage === 'autre') continue;
    const n = hits.get(langage) ?? 0;
    if (n > bestN) {
      best = langage;
      bestN = n;
    }
  }
  return best;
}

function estCode(pli: string, hits: Map<Langage, number>): boolean {
  if ([...hits.values()].some((n) => n > 0)) return true;
  if (pli.includes('```')) return true;
  if (/\bbugs?\b|\bdebug\w*\b|\bcompil\w*\b|\bscripts?\b/.test(pli)) return true;
  return false;
}

function estCao(pli: string): boolean {
  if (/\bfreecad\b|\bblender\b|\bstl\b|\besquisse\b/.test(pli)) return true;
  if (/\bpiece jointe\b/.test(pli)) return false;
  return /\bpieces?\b/.test(pli);
}

function estBourse(pli: string): boolean {
  if (/\bbourse\b|\bactions?\b|\bprix\b/.test(pli)) return true;
  const sansLocution = pli.replaceAll('au cours de', ' ');
  return /\bcours\b/.test(sansLocution);
}

function familleDe(pli: string, hits: Map<Langage, number>): Famille {
  const tests: readonly { famille: Famille; ok: boolean }[] = [
    {
      famille: 'impression 3D',
      ok: /\bg-?codes?\b|\bklipper\b|\bmoonraker\b|\btrancheur\b|\bbuse\b|\bplateau\b/.test(pli),
    },
    { famille: 'CAO et 3D', ok: estCao(pli) },
    {
      famille: 'électronique et enceinte',
      ok: /\besp32\b|\besp-idf\b|\bmicrophones?\b|\bmicro\b|\bcablage\b|\bfirmware\b|\bwi-?fi\b/.test(pli),
    },
    { famille: 'musique', ok: /\bspotify\b|\bplaylists?\b|\bchansons?\b/.test(pli) },
    { famille: 'bourse et argent', ok: estBourse(pli) },
    {
      famille: 'météo et agenda',
      ok: /\bmeteo\b|\bpluie\b|\brendez-?vous\b|\bagenda\b/.test(pli),
    },
    { famille: 'images', ok: /\bimages?\b|\blogos?\b|\bdessins?\b|\bphotos?\b/.test(pli) },
    {
      famille: 'vinyle et stickers',
      ok: /\bvinyle\b|\bstickers?\b|\bbandeau\b|\bdecoupe\b/.test(pli),
    },
    {
      famille: 'chantier',
      ok: /\bcharpente\b|\bcouverture\b|\bdevis\b|\bchevron\b|\bliteau\b/.test(pli),
    },
    { famille: 'code', ok: estCode(pli, hits) },
    {
      famille: 'recherche',
      ok: /\bcherch\w*\b|\btrouve\w*\b|\bqu'est-ce que\b/.test(pli),
    },
    {
      famille: 'quotidien',
      ok: /\bnotes?\b|\broutines?\b|\brappels?\b|\bbriefings?\b/.test(pli),
    },
    {
      famille: 'Jarvis lui-même',
      ok: /\bjarvis\b|\breglages?\b|\bmise a jour\b|\bversions?\b/.test(pli),
    },
  ];
  for (const regle of tests) {
    if (regle.ok) return regle.famille;
  }
  const nbMots = pli.split(' ').filter(Boolean).length;
  if (nbMots > 0 && nbMots <= 4) return 'conversation';
  if (/^(salut|bonjour|bonsoir|coucou|hello|merci|ciao|ok|oui|non|bonne nuit|a plus|au revoir)\b/.test(pli)) {
    return 'conversation';
  }
  return 'autre';
}

/** Une famille, et un langage seulement quand le texte en montre un (ou « autre » pour du code sans langage). */
export function classerDemande(texte: string): Classement {
  const pli = plier(texte);
  if (!pli) return { famille: 'autre', langage: null };
  const hits = indicesLangage(pli);
  const famille = familleDe(pli, hits);
  const reconnu = meilleurLangage(hits);
  if (famille === 'code') return { famille, langage: reconnu ?? 'autre' };
  if (famille === 'impression 3D' && reconnu === 'G-code et Klipper') return { famille, langage: reconnu };
  if (famille === 'électronique et enceinte' && reconnu === 'C ou C++') return { famille, langage: reconnu };
  return { famille, langage: null };
}
