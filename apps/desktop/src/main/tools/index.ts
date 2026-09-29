import {
  ToolManager,
  type MarketDataProviderRegistry,
  type SearchProviderRegistry,
  type Settings,
} from '@jarvis/core';
import { getSystemInfoTool } from './system.js';
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
import { createWebSearchTool, createWebResearchTool, fetchPageTool } from './web.js';
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
}

/**
 * Catalogue des outils exposés au modèle. Point d'extension principal : pour
 * ajouter une capacité, écrire un `defineTool` et l'ajouter ici. Rien d'autre
 * n'est à modifier — ni l'agent, ni l'IPC, ni l'interface.
 */
export function createToolManager(deps: ToolManagerDeps): ToolManager {
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
  ]);
}
