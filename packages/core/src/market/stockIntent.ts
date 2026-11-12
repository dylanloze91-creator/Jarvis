/**
 * Demande de cours d'action, décidée sans modèle.
 * « cours de X » seul ne suffit pas : il faut un indice (bourse, action, cotation,
 * Yahoo, combien vaut…) ou un nom qui ressemble à une entreprise (majuscule, SPIE, LVMH).
 * Un mot en minuscules sans indice, un possessif, un horaire ou un agenda restent au cerveau.
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
  return text
    .replace(/[’`]/g, "'")
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{M}/gu, '');
}

/** Même avec une majuscule, ces phrases ne sont pas une demande de bourse. */
function blockedStock(folded: string): boolean {
  if (/\b(?:mon|ma|mes|ton|ta|tes|notre|votre)\b/.test(folded)) return true;
  if (/\b(?:demain|aujourd'hui|hier|ce matin|ce soir|ce midi|lundi|mardi|mercredi|jeudi|vendredi|samedi|dimanche)\b/.test(folded)) {
    return true;
  }
  if (/\b\d{1,2}\s?h\b/.test(folded)) return true;
  if (/\b(?:agenda|calendrier|rappelle|rendez-vous)\b/.test(folded)) return true;
  if (/\ba quelle heure\b/.test(folded) || /\brate\b/.test(folded)) return true;
  if (/\bj'ai cours\b/.test(folded) || /\bun cours de\b/.test(folded) || /\bdes cours de\b/.test(folded)) return true;
  return false;
}

/** Indice qui permet un nom en minuscules (« spi en bourse », « l'action spi »). */
function hasStrongClue(folded: string): boolean {
  return (
    /\ben bourse\b/.test(folded) ||
    /\bl'action\b/.test(folded) ||
    /\bcotation\b/.test(folded) ||
    /\byahoo\b/.test(folded) ||
    /\b(?:combien|ca) vaut\b/.test(folded) ||
    /\bbourse\b/.test(folded) ||
    /\bcac\b/.test(folded) ||
    /\beuronext\b/.test(folded) ||
    /\bnasdaq\b/.test(folded)
  );
}

function hasCapital(name: string): boolean {
  return /\p{Lu}/u.test(name);
}

/** « la Seine », « l'eau », « la vie » : pas un nom d'entreprise. « L'Oréal » si. */
function isCommonCourse(raw: string): boolean {
  const text = raw.trim();
  if (/^(?:la |le |les |du |des |une |un )/i.test(text)) return true;
  return /^l'(?=\p{Ll})/u.test(text);
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

function splitNames(span: string, strong: boolean): string[] {
  return cutTail(span)
    .split(/\s*,\s*|\s+et\s+(?:de\s+|d')?/i)
    .filter((part) => (strong ? true : !isCommonCourse(part)))
    .map((part) => cleanOne(part))
    .filter((part) => isCompany(part) && (strong || hasCapital(part)))
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

/** `null` : ce n'est pas une demande de cours d'action. Le cerveau choisit. */
export function detectStockRequest(text: string): StockRequest | null {
  const spoken = stripAddress(text);
  if (!spoken) return null;
  const folded = fold(text);
  if (blockedStock(folded)) return null;
  const strong = hasStrongClue(folded);

  for (const pattern of NAME_PATTERNS) {
    const match = pattern.exec(spoken);
    const span = match?.[1];
    if (!span) continue;
    const names = splitNames(span, strong);
    if (!names.length) continue;
    return { names, prefer: preferParis(folded) };
  }
  return null;
}
