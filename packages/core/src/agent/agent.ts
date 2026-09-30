import type { LLMProvider } from '../providers/types.js';
import type { ToolManager } from '../tools/manager.js';
import type { ToolContext } from '../tools/types.js';
import { extractKnowledgeIntent } from '../knowledge/intent.js';
import { isCurrentTrackQuestion } from '../media/currentTrackIntent.js';
import { extractSpotifyPlayQuery, isMusicIntent } from '../media/playIntent.js';
import { extractYoutubeUrl } from '../youtube/url.js';
import {
  createMessage,
  randomId,
  type ChatMessage,
  type ToolCall,
  type ToolCallOutcome,
} from '../types.js';

export type AgentEvent =
  | { type: 'assistant_delta'; delta: string }
  | { type: 'assistant_message'; message: ChatMessage }
  | { type: 'tool_start'; call: ToolCall }
  | { type: 'tool_progress'; callId: string; message: string }
  | { type: 'tool_result'; outcome: ToolCallOutcome; message: ChatMessage }
  | { type: 'error'; message: string }
  | { type: 'done' };

/** Plafond dur de tours d'outils, même si l'appelant en demande plus. */
export const HARD_TOOL_ROUND_CAP = 6;

/** Température basse dès qu'un tour porte sur des faits, des outils ou des chiffres. */
export function temperatureForTurn(text: string, configured = 0.4): number {
  if (
    /cherch|recherche|actualité|spotify|youtube|vidéo|video|mémoire|document|fichier|cours de|action |chiffre|combien|facture|quelle est/i.test(
      text,
    )
  ) {
    return Math.min(configured, 0.2);
  }
  return configured;
}

export interface AgentOptions {
  systemPrompt: string;
  /** Garde-fou contre les boucles d'outils sans fin. */
  maxToolRounds?: number;
  temperature?: number;
  maxTokens?: number;
}

export const DEFAULT_SYSTEM_PROMPT = [
  "Tu es Jarvis, l'assistant personnel de l'utilisateur sur son PC Windows.",
  'Réponds en français, de façon naturelle, directe et concise.',
  "Tu n'es pas un assistant uniquement musical : tu aides aussi pour le système, les fichiers, le web, les applications et le reste.",
  "Tu ne peux agir sur l'ordinateur qu'à travers les outils qui te sont fournis. Utilise-les réellement ; n'invente pas un résultat d'outil.",
  "Les commandes dictées par Whisper peuvent contenir des fautes phonétiques françaises : « ouf », « ouve » ou « ouv » pour ouvrir, « fichié » pour fichier, « chrome » pour Google Chrome. Interprète l'intention et appelle l'outil adapté. Ne prétends pas avoir été réentraîné : tu restes le modèle local, avec la mémoire et l'index du PC.",
  "N'invente jamais un résultat : si tu as besoin d'une information sur la machine, appelle l'outil correspondant.",
  "Pour une information actuelle, une recherche sur Internet ou une question factuelle dont tu n'es pas certain, utilise web_search. Pour une question complexe, importante, comparative, technique ou nécessitant plusieurs sources, utilise web_research avec 2 à 4 requêtes complémentaires. Le moteur Google est disponible sans clé API ; Wikipédia et Brave Search restent choisis dans les réglages. Après une recherche, ouvre avec fetch_page les sources les plus importantes, en priorité les sources officielles, primaires ou spécialisées. Ne traite jamais un extrait de moteur de recherche comme une preuve suffisante. Compare les sources quand elles peuvent diverger, vérifie les dates, sépare les faits des hypothèses et indique clairement l'incertitude. Quand tu utilises le Web, donne les sources principales dans ta réponse. N'invente jamais une information qui pourrait être vérifiée sur le Web.",
  "Si l'utilisateur demande explicitement de retenir, mémoriser, oublier ou afficher une préférence (ton, nom, habitudes), utilise les outils get/set/add/forget/reset_jarvis_personalization. N'enregistre rien sans une demande explicite.",
  "Pour retrouver une information personnelle, un projet passé ou un document déjà indexé, utilise search_jarvis_memory. Pour une demande explicite de mémorisation longue durée d'un fait, utilise remember_jarvis. N'affirme jamais qu'une information vient de la mémoire si tu ne l'as pas retrouvée.",
  "Si l'utilisateur donne un lien YouTube (youtube.com/watch, youtu.be, Shorts ou live), utilise youtube_transcript. L'outil écoute la piste audio avec Whisper local, puis le modèle local rédige un condensé en français : un court paragraphe et les points importants. N'invente aucun chiffre ni aucun fait absent de ce résultat. Conserve la séparation entre faits et opinions, les horodatages, et l'avertissement que ce n'est pas un conseil d'investissement s'il figure dans le résultat. S'il précise que les sous-titres ont remplacé l'écoute, conserve cette phrase.",
  "Si l'utilisateur demande de bloquer ou débloquer des sites, d'activer un mode travail ou concentration, ou de programmer un créneau, utilise les outils siteblock_*. Ne prétends jamais avoir modifié le blocage sans un résultat positif de l'outil.",
  "Certaines actions demandent l'accord de l'utilisateur ; s'il refuse, accepte-le sans insister.",
  "N'invente jamais le contenu d'un fichier, un résultat de recherche, une action effectuée, un chiffre financier ni l'état Spotify. Si l'outil ne l'a pas renvoyé, dis-le.",
  "Tu peux enchaîner plusieurs outils dans un même tour (mémoire, documents, web, lecture de page) puis vérifier avant de répondre.",
  "Si l'utilisateur demande de garder une vidéo en mémoire, utilise remember_video. Ne transforme pas une opinion de la vidéo en fait.",
].join(' ');

