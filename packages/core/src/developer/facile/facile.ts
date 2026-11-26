/**
 * Jarvis Développeur facile, étape 1 (`docs/specs/developpeur-facile.md`). Jarvis Test seulement.
 *
 * Ce module ne change pas le moteur des missions : il décide de ce que l'utilisateur **voit**
 * quand il demande une application dans la discussion. Tout est pur, sans Electron ni réseau :
 *
 * - reconnaître une demande de création, par règles, avant tout modèle ;
 * - la phrase dite tout de suite, et la reformulation ;
 * - les recherches « ce qui existe déjà » et le tri de leurs vrais résultats ;
 * - les lignes de travail en mots simples, tirées des étapes réelles de la mission ;
 * - une question à la fois, avec une réponse par défaut.
 *
 * Règle de fond : jamais une étape annoncée qui n'a pas eu lieu, jamais un lien inventé.
 */
import { cleanMissionObjective, looksLikeCodeExplanationOnly } from '../chatMissions/detect.js';
import type { MissionState, MissionStep } from '../engine/mission.js';
import type { RenfortCard } from '../renfort/renfort.js';
import type { FacilePlanStep } from './suivi.js';

/** Dite (et écrite) tout de suite, sans attendre un modèle. */
export const FACILE_IMMEDIATE_REPLY = 'Pas de souci, je m’en occupe. Je regarde d’abord ce qui existe déjà.';

/** Depuis une enceinte : Jarvis répond, mais ne lance jamais une création. */
export const FACILE_SPEAKER_REPLY = 'Pas de souci. Je ne lance rien depuis l’enceinte : je te montre ça sur le PC.';

/** Une création tourne déjà. */
export const FACILE_BUSY_REPLY =
  'Je suis déjà en train de construire quelque chose. Je finis d’abord, ou dis-moi d’arrêter.';

/** Sans réponse dans ce délai, Jarvis prend la réponse par défaut, le dit, et continue. */
export const FACILE_QUESTION_TIMEOUT_MS = 2 * 60_000;

/** Au-delà, la ligne de travail dit « c'est long, je suis toujours dessus ». */
export const FACILE_SLOW_STEP_MS = 30_000;

/** Réponse par défaut à une question de Jarvis restée sans réponse. */
export const FACILE_DEFAULT_ANSWER = 'Fais au plus simple.';

const WAKE = /^(?:(?:dis|ok|hey|eh|bon|alors)[,\s]+)?(?:jarvis)[,\s]+/iu;
const POLITE =
  /^(?:s['’]il te pla[iî]t[,\s]+|stp[,\s]+|(?:est-ce que )?tu (?:peux|pourrais|veux bien)[,\s]+|peux-tu[,\s]+|pourrais-tu[,\s]+|j['’]aimerais que tu[,\s]+|je voudrais que tu[,\s]+|je veux que tu[,\s]+)/iu;
const CREATION_VERB =
  /^(?:(?:me\s+)?(?:cr[ée]e[rsz]?|fai(?:s|re)|fabrique[rsz]?|construi(?:s|re)|d[ée]veloppe[rsz]?|code[rsz]?|programme[rsz]?|[ée]cri(?:s|re)|bricole[rsz]?|pr[ée]pare[rsz]?|monte[rsz]?)(?:[-\s]moi|[-\s]nous)?|il me faudrait|il me faut|j['’]aimerais(?: avoir)?|je voudrais(?: avoir)?|je veux|j['’]ai besoin d['’]|j['’]ai besoin de)\s+/iu;
const CREATED_THING =
  /^(?:(?:une?|mon|ma|notre)\s+)?(?:(?:petite?|nouvelle?|nouveau|nouvel|simple|vraie?|mini)\s+){0,2}(appli(?:cation)?|app|programme|logiciel|jeu(?: vid[ée]o)?|site(?: web| internet)?|page web|outil|utilitaire|calculatrice|tableau de bord|extension|script)(?![\p{L}\p{N}])/iu;
