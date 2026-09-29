import { randomId, type ChatMessage } from '../types.js';
import { extractSpotifyPlayQuery, isMusicIntent } from '../media/playIntent.js';
import { extractYoutubeUrl } from '../youtube/url.js';
import { extractPersonalizationIntent } from '../personalization/intent.js';
import { extractKnowledgeIntent } from '../knowledge/intent.js';
import { extractSiteBlockIntent } from '../siteblock/intent.js';
import type {
  ChatRequest,
  ChatStreamEvent,
  LLMProvider,
  ProviderConfig,
  ProviderDescriptor,
} from './types.js';

export const mockDescriptor: ProviderDescriptor = {
  id: 'mock',
  label: 'Démo hors ligne (sans clé API)',
  requiresApiKey: false,
  defaultModel: 'jarvis-demo',
  suggestedModels: ['jarvis-demo'],
};

/**
 * Provider de démonstration : aucune requête réseau, aucune clé. Il sert à
 * faire tourner l'application et la boucle d'outils immédiatement après le
 * clonage, et de filet de sécurité quand aucune clé n'est configurée.
 *
 * Le « planificateur » ci-dessous route une phrase vers l'outil disponible le
 * plus pertinent par mots-clés. Il couvre tous les outils livrés — lecture et
 * action — pour que la démonstration reste possible sans clé OpenAI.
 */
export class MockProvider implements LLMProvider {
  readonly id = mockDescriptor.id;
  readonly label = mockDescriptor.label;
  readonly requiresApiKey = false;
  readonly model: string;

  constructor(config?: ProviderConfig) {
    this.model = config?.model || mockDescriptor.defaultModel;
  }

  async *streamChat(request: ChatRequest): AsyncIterable<ChatStreamEvent> {
    // Seul le tour courant compte : les outils des tours précédents ne doivent
    // pas empêcher d'en planifier un nouveau.
    const turn = currentTurn(request.messages);
    const prompt = turn.find((m) => m.role === 'user')?.content ?? '';
    const alreadyRan = turn.some((m) => m.role === 'tool');
    const available = new Set((request.tools ?? []).map((t) => t.name));

    const plan = alreadyRan ? null : planToolCall(prompt, available);

    if (plan) {
      yield* stream(plan.preamble);
      yield { type: 'tool_call', call: { id: randomId(), name: plan.tool, arguments: plan.args } };
      yield { type: 'done', finishReason: 'tool_calls' };
      return;
    }

    yield* stream(alreadyRan ? summarizeToolRun(turn) : answer(prompt));
    yield { type: 'done', finishReason: 'stop' };
  }
}

/** Messages postérieurs au dernier message utilisateur, celui-ci inclus. */
function currentTurn(messages: ChatMessage[]): ChatMessage[] {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    if (messages[index]?.role === 'user') return messages.slice(index);
  }
  return messages;
}

interface ToolPlan {
  preamble: string;
  tool: string;
  args: Record<string, unknown>;
}

/**
 * Router par mots-clés, du plus spécifique au plus générique : un outil placé
 * plus haut dans la liste gagne en cas d'ambiguïté (par exemple « ferme le
 * dossier X » doit déclencher `close_application`, pas `create_folder`).
 */