const WEB_RESEARCH_TURN_PROMPT =
  "PROTOCOLE RECHERCHE : si cette demande nécessite Internet, choisis l'outil adapté. " +
  'Question simple et factuelle : web_search. Question complexe, actuelle ou importante : web_research avec 2 à 4 angles complémentaires. ' +
  'Après la recherche, utilise fetch_page pour lire les sources qui portent réellement les faits importants. ' +
  'Ne mélange pas les connaissances du modèle avec les faits trouvés sans les distinguer. ' +
  'Pour une information temporelle, vérifie la date de publication ou de mise à jour. ' +
  'Si deux sources sérieuses divergent, signale la divergence au lieu de choisir arbitrairement. ' +
  "Ne prétends jamais avoir consulté une source que tu n'as pas reçue d'un outil.";

const YOUTUBE_TURN_PROMPT =
  "Pour CETTE demande, un lien YouTube est présent. Utilise youtube_transcript avant de répondre. Le condensé (paragraphe court, puis les points importants) vient de l'outil : faits, chiffres, noms, décisions et risques seulement. Garde les opinions à part des faits, les horodatages, et l'avertissement d'investissement s'il est présent. N'invente aucun chiffre. Si l'outil dit avoir utilisé les sous-titres plutôt que l'écoute, répète-le.";

const MUSIC_TURN_PROMPT =
  "Pour CETTE demande (musique / Spotify uniquement), utilise les outils spotify_* : lecture, pause, reprise, suivant, précédent, volume, shuffle, morceau en cours. N'envoie pas simplement un lien Spotify. N'invente jamais qu'un morceau ou un artiste n'existe pas : appelle spotify_play avec la requête telle quelle (fautes comprises) et base ta réponse sur le résultat de l'outil. " +
  "Pour savoir ce qui joue, appelle spotify_current_track et donne le titre et l'artiste renvoyés, ou son message d'erreur. Ne réponds jamais de mémoire et ne propose jamais de commande shell, PowerShell ou wmic pour Spotify.";

const STICKY_MUSIC_SENTENCES = [
  /Pour une demande de lecture, pause, reprise, morceau suivant, morceau précédent, volume ou shuffle Spotify, utilise les outils spotify_\* disponibles\. N'envoie pas simplement un lien Spotify et ne prétends pas avoir lancé une musique sans avoir exécuté l'outil\.\s*/giu,
  /N'invente jamais qu'un morceau ou un artiste n'existe pas : appelle spotify_play avec la requête telle quelle \(fautes comprises\)\. Base ta réponse uniquement sur le résultat de l'outil\.\s*/giu,
];

