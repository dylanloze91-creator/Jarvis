/**
 * Demande de cours d'action, décidée sans modèle.
 * L'or, l'euro, le bitcoin, un cours de maths et « en cours » / « au cours de »
 * ne sont pas des actions : la fonction renvoie `null` et le chemin d'avant reste.
 */

export interface StockRequest {
  names: string[];
  prefer: 'paris' | null;
}

const LESSONS = new Set([
  'maths',
  'math',
  'mathematiques',
  'mathematique',
  'guitare',
  'cuisine',
  'piano',
  'anglais',
  'francais',
  'histoire',
  'geographie',
  'sport',
  'yoga',
  'conduite',
  'natation',
  'dessin',
  'chant',
  'theatre',
  'musique',
  'danse',
  'photo',
  'photographie',
  'informatique',
  'physique',
  'chimie',
  'biologie',
  'philosophie',
  'philo',
  'latin',
  'grec',
  'espagnol',
  'allemand',
  'italien',
  'chinois',
  'japonais',
  'russe',
  'arabe',
  'portugais',
  'programmation',
  'solfege',
  'violon',
  'batterie',
  'flute',
  'saxophone',
  'droit',
  'medecine',
  'comptabilite',
  'marketing',
  'patisserie',
  'couture',
  'bricolage',
  'jardinage',
  'mecanique',
  'electricite',
  'peinture',
  'lecture',
  'orthographe',
  'grammaire',
  'economie',
  'finance',
]);

const COMMODITIES = new Set([
  'or',
  'euro',
  'euros',
  'bitcoin',
  'btc',
  'ethereum',
  'eth',
  'ether',
  'crypto',
  'cryptomonnaie',
  'cryptomonnaies',
]);

const NOT_A_COMPANY = new Set([
  'yahoo',
  'google',
  'internet',
  'web',
  'bourse',
  'action',
  'actions',
  'cours',
  'cotation',
  'paris',
  'euronext',
  'cac',
  'cac40',
]);

function normalizeSpaces(text: string): string {
  return text.replace(/[’`]/g, "'").replace(/\s+/g, ' ').trim();
}

function fold(text: string): string {
  return text.toLowerCase().normalize('NFD').replace(/\p{M}/gu, '');
}

function stripAddress(text: string): string {
  let current = normalizeSpaces(text);
  for (let i = 0; i < 3; i += 1) {
    const next = current
      .replace(/^(?:jarvis[,:!\s]+)+/i, '')
      .replace(/^(?:s'il te plait[, ]+|stp[, ]+)/i, '')
      .replace(/^(?:dis[- ]moi|tu peux me dire|peux[- ]tu me dire|je (?:voudrais|veux|voulais) savoir|quel est|quelle est|c'est quoi|donne[- ]moi)\s+/i, '')
      .trim();
    if (next === current) break;
    current = next;
  }
  return current;
}

function hasStockCue(folded: string): boolean {
  if (/\bcomment va l'action\b/.test(folded)) return true;
  if (/\bcotation\b/.test(folded)) return true;
  if (/\ben bourse\b/.test(folded)) return true;
  if (/\byahoo\b/.test(folded) && /\b(?:cours|cotation|action|bourse)\b/.test(folded)) return true;
  const marker = /cours d(?:e |')/g;
  let match: RegExpExecArray | null;
  while ((match = marker.exec(folded))) {
    const before = folded.slice(Math.max(0, match.index - 4), match.index);
    if (/(?:^|\s)(?:au|en)\s$/.test(before)) continue;
    return true;
  }
  return false;
}

function preferParis(folded: string): 'paris' | null {
  if (/\beuronext\b/.test(folded) || /\bcac\b/.test(folded) || /\bparis\b/.test(folded)) return 'paris';
  if (/\bfrancais(?:e)?\b/.test(folded) && !/\bcours de francais\b/.test(folded)) return 'paris';
  return null;
}

function cutTail(span: string): string {
  return span
    .replace(/\s+(?:sur yahoo finance|yahoo finance|sur yahoo|en bourse|aujourd'hui|s'il te plait|stp|merci|jarvis)\b[\s\S]*$/i, '')
    .replace(/\s+au cours de\b[\s\S]*$/i, '')
    .replace(/\s+(?:a|à)\s+paris\b[\s\S]*$/i, '')
    .replace(/\s+(?:sur|au)\s+(?:l')?euronext\b[\s\S]*$/i, '')
    .replace(/\s+(?:au|sur le)\s+cac(?:\s*40)?\b[\s\S]*$/i, '')
    .replace(/,?\s+l'entreprise\s+fran[cç]aise\b[\s\S]*$/i, '')
    .replace(/[?.!]+$/g, '')
    .trim();
}

function cleanOne(part: string): string {
  let text = part.replace(/[?.!,;:]+$/g, '').replace(/\s+/g, ' ').trim();
  text = text.replace(/^(?:combien vaut|quel est le cours de|cours de l'action|l'action|l'entreprise|la societe|la société|la valeur|une action)\s+/i, '').trim();
  text = text.replace(/\b(?:française|français|francaise|francais)\b/gi, ' ').replace(/\s+/g, ' ').trim();
  if (/^l'[\p{Lu}]/u.test(text)) return text;
  text = text.replace(/^(?:l'|la |le |les |des |du |de |d')+/i, '').trim();
  return text;
}

function isCompany(name: string): boolean {
  const folded = fold(name);
  if (folded.length < 2 || folded.length > 40) return false;
  if (name.split(/\s+/).length > 4) return false;
  if (LESSONS.has(folded) || COMMODITIES.has(folded) || NOT_A_COMPANY.has(folded)) return false;
  if (!/\p{L}/u.test(name)) return false;
  return true;
}

function splitNames(span: string): string[] {
  return cutTail(span)
    .split(/\s*,\s*|\s+et\s+(?:de\s+|d')?/i)
    .map((part) => cleanOne(part))
    .filter((part) => isCompany(part))
    .slice(0, 5);
}

const NAME_PATTERNS: RegExp[] = [
  /comment va l'action\s+(.+)/i,
  /cotation\s+(?:de\s+|d'|du\s+|de la\s+|de l')(.+)/i,
  /cours\s+de\s+l'action\s+(.+)/i,
  /combien vaut\s+(.+?)\s+en bourse\b/i,
  /cours\s+(?:de\s+|d'|du\s+|de la\s+|de l')(.+)/i,
  /([^\s,]+(?:\s+[^\s,]+){0,3})\s+en bourse\b/i,
];

/** `null` : ce n'est pas une demande de cours d'action. */
export function detectStockRequest(text: string): StockRequest | null {
  const spoken = stripAddress(text);
  if (!spoken) return null;
  const folded = fold(spoken);
  if (!hasStockCue(folded)) return null;
  if (/\bau cours de\b/.test(folded) && !/\b(?:en bourse|cotation|yahoo|l'action)\b/.test(folded)) {
    const onlyLesson = !/cours d(?:e |')/.test(folded.replace(/au cours de/g, ' '));
    if (onlyLesson) return null;
  }

  for (const pattern of NAME_PATTERNS) {
    const match = pattern.exec(spoken);
    const span = match?.[1];
    if (!span) continue;
    const names = splitNames(span);
    if (!names.length) continue;
    return { names, prefer: preferParis(folded) };
  }
  return null;
}
