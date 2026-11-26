/**
 * Jarvis Développeur facile, étape 3, § 3 : « Claude en renfort » (`docs/specs/developpeur-facile-etape3.md`).
 * Jarvis Test seulement, coupé par défaut.
 *
 * Quand une étape est trop dure pour le modèle local, Jarvis **propose** de la confier à Claude, sur
 * une carte : pourquoi, quel modèle, combien de temps et combien ça coûte (« environ »), ce qui a déjà
 * été dépensé et le plafond. Rien ne part sans le clic de l'utilisateur, jamais depuis une enceinte.
 *
 * Tout est pur ici (ni Electron, ni réseau, sauf `callClaude` qui prend son `fetch` en paramètre) :
 * la table des prix, le choix du modèle, l'estimation, le plafond et le compte des dépenses, ce qui
 * part chez Claude et ce qui n'y part jamais, la lecture de sa réponse.
 *
 * Étape appelable (cap « chef de projet », § 5) : entrées et sorties typées, résultat honnête
 * (coût réel, fichiers reçus, fichiers refusés), faux Claude pour les essais.
 */
import { redactSecrets } from '../../security/redact.js';

// ---------------------------------------------------------------------------------------------
// Modèles et prix

/**
 * Relevé dans la documentation d'Anthropic le 27 novembre 2026 :
 * - https://platform.claude.com/docs/en/about-claude/models/overview (identifiants)
 * - https://platform.claude.com/docs/en/about-claude/pricing (prix, en dollars par million de jetons)
 * À relire avant de s'en servir longtemps après : les prix changent.
 */
export const CLAUDE_PRICES_DATE = '2026-11-27';
export const CLAUDE_PRICES_SOURCE = 'https://platform.claude.com/docs/en/about-claude/pricing';

export type ClaudeFamily = 'haiku' | 'sonnet' | 'opus';

export interface ClaudeModel {
  /** Identifiant exact de l'API. */
  id: string;
  nom: string;
  famille: ClaudeFamily;
  /** Dollars par million de jetons. */
  inputUsd: number;
  outputUsd: number;
  /** Prix plus hauts quand la demande dépasse ce nombre de jetons (Haiku 5.5 : 100 000). */
  long?: { au_dela: number; inputUsd: number; outputUsd: number };
  /**
   * Jetons écrits par seconde, pour estimer la durée. **Hypothèse de Jarvis**, pas un chiffre
   * d'Anthropic (sa documentation ne donne que « le plus rapide / rapide / modéré ») : à corriger
   * avec les durées mesurées dès les premiers appels réels.
   */
  jetonsParSeconde: number;
}

export const CLAUDE_MODELS: readonly ClaudeModel[] = [
  { id: 'claude-haiku-5-5', nom: 'Claude Haiku 5.5', famille: 'haiku', inputUsd: 0.1, outputUsd: 0.5, long: { au_dela: 100_000, inputUsd: 0.5, outputUsd: 2.5 }, jetonsParSeconde: 120 },
  { id: 'claude-sonnet-5-5', nom: 'Claude Sonnet 5.5', famille: 'sonnet', inputUsd: 2, outputUsd: 10, jetonsParSeconde: 70 },
  { id: 'claude-opus-5-5', nom: 'Claude Opus 5.5', famille: 'opus', inputUsd: 4, outputUsd: 20, jetonsParSeconde: 50 },
];

export function claudeModel(idOrFamily: string): ClaudeModel | undefined {
  return CLAUDE_MODELS.find((m) => m.id === idOrFamily || m.famille === idOrFamily);
}

/** Un modèle de Claude ? (sert à marquer et à exclure de l'entraînement). */
export function isClaudeModel(model: string | null | undefined): boolean {
  return /^claude[-:]/i.test(model?.trim() ?? '');
}

/**
 * Limite inscrite dans la preuve d'une mission où Claude a écrit quelque chose : `stagingFor` la
 * rejette, elle ne devient jamais un exemple d'entraînement.
 */
export const RENFORT_EVIDENCE_LIMIT = 'Une partie de ce travail a été écrite par Claude (renfort) : jamais dans un jeu d’entraînement.';

// ---------------------------------------------------------------------------------------------
// Quand proposer Claude, et quel modèle

/** Les signes mesurés qui font proposer Claude (cahier, § 3.1). */
export type RenfortReason = 'meme-erreur' | 'trop-grand' | 'delai' | 'illisible' | 'demande';

export const RENFORT_REASON_TEXT: Record<RenfortReason, string> = {
  'meme-erreur': 'j’ai fait deux fois la même erreur sur cette étape',
  'trop-grand': 'cette appli est trop grande pour mon petit modèle',
  delai: 'mon petit modèle a mis trop de temps sur cette étape',
  illisible: 'mon petit modèle m’a rendu une réponse que je ne sais pas lire, même après une relance',
  demande: 'tu me l’as demandé',
};

