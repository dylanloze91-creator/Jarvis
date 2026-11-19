import { z } from 'zod';
import { checkRoverBaseUrl } from '../rover/url.js';
import type { ToolOutcomeKind } from '../tools/outcome.js';

/**
 * Contrat commun des appendices de Jarvis, version 1 (cahier `docs/specs/jarvis-development.md`,
 * section 3). Pur : aucun réseau, aucun fichier. Les mots sont ceux du robot, en français.
 *
 * Un appendice qui agit est un petit serveur que Jarvis appelle :
 *   GET  /api/sante            sans jeton   il répond, version, mode
 *   GET  /api/hello            jeton        présentation
 *   GET  /api/etat             sans jeton   état
 *   POST /api/<capacité>       jeton        action bornée
 *   POST /api/stop             sans jeton   arrêt de l'action en cours
 *   POST /api/arret_urgence    sans jeton pour l'activer, jeton pour le relâcher
 */
export const APPENDICE_CONTRACT = 1;

export const APPENDICE_GENRES = ['oeil', 'bras', 'jambes', 'oreille', 'sens', 'main', 'ecran', 'energie'] as const;
export type AppendiceGenre = (typeof APPENDICE_GENRES)[number];

export const APPENDICE_GENRE_LABELS: Record<AppendiceGenre, string> = {
  oeil: 'Œil',
  bras: 'Bras',
  jambes: 'Jambes',
  oreille: 'Oreille',
  sens: 'Sens',
  main: 'Main sur la maison',
  ecran: 'Écran',
  energie: 'Énergie',
};

/** Les trois niveaux de risque du cahier (section 3.3). */
export const APPENDICE_RISKS = ['lire', 'agir', 'bouger'] as const;
export type AppendiceRisk = (typeof APPENDICE_RISKS)[number];

export const APPENDICE_RISK_LABELS: Record<AppendiceRisk, string> = {
  lire: 'lit (regarde, écoute, mesure)',
  agir: 'agit (sans danger, réversible)',
  bouger: 'bouge ou chauffe',
};

export const APPENDICE_STATES = ['pret', 'occupe', 'arrete', 'arret_urgence', 'erreur'] as const;
export type AppendiceStateName = (typeof APPENDICE_STATES)[number];

export const APPENDICE_STATUSES = ['en_cours', 'termine', 'interrompu', 'remplace', 'bloque', 'erreur', 'refuse'] as const;
export type AppendiceActionStatus = (typeof APPENDICE_STATUSES)[number];

/** Sens du lien : Jarvis l'appelle (il agit), ou il appelle Jarvis (il sent ou parle). */
export const APPENDICE_LINKS = ['jarvis-appelle', 'il-appelle'] as const;
export type AppendiceLink = (typeof APPENDICE_LINKS)[number];

export const APPENDICE_MAX = 20;
export const APPENDICE_MAX_CAPACITIES = 24;

/** Routes du contrat : une capacité ne peut pas porter l'un de ces noms. */
export const APPENDICE_RESERVED_ROUTES = ['sante', 'hello', 'etat', 'stop', 'arret_urgence', 'verifier'] as const;

const CAPACITY_NAME = /^[a-z][a-z0-9_]{0,31}$/;
const APPENDICE_ID = /^[a-z0-9][a-z0-9-]{1,39}$/;

/** Texte venu d'un appendice : une ligne, sans caractère de contrôle, borné. */
function oneLine(max: number) {
  return z
    .string()
    // eslint-disable-next-line no-control-regex -- regex de contrôle voulue : on retire ces caractères d'un texte venu du réseau
    .transform((value) => value.replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max));
}

export const appendiceCapacitySchema = z.object({
  nom: z
    .string()
    .regex(CAPACITY_NAME, 'nom de capacité invalide')
    .refine((name) => !(APPENDICE_RESERVED_ROUTES as readonly string[]).includes(name), 'nom réservé au contrat'),
  description: oneLine(200).optional(),
  risque: z.enum(APPENDICE_RISKS).optional(),
});
export type AppendiceCapacity = z.infer<typeof appendiceCapacitySchema>;

