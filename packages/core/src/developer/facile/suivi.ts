/**
 * Jarvis Développeur facile, étape 3, § 2 : suivre son projet (`docs/specs/developpeur-facile-etape3.md`).
 * Jarvis Test seulement. Tout est pur, sans modèle :
 *
 * - **le plan visible** : les grandes étapes d'une création, en mots simples, chacune avec son état
 *   (à faire, en cours, faite, ratée, en attente de toi), tiré des étapes **réelles** du moteur ;
 * - **« où en est mon appli ? »** : règle express, trois phrases (une à l'enceinte) ;
 * - **« mes applis »** : la liste des applis créées, avec leur état et leur dossier.
 *
 * Règle de fond, la même qu'à l'étape 1 : jamais une étape dite faite qui n'a pas eu lieu.
 */
import type { MissionState, MissionStep } from '../engine/mission.js';
import { facileCanOpen, type FacilePayload, type FacileStatus } from './facile.js';

export type FacilePlanState = 'a-faire' | 'en-cours' | 'fait' | 'rate' | 'attend' | 'saute';

export interface FacilePlanStep {
  id: string;
  /** L'étape, en mots simples. */
  titre: string;
  etat: FacilePlanState;
  /** Ce que Jarvis fait en ce moment, ou la raison d'un raté. */
  detail?: string;
}

interface Phase {
  id: string;
  titre: string;
  /** Étapes du moteur qui font cette étape du plan (par identifiant, « edit-2 » compte pour « edit »). */
  steps: readonly string[];
  enCours: string;
}

/** Le plan d'une création : six étapes, toujours les mêmes, dans l'ordre du moteur. */
const PHASES: readonly Phase[] = [
  { id: 'comprendre', titre: 'Comprendre ta demande', steps: ['supervisor', 'goal', 'web-research'], enCours: 'je relis ta demande' },
  { id: 'base', titre: 'Poser la base de l’appli', steps: ['design', 'create', 'scaffold'], enCours: 'je choisis la base et je crée le dossier' },
  { id: 'preparer', titre: 'Préparer le travail', steps: ['plan'], enCours: 'je décide quels fichiers écrire' },
  { id: 'ecrire', titre: 'Écrire les fichiers', steps: ['edit'], enCours: 'j’écris les fichiers' },
  { id: 'tester', titre: 'Tester et corriger', steps: ['test', 'diagnose', 'fix'], enCours: 'je teste' },
  { id: 'relire', titre: 'Relire mon travail', steps: ['review'], enCours: 'je relis mon travail' },
];

const key = (id: string) => id.replace(/-\d+$/u, '');
const started = (s: MissionStep) => s.status !== 'pending' && s.status !== 'skipped';
/** Une série d'essais qui a tourné mais dont des essais échouent (`taskFlow.ts`). */
const RED_SERIES = /\(\d+ échec\(s\) au total\)\s*$/u;

const EN_COURS: Record<string, string> = {
  supervisor: 'je regarde par où commencer',
  goal: 'je relis ta demande',
  'web-research': 'je cherche sur Internet la bonne façon de faire',
  design: 'je choisis la base qui convient',
  create: 'je pose la base de l’application',
  scaffold: 'je prépare le dossier du projet',
  plan: 'je décide quels fichiers écrire',
  edit: 'j’écris les fichiers',
  test: 'je teste',
  diagnose: 'je cherche pourquoi un essai ne marche pas',
  fix: 'je corrige',
  review: 'je relis mon travail',
};

/**
 * Le plan coché d'une création. Sans mission (elle n'a pas encore démarré) : tout est « à faire ».
 * Une étape n'est « faite » que si toutes ses étapes réelles commencées sont finies sans échec.
 */