/**
 * Le signe mesuré, lu dans ce que le moteur a vraiment conclu. `null` : rien ne justifie Claude.
 * Jamais « au hasard » : sans l'un de ces signes, la carte n'apparaît pas.
 */
export function renfortReason(input: {
  /** Arrêt net du moteur : la correction a reproduit les mêmes échecs. */
  repeatedFailure?: unknown;
  /** Contrôle de difficulté : mission non lancée car trop grande pour le Codeur local. */
  gateRefused?: boolean;
  /** Raison d'échec dite par le moteur. */
  failureReason?: string | null;
  /** L'utilisateur l'a demandé. */
  asked?: boolean;
}): RenfortReason | null {
  if (input.asked) return 'demande';
  if (input.repeatedFailure) return 'meme-erreur';
  if (input.gateRefused) return 'trop-grand';
  const raison = (input.failureReason ?? '').toLowerCase();
  if (/d[ée]lai|trop de temps|timeout|dur[ée]e d[ée]pass[ée]e|[ée]ch[ée]ance/.test(raison)) return 'delai';
  if (/illisible|hors format|format|json|pas de code|ne contient pas de code/.test(raison)) return 'illisible';
  return null;
}

const WAKE = /^(?:(?:dis|ok|hey|eh|bon|alors)[,\s]+)?jarvis[,\s]+/iu;

/** « passe à Claude pour cette étape », « demande à Claude », « fais-le avec Claude ». */
export function detectRenfortRequest(text: string): { famille: ClaudeFamily | null } | null {
  const t = text.trim().replace(WAKE, '').toLowerCase().replace(/\s+/g, ' ');
  if (t.length > 160) return null;
  if (!/\b(?:passe|demande|confie|donne|envoie|utilise|prends|essaie|essaye|fais|continue|termine|finis)\b.*\b(?:claude|haiku|sonnet|opus)\b/.test(t)) return null;
  const famille = /\bopus\b/.test(t) ? 'opus' : /\bsonnet\b/.test(t) ? 'sonnet' : /\bhaiku\b/.test(t) ? 'haiku' : null;
  return { famille };
}

/**
 * Le plus petit modèle qui convient : Haiku pour une correction ciblée, Sonnet pour une étape
 * difficile ou une appli trop grande. **Jamais Opus sans que l'utilisateur le demande.**
 */
export function chooseRenfortModel(reason: RenfortReason, asked: ClaudeFamily | null = null): ClaudeModel {
  if (asked) return claudeModel(asked)!;
  return claudeModel(reason === 'meme-erreur' || reason === 'illisible' ? 'haiku' : 'sonnet')!;
}

// ---------------------------------------------------------------------------------------------
// Estimation et coût réel

/**
 * Jetons d'un texte, comptés large : environ 2,8 caractères par jeton. La documentation dit que le
 * découpage des modèles récents donne environ 30 % de jetons de plus qu'avant pour le même texte :
 * mieux vaut annoncer un peu trop que pas assez.
 */
export function estimateClaudeTokens(text: string | number): number {
  const chars = typeof text === 'number' ? text : text.length;
  return Math.ceil(Math.max(0, chars) / 2.8);
}

export interface RenfortUsage {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens?: number;
  cacheCreationTokens?: number;
}

/** Le coût en dollars d'un appel, d'après les jetons rendus par l'API (ou estimés). */
export function claudeCostUsd(model: ClaudeModel, usage: RenfortUsage): number {
  const lu = usage.cacheReadTokens ?? 0;
  const ecrit = usage.cacheCreationTokens ?? 0;
  // La longueur de la demande compte tous les jetons d'entrée, cache compris.
  const long = model.long && usage.inputTokens + lu + ecrit > model.long.au_dela ? model.long : null;
  const prixEntree = long?.inputUsd ?? model.inputUsd;
  const prixSortie = long?.outputUsd ?? model.outputUsd;
  // Jarvis ne se sert pas du cache : s'il y en a quand même, il est compté au prix plein (au plus cher).
  return ((usage.inputTokens + lu + ecrit) * prixEntree + usage.outputTokens * prixSortie) / 1_000_000;
}

export interface RenfortEstimate {
  modele: string;
  /** Appels prévus (un par fichier à écrire, plus une marge pour une correction). */
  appels: number;
  inputTokens: number;
  outputTokens: number;
  usd: number;
  eur: number;
  secondes: number;
}

/** Jetons de sortie demandés au plus par appel. */
export const RENFORT_MAX_OUTPUT_TOKENS = 16_000;

/**
 * Estimation « environ », calculée d'après la taille de ce qui sera envoyé et une marge pour la
 * réponse (cahier, § 3.2). Chaque appel renvoie tout le contexte et écrit un fichier ; la moitié des
 * fichiers sont comptés une seconde fois, pour une correction après les essais.
 */