function planToolCall(prompt: string, available: Set<string>): ToolPlan | null {
  const normalized = prompt.toLowerCase();
  const has = (tool: string): boolean => available.has(tool);

  const youtubeUrl = extractYoutubeUrl(prompt);
  if (has('youtube_transcript') && youtubeUrl) {
    return {
      preamble: 'Je vais écouter cette vidéo.\n\n',
      tool: 'youtube_transcript',
      args: { url: youtubeUrl },
    };
  }

  // Avant `delete_file` (« efface » / « supprime ») : « efface toute ta
  // personnalisation » n'est pas une suppression de fichier.
  const personalizationPlan = planPersonalizationToolCall(prompt, has);
  if (personalizationPlan) return personalizationPlan;

  const knowledgePlan = planKnowledgeToolCall(prompt, has);
  if (knowledgePlan) return knowledgePlan;

  const siteBlockPlan = planSiteBlockToolCall(prompt, has);
  if (siteBlockPlan) return siteBlockPlan;

  const url = extractUrl(prompt);
  if (available.has('fetch_page') && url) {
    return { preamble: 'Je vais lire cette page.\n\n', tool: 'fetch_page', args: { url } };
  }

  if (available.has('get_stock_quote') && /\b(cours|bourse|actions?)\b/.test(normalized)) {
    const queries = extractCompanyNames(prompt);
    if (queries.length > 0) {
      return {
        preamble: 'Je vérifie le cours de bourse.\n\n',
        tool: 'get_stock_quote',
        args: { queries },
      };
    }
  }

  if (
    has('get_active_window') &&
    /fen[êe]tre active|fen[êe]tres ouvertes|qu(?:'|e )est-ce que j.ai d.ouvert|quelles applications/.test(
      normalized,
    )
  ) {
    return {
      preamble: 'Je regarde ce qui est ouvert.\n\n',
      tool: 'get_active_window',
      args: {},
    };
  }

  if (has('list_processes') && /processus|programmes? en cours/.test(normalized)) {
    return {
      preamble: 'Je liste les processus en cours.\n\n',
      tool: 'list_processes',
      args: { sortBy: 'cpu', limit: 15 },
    };
  }

  if (
    has('get_system_errors') &&
    /erreurs? (système|systeme)|journal d.[ée]v[ée]nements|event ?log/.test(normalized)
  ) {
    return {
      preamble: "Je consulte le journal d'événements.\n\n",
      tool: 'get_system_errors',
      args: {},
    };
  }

  if (has('search_files') && /(recherch|cherch|trouv).{0,15}fichier/.test(normalized)) {
    return {
      preamble: 'Je lance la recherche de fichiers.\n\n',
      tool: 'search_files',
      args: { query: extractQuoted(prompt) ?? 'rapport' },
    };
  }

  if (has('read_file') && /(lis|lire|affiche|contenu)( le| du)? fichier/.test(normalized)) {
    return {
      preamble: 'Je lis le fichier demandé.\n\n',
      tool: 'read_file',
      args: { path: extractQuoted(prompt) ?? 'notes.txt' },
    };
  }

  if (
    has('take_screenshot') &&
    /capture (?:d['’]|de l['’])?(?:[ée]cran)|screenshot/.test(normalized)
  ) {
    return {
      preamble: "Je capture l'écran.\n\n",
      tool: 'take_screenshot',
      args: { display: 0 },
    };
  }

  if (
    has('run_command') &&
    /(ex[ée]cute|lance)( la| une)? commande|commande shell/.test(normalized)
  ) {
    const raw = extractQuoted(prompt) ?? 'echo Bonjour depuis Jarvis';
    const [command, ...cmdArgs] = raw.split(/\s+/);
    return {
      preamble: 'Je prépare l’exécution de la commande.\n\n',
      tool: 'run_command',
      args: { command, args: cmdArgs },
    };
  }

  if (has('delete_file') && /(supprime|efface|corbeille)/.test(normalized)) {
    return {
      preamble: 'Je prépare la suppression (vers la corbeille).\n\n',
      tool: 'delete_file',
      args: { path: extractQuoted(prompt) ?? 'fichier-a-supprimer.txt' },
    };
  }

  if (has('move_file') && /(d[ée]place|renomme)/.test(normalized)) {
    const [source, destination] = extractAllQuoted(prompt);
    return {
      preamble: 'Je prépare le déplacement.\n\n',
      tool: 'move_file',
      args: { source: source ?? 'source.txt', destination: destination ?? 'destination.txt' },
    };
  }

  if (has('copy_file') && /copi|duplique/.test(normalized)) {
    const [source, destination] = extractAllQuoted(prompt);
    return {
      preamble: 'Je prépare la copie.\n\n',
      tool: 'copy_file',
      args: { source: source ?? 'source.txt', destination: destination ?? 'copie.txt' },
    };
  }

  const spotifyPlan = isMusicIntent(prompt) ? planSpotifyToolCall(prompt, normalized, has) : null;
  if (spotifyPlan) return spotifyPlan;

  if (has('close_application') && /(ferme|quitte|arr[êe]te|tue)\s/.test(normalized)) {
    return {
      preamble: "Je prépare la fermeture de l'application.\n\n",
      tool: 'close_application',
      args: {
        name: extractAfter(prompt, ['ferme', 'quitte', 'arrête', 'arrete', 'tue']) ?? 'application',
      },
    };
  }

  if (has('open_application') && /(ouvre|lance|d[ée]marre)\s/.test(normalized)) {
    return {
      preamble: "Je prépare l'ouverture de l'application.\n\n",
      tool: 'open_application',
      args: {
        name: extractAfter(prompt, ['ouvre', 'lance', 'démarre', 'demarre']) ?? 'application',
      },
    };
  }

  if (
    has('get_system_info') &&
    /système|systeme|cpu|ram|mémoire|memoire|disque|stockage|lent|perf|machine|pc/.test(normalized)
  ) {
    return { preamble: 'Je regarde l’état de la machine.\n\n', tool: 'get_system_info', args: {} };
  }

  if (has('create_folder') && /dossier|répertoire|repertoire|folder/.test(normalized)) {
    return {
      preamble: 'Je prépare la création du dossier.\n\n',
      tool: 'create_folder',
      args: { name: extractFolderName(prompt), location: 'documents' },
    };
  }

  if (
    has('web_research') &&
    /recherche approfondie|plusieurs sources|compare\b|comparaison/.test(normalized)
  ) {
    const query = extractSearchQuery(prompt);
    return {
      preamble: 'Je lance une recherche approfondie.\n\n',
      tool: 'web_research',
      args: {
        queries: [query, `${query} source officielle`].slice(0, 4),
        limitPerQuery: 4,
      },
    };
  }

  if (
    available.has('web_search') &&
    /recherche|cherche|internet|actualit|météo|meteo|qui est|qui a|quelle est|qu'est-ce que|c'est quoi|capitale de/.test(
      normalized,
    )
  ) {
    return {
      preamble: 'Je cherche ça sur Internet.\n\n',
      tool: 'web_search',
      args: { query: extractSearchQuery(prompt), limit: 5 },
    };
  }

  return null;
}