export const appendiceHelloSchema = z.object({
  contrat: z.number().int(),
  id: z.string().regex(APPENDICE_ID, 'identifiant invalide'),
  genre: z.enum(APPENDICE_GENRES),
  nom: oneLine(40).pipe(z.string().min(1)),
  piece: oneLine(40).optional(),
  version: oneLine(24).pipe(z.string().min(1)),
  risque: z.enum(APPENDICE_RISKS),
  capacites: z.array(appendiceCapacitySchema).max(APPENDICE_MAX_CAPACITIES),
});
export type AppendiceHello = z.infer<typeof appendiceHelloSchema>;

export const appendiceActionSchema = z.object({
  id: z.union([z.string(), z.number()]).transform(String).optional(),
  type: oneLine(40).optional(),
  statut: z.enum(APPENDICE_STATUSES),
  message: oneLine(300).optional(),
  /** Ce que l'appendice a mesuré ou relu. Sans elle, « terminé » n'est pas une preuve. */
  mesure: z.unknown().optional(),
  duree_s: z.number().nonnegative().optional(),
});
export type AppendiceAction = z.infer<typeof appendiceActionSchema>;

export const appendiceStateSchema = z.object({
  etat: z.enum(APPENDICE_STATES),
  action: appendiceActionSchema.nullable().optional(),
  derniere_action: appendiceActionSchema.nullable().optional(),
  alertes: z.array(oneLine(200)).max(20).optional(),
  mesures: z.record(z.string(), z.union([z.string(), z.number(), z.boolean()])).optional(),
});
export type AppendiceState = z.infer<typeof appendiceStateSchema>;

/** Paramètres d'une action : des valeurs simples, peu nombreuses. Rien d'imbriqué. */
export const appendiceParamsSchema = z
  .record(z.string().regex(/^[a-z][a-z0-9_]{0,31}$/), z.union([z.string().max(200), z.number().finite(), z.boolean()]))
  .refine((params) => Object.keys(params).length <= 12, '12 paramètres au plus');
export type AppendiceParams = z.infer<typeof appendiceParamsSchema>;

export type AppendiceHelloCheck = { ok: true; hello: AppendiceHello } | { ok: false; reason: string };

/** Lit la présentation d'un appendice. Une version de contrat inconnue est refusée, jamais devinée. */
export function parseAppendiceHello(raw: unknown): AppendiceHelloCheck {
  const parsed = appendiceHelloSchema.safeParse(raw);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    const where = issue?.path.join('.') || 'présentation';
    return { ok: false, reason: `L’appendice se présente mal (${where} : ${issue?.message ?? 'illisible'}).` };
  }
  if (parsed.data.contrat !== APPENDICE_CONTRACT) {
    return {
      ok: false,
      reason: `L’appendice parle la version ${parsed.data.contrat} du contrat ; Jarvis ne connaît que la version ${APPENDICE_CONTRACT}.`,
    };
  }
  const names = parsed.data.capacites.map((capacity) => capacity.nom);
  if (new Set(names).size !== names.length) {
    return { ok: false, reason: 'L’appendice annonce deux fois la même capacité.' };
  }
  return { ok: true, hello: parsed.data };
}

export type AppendiceUrlCheck = { ok: true; origin: string } | { ok: false; reason: string };

/** Réseau local seulement : localhost, IP privée, nom court ou en .local, comme le robot. */
export function checkAppendiceBaseUrl(raw: string): AppendiceUrlCheck {
  const check = checkRoverBaseUrl(raw);
  if (check.ok) return check;
  return {
    ok: false,
    reason: check.reason
      .replace(/Adresse du robot/g, 'Adresse de l’appendice')
      .replace(/adresse du robot/g, 'adresse de l’appendice')
      .replace(/pour le robot/g, 'pour un appendice')
      .replace(/Le robot/g, 'L’appendice')
      .replace(/\(exemple : [^)]*\)/, '(exemple : http://192.168.1.50:8770)'),
  };
}

/**
 * Règles d'accord. Les décisions de l'utilisateur sur les lumières, le chauffage, les caméras,
 * le bouton « Oui » et les alertes ne sont pas prises (cahier, section 8) : tout est réglé sur
 * le plus prudent. **Chaque action d'un appendice demande une carte**, quel que soit son niveau
 * de risque. Seuls l'arrêt et l'arrêt d'urgence agissent tout de suite.
 * Le jour où une décision est prise, c'est ici qu'elle s'écrit, et nulle part ailleurs.
 */
export const APPENDICE_POLICY = {
  /** Vrai : même une action de niveau « lire » ou « agir » passe par une carte. */
  everyActionConfirmed: true,
  /** Une enceinte n'a pas d'écran pour lire la carte : elle peut arrêter, jamais lancer. */
  speakerMayStart: false,
} as const;