export function estimateRenfort(input: { model: ClaudeModel; contextChars: number; filesToWrite: { chars: number }[]; usdToEur?: number }): RenfortEstimate {
  const fichiers = input.filesToWrite.length || 1;
  const appels = Math.ceil(fichiers * 1.5);
  const entreeParAppel = estimateClaudeTokens(input.contextChars) + 600;
  const tailleMoyenne = input.filesToWrite.reduce((s, f) => s + f.chars, 0) / fichiers;
  // Réponse : le fichier réécrit (plus gros qu'avant), plus la réflexion du modèle, facturée comme de la sortie.
  const sortieParAppel = Math.min(RENFORT_MAX_OUTPUT_TOKENS, Math.max(1_500, Math.ceil(estimateClaudeTokens(tailleMoyenne) * 1.6 + 1_200)));
  const inputTokens = entreeParAppel * appels;
  const outputTokens = sortieParAppel * appels;
  const usd = claudeCostUsd(input.model, { inputTokens: entreeParAppel, outputTokens: sortieParAppel }) * appels;
  return {
    modele: input.model.id,
    appels,
    inputTokens,
    outputTokens,
    usd,
    eur: usd * usdToEur(input.usdToEur),
    secondes: Math.ceil(appels * (4 + sortieParAppel / input.model.jetonsParSeconde)),
  };
}

/**
 * Un dollar compté comme un euro tant que l'utilisateur n'a pas réglé le taux : Anthropic facture en
 * dollars, le plafond est en euros. Le taux réglé est borné (0,5 à 2).
 */
export function usdToEur(rate?: number): number {
  return typeof rate === 'number' && Number.isFinite(rate) && rate >= 0.5 && rate <= 2 ? rate : 1;
}

/** « environ 3 centimes », « environ 1,20 € », « moins d'un centime ». */
export function direEuros(eur: number, environ = true): string {
  const e = environ ? 'environ ' : '';
  if (eur < 0.005) return 'moins d’un centime';
  if (eur < 0.995) {
    const c = Math.max(1, Math.round(eur * 100));
    return `${e}${c} centime${c > 1 ? 's' : ''}`;
  }
  return `${e}${eur.toFixed(2).replace('.', ',')} €`;
}

/** « environ 40 secondes », « environ 3 minutes ». */
export function direDuree(secondes: number): string {
  if (secondes < 50) return `environ ${Math.max(10, Math.round(secondes / 10) * 10)} secondes`;
  const m = Math.max(1, Math.round(secondes / 60));
  return `environ ${m} minute${m > 1 ? 's' : ''}`;
}

// ---------------------------------------------------------------------------------------------
// Plafond et dépenses

/** Plafond par appli quand rien n'est réglé (cahier, § 3.3). */
export const RENFORT_DEFAULT_CAP_EUR = 2;

export interface RenfortCaps {
  /** Par appli, en euros. */
  parAppli: number;
  /** Par mois, en euros. `null` : pas de plafond par mois. */
  parMois: number | null;
}

export function renfortCaps(settings?: { capPerAppEur?: number; capPerMonthEur?: number } | null): RenfortCaps {
  const ok = (x: unknown): x is number => typeof x === 'number' && Number.isFinite(x) && x >= 0;
  return {
    parAppli: ok(settings?.capPerAppEur) ? settings!.capPerAppEur! : RENFORT_DEFAULT_CAP_EUR,
    parMois: ok(settings?.capPerMonthEur) ? settings!.capPerMonthEur! : null,
  };
}

export interface RenfortCall {
  quand: number;
  modele: string;
  etape: string;
  inputTokens: number;
  outputTokens: number;
  usd: number;
  eur: number;
}

/** Le registre des dépenses : par appli et par mois (« 2026-11 »). Écrit par le PC, hors des réglages. */
export interface RenfortLedger {
  version: 1;
  applis: Record<string, { nom: string; eur: number; appels: RenfortCall[] }>;
  mois: Record<string, number>;
}

export function emptyRenfortLedger(): RenfortLedger {
  return { version: 1, applis: {}, mois: {} };
}