export function isSpotifyToolName(name: string): boolean {
  return name.startsWith('spotify_');
}

/** Enlève les consignes 0.4.x qui collaient Jarvis à Spotify d'un tour à l'autre. */
export function composeSystemPrompt(
  systemPrompt: string,
  musicTurn: boolean,
  webTurn = false,
  youtubeTurn = false,
): string {
  let text = systemPrompt;
  for (const sticky of STICKY_MUSIC_SENTENCES) {
    text = text.replace(sticky, '');
  }
  text = text.replace(/\s{2,}/g, ' ').trim();
  if (youtubeTurn) return `${text} ${YOUTUBE_TURN_PROMPT}`.trim();
  if (musicTurn) return `${text} ${MUSIC_TURN_PROMPT}`.trim();
  if (webTurn) return `${text} ${WEB_RESEARCH_TURN_PROMPT}`.trim();
  return text;
}

/**
 * Orchestre un tour de conversation : appel du modèle, exécution des outils
 * demandés, puis relance du modèle avec les résultats jusqu'à la réponse finale.
 */
export class Agent {
  constructor(
    private readonly provider: LLMProvider,
    private readonly tools: ToolManager,
    private readonly options: AgentOptions,
  ) {}

  async *run(history: ChatMessage[], context: ToolContext): AsyncGenerator<AgentEvent> {
    const conversation = [...history];
    const maxRounds = Math.min(
      this.options.maxToolRounds ?? HARD_TOOL_ROUND_CAP,
      HARD_TOOL_ROUND_CAP,
    );
    const lastUser = lastUserMessage(conversation);
    const youtubeTurn = extractYoutubeUrl(lastUser) !== null;
    const musicTurn = !youtubeTurn && isMusicIntent(lastUser);
    const webTurn = !youtubeTurn && looksLikeWebResearchIntent(lastUser);
    const system = composeSystemPrompt(this.options.systemPrompt, musicTurn, webTurn, youtubeTurn);
    const toolSchemas = this.tools
      .schemas()
      .filter((tool) => musicTurn || !isSpotifyToolName(tool.name));

    for (let round = 0; round <= maxRounds; round += 1) {
      const forcedYoutube =
        round === 0 && youtubeTurn ? this.forcedYoutubeTranscript(conversation) : null;
      if (forcedYoutube) {
        yield { type: 'assistant_message', message: forcedYoutube.assistantMessage };
        conversation.push(forcedYoutube.assistantMessage);
        yield { type: 'tool_start', call: forcedYoutube.call };
        const outcome = yield* this.executeReportingProgress(forcedYoutube.call, context);
        const toolMessage = createMessage('tool', outcome.content, {
          toolCallId: forcedYoutube.call.id,
          toolName: forcedYoutube.call.name,
          toolStatus: outcome.status,
        });
        conversation.push(toolMessage);
        yield { type: 'tool_result', outcome, message: toolMessage };
        // Le condensé est déjà rédigé par le modèle local. On ne relance pas
        // le modèle du chat : il ajouterait des chiffres qui n'ont pas été dits.
        yield { type: 'assistant_delta', delta: outcome.content };
        const reply = createMessage('assistant', outcome.content);
        conversation.push(reply);
        yield { type: 'assistant_message', message: reply };
        yield { type: 'done' };
        return;
      }

      const forced = round === 0 && musicTurn ? this.forcedSpotify(conversation) : null;
      if (forced) {
        yield { type: 'assistant_message', message: forced.assistantMessage };
        conversation.push(forced.assistantMessage);
        yield { type: 'tool_start', call: forced.call };
        const outcome = await this.tools.execute(forced.call, context);
        const toolMessage = createMessage('tool', outcome.content, {
          toolCallId: forced.call.id,
          toolName: forced.call.name,
          toolStatus: outcome.status,
        });
        conversation.push(toolMessage);
        yield { type: 'tool_result', outcome, message: toolMessage };
        // Ne pas relancer le modèle : c'est lui qui inventait « introuvable »
        // sans appeler l'API, ou une commande wmic pour le morceau en cours.
        // Le texte de l'outil est la réponse.
        const text =
          forced.call.name === 'spotify_current_track'
            ? currentTrackReply(outcome)
            : outcome.content;
        yield { type: 'assistant_delta', delta: text };
        const reply = createMessage('assistant', text);
        conversation.push(reply);
        yield { type: 'assistant_message', message: reply };
        yield { type: 'done' };
        return;
      }

      let text = '';
      const calls: ToolCall[] = [];
      let failed = false;

      try {
        const stream = this.provider.streamChat({
          messages: [...conversation],
          system,
          tools: toolSchemas,
          temperature: temperatureForTurn(lastUser, this.options.temperature),
          maxTokens: this.options.maxTokens,
          signal: context.signal,
        });

        for await (const event of stream) {
          if (event.type === 'text') {
            text += event.delta;
            yield { type: 'assistant_delta', delta: event.delta };
          } else if (event.type === 'tool_call') {
            calls.push(event.call);
          } else if (event.type === 'error') {
            failed = true;
            yield { type: 'error', message: event.message };
            break;
          }
        }
      } catch (error) {
        if (context.signal?.aborted) {
          yield { type: 'done' };
          return;
        }
        yield { type: 'error', message: describeError(error) };
        return;
      }

      if (failed) return;

      const assistantMessage = createMessage(
        'assistant',
        text,
        calls.length > 0 ? { toolCalls: calls } : {},
      );
      conversation.push(assistantMessage);
      yield { type: 'assistant_message', message: assistantMessage };

      if (calls.length === 0) {
        yield { type: 'done' };
        return;
      }

      const outcomes: ToolCallOutcome[] = [];
      for (const call of calls) {
        yield { type: 'tool_start', call };
        const outcome = yield* this.executeReportingProgress(call, context);
        outcomes.push(outcome);
        const toolMessage = createMessage('tool', outcome.content, {
          toolCallId: call.id,
          toolName: call.name,
          toolStatus: outcome.status,
        });
        conversation.push(toolMessage);
        yield { type: 'tool_result', outcome, message: toolMessage };
      }

      // Tout refusé : on ne relance pas le modèle. qwen2.5:3b répondait
      // « le dossier a été créé » juste après un clic sur « Refuser ».
      if (outcomes.every((outcome) => outcome.decision === 'refused')) {
        const names = [...new Set(outcomes.map((outcome) => `« ${outcome.name} »`))].join(', ');
        const text = `D'accord, je n'ai rien fait : tu as refusé ${names}. Rien n'a été modifié.`;
        yield { type: 'assistant_delta', delta: text };
        const reply = createMessage('assistant', text);
        conversation.push(reply);
        yield { type: 'assistant_message', message: reply };
        yield { type: 'done' };
        return;
      }
    }

    yield {
      type: 'error',
      message: "Trop d'appels d'outils enchaînés, j'ai interrompu la boucle par sécurité.",
    };
  }

