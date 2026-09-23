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
import { createWebSearchTool, fetchPageTool } from './web.js';
import { createGetStockQuoteTool } from './stocks.js';

export interface ToolManagerDeps {
  getSettings: () => Settings;
  searchRegistry: SearchProviderRegistry;
  marketDataRegistry: MarketDataProviderRegistry;
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
    fetchPageTool,
    createGetStockQuoteTool(deps),
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