export function renfortMonthKey(now: number): string {
  const d = new Date(now);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

/** Lecture tolérante : ce qui n'est pas un nombre est ignoré. */
export function parseRenfortLedger(text: string): RenfortLedger {
  const out = emptyRenfortLedger();
  const data = JSON.parse(text) as Partial<RenfortLedger>;
  if (!data || typeof data !== 'object') throw new Error('registre illisible');
  for (const [id, a] of Object.entries(data.applis ?? {})) {
    if (!a || typeof a.eur !== 'number' || !Number.isFinite(a.eur)) continue;
    out.applis[id] = { nom: typeof a.nom === 'string' ? a.nom : id, eur: a.eur, appels: Array.isArray(a.appels) ? a.appels.filter((c) => c && typeof c.eur === 'number') : [] };
  }
  for (const [m, v] of Object.entries(data.mois ?? {})) if (typeof v === 'number' && Number.isFinite(v)) out.mois[m] = v;
  return out;
}

export function renfortSpentOn(ledger: RenfortLedger, appId: string): number {
  return ledger.applis[appId]?.eur ?? 0;
}

export type BudgetCheck =
  | { ok: true; resteAppli: number; resteMois: number | null }
  | { ok: false; lequel: 'appli' | 'mois'; plafond: number; depense: number; phrase: string };

/**
 * Avant chaque appel : si l'estimation fait dépasser un plafond, pas d'appel (cahier, § 3.3).
 * `prevuEur` : ce que l'appel (ou la suite des appels) devrait coûter.
 */
export function checkRenfortBudget(ledger: RenfortLedger, appId: string, prevuEur: number, caps: RenfortCaps, now: number): BudgetCheck {
  const depenseAppli = renfortSpentOn(ledger, appId);
  if (depenseAppli + prevuEur > caps.parAppli + 1e-9) {
    return {
      ok: false,
      lequel: 'appli',
      plafond: caps.parAppli,
      depense: depenseAppli,
      phrase: `Plafond atteint pour cette appli : ${direEuros(depenseAppli, false)} déjà dépensés sur ${direEuros(caps.parAppli, false)}, et cette étape coûterait ${direEuros(prevuEur)}. Je n’appelle pas Claude.`,
    };
  }
  const depenseMois = ledger.mois[renfortMonthKey(now)] ?? 0;
  if (caps.parMois !== null && depenseMois + prevuEur > caps.parMois + 1e-9) {
    return {
      ok: false,
      lequel: 'mois',
      plafond: caps.parMois,
      depense: depenseMois,
      phrase: `Plafond du mois atteint : ${direEuros(depenseMois, false)} déjà dépensés sur ${direEuros(caps.parMois, false)}. Je n’appelle pas Claude.`,
    };
  }
  return { ok: true, resteAppli: caps.parAppli - depenseAppli, resteMois: caps.parMois === null ? null : caps.parMois - depenseMois };
}

/** Après chaque appel : le coût réel, ajouté à l'appli et au mois. Rend un nouveau registre. */
export function addRenfortSpend(ledger: RenfortLedger, appId: string, nom: string, call: RenfortCall): RenfortLedger {
  const avant = ledger.applis[appId] ?? { nom, eur: 0, appels: [] };
  const mois = renfortMonthKey(call.quand);
  return {
    version: 1,
    applis: { ...ledger.applis, [appId]: { nom: avant.nom || nom, eur: avant.eur + call.eur, appels: [...avant.appels, call].slice(-200) } },
    mois: { ...ledger.mois, [mois]: (ledger.mois[mois] ?? 0) + call.eur },
  };
}

// ---------------------------------------------------------------------------------------------
// Ce qui part chez Claude, et ce qui n'y part jamais (cahier, § 3.4)

export interface RenfortFile {
  /** Chemin relatif au dossier du projet. */
  path: string;
  content: string;
}

/** Taille d'un fichier au plus : au-delà, il ne part pas (et c'est dit). */
export const RENFORT_FILE_MAX_CHARS = 60_000;
/** Taille de tout l'envoi au plus. */
export const RENFORT_TOTAL_MAX_CHARS = 240_000;

const SECRET_FILE =
  /(?:^|\/)(?:\.env(?:\..*)?|.*\.(?:pem|key|p12|pfx|keystore|jks)|id_(?:rsa|dsa|ed25519)(?:\.pub)?|credentials(?:\..*)?|secrets?(?:\..*)?|settings\.json|coffre\.bin|.*token.*\.(?:json|bin|txt)|\.npmrc|\.netrc|.*\.sqlite3?|personalization\.json|speakers\.json|phone\.json)$/i;
const NOT_PROJECT = /(?:^|\/)(?:node_modules|\.git|dist|build|out|release|coverage|\.vite)(?:\/|$)/i;

/** Pourquoi ce fichier ne part pas, ou `null` s'il peut partir. */
export function renfortFileRefusal(file: RenfortFile): string | null {
  const p = file.path.replace(/\\/g, '/').trim();
  if (!p || p.startsWith('/') || /^[a-z]:/i.test(p) || p.split('/').includes('..')) return 'hors du dossier du projet';
  if (NOT_PROJECT.test(p)) return 'dossier technique (dépendances, sorties de construction, git)';
  if (SECRET_FILE.test(p)) return 'fichier de clés ou de réglages';
  if (file.content.includes('\u0000')) return 'fichier binaire';
  if (file.content.length > RENFORT_FILE_MAX_CHARS) return 'fichier trop gros';
  return null;
}

export interface RenfortPackage {
  system: string;
  prompt: string;
  /** Ce qui part, avec sa taille : montré à l'utilisateur avant l'envoi. */
  envoyes: { path: string; chars: number; masque: boolean }[];
  /** Ce qui ne part pas, et pourquoi. */
  refuses: { path: string; raison: string }[];
  chars: number;
}

export const RENFORT_SYSTEM = [
  'Tu aides à finir une petite application. Un autre programme (Jarvis) a posé la base, écrit un plan, lancé les essais, et bloque sur une étape.',
  'Tu reçois la demande, le plan, les fichiers du projet concernés et les erreurs des essais.',
  'Écris le contenu COMPLET des fichiers demandés, et seulement ceux-là. Ne touche à aucun autre fichier, ne change pas les dépendances.',
  'Format de réponse, strict, sans rien avant ni après :',
  '@@ FICHIER chemin/relatif.ext',
  '<contenu complet du fichier>',
  '@@ FIN',
  'Un bloc par fichier. Puis, facultatif, une ligne « @@ NOTE » suivie de deux phrases au plus pour dire ce que tu as changé.',
].join('\n');

/**
 * Prépare l'envoi : seulement la demande, le plan, les fichiers du projet concernés et les erreurs
 * des essais. Chaque fichier passe la garde (hors projet, clés, réglages, binaire, trop gros) et
 * son contenu passe par `redactSecrets` (la même garde que le journal). Rien d'autre ne part.
 */
export function buildRenfortPackage(input: { objectif: string; plan: string; aEcrire: readonly string[]; fichiers: readonly RenfortFile[]; erreurs: string }): RenfortPackage {
  const envoyes: RenfortPackage['envoyes'] = [];
  const refuses: RenfortPackage['refuses'] = [];
  const blocs: string[] = [];
  let total = 0;
  for (const f of input.fichiers) {
    const refus = renfortFileRefusal(f);
    if (refus) {
      refuses.push({ path: f.path, raison: refus });
      continue;
    }
    const propre = redactSecrets(f.content);
    if (total + propre.length > RENFORT_TOTAL_MAX_CHARS) {
      refuses.push({ path: f.path, raison: 'l’envoi serait trop gros' });
      continue;
    }
    total += propre.length;
    envoyes.push({ path: f.path.replace(/\\/g, '/'), chars: propre.length, masque: propre !== f.content });
    blocs.push(`--- ${f.path.replace(/\\/g, '/')}\n${propre}`);
  }
  const prompt = [
    `Demande de l'utilisateur :\n${redactSecrets(input.objectif).slice(0, 4_000)}`,
    `Plan :\n${redactSecrets(input.plan).slice(0, 8_000) || '(pas de plan écrit)'}`,
    `Fichiers à écrire (contenu complet de chacun) :\n${input.aEcrire.map((p) => `- ${p.replace(/\\/g, '/')}`).join('\n')}`,
    `Erreurs des essais :\n${redactSecrets(input.erreurs).slice(0, 12_000) || '(aucune : les essais n’ont pas encore tourné)'}`,
    `Fichiers du projet :\n${blocs.join('\n\n') || '(aucun)'}`,
  ].join('\n\n');
  return { system: RENFORT_SYSTEM, prompt, envoyes, refuses, chars: RENFORT_SYSTEM.length + prompt.length };
}

/**
 * La réponse de Claude : les fichiers écrits. Un fichier qui n'était pas demandé, ou que la garde
 * refuse, n'est pas gardé (et c'est dit). Rien n'est écrit ici : le moteur écrit, avec ses contrôles.
 */
export function parseRenfortReply(text: string, demandes: readonly string[]): { fichiers: RenfortFile[]; refuses: { path: string; raison: string }[]; note: string } {
  const voulus = new Set(demandes.map((p) => p.replace(/\\/g, '/')));
  const fichiers: RenfortFile[] = [];
  const refuses: { path: string; raison: string }[] = [];
  const re = /^@@ FICHIER[ \t]+(.+?)[ \t]*\r?\n([\s\S]*?)\r?\n@@ FIN[ \t]*$/gm;
  for (const m of text.matchAll(re)) {
    const path = m[1]!.trim().replace(/\\/g, '/').replace(/^\.\//, '');
    let content = m[2]!;
    // Un bloc ``` autour du contenu : retiré.
    const cloture = /^```[a-z0-9]*\r?\n([\s\S]*?)\r?\n```\s*$/i.exec(content.trim());
    if (cloture) content = cloture[1]!;
    const refus = renfortFileRefusal({ path, content }) ?? (voulus.has(path) ? null : 'fichier non demandé');
    if (refus) refuses.push({ path, raison: refus });
    else if (!fichiers.some((f) => f.path === path)) fichiers.push({ path, content: content.endsWith('\n') ? content : `${content}\n` });
  }
  const note = /^@@ NOTE[ \t]*\r?\n?([\s\S]*)$/m.exec(text)?.[1]?.trim().slice(0, 400) ?? '';
  return { fichiers, refuses, note };
}

// ---------------------------------------------------------------------------------------------
// L'appel (Messages API d'Anthropic)

export interface ClaudeReply {
  text: string;
  usage: RenfortUsage;
  /** `end_turn`, `max_tokens`, `refusal`… */
  stopReason: string;
  model: string;
}

/** Un appel à Claude. Les essais passent un faux ; le PC passe `callClaude` avec la clé du coffre. */
export type ClaudeCaller = (input: { model: string; system: string; prompt: string; maxTokens: number; signal?: AbortSignal }) => Promise<ClaudeReply>;

export class ClaudeCallError extends Error {
  constructor(
    message: string,
    readonly status: number | null,
  ) {
    super(message);
    this.name = 'ClaudeCallError';
  }
}

/**
 * Un appel à la Messages API, sans flux (`POST /v1/messages`). La clé ne part que dans l'en-tête
 * `x-api-key` ; aucun message d'erreur ne la contient.
 *
 * Le dépôt parle déjà à Anthropic en HTTP direct (`providers/anthropic.ts`), sans le SDK : même
 * choix ici, pour garder un `fetch` remplaçable dans les essais et aucune dépendance de plus.
 * Ni `temperature`, ni `thinking`, ni réponse amorcée : les modèles de 2026 les refusent (400).
 */
export function callClaude(fetchImpl: typeof fetch, apiKey: string, baseUrl = 'https://api.anthropic.com'): ClaudeCaller {
  return async ({ model, system, prompt, maxTokens, signal }) => {
    if (!apiKey.trim()) throw new ClaudeCallError('Clé Anthropic absente.', null);
    let res: Response;
    try {
      res = await fetchImpl(`${baseUrl.replace(/\/+$/, '')}/v1/messages`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-api-key': apiKey.trim(), 'anthropic-version': '2023-06-01' },
        body: JSON.stringify({ model, max_tokens: maxTokens, system, messages: [{ role: 'user', content: prompt }] }),
        ...(signal ? { signal } : {}),
      });
    } catch (error) {
      throw new ClaudeCallError(`Claude est injoignable : ${redactSecrets(error instanceof Error ? error.message : String(error)).slice(0, 200)}`, null);
    }
    const brut = await res.text();
    if (!res.ok) {
      let detail = '';
      try {
        detail = (JSON.parse(brut) as { error?: { message?: string } }).error?.message ?? '';
      } catch {
        /* pas du JSON */
      }
      const quoi =
        res.status === 401 ? 'la clé est refusée' : res.status === 429 ? 'trop de demandes, ou crédit épuisé' : res.status === 400 ? 'demande refusée' : res.status >= 500 ? 'panne chez Anthropic' : `erreur ${res.status}`;
      throw new ClaudeCallError(`Claude n’a pas répondu : ${quoi}${detail ? ` (${redactSecrets(detail).slice(0, 200)})` : ''}.`, res.status);
    }
    const data = JSON.parse(brut) as {
      model?: string;
      stop_reason?: string;
      content?: { type?: string; text?: string }[];
      usage?: { input_tokens?: number; output_tokens?: number; cache_read_input_tokens?: number; cache_creation_input_tokens?: number };
    };
    const n = (x: unknown) => (typeof x === 'number' && Number.isFinite(x) ? x : 0);
    return {
      text: (data.content ?? []).filter((b) => b.type === 'text' && typeof b.text === 'string').map((b) => b.text).join(''),
      usage: {
        inputTokens: n(data.usage?.input_tokens),
        outputTokens: n(data.usage?.output_tokens),
        cacheReadTokens: n(data.usage?.cache_read_input_tokens),
        cacheCreationTokens: n(data.usage?.cache_creation_input_tokens),
      },
      stopReason: data.stop_reason ?? '',
      model: data.model ?? model,
    };
  };
}

// ---------------------------------------------------------------------------------------------
// La carte

export type RenfortState = 'propose' | 'sans-cle' | 'plafond' | 'en-cours' | 'fait' | 'rate' | 'refuse';

/** Ce que la carte « Claude en renfort » affiche. Écrit dans la carte de la création. */
export interface RenfortCard {
  etat: RenfortState;
  /** L'étape concernée, en une phrase. */
  etape: string;
  raison: RenfortReason;
  /** Pourquoi le local n'y arrive pas, en mots simples. */
  pourquoi: string;
  modele: { id: string; nom: string };
  estimation: { secondes: number; eur: number; appels: number; texte: string };
  /** Déjà dépensé sur cette appli, et le plafond (euros). */
  depenseEur: number;
  plafondEur: number;
  /** Ce qui partirait : nombre de fichiers et taille. */
  envoi: { fichiers: string[]; refuses: { path: string; raison: string }[]; chars: number };
  /** Après l'appel : le coût réel de cet appel, les fichiers reçus. */
  coutReelEur?: number;
  fichiersRecus?: string[];
  message?: string;
}

/** La phrase de la carte : jamais sans « environ ». */
export function renfortSentence(card: Pick<RenfortCard, 'pourquoi' | 'modele' | 'estimation' | 'depenseEur' | 'plafondEur'>): string {
  return `Cette étape est trop dure pour moi : ${card.pourquoi}. Je propose de la confier à Claude (${card.modele.nom}) : ${card.estimation.texte}. Déjà dépensé sur cette appli : ${direEuros(card.depenseEur, false)} sur ${direEuros(card.plafondEur, false)}.`;
}

export const RENFORT_NO_KEY =
  'Je pourrais confier cette étape à Claude, mais aucune clé Anthropic n’est réglée. Pour l’ajouter : Réglages → Développeur → « Claude en renfort ». Je continue en local.';
export const RENFORT_FROM_SPEAKER = 'Je ne confie rien à Claude depuis l’enceinte : la carte est sur le PC.';

/** Construit la carte de proposition (rien n'est envoyé). */
export function proposeRenfort(input: {
  etape: string;
  raison: RenfortReason;
  famille?: ClaudeFamily | null;
  colis: RenfortPackage;
  aEcrire: { path: string; chars: number }[];
  ledger: RenfortLedger;
  appId: string;
  caps: RenfortCaps;
  now: number;
  cle: boolean;
  usdToEur?: number;
}): RenfortCard {
  const modele = chooseRenfortModel(input.raison, input.famille ?? null);
  const e = estimateRenfort({ model: modele, contextChars: input.colis.chars, filesToWrite: input.aEcrire, ...(input.usdToEur !== undefined ? { usdToEur: input.usdToEur } : {}) });
  const depenseEur = renfortSpentOn(input.ledger, input.appId);
  const budget = checkRenfortBudget(input.ledger, input.appId, e.eur, input.caps, input.now);
  const base: RenfortCard = {
    etat: 'propose',
    etape: input.etape,
    raison: input.raison,
    pourquoi: RENFORT_REASON_TEXT[input.raison],
    modele: { id: modele.id, nom: modele.nom },
    estimation: { secondes: e.secondes, eur: e.eur, appels: e.appels, texte: `${direDuree(e.secondes)}, ${direEuros(e.eur)}` },
    depenseEur,
    plafondEur: input.caps.parAppli,
    envoi: { fichiers: input.colis.envoyes.map((f) => f.path), refuses: input.colis.refuses, chars: input.colis.chars },
  };
  if (!input.cle) return { ...base, etat: 'sans-cle', message: RENFORT_NO_KEY };
  if (!budget.ok) return { ...base, etat: 'plafond', message: budget.phrase };
  return { ...base, message: renfortSentence(base) };
}

// ---------------------------------------------------------------------------------------------
// Un appel compté, pour le moteur (Claude écrit un fichier à la place du modèle local)

/** Le plafond serait dépassé : l'appel n'a pas eu lieu. */
export class RenfortCapError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RenfortCapError';
  }
}