  /**
   * Un lien YouTube dans le dernier message utilisateur force l'écoute,
   * comme Spotify force la lecture : le modèle ne résume pas de mémoire.
   * Un lien plus ancien ne compte pas.
   */
  private forcedYoutubeTranscript(
    conversation: ChatMessage[],
  ): { call: ToolCall; assistantMessage: ChatMessage } | null {
    const tool = this.tools.get('youtube_transcript');
    if (!tool || tool.risk === 'denied') return null;

    const lastUserIndex = conversation.map((message) => message.role).lastIndexOf('user');
    if (lastUserIndex < 0) return null;
    if (conversation.slice(lastUserIndex).some((message) => message.role === 'tool')) return null;

    const url = extractYoutubeUrl(conversation[lastUserIndex]?.content ?? '');
    if (!url) return null;

    const call: ToolCall = { id: randomId(), name: 'youtube_transcript', arguments: { url } };
    return {
      call,
      assistantMessage: createMessage('assistant', '', { toolCalls: [call] }),
    };
  }

  private async *executeReportingProgress(
    call: ToolCall,
    context: ToolContext,
  ): AsyncGenerator<AgentEvent, ToolCallOutcome> {
    const pending: string[] = [];
    let finished = false;
    let wake: (() => void) | null = null;
    const pulse = (): void => {
      const resolve = wake;
      wake = null;
      resolve?.();
    };

    const outcomePromise = this.tools.execute(call, {
      ...context,
      onProgress: (message) => {
        const text = message.trim();
        if (!text) return;
        pending.push(text);
        pulse();
      },
    });
    void outcomePromise.finally(() => {
      finished = true;
      pulse();
    });

    while (!finished || pending.length > 0) {
      if (pending.length > 0) {
        const message = pending.shift() ?? '';
        if (message) yield { type: 'tool_progress', callId: call.id, message };
        continue;
      }
      await new Promise<void>((resolve) => {
        if (finished && pending.length === 0) {
          resolve();
          return;
        }
        wake = resolve;
      });
    }

    return outcomePromise;
  }

