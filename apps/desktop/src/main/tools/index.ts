import {
  ToolManager,
  type MarketDataProviderRegistry,
  type SearchProviderRegistry,
  type Settings,
} from '@jarvis/core';
import { getSystemInfoTool } from './system.js';
import { getCurrentTimeTool } from './time.js';
import { createFolderTool } from './files.js';
import { listProcessesTool } from './processes.js';
import { getActiveWindowTool } from './active-window.js';
import { searchFilesTool } from './search-files.js';
import { readFileTool } from './read-file.js';
import { getSystemErrorsTool } from './system-errors.js';
import { openApplicationTool, closeApplicationTool } from './applications.js';
import { moveFileTool, copyFileTool, deleteFileTool } from './filesystem.js';
import { takeScreenshotTool } from './screenshot.js';
import { runCommandTool } from './shell.js';
import {
  createCurrentInfoSearchTool,
  createWebSearchTool,
  createWebResearchTool,
  fetchPageTool,
} from './web.js';
import { createGetStockQuoteTool } from './stocks.js';
import { createSpotifyTools } from './spotify.js';
import { createYoutubeTranscriptTool } from './youtube.js';
import type { SpotifyBridge } from '../media/SpotifyBridge.js';
import type { SiteBlockBridge } from '../siteblock/SiteBlockBridge.js';
import { createSiteBlockTools } from './siteblock.js';
import type { PersonalizationStore } from '../personalization.js';
import { createPersonalizationTools } from './personalization.js';
import type { KnowledgeStore } from '../knowledge.js';
import { createKnowledgeTools } from './knowledge.js';
import type { GoogleRuntime } from '../google/runtime.js';
import { createGoogleTools } from './google.js';

export interface YoutubeSummarize {
  (
    url: string,
    onProgress: (message: string) => void,
    signal?: AbortSignal,
  ): Promise<{ ok: boolean; content: string }>;
}

export interface ToolManagerDeps {
  getSettings: () => Settings;
  searchRegistry: SearchProviderRegistry;
  marketDataRegistry: MarketDataProviderRegistry;
  spotify: SpotifyBridge;
  siteBlock: SiteBlockBridge;
  personalization: PersonalizationStore;
  knowledge: KnowledgeStore;
  /** Écoute YouTube. Absent dans les tests qui ne construisent pas le catalogue complet. */
  summarizeYoutube?: YoutubeSummarize;
  /** Google Workspace. Ses outils ne sont proposés au modèle qu'une fois un compte connecté. */
  google?: GoogleRuntime;
  /**
   * Profil modeste seulement : Spotify reste enregistré mais absent du prompt
   * tant que le compte n’est pas connecté. Ignoré sur les autres profils.
   */
  spotifyConnected?: () => boolean;
}

/**
 * Catalogue des outils exposés au modèle. Point d'extension principal : pour
 * ajouter une capacité, écrire un `defineTool` et l'ajouter ici. Rien d'autre
 * n'est à modifier — ni l'agent, ni l'IPC, ni l'interface.
 */
export function createToolManager(deps: ToolManagerDeps): ToolManager {
  if (deps.getSettings().machine?.profile === 'modest') return createModestToolManager(deps);
  return createFullToolManager(deps);
}

/**
 * Catalogue 0.4.25. Ne pas y ajouter d’outil : le test de référence compare
 * cette liste, profil complet ou réglages déjà présents.
 */
function createFullToolManager(deps: ToolManagerDeps): ToolManager {
  return new ToolManager().registerAll([
    // Lecture — niveau safe
    getSystemInfoTool,
    listProcessesTool,
    getActiveWindowTool,
    searchFilesTool,
    readFileTool,
    getSystemErrorsTool,
    createWebSearchTool(deps),
    createWebResearchTool(deps),
    fetchPageTool,
    createCurrentInfoSearchTool(deps),
    createYoutubeTranscriptTool({
      summarize:
        deps.summarizeYoutube ??
        (async () => ({
          ok: false,
          content: "L'écoute YouTube n'est pas disponible dans ce processus.",
        })),
    }),
    createGetStockQuoteTool(deps),
    ...createSpotifyTools(deps),
    ...createSiteBlockTools(deps),
    ...createPersonalizationTools(deps.personalization),
    ...createKnowledgeTools(deps.knowledge, deps.getSettings),
    // Action — niveau confirm
    createFolderTool,
    openApplicationTool,
    closeApplicationTool,
    moveFileTool,
    copyFileTool,
    deleteFileTool,
    takeScreenshotTool,
    runCommandTool,
    // Google Workspace — absents du catalogue tant qu'aucun compte n'est connecté
    ...(deps.google ? createGoogleTools(deps.google) : []),
  ]);
}

/** Liste courte : heure, notes, ouvrir une application, recherche web. */
function createModestToolManager(deps: ToolManagerDeps): ToolManager {
  const notes = createKnowledgeTools(deps.knowledge, deps.getSettings).filter(
    (tool) => tool.name === 'remember_jarvis' || tool.name === 'search_jarvis_memory',
  );
  const spotify = createSpotifyTools(deps).map((tool) => ({
    ...tool,
    isAvailable: () => deps.spotifyConnected?.() ?? false,
    unavailableMessage: () =>
      'Spotify n’est pas connecté. Le compte se branche dans Réglages ; rien n’est chargé avant.',
  }));
  return new ToolManager().registerAll([
    getCurrentTimeTool,
    ...notes,
    openApplicationTool,
    createWebSearchTool(deps),
    createCurrentInfoSearchTool(deps),
    ...spotify,
    ...(deps.google ? createGoogleTools(deps.google) : []),
  ]);
}