/**
 * Un appel à Claude, compté : plafond revérifié juste avant (avec ce que l'appel peut coûter au
 * plus), coût réel ajouté après. La consigne et la demande passent par `redactSecrets`. Rend le
 * texte brut : c'est le moteur qui le lit, l'écrit et le contrôle. `RenfortCapError` : plafond.
 */
export async function meteredClaudeCall(input: {
  appId: string;
  nom: string;
  etape: string;
  modele: ClaudeModel;
  system: string;
  prompt: string;
  ledger: RenfortLedger;
  caps: RenfortCaps;
  caller: ClaudeCaller;
  now: () => number;
  usdToEur?: number;
  signal?: AbortSignal;
}): Promise<{ text: string; stopReason: string; appel: RenfortCall; ledger: RenfortLedger }> {
  const taux = usdToEur(input.usdToEur);
  const system = redactSecrets(input.system);
  const prompt = redactSecrets(input.prompt);
  const auPlusEur = claudeCostUsd(input.modele, { inputTokens: estimateClaudeTokens(system.length + prompt.length) + 600, outputTokens: RENFORT_MAX_OUTPUT_TOKENS }) * taux;
  const budget = checkRenfortBudget(input.ledger, input.appId, auPlusEur, input.caps, input.now());
  if (!budget.ok) throw new RenfortCapError(budget.phrase);
  const reponse = await input.caller({ model: input.modele.id, system, prompt, maxTokens: RENFORT_MAX_OUTPUT_TOKENS, ...(input.signal ? { signal: input.signal } : {}) });
  const usd = claudeCostUsd(input.modele, reponse.usage);
  const appel: RenfortCall = {
    quand: input.now(),
    modele: reponse.model || input.modele.id,
    etape: input.etape,
    inputTokens: reponse.usage.inputTokens,
    outputTokens: reponse.usage.outputTokens,
    usd,
    eur: usd * taux,
  };
  return { text: reponse.text, stopReason: reponse.stopReason, appel, ledger: addRenfortSpend(input.ledger, input.appId, input.nom, appel) };
}