export function appendiceActionNeedsCard(risk: AppendiceRisk): boolean {
  if (APPENDICE_POLICY.everyActionConfirmed) return true;
  return risk === 'bouger';
}

/** Risque d'une capacité : le sien si elle le dit, sinon celui de l'appendice. Jamais plus bas que « lire ». */
export function capacityRisk(hello: Pick<AppendiceHello, 'risque'>, capacity: AppendiceCapacity): AppendiceRisk {
  return capacity.risque ?? hello.risque;
}

/** Vrai si l'appendice a joint une mesure qui dit quelque chose. */
export function actionMeasured(action: AppendiceAction): boolean {
  const measure = action.mesure;
  if (measure === undefined || measure === null) return false;
  if (typeof measure === 'string') return measure.trim() !== '';
  if (typeof measure === 'number') return Number.isFinite(measure);
  if (typeof measure === 'boolean') return true;
  if (Array.isArray(measure)) return measure.length > 0;
  if (typeof measure === 'object') return Object.keys(measure).length > 0;
  return false;
}

function measureText(measure: unknown): string {
  if (typeof measure === 'string') return measure.trim().slice(0, 200);
  if (typeof measure === 'number' || typeof measure === 'boolean') return String(measure);
  try {
    return JSON.stringify(measure).slice(0, 200);
  } catch {
    return '';
  }
}

export interface AppendiceActionReport {
  outcome: ToolOutcomeKind;
  /** Phrase française pour l'utilisateur et pour le modèle. */
  content: string;
  /** Vrai si Jarvis doit envoyer un stop par précaution. */
  stopNeeded: boolean;
}

/**
 * Traduit le résultat d'une action. « Terminé » n'est dit que si l'appendice l'a mesuré ou relu
 * (règle 5 du contrat) : un « terminé » sans mesure est rapporté comme non vérifié, jamais comme fait.
 */
export function describeAppendiceAction(name: string, capacity: string, action: AppendiceAction): AppendiceActionReport {
  const said = action.message ? ` ${action.message}` : '';
  const head = `${name}, ${capacity} :`;
  switch (action.statut) {
    case 'termine':
      if (actionMeasured(action)) {
        return { outcome: 'success', content: `${head} terminé (mesure : ${measureText(action.mesure)}).${said}`, stopNeeded: false };
      }
      return {
        outcome: 'recoverable',
        content: `${head} l’appendice répond « terminé » sans rien avoir mesuré. Je ne peux pas dire que c’est fait.${said}`,
        stopNeeded: false,
      };
    case 'en_cours':
      return {
        outcome: 'timeout',
        content: `${head} l’action dure encore. J’ai envoyé l’arrêt par précaution.${said}`,
        stopNeeded: true,
      };
    case 'bloque':
      return { outcome: 'definitive', content: `${head} bloqué.${said}`, stopNeeded: false };
    case 'erreur':
      return { outcome: 'definitive', content: `${head} en erreur.${said}`, stopNeeded: false };
    case 'refuse':
      return { outcome: 'definitive', content: `${head} refusé par l’appendice.${said}`, stopNeeded: false };
    case 'interrompu':
      return { outcome: 'cancelled', content: `${head} interrompu avant la fin.${said}`, stopNeeded: false };
    case 'remplace':
      return { outcome: 'cancelled', content: `${head} remplacé par un autre ordre.${said}`, stopNeeded: false };
  }
}

const STATE_SENTENCES: Record<AppendiceStateName, string> = {
  pret: 'prêt',
  occupe: 'occupé',
  arrete: 'arrêté',
  arret_urgence: 'en arrêt d’urgence',
  erreur: 'en erreur',
};

export function describeAppendiceState(name: string, state: AppendiceState): string {
  const parts = [`${name} : ${STATE_SENTENCES[state.etat]}`];
  if (state.action?.type) parts.push(`action en cours : ${state.action.type}`);
  const measures = Object.entries(state.mesures ?? {})
    .slice(0, 8)
    .map(([key, value]) => `${key} = ${value}`);
  if (measures.length) parts.push(measures.join(', '));
  if (state.alertes?.length) parts.push(`alertes : ${state.alertes.join(' ; ')}`);
  return `${parts.join(' ; ')}.`;
}