/**
 * Étape 2 (20 novembre 2026) : « Crée-moi un minuteur de pause café » partait à l'équipe PC (essai
 * réel). Un petit outil nommé sans le mot « appli » est une création, mais seulement avec un verbe
 * qui fabrique (crée, développe, code, programme, construis, fabrique) et sans durée : « fais-moi
 * un minuteur de 10 minutes » reste une demande de minuteur, pas une application.
 */
const MAKING_VERB =
  /^(?:(?:me\s+)?(?:cr[ée]e[rsz]?|fabrique[rsz]?|construi(?:s|re)|d[ée]veloppe[rsz]?|code[rsz]?|programme[rsz]?)(?:[-\s]moi|[-\s]nous)?)\s+/iu;
const CREATED_TOOL =
  /^(?:(?:une?|mon|ma|notre)\s+)?(?:(?:petite?|nouvelle?|nouveau|nouvel|simple|vraie?|mini)\s+){0,2}(minuteur|chronom[èe]tre|compteur|convertisseur|g[ée]n[ée]rateur|gestionnaire|carnet|planificateur|quiz|calculateur|simulateur|tableau de suivi|suivi)(?![\p{L}\p{N}])/iu;
const DURATION = /\d+\s*(?:s|sec(?:ondes?)?|min(?:utes?)?|h|heures?)(?![\p{L}\p{N}])/iu;
/** Le mot désigne autre chose qu'un logiciel. */
const NOT_SOFTWARE =
  /(?:programme\s+(?:de|d['’])\s*(?:musculation|sport|entra[iî]nement|r[ée]visions?|r[ée]gime|t[ée]l[ée]|la\s|ma\s|mon\s|mes\s|vacances|travail|cours|course)|jeu\s+de\s+mots|outil\s+de\s+jardin)/iu;
const QUESTION_START = /^(?:comment|pourquoi|c['’]est quoi|qu['’]est-ce|est-ce que|quel(?:le)?s?|combien|où|quand)(?![\p{L}\p{N}])/iu;

export interface CreationRequest {
  /** La demande de l'utilisateur, nettoyée (mot de réveil et politesse retirés). */
  objectif: string;
  /** Ce qu'il faut construire, sans le verbe : « une petite appli pour noter mes heures ». */
  sujet: string;
}

/**
 * « Crée / fais-moi une appli, un programme, un jeu, un site… » : une demande de création, vue par
 * règles. En cas de doute, `null` : la demande suit le chemin d'avant (le cerveau, l'équipe Code).
 * Une question (« comment créer une appli ? ») ou une explication de code n'est pas une création.
 */
export function detectCreationRequest(text: string): CreationRequest | null {
  const raw = text.trim().replace(/\s+/g, ' ');
  if (raw.length < 12 || raw.length > 2_000) return null;
  if (looksLikeCodeExplanationOnly(raw)) return null;
  let rest = raw.replace(WAKE, '');
  const polite = POLITE.test(rest);
  rest = rest.replace(POLITE, '').replace(/^de\s+/iu, '');
  if (QUESTION_START.test(rest)) return null;
  const verb = CREATION_VERB.exec(rest);
  if (!verb) return null;
  // Une phrase qui finit par « ? » sans tournure de politesse est une question, pas un ordre.
  if (/\?\s*$/.test(raw) && !polite) return null;
  const after = rest.slice(verb[0].length);
  const thing =
    CREATED_THING.exec(after) ?? (MAKING_VERB.test(rest) && !DURATION.test(after) ? CREATED_TOOL.exec(after) : null);
  if (!thing) return null;
  // « un programme de musculation », « un jeu de mots » : le même mot, mais pas un logiciel.
  if (NOT_SOFTWARE.test(after)) return null;
  const sujet = after.replace(/[\s.!?]+$/u, '').trim();
  if (sujet.length < 6) return null;
  return { objectif: cleanMissionObjective(raw), sujet };
}

/** « Si j'ai bien compris : … ». Reformulation sans modèle : les mots de l'utilisateur, nettoyés. */
export function facileRestatement(sujet: string): string {
  const text = sujet.trim().replace(/[\s.!?]+$/u, '').slice(0, 300);
  return `Si j’ai bien compris : ${text}.`;
}

/** Le sujet sans son article, pour une recherche : « appli pour noter mes heures de chantier ». */
function searchSubject(sujet: string): string {
  return sujet
    .replace(/^(?:une?|mon|ma|notre)\s+/iu, '')
    .replace(/^(?:(?:petite?|nouvelle?|nouveau|nouvel|simple|vraie?|mini)\s+)+/iu, '')
    .replace(/[\s.!?]+$/u, '')
    .slice(0, 120);
}

/** Les recherches « ce qui existe déjà » : deux, jamais plus de quatre. */
export function creationSearchQueries(sujet: string): string[] {
  const subject = searchSubject(sujet);
  if (!subject) return [];
  return [`${subject} gratuit`, `${subject} open source`];
}

/** Un résultat de recherche tel que l'outil `web_search` le rend. */
export interface FacileHit {
  title: string;
  url: string;
  snippet?: string;
}

/** Une application qui existe déjà : un vrai résultat de recherche, jamais une invention. */
export interface FacileFound {
  name: string;
  phrase: string;
  url: string;
  site: string;
}

function hostOf(url: string): string | null {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null;
    return parsed.hostname.toLowerCase().replace(/^www\./, '');
  } catch {
    return null;
  }
}

function firstSentence(text: string, max: number): string {
  const clean = text.replace(/\s+/g, ' ').trim();
  const cut = /^(.{20,}?[.!?])(?:\s|$)/u.exec(clean)?.[1] ?? clean;
  return cut.length > max ? `${cut.slice(0, max - 1).trimEnd()}…` : cut;
}

/**
 * Une à trois applications parmi les vrais résultats. Un site par application, un lien `http(s)`
 * lisible, un titre. Rien n'est complété ni inventé : sans résultat, la liste est vide.
 */
export function pickExistingApps(hits: readonly FacileHit[], max = 3): FacileFound[] {
  const seen = new Set<string>();
  const found: FacileFound[] = [];
  for (const hit of hits) {
    const site = hostOf(hit.url);
    const name = hit.title.replace(/\s+/g, ' ').trim();
    if (!site || !name || seen.has(site)) continue;
    seen.add(site);
    found.push({
      name: name.length > 80 ? `${name.slice(0, 79).trimEnd()}…` : name,
      phrase: hit.snippet ? firstSentence(hit.snippet, 160) : '',
      url: hit.url,
      site,
    });
    if (found.length >= Math.max(1, Math.min(3, max))) break;
  }
  return found;
}

/** « Pour la construire » : une phrase sans jargon, d'après la base choisie. */
export function buildingSentence(template: string | null | undefined): string {
  switch (template) {
    case 'web-game':
      return 'Je pars d’un petit jeu qui s’ouvre dans une page, et je le change pour qu’il fasse ce que tu demandes.';
    case 'vite-react':
      return 'Je pars d’une petite appli avec un écran et des boutons, et j’y ajoute ce que tu demandes.';
    case 'node-cli':
      return 'Je pars d’un petit programme qui se lance d’une ligne de commande, et j’y ajoute ce que tu demandes.';
    case 'dotnet-winforms':
    case 'dotnet-wpf':
      return 'Je pars d’une application Windows avec sa fenêtre, et j’y ajoute ce que tu demandes.';
    case 'dotnet-console':
    case 'dotnet-worker':
      return 'Je pars d’un petit programme Windows sans fenêtre, et j’y ajoute ce que tu demandes.';
    default:
      return 'Je pars d’une base qui marche déjà, et j’y ajoute ce que tu demandes, une étape à la fois.';
  }
}

export type FacileChoice = 'construire' | 'voir' | 'changer';

export interface FacileFindings {
  /** `cherche` : en cours ; `rien` : aucun résultat ; `coupe` : Internet n'a pas répondu. */
  state: 'cherche' | 'trouve' | 'rien' | 'coupe';
  existing: FacileFound[];
  method: string;
  /** Le choix de l'utilisateur. Absent : « construire » par défaut, la construction continue. */
  choice?: FacileChoice;
}

export type FacileLineState = 'en-cours' | 'fait' | 'rate';

export interface FacileLine {
  id: string;
  text: string;
  state: FacileLineState;
  startedAt?: number;
  finishedAt?: number;
}

export interface FacileQuestion {
  text: string;
  /** Réponse prise sans réponse de l'utilisateur. */
  defaut: string;
  askedAt: number;
  /** Rang de la question (1 = la première) et nombre de questions. */
  index: number;
  total: number;
}

export interface FacileAnswer {
  question: string;
  answer: string;
  /** Vrai si Jarvis a pris la réponse par défaut, faute de réponse. */
  parDefaut: boolean;
}

export type FacileStatus = 'travaille' | 'question' | 'pret' | 'rate' | 'arrete';

/** Ce que la discussion affiche pour une création. Écrit dans le message, relu à la réouverture. */
export interface FacilePayload {
  id: string;
  missionId: string | null;
  projectId: string | null;
  objectif: string;
  restatement: string;
  startedAt: number;
  status: FacileStatus;
  findings: FacileFindings;
  lines: FacileLine[];
  /** Fichiers créés ou modifiés, dans l'ordre où ils sont apparus. */
  files: string[];
  /** Dossier du projet, dès qu'il existe. */
  folder: string | null;
  question: FacileQuestion | null;
  answers: FacileAnswer[];
  /** Dernière phrase : « C'est prêt… », ou pourquoi ça n'a pas marché. */
  result: string | null;
  /** Vient de la voix : les moments importants sont dits. */
  voice: boolean;
  /** Base du projet, dès que le moteur l'a créé (étape 2). Absent dans les cartes d'avant. */
  template?: string | null;
  /** « Ouvrir l'appli » : en cours, ouverte, ou ratée avec sa raison (étape 2). */
  ouverture?: { etat: 'en-cours' | 'ouverte' | 'ratee'; message: string } | null;
  /** Étape 3 : le plan coché (six étapes, états tirés des étapes réelles). Absent dans les cartes d'avant. */
  plan?: FacilePlanStep[];
  /** Étape 3 : le nom lisible de l'appli (celui du projet, dès qu'il existe). */
  nom?: string | null;
  /** Étape 3 : la carte « Claude en renfort », quand un signe mesuré la justifie. */
  renfort?: RenfortCard | null;
  /** Étape 3 : dépensé chez Claude pour cette appli (euros). */
  claudeEur?: number;
}

/** Mots de développeur → mots simples, dans un texte venu du moteur. */
export function simpleWords(text: string): string {
  return text
    .replace(/\bcopie isol[ée]e\b/giu, 'dossier de travail')
    .replace(/\b(?:la |une )?branche\b/giu, 'version de travail')
    .replace(/\bdiffs?\b/giu, 'ce qui a changé')
    .replace(/\bplan valid[ée]\b/giu, 'ce que je vais faire')
    .replace(/\bcrit[èe]res?\b/giu, 'ce qu’il faut vérifier')
    .replace(/\bworktree\b/giu, 'dossier de travail')
    .replace(/\bgabarit\b/giu, 'base')
    .replace(/\bcommit\b/giu, 'point de reprise')
    .replace(/\btypecheck\b/giu, 'vérification du code');
}

interface LineWords {
  running: string;
  done: string;
  failed: string;
}

/** Une phrase par étape réelle du moteur, reconnue par son identifiant (jamais par son libellé). */
const STEP_WORDS: Record<string, LineWords> = {
  supervisor: {
    running: 'Je regarde par où commencer…',
    done: 'Je sais par où commencer.',
    failed: 'Je n’ai pas su découper le travail.',
  },
  'web-research': {
    running: 'Je cherche sur Internet la bonne façon de faire…',
    done: 'J’ai regardé comment ce genre d’application se construit.',
    failed: 'Internet ne m’a rien appris, je continue avec ma base.',
  },
  scaffold: {
    running: 'Je prépare le dossier du projet…',
    done: 'Le dossier du projet est prêt.',
    failed: 'Je n’ai pas pu créer le dossier du projet.',
  },
  goal: {
    running: 'Je relis ta demande…',
    done: 'J’ai noté ce que tu veux.',
    failed: 'Je n’ai pas compris la demande.',
  },
  design: {
    running: 'Je choisis la base qui convient…',
    done: 'J’ai choisi la base.',
    failed: 'Je n’ai pas su choisir une base.',
  },
  create: {
    running: 'Je pose la base de l’application…',
    done: 'La base de l’application est posée.',
    failed: 'Je n’ai pas pu poser la base.',
  },
  plan: {
    running: 'Je prépare ce que je vais faire…',
    done: 'Je sais quels fichiers toucher.',
    failed: 'Je n’ai pas su préparer le travail.',
  },
  edit: {
    running: 'J’écris les fichiers…',
    done: 'Les fichiers sont écrits.',
    failed: 'Je n’ai pas pu écrire les fichiers.',
  },
  test: {
    running: 'Je teste…',
    done: 'Les essais marchent.',
    failed: 'Un essai ne marche pas, je regarde pourquoi.',
  },
  review: {
    running: 'Je relis mon travail…',
    done: 'J’ai relu mon travail.',
    failed: 'La relecture a trouvé un souci.',
  },
  diagnose: {
    running: 'Je cherche pourquoi un essai ne marche pas…',
    done: 'J’ai trouvé ce qui ne va pas.',
    failed: 'Je n’ai pas trouvé ce qui ne va pas.',
  },
  fix: {
    running: 'Je corrige…',
    done: 'C’est corrigé.',
    failed: 'Ma correction n’a pas suffi.',
  },
};

/** `edit-2` → `edit` ; `web-research` reste entier. */
function stepKey(id: string): string {
  if (STEP_WORDS[id]) return id;
  return id.replace(/-\d+$/u, '');
}

/**
 * Le moteur note « done » une série d'essais qui a **tourné**, même si des essais échouent : le
 * nombre d'échecs est alors à la fin de son détail (« … (7 échec(s) au total) », `taskFlow.ts`).
 * Sans cette lecture, la carte disait « Les essais marchent. » sur une série rouge (essai réel du
 * 20 novembre 2026).
 */
const FAILING_SERIES = /\(\d+ échec\(s\) au total\)\s*$/u;

function lineOf(step: MissionStep, beforeAnyEdit: boolean): FacileLine | null {
  const words = STEP_WORDS[stepKey(step.id)];
  if (!words) return null;
  if (step.status === 'pending' || step.status === 'skipped') return null;
  const key = stepKey(step.id);
  const redSeries = key === 'test' && step.status === 'done' && FAILING_SERIES.test(step.detail ?? '');
  const state: FacileLineState =
    step.status === 'done' && !redSeries ? 'fait' : step.status === 'failed' || redSeries ? 'rate' : 'en-cours';
  let text = state === 'fait' ? words.done : state === 'rate' ? words.failed : words.running;
  // La première série tourne avant toute écriture : elle vérifie la base, pas le travail de Jarvis.
  if (key === 'test' && beforeAnyEdit) {
    text =
      state === 'fait'
        ? 'La base marche, je peux commencer.'
        : state === 'rate'
          ? 'La base a un souci avant même que j’y touche.'
          : 'Je vérifie que la base marche…';
  }
  const files = step.files?.length ?? 0;
  if (key === 'edit' && state === 'fait' && files > 0) {
    text = files === 1 ? 'J’ai écrit un fichier.' : `J’ai écrit ${files} fichiers.`;
  }
  if (key === 'fix' && state === 'fait' && files > 0) {
    text = files === 1 ? 'J’ai corrigé un fichier.' : `J’ai corrigé ${files} fichiers.`;
  }
  return {
    id: step.id,
    text,
    state,
    ...(step.startedAt !== undefined ? { startedAt: step.startedAt } : {}),
    ...(step.finishedAt !== undefined ? { finishedAt: step.finishedAt } : {}),
  };
}

/**
 * Les lignes de travail d'une mission : une par étape **commencée**, dans l'ordre du moteur.
 * Une étape qui n'a pas encore commencé, ou que le moteur a sautée, ne donne aucune ligne.
 */
export function facileLines(mission: Pick<MissionState, 'steps'>): FacileLine[] {
  const lines: FacileLine[] = [];
  let edited = false;
  for (const step of mission.steps) {
    const line = lineOf(step, !edited);
    if (line) lines.push(line);
    if (stepKey(step.id) === 'edit' && step.status !== 'pending' && step.status !== 'skipped') edited = true;
  }
  return lines;
}

/** Fichiers touchés, sans doublon, dans l'ordre d'apparition. */
export function facileFiles(mission: Pick<MissionState, 'steps'>): string[] {
  const seen = new Set<string>();
  const files: string[] = [];
  for (const step of mission.steps) {
    for (const file of step.files ?? []) {
      const clean = file.trim();
      if (!clean || seen.has(clean)) continue;
      seen.add(clean);
      files.push(clean);
    }
  }
  return files.slice(0, 60);
}

/** Dossier du projet, lu dans l'étape qui l'a créé (`scaffold`). `null` tant qu'il n'existe pas. */
export function facileFolder(mission: Pick<MissionState, 'steps'>): string | null {
  const scaffold = mission.steps.find((step) => step.id === 'scaffold' && step.status === 'done');
  const detail = scaffold?.detail?.replace(/^déjà là\s+/u, '').trim();
  return detail && /[\\/]/.test(detail) ? detail : null;
}

/** La question à poser maintenant : la première qui n'a pas encore de réponse. Une seule à la fois. */
export function nextFacileQuestion(
  questions: readonly string[],
  answers: readonly FacileAnswer[],
  now: number,
): FacileQuestion | null {
  const index = answers.length;
  const text = questions[index]?.trim();
  if (!text) return null;
  return { text, defaut: FACILE_DEFAULT_ANSWER, askedAt: now, index: index + 1, total: questions.length };
}

/** Bases qui s'ouvrent dans une fenêtre de Jarvis (« Ouvrir l'appli »). */
const OPENABLE_TEMPLATES: ReadonlySet<string> = new Set(['vite-react', 'web-game']);
/** Bases qui se lancent en tapant une commande. */
const COMMAND_TEMPLATES: ReadonlySet<string> = new Set(['node-cli', 'dotnet-console', 'dotnet-worker', 'ts-lib']);

/** La base choisie s'ouvre-t-elle d'un clic, dans une fenêtre ? */
export function facileCanOpen(template: string | null | undefined): boolean {
  return Boolean(template && OPENABLE_TEMPLATES.has(template));
}

/** Comment se servir de ce qui vient d'être fait, d'après la base. Sans base connue : rien. */
export function facileHowToUse(template: string | null | undefined): string {
  if (facileCanOpen(template)) return 'Clique sur « Ouvrir l’appli » pour l’essayer : je la prépare et je l’ouvre dans une fenêtre.';
  if (template && COMMAND_TEMPLATES.has(template)) {
    return 'C’est un petit programme qui se lance en tapant une commande : le mode d’emploi est dans le fichier README du dossier.';
  }
  if (template === 'dotnet-winforms' || template === 'dotnet-wpf') {
    return 'C’est une application Windows : pour la lancer, demande « Construire » dans le panneau Développeur, puis ouvre le fichier .exe du dossier.';
  }
  return '';
}

/** La phrase de fin, d'après ce que le moteur a vraiment conclu. Jamais « prêt » sans réussite. */
export function facileResult(
  mission: Pick<MissionState, 'status' | 'verdict' | 'summary'>,
  folder: string | null,
  template?: string | null,
): { status: FacileStatus; text: string } | null {
  if (mission.status === 'cancelled') return { status: 'arrete', text: 'J’ai arrêté. Ce qui est fait reste dans son dossier.' };
  if (mission.status === 'failed' || mission.verdict === 'failed') {
    return {
      status: 'rate',
      // Le moteur ne copie dans le dossier du projet qu'un travail réussi : y annoncer « ce qui est
      // fait » était faux, il ne contient que la base (essai réel du 20 novembre 2026).
      text: `Je n’ai pas réussi à finir. ${folder ? 'Le dossier du projet contient seulement la base : mon travail inachevé n’y a pas été copié.' : ''}`.trim(),
    };
  }
  if (mission.status !== 'finished') return null;
  // Étape 2 : « C'est prêt » dit comment s'en servir (essai réel du 20 novembre 2026 : il fallait
  // ouvrir le dossier et savoir quoi taper). Sans base connue, la phrase d'avant.
  const how = facileHowToUse(template);
  if (mission.verdict === 'success') {
    if (how) return { status: 'pret', text: `C’est prêt. ${how}` };
    return { status: 'pret', text: folder ? 'C’est prêt. Tout est dans le dossier du projet.' : 'C’est prêt.' };
  }
  // Tests verts mais relecture non faite : le moteur ne dit pas « réussi », Jarvis non plus.
  return {
    status: 'pret',
    text: `J’ai fini, et les essais marchent, mais je n’ai pas pu relire mon travail : regarde-le avant de t’en servir.${how ? ` ${how}` : ''}`,
  };
}

/**
 * Ce qu'il faut dire à voix haute en passant de `before` à `after` : seulement les moments
 * importants (ce qui a été trouvé, une question, la fin). `null` : rien à dire.
 */
export function facileVoiceMoment(before: FacilePayload | null, after: FacilePayload): string | null {
  if (!after.voice) return null;
  if (after.question && after.question.text !== before?.question?.text) return after.question.text;
  if (after.result && after.result !== before?.result) return after.result;
  const was = before?.findings.state ?? 'cherche';
  if (was === 'cherche' && after.findings.state === 'trouve') {
    const n = after.findings.existing.length;
    return n === 1
      ? 'J’ai trouvé une application qui fait presque ça. Je te la montre à l’écran, et je continue.'
      : `J’ai trouvé ${n} applications qui font presque ça. Je te les montre à l’écran, et je continue.`;
  }
  return null;
}

/** La carte de départ d'une création, avant que le moteur n'ait rien dit. */
export function newFacilePayload(input: {
  id: string;
  request: CreationRequest;
  now: number;
  voice: boolean;
  template?: string | null;
}): FacilePayload {
  return {
    id: input.id,
    missionId: null,
    projectId: null,
    objectif: input.request.objectif,
    restatement: facileRestatement(input.request.sujet),
    startedAt: input.now,
    status: 'travaille',
    findings: { state: 'cherche', existing: [], method: buildingSentence(input.template) },
    lines: [],
    files: [],
    folder: null,
    question: null,
    answers: [],
    result: null,
    voice: input.voice,
  };
}