  /**
   * Si le dernier message utilisateur demande ce qui joue, on exécute
   * `spotify_current_track` avant le modèle ; si c'est une demande de
   * lecture, `spotify_play`. Un petit modèle local répondait sinon de
   * mémoire (« Necfeu introuvable », « lance wmic en administrateur ») alors
   * que Spotify n'avait jamais été interrogé.
   */
  private forcedSpotify(
    conversation: ChatMessage[],
  ): { call: ToolCall; assistantMessage: ChatMessage } | null {
    const lastUserIndex = conversation.map((message) => message.role).lastIndexOf('user');
    if (lastUserIndex < 0) return null;
    if (conversation.slice(lastUserIndex).some((message) => message.role === 'tool')) return null;

    const prompt = conversation[lastUserIndex]?.content ?? '';
    if (isCurrentTrackQuestion(prompt)) return this.forcedCall('spotify_current_track', {});

    const query = extractSpotifyPlayQuery(prompt);
    if (!query) return null;
    return this.forcedCall('spotify_play', { query });
  }

  private forcedCall(
    name: string,
    args: Record<string, unknown>,
  ): { call: ToolCall; assistantMessage: ChatMessage } | null {
    const tool = this.tools.get(name);
    if (!tool || tool.risk === 'denied') return null;

    const call: ToolCall = { id: randomId(), name, arguments: args };
    return {
      call,
      assistantMessage: createMessage('assistant', '', { toolCalls: [call] }),
    };
  }
}

/**
 * Le texte de `spotify_current_track` donne déjà « Lecture : titre — artiste ».
 * En cas d'échec, une phrase française d'abord : le message brut peut venir
 * du réseau (« fetch failed »).
 */
function currentTrackReply(outcome: ToolCallOutcome): string {
  if (outcome.status === 'ok') return outcome.content;
  const reason = outcome.content.replace(/^Spotify\s*:\s*/u, '').trim();
  if (!reason) return "Je n'ai pas pu savoir ce qui joue sur Spotify.";
  return `Je n'ai pas pu savoir ce qui joue sur Spotify : ${reason}`;
}

/**
 * Intention web explicite : actualité, Internet, vérification de sources.
 * Volontairement étroit — « comment ouvrir Chrome » ou « cherche dans ta
 * mémoire » ne doivent pas pousser le modèle vers la recherche web.
 */
export function looksLikeWebResearchIntent(prompt: string): boolean {
  const text = prompt.trim();
  if (!text) return false;
  if (extractKnowledgeIntent(text)) return false;
  return /sur internet|sur le web|\bgoogle\b|actualit[ée]s?|\bnews\b|aujourd['’]hui|en ce moment|m[ée]t[ée]o|recherche approfondie|plusieurs sources|source officielle|v[ée]rifie(?:r)? (?:sur|avec|ça)/iu.test(
    text,
  );
}

function lastUserMessage(conversation: ChatMessage[]): string {
  const lastUserIndex = conversation.map((message) => message.role).lastIndexOf('user');
  if (lastUserIndex < 0) return '';
  return conversation[lastUserIndex]?.content ?? '';
}

function describeError(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}