function planSiteBlockToolCall(prompt: string, has: (tool: string) => boolean): ToolPlan | null {
  const intent = extractSiteBlockIntent(prompt);
  if (!intent || !has(intent.tool)) return null;

  const preambles: Record<string, string> = {
    siteblock_get_status: 'Je consulte SiteBlock.\n\n',
    siteblock_set_blocking: 'Je prépare la modification du blocage SiteBlock.\n\n',
    siteblock_add_domain: 'Je prépare l’ajout du site à la liste de blocage.\n\n',
    siteblock_remove_domain: 'Je prépare le déblocage du site.\n\n',
    siteblock_start_focus: 'Je prépare le mode concentration SiteBlock.\n\n',
    siteblock_stop_focus: 'Je prépare l’arrêt du mode concentration.\n\n',
    siteblock_add_period: 'Je prépare la période de blocage.\n\n',
    siteblock_remove_period: 'Je prépare la suppression de la période SiteBlock.\n\n',
  };

  return {
    preamble: preambles[intent.tool] ?? 'Je prépare l’action SiteBlock.\n\n',
    tool: intent.tool,
    args: intent.args,
  };
}

function planPersonalizationToolCall(
  prompt: string,
  has: (tool: string) => boolean,
): ToolPlan | null {
  const intent = extractPersonalizationIntent(prompt);
  if (!intent || !has(intent.tool)) return null;

  const preambles: Record<string, string> = {
    get_jarvis_personalization: 'Je consulte la mémoire persistante.\n\n',
    set_jarvis_personalization: 'Je retiens cette préférence.\n\n',
    add_jarvis_personalization_rule:
      'J’enregistre cette règle pour les prochaines conversations.\n\n',
    forget_jarvis_personalization: 'J’oublie cette préférence.\n\n',
    reset_jarvis_personalization: 'J’efface toute la mémoire persistante.\n\n',
  };

  return {
    preamble: preambles[intent.tool] ?? 'Je mets à jour la personnalisation.\n\n',
    tool: intent.tool,
    args: intent.args,
  };
}

