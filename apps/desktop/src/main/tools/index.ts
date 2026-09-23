import {
  ToolManager,
  type MarketDataProviderRegistry,
  type SearchProviderRegistry,
  type Settings,
} from '@jarvis/core';
import { getSystemInfoTool } from './system.js';
import { createFolderTool } from './files.js';
import { createWebSearchTool, fetchPageTool } from './web.js';
import { createGetStockQuoteTool } from './stocks.js';

export interface ToolManagerDeps {
  getSettings: () => Settings;
  searchRegistry: SearchProviderRegistry;
  marketDataRegistry: MarketDataProviderRegistry;
}

/**
 * Catalogue des outils exposés au modèle. Point d'extension principal : pour
 * ajouter une capacité (capture d'écran, recherche de fichiers, pilotage d'une
 * autre application), écrire un `defineTool` et l'ajouter ici. Rien d'autre
 * n'est à modifier — ni l'agent, ni l'IPC, ni l'interface.
 */
export function createToolManager(deps: ToolManagerDeps): ToolManager {
  return new ToolManager().registerAll([
    getSystemInfoTool,
    createFolderTool,
    createWebSearchTool(deps),
    fetchPageTool,
    createGetStockQuoteTool(deps),
  ]);
}
