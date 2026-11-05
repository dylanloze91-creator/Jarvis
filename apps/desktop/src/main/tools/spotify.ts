import { z } from 'zod';
import { defineTool, spotifyTargetFromText, type SpotifyPlayTarget } from '@jarvis/core';
import type { SpotifyBridge } from '../media/SpotifyBridge.js';
import type { SpotifyPlayedOn } from '../media/SpotifyProvider.js';

export interface SpotifyToolsDeps {
  spotify: SpotifyBridge;
  /**
   * 5.0.69 : une enceinte Connect (autre que le PC) est choisie dans les réglages. Sans elle,
   * `spotify_transfer` reste hors du catalogue du modèle (catalogue figé de 0.4.22 inchangé).
   */
  speakerChosen?: () => boolean;
}

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function describeSpotifyFailure(error: unknown): string {
  const message = describeError(error);
  if (/identifiant client|n'est pas configuré/i.test(message)) {
    return "Spotify n'est pas configuré. Colle l'identifiant client (Client ID) dans les réglages, section Musique.";
  }
  if (/pas connecté|expiré|Reconnecte/i.test(message)) {
    return "Spotify n'est pas connecté. Clique sur « Se connecter » dans les réglages, section Musique.";
  }
  if (/premium/i.test(message)) {
    return "Spotify Premium est requis pour piloter la lecture (limite de l'API Spotify, pas de Jarvis).";
  }
  // Messages déjà rédigés : pas de lecteur audible, 204 silencieux, volume 0, mauvais appareil,
  // enceinte introuvable, plusieurs enceintes, transfert non vérifié.
  if (
    /Je ne trouve pas|Je ne vois aucune enceinte|Plusieurs enceintes|n'est pas passée sur|lecture à transférer|aucun lecteur|lecture n'a pas démarré|lecture n'est pas confirmée|volume est à 0|pas sur l'application de bureau|pas sur «|Spotify est fermé|appareil Spotify est indisponible|Premium|jeton Spotify|HTTP 429|Appareils Connect|is_playing=/i.test(
      message,
    )
  ) {
    return message;
  }
  return `Impossible de lancer la musique sur Spotify : ${message}`;
}

/** Libellé parlé d'une cible : « l'enceinte », « le PC », « Devialet ». */
function targetLabel(target: SpotifyPlayTarget): string {
  if (target.kind === 'speaker') return "l'enceinte";
  if (target.kind === 'pc') return 'le PC';
  return `« ${target.name} »`;
}

/** 5.0.69 : quand un appareil précis était demandé, c'est le résultat qui dit où ça joue. */
function playedWhere(played: SpotifyPlayedOn | void): string {
  return played?.targeted ? ` sur « ${played.deviceName} »` : '';
}

/**
 * Les outils Spotify. Niveau de risque : `safe` pour tous, y compris les
 * actions qui changent l'état de lecture (pause, suivant, volume…) — décision
 * prise lors de l'intégration de cette fonctionnalité, documentée en détail
 * dans le README (section « Pourquoi les outils Spotify sont `safe` ») :
 * aucune n'est destructrice ni irréversible, toutes s'annulent en un mot
 * (« reprends », « remets la musique »), et exiger une confirmation pour
 * mettre en pause rendrait la fonctionnalité inutilisable à la voix. Seule
 * exception envisagée puis écartée : `spotify_play` interrompt ce qui joue
 * déjà — mais l'interruption elle-même est tout aussi réversible (un second
 * « reprends » relance l'ancien morceau), donc `safe` aussi, par cohérence
 * avec le reste du contrôle de lecture.
 *
 * 5.0.69 : `spotify_transfer` (« passe la musique sur l'enceinte ») n'est proposé au modèle
 * qu'avec une enceinte choisie dans les réglages ; « mets X sur le PC » passe par `spotify_play`
 * avec l'appareil dans le contexte d'exécution (`ToolContext.playbackTarget`).
 */