function planKnowledgeToolCall(prompt: string, has: (tool: string) => boolean): ToolPlan | null {
  const intent = extractKnowledgeIntent(prompt);
  if (!intent || !has(intent.tool)) return null;

  const preambles: Record<string, string> = {
    search_jarvis_memory: 'Je cherche dans la mémoire locale.\n\n',
    remember_jarvis: 'Je prépare l’enregistrement dans la mémoire locale.\n\n',
    index_jarvis_folder: 'Je prépare l’indexation du dossier.\n\n',
    get_jarvis_memory_stats: 'Je consulte l’index local.\n\n',
    clear_jarvis_memory: 'Je prépare l’effacement de la mémoire documentaire.\n\n',
  };

  return {
    preamble: preambles[intent.tool] ?? 'Je consulte la mémoire documentaire.\n\n',
    tool: intent.tool,
    args: intent.args,
  };
}

/**
 * Routage des huit outils `spotify_*`. Séparé de `planToolCall` parce que
 * deux de ses motifs (« lance … sur Spotify », « mets du … ») doivent être
 * vérifiés avant les motifs génériques `ouvre|lance|démarre` de
 * `open_application` : sans ça, « Lance Get Lucky sur Spotify » ouvrirait
 * l'application "Get Lucky sur Spotify" au lieu de lancer le morceau. À
 * l'inverse, une simple « Lance Spotify » (sans morceau ni « sur Spotify »)
 * ne doit surtout pas déclencher `spotify_play` : c'est bien
 * `open_application` qui doit s'en charger, comme avant l'ajout de Spotify.
 */
function planSpotifyToolCall(
  prompt: string,
  normalized: string,
  has: (tool: string) => boolean,
): ToolPlan | null {
  if (
    has('spotify_current_track') &&
    /qu(?:'|e )est-ce qui joue|morceau (?:actuel|en cours)/.test(normalized)
  ) {
    return {
      preamble: 'Je regarde ce qui joue sur Spotify.\n\n',
      tool: 'spotify_current_track',
      args: {},
    };
  }

  if (has('spotify_next') && /morceau suivant|piste suivante|chanson suivante/.test(normalized)) {
    return { preamble: 'Je passe au morceau suivant.\n\n', tool: 'spotify_next', args: {} };
  }

  if (
    has('spotify_previous') &&
    /morceau pr[ée]c[ée]dent|piste pr[ée]c[ée]dente|chanson pr[ée]c[ée]dente/.test(normalized)
  ) {
    return { preamble: 'Je reviens au morceau précédent.\n\n', tool: 'spotify_previous', args: {} };
  }

  if (has('spotify_set_shuffle') && /\bshuffle\b|mode al[ée]atoire/.test(normalized)) {
    const enabled = !/(désactiv|desactiv|coupe|arr[êe]te)/.test(normalized);
    return {
      preamble: `Je ${enabled ? 'active' : 'désactive'} le mode aléatoire Spotify.\n\n`,
      tool: 'spotify_set_shuffle',
      args: { enabled },
    };
  }

  if (has('spotify_set_volume') && /\bvolume\b/.test(normalized)) {
    const percent = Number(prompt.match(/(\d{1,3})\s*%?/)?.[1] ?? 50);
    return {
      preamble: `Je règle le volume Spotify à ${percent} %.\n\n`,
      tool: 'spotify_set_volume',
      args: { percent: Math.min(100, Math.max(0, percent)) },
    };
  }

  if (has('spotify_pause') && /\bpause\b/.test(normalized)) {
    return { preamble: 'Je mets Spotify en pause.\n\n', tool: 'spotify_pause', args: {} };
  }

  if (
    has('spotify_resume') &&
    (/\breprend(?:s|re)?\b/.test(normalized) || /mets la musique/.test(normalized))
  ) {
    return { preamble: 'Je reprends la lecture Spotify.\n\n', tool: 'spotify_resume', args: {} };
  }

  if (has('spotify_play')) {
    const query = extractSpotifyPlayQuery(prompt);
    if (query) {
      return {
        preamble: `Je cherche « ${query} » sur Spotify.\n\n`,
        tool: 'spotify_play',
        args: { query },
      };
    }
  }

  return null;
}

function extractFolderName(prompt: string): string {
  const quoted = extractQuoted(prompt);
  if (quoted) return quoted;
  const named = prompt.match(/(?:nommé|nomme|appelé|appele|nommer)\s+([\p{L}\p{N}\-_. ]{1,40})/iu);
  if (named?.[1]) return named[1].trim();
  return 'Nouveau dossier';
}

/** Premier segment entre guillemets («», "" ou '') du texte, s'il existe. */
function extractQuoted(prompt: string): string | null {
  const match = prompt.match(/[«"']([^»"']{1,200})[»"']/);
  return match?.[1]?.trim() ?? null;
}

/** Tous les segments entre guillemets, dans l'ordre d'apparition. */
function extractAllQuoted(prompt: string): [string | null, string | null] {
  const matches = [...prompt.matchAll(/[«"']([^»"']{1,200})[»"']/g)].map(
    (m) => m[1]?.trim() ?? null,
  );
  return [matches[0] ?? null, matches[1] ?? null];
}

/** Mot ou groupe de mots qui suit le premier mot-clé trouvé parmi `keywords`. */
function extractAfter(prompt: string, keywords: string[]): string | null {
  const quoted = extractQuoted(prompt);
  if (quoted) return quoted;
  const pattern = new RegExp(`(?:${keywords.join('|')})\\s+([\\p{L}\\p{N}\\-_. ]{1,60})`, 'iu');
  const match = prompt.match(pattern);
  if (!match?.[1]) return null;
  return match[1].replace(/\s+(et|puis)\b.*$/i, '').trim();
}

function extractUrl(prompt: string): string | null {
  const match = prompt.match(/https?:\/\/[^\s)\]>,]+/i);
  if (!match) return null;
  return match[0].replace(/[.,;:)\]>'"]+$/, '');
}