// ---------------------------------------------------------------------------------------------
// L'étape : un appel, compté

export interface RenfortRun {
  ok: boolean;
  /** Réussi, ou pourquoi pas : toujours une phrase. */
  raison: string;
  /** Vrai : l'appel n'a pas eu lieu parce qu'un plafond serait dépassé. */
  plafond: boolean;
  fichiers: RenfortFile[];
  refuses: { path: string; raison: string }[];
  note: string;
  /** L'appel fait (coût réel), ou `null` si rien n'est parti. */
  appel: RenfortCall | null;
  /** Le registre après l'appel (inchangé si rien n'est parti). */
  ledger: RenfortLedger;
}

/**
 * Confie l'étape à Claude : le plafond est revérifié **juste avant** l'appel (avec ce que cet appel
 * peut coûter au plus), puis le coût réel, calculé d'après les jetons rendus par l'API, est ajouté à
 * l'appli et au mois. Rien n'est écrit sur le disque ici : les fichiers reçus sont rendus à
 * l'appelant, qui les fait passer par les contrôles du moteur (plan, revue du diff, essais).
 */
export async function runRenfort(input: {
  appId: string;
  nom: string;
  etape: string;
  modele: ClaudeModel;
  colis: RenfortPackage;
  aEcrire: readonly string[];
  ledger: RenfortLedger;
  caps: RenfortCaps;
  caller: ClaudeCaller;
  now: () => number;
  usdToEur?: number;
  signal?: AbortSignal;
}): Promise<RenfortRun> {
  const rien = { fichiers: [], refuses: [], note: '', appel: null, ledger: input.ledger };
  const taux = usdToEur(input.usdToEur);
  const entree = estimateClaudeTokens(input.colis.chars) + 600;
  // Au plus : toute la demande, et une réponse qui remplit son plafond de jetons.
  const auPlusEur = claudeCostUsd(input.modele, { inputTokens: entree, outputTokens: RENFORT_MAX_OUTPUT_TOKENS }) * taux;
  const budget = checkRenfortBudget(input.ledger, input.appId, auPlusEur, input.caps, input.now());
  if (!budget.ok) return { ok: false, raison: budget.phrase, plafond: true, ...rien };
  let reponse: ClaudeReply;
  try {
    reponse = await input.caller({
      model: input.modele.id,
      system: input.colis.system,
      prompt: input.colis.prompt,
      maxTokens: RENFORT_MAX_OUTPUT_TOKENS,
      ...(input.signal ? { signal: input.signal } : {}),
    });
  } catch (error) {
    // Un appel refusé avant toute réponse n'est pas facturé : rien n'est compté.
    return { ok: false, raison: error instanceof Error ? error.message : String(error), plafond: false, ...rien };
  }
  const usd = claudeCostUsd(input.modele, reponse.usage);
  const appel: RenfortCall = {
    quand: input.now(),
    modele: reponse.model || input.modele.id,
    etape: input.etape,
    inputTokens: reponse.usage.inputTokens,
    outputTokens: reponse.usage.outputTokens,
    usd,
    eur: usd * taux,
  };
  const ledger = addRenfortSpend(input.ledger, input.appId, input.nom, appel);
  const lu = parseRenfortReply(reponse.text, input.aEcrire);
  const cout = `Coût réel : ${direEuros(appel.eur, false)}.`;
  if (reponse.stopReason === 'refusal') return { ok: false, raison: `Claude a refusé cette demande. ${cout}`, plafond: false, ...rien, appel, ledger };
  if (!lu.fichiers.length) {
    const pourquoi = reponse.stopReason === 'max_tokens' ? 'sa réponse a été coupée avant la fin du premier fichier' : 'sa réponse ne contient aucun des fichiers demandés';
    return { ok: false, raison: `Claude a répondu, mais ${pourquoi}. ${cout}`, plafond: false, fichiers: [], refuses: lu.refuses, note: lu.note, appel, ledger };
  }
  const manquants = input.aEcrire.map((p) => p.replace(/\\/g, '/')).filter((p) => !lu.fichiers.some((f) => f.path === p));
  const n = lu.fichiers.length;
  return {
    ok: manquants.length === 0,
    raison: manquants.length
      ? `Claude a écrit ${n} fichier${n > 1 ? 's' : ''} sur ${input.aEcrire.length} (il manque ${manquants.join(', ')}). ${cout}`
      : `Claude a écrit ${n} fichier${n > 1 ? 's' : ''}. ${cout}`,
    plafond: false,
    fichiers: lu.fichiers,
    refuses: lu.refuses,
    note: lu.note,
    appel,
    ledger,
  };
}
