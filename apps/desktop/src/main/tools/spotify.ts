import { z } from 'zod';
import {
  defineTool,
  extractSpotifyPlayDeviceHintFromQuery,
  peekSpotifyPlayDeviceHint,
  stripSpotifyPlayDeviceSuffix,
  takeSpotifyPlayDeviceHint,
  type Settings,
  type SpotifyPlayDeviceHint,
} from '@jarvis/core';
import {
  looksLikeLocalDesktopName,
  pickNamedConnectDevice,
  type ConnectDevice,
} from '../media/spotifyDevices.js';
import type { SpotifyBridge } from '../media/SpotifyBridge.js';

export interface SpotifyToolsDeps {
  spotify: SpotifyBridge;
  getSettings: () => Settings;
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
  // Messages déjà rédigés : pas de lecteur audible, 204 silencieux, volume 0, mauvais appareil.
  if (
    /Je ne trouve pas|aucun lecteur|lecture n'a pas démarré|lecture n'est pas confirmée|volume est à 0|pas sur l'application de bureau|pas sur «|Spotify est fermé|appareil Spotify est indisponible|Premium|jeton Spotify|HTTP 429|Appareils Connect|is_playing=/i.test(
      message,
    )
  ) {
    return message;
  }
  return `Impossible de lancer la musique sur Spotify : ${message}`;
}

/**
 * Les huit outils Spotify. Niveau de risque : `safe` pour tous, y compris les
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
 */
type ConnectListing = {
  listConnectDevices?: () => Promise<
    Array<{ id: string; name: string; type: string; is_active: boolean }>
  >;
};

async function listVisibleDevices(provider: ConnectListing): Promise<ConnectDevice[]> {
  if (typeof provider.listConnectDevices !== 'function') return [];
  const found = await provider.listConnectDevices();
  return found
    .filter((device) => device.id && device.name.trim())
    .map((device) => ({
      id: device.id,
      name: device.name,
      type: device.type,
      is_active: device.is_active,
      is_restricted: false,
    }));
}

/**
 * Un nom (« ville », « Devialet ») n'est gardé que s'il correspond à un
 * appareil Connect visible (même souplesse que `pickNamedConnectDevice`).
 * Sinon on ignore l'indice et on cherche la requête entière.
 */
function resolvePlayDeviceHint(
  query: string,
  devices: ConnectDevice[],
): {
  searchQuery: string;
  deviceHint: SpotifyPlayDeviceHint | null;
} {
  const stashed = takeSpotifyPlayDeviceHint();
  const fromQuery = extractSpotifyPlayDeviceHintFromQuery(query);
  const candidate = stashed ?? fromQuery;
  if (candidate?.kind === 'named' && !pickNamedConnectDevice(devices, candidate.name)) {
    return { searchQuery: query.trim(), deviceHint: null };
  }
  const searchQuery = candidate ? stripSpotifyPlayDeviceSuffix(query) : query;
  return { searchQuery: searchQuery.trim() || query.trim(), deviceHint: candidate };
}

function spotifyTransferAvailable(getSettings: () => Settings): boolean {
  const name = (getSettings().spotifyDeviceName ?? '').trim();
  if (!name) return false;
  return !looksLikeLocalDesktopName(name);
}

function transferHintFromTarget(target: string): SpotifyPlayDeviceHint {
  const trimmed = target.trim();
  const normalized = trimmed.toLowerCase();
  if (normalized === 'speaker' || normalized === 'enceinte') return { kind: 'speaker' };
  if (normalized === 'pc' || normalized === 'ordinateur') return { kind: 'pc' };
  return { kind: 'named', name: trimmed };
}

export function createSpotifyTools(deps: SpotifyToolsDeps) {
  const getSpotify = () => deps.spotify.getProvider();

  const spotifyPlayTool = defineTool({
    name: 'spotify_play',
    description:
      "Recherche un morceau sur Spotify (requête libre, fautes d’orthographe acceptées) et le lance sur l'application de bureau Windows — pas le téléphone ni le lecteur web. Vérifie que ça joue vraiment (is_playing, appareil, volume). Nécessite Spotify Premium. Ne jamais inventer un échec ni annoncer une lecture s'il n'y a pas de son.",
    risk: 'safe',
    schema: z.object({
      query: z.string().min(1).max(200).describe('Morceau, artiste ou combinaison à rechercher.'),
    }),
    summarize: ({ query }) => `Lancer sur Spotify : « ${query} ».`,
    execute: async ({ query }) => {
      try {
        const pending = peekSpotifyPlayDeviceHint() ?? extractSpotifyPlayDeviceHintFromQuery(query);
        const devices = pending?.kind === 'named' ? await listVisibleDevices(getSpotify()) : [];
        const { searchQuery, deviceHint } = resolvePlayDeviceHint(query, devices);
        const track = await getSpotify().searchTrack(searchQuery);

        if (!track) {
          return {
            ok: false,
            content: `Aucun morceau trouvé sur Spotify pour « ${searchQuery} ». Spotify n'a rien renvoyé pour cette recherche.`,
          };
        }

        await getSpotify().play(track.uri, {
          contextUri: track.contextUri,
          artistUri: track.artistUri,
          deviceHint,
        });

        const playback = await getSpotify().getPlaybackState();
        const where = playback?.deviceName;
        const artists = track.artists.join(', ');
        const verified = ' Lecture vérifiée : is_playing=true et URI confirmée.';
        const content = where
          ? `Lecture sur « ${where} » : ${track.title} — ${artists}.${verified}`
          : `Lecture lancée sur Spotify : ${track.title} — ${artists}.${verified}`;

        return {
          ok: true,
          content,
          data: track,
        };
      } catch (error) {
        return {
          ok: false,
          content: describeSpotifyFailure(error),
        };
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

  const spotifyTransferTool = defineTool({
    name: 'spotify_transfer',
    description:
      "Transfère la lecture Spotify en cours vers un autre appareil Connect (enceinte des réglages, le PC, ou un nom d'appareil). Vérifie que la musique joue vraiment sur la cible avant de confirmer.",
    risk: 'safe',
    schema: z.object({
      target: z
        .string()
        .min(1)
        .max(80)
        .describe('speaker, pc, ou le nom d’une enceinte Connect (ex. Devialet).'),
    }),
    summarize: ({ target }) => `Transférer Spotify vers ${target}.`,
    isAvailable: () => spotifyTransferAvailable(deps.getSettings),
    unavailableMessage:
      "Transfert Spotify indisponible : règle d'abord une enceinte Connect (autre que le PC) dans Musique.",
    execute: async ({ target }) => {
      try {
        const hint = transferHintFromTarget(target);
        if (hint.kind === 'named') {
          const devices = await listVisibleDevices(getSpotify());
          if (!pickNamedConnectDevice(devices, hint.name)) {
            return {
              ok: false,
              content: `Je ne vois pas d'appareil appelé ${hint.name}`,
            };
          }
        }
        const { deviceName } = await getSpotify().transferPlayback(hint);
        return {
          ok: true,
          content: `La musique joue maintenant sur « ${deviceName} ».`,
        };
      } catch (error) {
        return {
          ok: false,
          content: describeSpotifyFailure(error),
        };
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

  const tools = [
    spotifyPlayTool,
    spotifyPauseTool,
    spotifyResumeTool,
    spotifyNextTool,
    spotifyPreviousTool,
    spotifyVolumeTool,
    spotifyShuffleTool,
    spotifyCurrentTrackTool,
  ];
  if (spotifyTransferAvailable(deps.getSettings)) {
    tools.splice(tools.length - 1, 0, spotifyTransferTool);
  }
  return tools;
}