export function facilePlan(mission: Pick<MissionState, 'steps' | 'status' | 'verdict'> | null): FacilePlanStep[] {
  const steps = mission?.steps ?? [];
  const fini = mission ? mission.status === 'finished' || mission.status === 'failed' || mission.status === 'cancelled' : false;
  const rate = mission ? mission.status === 'failed' || mission.verdict === 'failed' : false;
  // L'étape du plan la plus avancée qui a commencé : ce qui est avant et n'a rien fait a été sauté.
  let derniere = -1;
  PHASES.forEach((phase, i) => {
    if (steps.some((s) => phase.steps.includes(key(s.id)) && started(s))) derniere = i;
  });
  return PHASES.map((phase, i): FacilePlanStep => {
    const miens = steps.filter((s) => phase.steps.includes(key(s.id)) && started(s));
    const base = { id: phase.id, titre: phase.titre };
    if (!miens.length) return { ...base, etat: i < derniere || (fini && !rate && mission?.status !== 'cancelled') ? 'saute' : 'a-faire' };
    const enCours = miens.filter((s) => s.status === 'running').at(-1);
    if (enCours && !fini) return { ...base, etat: 'en-cours', detail: EN_COURS[key(enCours.id)] ?? phase.enCours };
    if (miens.some((s) => (s.status as string) === 'waiting') && !fini) return { ...base, etat: 'attend', detail: 'j’attends ta réponse' };
    const dernier = miens.at(-1)!;
    const rouge = dernier.status === 'failed' || (key(dernier.id) === 'test' && RED_SERIES.test(dernier.detail ?? ''));
    if (rouge) {
      // Pendant la mission, un essai rouge n'est pas un raté : Jarvis va corriger.
      if (!fini) return { ...base, etat: 'en-cours', detail: phase.id === 'tester' ? 'un essai ne marche pas, je regarde pourquoi' : phase.enCours };
      const raison = (dernier.error ?? dernier.detail ?? '').replace(/\s+/g, ' ').trim().slice(0, 160);
      return { ...base, etat: 'rate', ...(raison ? { detail: raison } : {}) };
    }
    // Arrêtée en route : ce qui tournait n'est pas fini.
    if (enCours) return { ...base, etat: 'rate', detail: 'arrêtée avant la fin' };
    const fichiers = phase.id === 'ecrire' ? new Set(miens.flatMap((s) => s.files ?? [])).size : 0;
    return { ...base, etat: 'fait', ...(fichiers ? { detail: fichiers === 1 ? '1 fichier' : `${fichiers} fichiers` } : {}) };
  });
}

// ---------------------------------------------------------------------------------------------
// « Où en est mon appli ? »

