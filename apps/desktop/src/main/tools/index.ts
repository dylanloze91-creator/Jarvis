import { ToolManager } from '@jarvis/core';
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

/**
 * Catalogue des outils exposés au modèle. Point d'extension principal : pour
 * ajouter une capacité, écrire un `defineTool` et l'ajouter ici. Rien d'autre
 * n'est à modifier — ni l'agent, ni l'IPC, ni l'interface.
 */
export function createToolManager(): ToolManager {
  return new ToolManager().registerAll([
    // Lecture — niveau safe
    getSystemInfoTool,
    listProcessesTool,
    getActiveWindowTool,
    searchFilesTool,
    readFileTool,
    getSystemErrorsTool,
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