/** Extrait un ou plusieurs noms d'entreprises après « cours de », « action(s) »… */
function extractCompanyNames(prompt: string): string[] {
  const match = prompt.match(
    /(?:cours(?:\s+(?:de\s+bourse|boursier))?|actions?)\s+(?:de\s+|d['’])?([^?!.\n]{2,80})/iu,
  );
  const raw = match?.[1] ?? '';
  return raw
    .split(/,| et | & /iu)
    .map((part) => part.trim())
    .filter((part) => part.length > 0)
    .slice(0, 5);
}

/** Nettoie les formules d'introduction (« peux-tu chercher… ») pour garder l'essentiel de la requête. */
function extractSearchQuery(prompt: string): string {
  const stripped = prompt
    .replace(/^(?:est-ce que tu peux|peux-tu|pourrais-tu|merci de|stp)\s+/iu, '')
    .replace(
      /^(?:faire une recherche|fais une recherche|rechercher|recherche|chercher|cherche)\s*(?:sur internet|sur le web|en ligne)?\s*(?:sur|pour|de|à propos de)?\s*/iu,
      '',
    )
    .replace(/\s*(?:sur internet|sur le web|en ligne)\s*$/iu, '')
    .replace(/[?!.]+$/u, '')
    .trim();
  return stripped.length > 0 ? stripped : prompt.trim();
}

function summarizeToolRun(turn: ChatMessage[]): string {
  const last = [...turn].reverse().find((m) => m.role === 'tool');
  const body = last?.content?.trim() ?? '';
  const lines = body
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);

  return [
    'Voici ce que j’ai obtenu :',
    '',
    lines.length > 0
      ? lines.map((line) => `- ${line}`).join('\n')
      : '_Aucun résultat retourné par l’outil._',
    '',
    '_(Réponse générée par le provider de démonstration. Ajoute une clé API dans les réglages pour parler à un vrai modèle.)_',
  ].join('\n');
}

function answer(prompt: string): string {
  if (prompt.trim().length === 0) {
    return 'Je t’écoute. Pose-moi une question ou demande-moi une action.';
  }
  if (/bonjour|salut|hello|hey/i.test(prompt)) {
    return 'Bonjour. Je suis Jarvis, en mode démonstration hors ligne. Demande-moi l’état de ta machine ou la création d’un dossier pour voir la boucle d’outils en action.';
  }
  return [
    `Tu m’as demandé : « ${prompt} ».`,
    '',
    'Je tourne actuellement avec le **provider de démonstration**, qui ne contacte aucun modèle distant. Il sert à valider l’interface, le streaming et la boucle d’outils.',
    '',
    'Pour une vraie réponse, ouvre les réglages et renseigne une clé API OpenAI ou Anthropic.',
  ].join('\n');
}

async function* stream(text: string): AsyncGenerator<ChatStreamEvent> {
  for (const token of text.match(/\S+\s*|\s+/g) ?? []) {
    yield { type: 'text', delta: token };
    await sleep(12);
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