const WAKE = /^(?:(?:dis|ok|hey|eh|bon|alors)[,\s]+)?jarvis[,\s]+/iu;
const plier = (text: string) =>
  text
    .trim()
    .replace(WAKE, '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[’']/g, ' ')
    .replace(/[^a-z0-9 ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

const CHOSE = '(?:appli|applis|application|applications|app|projet|programme|logiciel|jeu|site|outil|creation|construction)';
const OU_EN_EST = new RegExp(
  [
    `^(?:et )?(?:alors )?(?:dis moi )?ou (?:en est|en sont|ca en est|t en es|tu en es)\\b.*\\b${CHOSE}\\b`,
    `^(?:et )?(?:alors )?(?:elle|il|ca|c) en est ou\\b.*\\b${CHOSE}\\b`,
    `^(?:et )?(?:alors )?(?:mon |ma |l |la |le )?${CHOSE}\\b.{0,40}\\b(?:en est ou|ca avance|ca donne quoi|c est pret|est prete?|est finie?|a avance)\\b`,
    `^(?:et )?(?:alors )?t en es ou\\b.*\\b${CHOSE}\\b`,
    `^(?:c est quoi |quel est |donne moi |dis moi )?l (?:avancement|etat) (?:de|du) (?:mon |ma |l |la |le )?${CHOSE}\\b`,
    `^(?:est ce que )?(?:mon |ma |l |la |le )${CHOSE} (?:est (?:prete?|finie?)|avance)$`,
    `^(?:ca avance|ca donne quoi|t en es ou|tu en es ou|ou t en es|ou tu en es) (?:avec |sur |pour )?(?:mon |ma |l |la |le )?${CHOSE}\\b`,
  ].join('|'),
);
/** Sans nommer l'appli : seulement quand une création est en cours. */
const OU_EN_ES_TU = /^(?:et )?(?:alors )?(?:t en es ou|tu en es ou|ou t en es|ou tu en es|ou en es tu|ca avance|ca en est ou|t as fini|tu as fini|c est pret|c est bientot pret)$/;

/**
 * « Où en est mon appli ? », « elle en est où, mon appli ? », « ça avance, le jeu ? ». `enCours` :
 * une création tourne, « t'en es où ? » tout seul la désigne. Jamais une image, une impression ni
 * une musique : la phrase doit nommer une appli, un projet, un programme, un jeu, un site.
 */
export function detectProgressQuestion(text: string, enCours = false): boolean {
  const t = plier(text);
  if (!t || t.length > 120) return false;
  if (/\b(?:image|photo|impression|imprimante|piece|boite|musique|telechargement)\b/.test(t)) return false;
  return OU_EN_EST.test(t) || (enCours && OU_EN_ES_TU.test(t));
}

/** Ce que la réponse a besoin de savoir d'une création. */
export type ProgressSource = Pick<FacilePayload, 'objectif' | 'status' | 'question' | 'result' | 'folder'> & {
  plan?: FacilePlanStep[];
  nom?: string | null;
  /** Une carte « Claude en renfort » attend une réponse. */
  renfortPropose?: boolean;
};

const nomDe = (p: ProgressSource) => (p.nom?.trim() ? `« ${p.nom.trim()} »` : 'ton appli');

/**
 * La réponse, d'après l'état réel : l'étape en cours, ce qui est fait et ce qui reste, ce que Jarvis
 * attend. Trois phrases ; à l'enceinte, une seule et « Le détail est sur le PC. ».
 */
export function facileProgressReply(source: ProgressSource | null, options: { voice?: boolean; ancienne?: boolean } = {}): string {
  const fin = options.voice ? ' Le détail est sur le PC.' : '';
  if (!source) {
    return options.voice
      ? 'Je ne construis aucune appli en ce moment.'
      : 'Je ne construis aucune appli en ce moment. Dis « mes applis » pour voir celles que j’ai déjà faites.';
  }
  const plan = source.plan ?? [];
  const faites = plan.filter((s) => s.etat === 'fait');
  const reste = plan.filter((s) => s.etat === 'a-faire');
  const courante = plan.find((s) => s.etat === 'en-cours' || s.etat === 'attend');
  const ratee = plan.find((s) => s.etat === 'rate');
  const nom = nomDe(source);
  const compte = plan.length ? `${faites.length} étape${faites.length > 1 ? 's' : ''} sur ${plan.length} ${faites.length > 1 ? 'sont faites' : 'est faite'}` : '';
  const listeReste = reste.length ? `Il reste : ${reste.map((s) => s.titre.toLowerCase()).join(', ')}.` : '';

  const etats: Record<FacileStatus, () => string[]> = {
    pret: () => [`${nom[0]!.toUpperCase()}${nom.slice(1)} est prête.`, source.result ?? '', source.folder ? `Ses fichiers sont dans ${source.folder}.` : ''],
    rate: () => [
      `Je n’ai pas réussi à finir ${nom}.`,
      ratee ? `Ça a coincé à l’étape « ${ratee.titre} »${ratee.detail ? ` : ${ratee.detail}` : ''}.` : (source.result ?? ''),
      source.renfortPropose ? 'Je te propose de confier cette étape à Claude : la carte attend ta réponse.' : 'Dis-moi si je réessaie, ou autrement.',
    ],
    arrete: () => [`J’ai arrêté ${nom} à ta demande.`, compte ? `${compte[0]!.toUpperCase()}${compte.slice(1)}.` : '', 'Ce qui est fait reste dans son dossier.'],
    question: () => [
      `Je construis ${nom}, et j’attends ta réponse pour continuer.`,
      source.question ? `Ma question : ${source.question.text}` : '',
      compte ? `${compte[0]!.toUpperCase()}${compte.slice(1)}.` : '',
    ],
    travaille: () => [
      courante ? `Je construis ${nom} : j’en suis à « ${courante.titre} »${courante.detail ? ` (${courante.detail})` : ''}.` : `Je construis ${nom} : je démarre.`,
      compte ? `${compte[0]!.toUpperCase()}${compte.slice(1)}.` : '',
      source.renfortPropose ? 'Je te propose de confier une étape à Claude : la carte attend ta réponse.' : listeReste || 'Je n’attends rien de toi.',
    ],
  };
  const phrases = etats[source.status]().filter(Boolean);
  const debut = options.ancienne ? 'La dernière appli que j’ai construite : ' : '';
  if (options.voice) {
    // À l'oreille : la première phrase, et ce qu'il attend s'il attend quelque chose.
    const attend = source.status === 'question' && source.question ? ` ${source.question.text}` : '';
    return `${debut}${phrases[0] ?? ''}${attend}${fin}`.trim();
  }
  return `${debut}${phrases.join(' ')}`.trim();
}

// ---------------------------------------------------------------------------------------------
// « Mes applis »

/** Une appli créée par Jarvis, telle qu'elle est gardée sur le PC (hors des réglages et des dépôts). */
export interface FacileApp {
  /** Identifiant de la création (celui de sa carte). */
  id: string;
  nom: string;
  objectif: string;
  projectId: string | null;
  missionId: string | null;
  folder: string | null;
  template: string | null;
  status: FacileStatus;
  /** L'étape du plan où elle en est (ou s'est arrêtée). */
  etape: string | null;
  faites: number;
  etapes: number;
  startedAt: number;
  updatedAt: number;
  /** La discussion et le message de sa carte, pour la rouvrir. */
  conversationId?: string;
  messageId?: string;
  /** Dépensé chez Claude pour cette appli (euros). Absent : rien. */
  claudeEur?: number;
  /** Vrai : Claude a écrit une partie de cette appli (jamais dans un jeu d'entraînement). */
  claude?: boolean;
}

/** Applis gardées au plus (les plus anciennes partent). */
export const FACILE_APPS_MAX = 100;

/** Un nom lisible sans projet : les premiers mots de la demande. */
export function appNameFromObjective(objectif: string): string {
  const mots = objectif
    .replace(/^(?:(?:cr[ée]e|fais|fabrique|construis|d[ée]veloppe|code|programme)[-\s]moi\s+|je (?:veux|voudrais)\s+)/iu, '')
    .replace(/^(?:une?|mon|ma)\s+/iu, '')
    .replace(/[.!?]+$/u, '')
    .split(/\s+/)
    .slice(0, 6)
    .join(' ');
  return mots ? `${mots[0]!.toUpperCase()}${mots.slice(1)}` : 'Appli sans nom';
}

/** La fiche d'une appli, d'après sa carte. */
export function appFromPayload(payload: FacilePayload & { plan?: FacilePlanStep[] }, extra: { nom?: string | null; now: number; conversationId?: string; messageId?: string; claudeEur?: number; claude?: boolean }): FacileApp {
  const plan = payload.plan ?? [];
  const courante = plan.find((s) => s.etat === 'en-cours' || s.etat === 'attend' || s.etat === 'rate') ?? null;
  return {
    id: payload.id,
    nom: extra.nom?.trim() || appNameFromObjective(payload.objectif),
    objectif: payload.objectif.slice(0, 400),
    projectId: payload.projectId,
    missionId: payload.missionId,
    folder: payload.folder,
    template: payload.template ?? null,
    status: payload.status,
    etape: courante?.titre ?? null,
    faites: plan.filter((s) => s.etat === 'fait').length,
    etapes: plan.length,
    startedAt: payload.startedAt,
    updatedAt: extra.now,
    ...(extra.conversationId ? { conversationId: extra.conversationId } : {}),
    ...(extra.messageId ? { messageId: extra.messageId } : {}),
    ...(extra.claudeEur ? { claudeEur: extra.claudeEur } : {}),
    ...(extra.claude ? { claude: true } : {}),
  };
}

/** Ajoute ou met à jour une appli (la plus récente en tête). */
export function upsertApp(apps: readonly FacileApp[], app: FacileApp): FacileApp[] {
  return [app, ...apps.filter((a) => a.id !== app.id)].sort((a, b) => b.updatedAt - a.updatedAt).slice(0, FACILE_APPS_MAX);
}

const STATUTS: ReadonlySet<string> = new Set(['travaille', 'question', 'pret', 'rate', 'arrete']);

/** Lecture tolérante du fichier des applis : une fiche incomplète est ignorée. */
export function parseApps(text: string): FacileApp[] {
  const data = JSON.parse(text) as { applis?: unknown };
  if (!data || typeof data !== 'object' || !Array.isArray(data.applis)) throw new Error('fichier des applis illisible');
  const out: FacileApp[] = [];
  for (const a of data.applis as Partial<FacileApp>[]) {
    if (!a || typeof a.id !== 'string' || typeof a.nom !== 'string' || typeof a.status !== 'string' || !STATUTS.has(a.status)) continue;
    if (typeof a.startedAt !== 'number' || typeof a.updatedAt !== 'number') continue;
    out.push({
      id: a.id,
      nom: a.nom,
      objectif: typeof a.objectif === 'string' ? a.objectif : '',
      projectId: typeof a.projectId === 'string' ? a.projectId : null,
      missionId: typeof a.missionId === 'string' ? a.missionId : null,
      folder: typeof a.folder === 'string' ? a.folder : null,
      template: typeof a.template === 'string' ? a.template : null,
      status: a.status as FacileStatus,
      etape: typeof a.etape === 'string' ? a.etape : null,
      faites: typeof a.faites === 'number' ? a.faites : 0,
      etapes: typeof a.etapes === 'number' ? a.etapes : 0,
      startedAt: a.startedAt,
      updatedAt: a.updatedAt,
      ...(typeof a.conversationId === 'string' ? { conversationId: a.conversationId } : {}),
      ...(typeof a.messageId === 'string' ? { messageId: a.messageId } : {}),
      ...(typeof a.claudeEur === 'number' && a.claudeEur > 0 ? { claudeEur: a.claudeEur } : {}),
      ...(a.claude === true ? { claude: true } : {}),
    });
  }
  return out;
}

export function writeApps(apps: readonly FacileApp[]): string {
  return `${JSON.stringify({ version: 1, note: 'Applis créées par Jarvis Développeur facile (suivi).', applis: apps }, null, 2)}\n`;
}

/**
 * Au redémarrage de Jarvis : une appli restée « en cours » n'avance plus (le moteur ne reprend pas
 * seul une mission coupée). Elle est dite arrêtée, sans rien inventer sur ce qui est fait.
 */
export function closeInterruptedApps(apps: readonly FacileApp[], now: number): FacileApp[] {
  return apps.map((a) => (a.status === 'travaille' || a.status === 'question' ? { ...a, status: 'arrete' as const, etape: a.etape ? `${a.etape} (coupée par un redémarrage)` : 'coupée par un redémarrage', updatedAt: now } : a));
}

const MES_APPLIS =
  /^(?:(?:montre|affiche|donne|liste|sors|ouvre)(?: moi)? )?(?:(?:la )?liste de )?(?:toutes )?mes (?:applis|applications|apps|projets|creations)(?: (?:stp|s il te plait|en cours|creees?|faites?))?$|^(?:c est quoi|quelles? sont|ou sont|tu as fait quelles?|j ai quelles?) (?:deja )?mes (?:applis|applications|projets|creations)$|^quelles? (?:applis|applications) (?:est ce que )?(?:j ai|tu as|tu m as) (?:deja )?(?:creees?|faites?|construites?)$|^(?:qu est ce que|quelles applis) tu (?:m )?as (?:deja )?(?:cree|construit|fait) comme (?:applis|applications)$/;

/** « Mes applis », « montre-moi mes applis », « quelles applis j'ai créées ? ». */
export function detectMyAppsRequest(text: string): boolean {
  const t = plier(text);
  return t.length > 0 && t.length <= 80 && MES_APPLIS.test(t);
}

const ETAT_DIT: Record<FacileStatus, string> = {
  travaille: 'en cours',
  question: 'attend ta réponse',
  pret: 'prête',
  rate: 'pas finie',
  arrete: 'arrêtée',
};

/** L'état d'une appli en quelques mots : « prête », « en cours : écrire les fichiers (3 sur 6) ». */
export function appStateText(app: FacileApp): string {
  const ou = app.etape && app.status !== 'pret' ? ` : ${app.etape.toLowerCase()}` : '';
  const compte = app.etapes && app.status !== 'pret' ? ` (${app.faites} étape${app.faites > 1 ? 's' : ''} sur ${app.etapes})` : '';
  const claude = app.claudeEur ? `, ${app.claudeEur.toFixed(2).replace('.', ',')} € chez Claude` : '';
  return `${ETAT_DIT[app.status]}${ou}${compte}${claude}`;
}

/** La liste dite (la carte montre le reste : dossier, « Ouvrir l'appli », « Continuer »). */
export function myAppsReply(apps: readonly FacileApp[], options: { voice?: boolean } = {}): string {
  if (!apps.length) return 'Je n’ai encore construit aucune appli pour toi. Demande-moi, par exemple : « fais-moi une appli pour noter mes heures ».';
  const n = apps.length;
  if (options.voice) {
    const pretes = apps.filter((a) => a.status === 'pret').length;
    return `J’ai ${n} appli${n > 1 ? 's' : ''} pour toi, dont ${pretes} prête${pretes > 1 ? 's' : ''}. La liste est sur le PC.`;
  }
  const lignes = apps.slice(0, 12).map((a) => `- ${a.nom} — ${appStateText(a)}`);
  const plus = n > 12 ? `\n… et ${n - 12} autre${n - 12 > 1 ? 's' : ''}.` : '';
  return `Voici ${n > 1 ? `tes ${n} applis` : 'ton appli'} :\n${lignes.join('\n')}${plus}`;
}

/** Ce que la carte « Mes applis » montre pour chaque appli. */
export interface FacileAppsPayload {
  apps: (FacileApp & { peutOuvrir: boolean; etat: string })[];
}

export function appsPayload(apps: readonly FacileApp[]): FacileAppsPayload {
  return { apps: apps.slice(0, 30).map((a) => ({ ...a, peutOuvrir: a.status === 'pret' && Boolean(a.projectId) && facileCanOpen(a.template), etat: appStateText(a) })) };
}

/** « Continuer » : la phrase posée dans la zone de saisie (l'utilisateur la finit lui-même). */
export function continueDraft(app: Pick<FacileApp, 'nom'>): string {
  return `Dans mon appli « ${app.nom} », `;
}