export function createSpotifyTools(deps: SpotifyToolsDeps) {
  const getSpotify = () => deps.spotify.getProvider();

  async function searchAndPlay(
    query: string,
    device?: SpotifyPlayTarget,
  ): Promise<{ ok: boolean; content: string; data?: unknown }> {
    try {
      const track = await getSpotify().searchTrack(query);

      if (!track) {
        return {
          ok: false,
          content: `Aucun morceau trouvé sur Spotify pour « ${query} ». Spotify n'a rien renvoyé pour cette recherche.`,
        };
      }

      const played = await getSpotify().play(track.uri, {
        contextUri: track.contextUri,
        artistUri: track.artistUri,
        ...(device ? { device } : {}),
      });

      return {
        ok: true,
        content: `Lecture lancée sur Spotify${playedWhere(played)} : ${track.title} — ${track.artists.join(', ')}. Lecture vérifiée : is_playing=true et URI confirmée.`,
        data: track,
      };
    } catch (error) {
      return {
        ok: false,
        content: describeSpotifyFailure(error),
      };
    }
  }

  const spotifyPlayTool = defineTool({
    name: 'spotify_play',
    description:
      "Recherche un morceau sur Spotify (requête libre, fautes d’orthographe acceptées) et le lance sur l'application de bureau Windows — pas le téléphone ni le lecteur web. Vérifie que ça joue vraiment (is_playing, appareil, volume). Nécessite Spotify Premium. Ne jamais inventer un échec ni annoncer une lecture s'il n'y a pas de son.",
    risk: 'safe',
    schema: z.object({
      query: z.string().min(1).max(200).describe('Morceau, artiste ou combinaison à rechercher.'),
    }),
    summarize: ({ query }) => `Lancer sur Spotify : « ${query} ».`,
    // 5.0.69 : l'appareil dit à la voix (« sur l'enceinte », « sur le PC ») arrive par le contexte
    // d'exécution, posé par le chemin forcé de l'agent ; le schéma et la description ne changent pas.
    execute: ({ query }, context) => searchAndPlay(query, context.playbackTarget),
  });

  const spotifyTransferTool = defineTool({
    name: 'spotify_transfer',
    description:
      "Passe la musique Spotify en cours sur un autre appareil : « enceinte » (l'enceinte choisie dans les réglages), « pc » (l'application de bureau Windows) ou le nom d'un appareil Spotify Connect. Vérifie que la lecture est bien passée sur cet appareil avant de le dire. Nécessite Spotify Premium.",
    risk: 'safe',
    isAvailable: () => deps.speakerChosen?.() ?? false,
    unavailableMessage: () =>
      "Aucune enceinte Spotify n'est choisie. Choisis-en une dans Réglages → Spotify → Enceinte de lecture, puis réessaie.",
    schema: z.object({
      device: z
        .string()
        .min(1)
        .max(80)
        .describe("« enceinte », « pc » ou le nom d'un appareil Spotify Connect."),
    }),
    summarize: ({ device }) =>
      `Passer la musique Spotify sur ${targetLabel(spotifyTargetFromText(device))}.`,
    execute: async ({ device }) => {
      try {
        const played = await getSpotify().transferPlayback(spotifyTargetFromText(device));
        return {
          ok: true,
          content: `La musique joue maintenant sur « ${played.deviceName} ». Lecture vérifiée : is_playing=true sur cet appareil.`,
          data: played,
        };
      } catch (error) {
        return { ok: false, content: describeSpotifyFailure(error) };
      }
    },
  });

  const spotifyPauseTool = defineTool({
    name: 'spotify_pause',
    description: 'Met la lecture Spotify en pause. Nécessite un abonnement Spotify Premium.',
    risk: 'safe',
    schema: z.object({}),
    summarize: () => 'Mettre Spotify en pause.',
    execute: async () => {
      try {
        await getSpotify().pause();
        return { ok: true, content: 'Spotify est en pause.' };
      } catch (error) {
        return { ok: false, content: `Spotify : ${describeError(error)}` };
      }
    },
  });

  const spotifyResumeTool = defineTool({
    name: 'spotify_resume',
    description: 'Reprend la lecture Spotify. Nécessite un abonnement Spotify Premium.',
    risk: 'safe',
    schema: z.object({}),
    summarize: () => 'Reprendre Spotify.',
    execute: async () => {
      try {
        await getSpotify().play();
        return { ok: true, content: 'Lecture Spotify reprise.' };
      } catch (error) {
        return { ok: false, content: `Spotify : ${describeError(error)}` };
      }
    },
  });

  const spotifyNextTool = defineTool({
    name: 'spotify_next',
    description: 'Passe au morceau suivant sur Spotify. Nécessite un abonnement Spotify Premium.',
    risk: 'safe',
    schema: z.object({}),
    summarize: () => 'Passer au morceau Spotify suivant.',
    execute: async () => {
      try {
        await getSpotify().next();
        return { ok: true, content: 'Morceau suivant.' };
      } catch (error) {
        return { ok: false, content: `Spotify : ${describeError(error)}` };
      }
    },
  });

  const spotifyPreviousTool = defineTool({
    name: 'spotify_previous',
    description:
      'Revient au morceau précédent sur Spotify. Nécessite un abonnement Spotify Premium.',
    risk: 'safe',
    schema: z.object({}),
    summarize: () => 'Revenir au morceau Spotify précédent.',
    execute: async () => {
      try {
        await getSpotify().previous();
        return { ok: true, content: 'Morceau précédent.' };
      } catch (error) {
        return { ok: false, content: `Spotify : ${describeError(error)}` };
      }
    },
  });

  const spotifyVolumeTool = defineTool({
    name: 'spotify_set_volume',
    description:
      'Règle le volume Spotify de 0 à 100 pour cent. Nécessite un abonnement Spotify Premium.',
    risk: 'safe',
    schema: z.object({
      percent: z.number().int().min(0).max(100),
    }),
    summarize: ({ percent }) => `Régler le volume Spotify à ${percent} %.`,
    execute: async ({ percent }) => {
      try {
        await getSpotify().setVolume(percent);
        const state = await getSpotify().getPlaybackState();
        const applied = state?.volumePercent ?? percent;
        if (applied < percent) {
          return {
            ok: true,
            content: `Volume Spotify réglé à ${applied} % (plafond de sécurité pour l'enceinte).`,
          };
        }
        return { ok: true, content: `Volume Spotify réglé à ${percent} %.` };
      } catch (error) {
        return { ok: false, content: `Spotify : ${describeError(error)}` };
      }
    },
  });

  const spotifyShuffleTool = defineTool({
    name: 'spotify_set_shuffle',
    description:
      'Active ou désactive le mode aléatoire Spotify. Nécessite un abonnement Spotify Premium.',
    risk: 'safe',
    schema: z.object({
      enabled: z.boolean(),
    }),
    summarize: ({ enabled }) => `${enabled ? 'Activer' : 'Désactiver'} le shuffle Spotify.`,
    execute: async ({ enabled }) => {
      try {
        await getSpotify().setShuffle(enabled);
        return {
          ok: true,
          content: `Shuffle Spotify ${enabled ? 'activé' : 'désactivé'}.`,
        };
      } catch (error) {
        return { ok: false, content: `Spotify : ${describeError(error)}` };
      }
    },
  });

  const spotifyCurrentTrackTool = defineTool({
    name: 'spotify_current_track',
    description: 'Indique le morceau actuellement joué sur Spotify.',
    risk: 'safe',
    schema: z.object({}),
    summarize: () => 'Consulter le morceau Spotify en cours.',
    execute: async () => {
      try {
        const state = await getSpotify().getPlaybackState();

        if (!state?.track) {
          return {
            ok: true,
            content:
              'État vérifié auprès de Spotify. Aucun morceau Spotify n’est actuellement en lecture. Rien n’est deviné.',
          };
        }

        const status = state.isPlaying ? 'Lecture' : 'Pause';
        const device = state.deviceName ? ` sur ${state.deviceName}` : '';

        return {
          ok: true,
          outcome: 'success',
          content: `État vérifié auprès de Spotify. ${status} : ${state.track.title} — ${state.track.artists.join(', ')}${device}.`,
          data: state,
        };
      } catch (error) {
        return { ok: false, content: `Spotify : ${describeError(error)}` };
      }
    },
  });

  return [
    spotifyPlayTool,
    spotifyPauseTool,
    spotifyResumeTool,
    spotifyNextTool,
    spotifyPreviousTool,
    spotifyVolumeTool,
    spotifyShuffleTool,
    spotifyCurrentTrackTool,
    spotifyTransferTool,
  ];
}
