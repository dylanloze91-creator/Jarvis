import { ToolManager } from '@jarvis/core';
import { getSystemInfoTool } from './system.js';
import { createFolderTool } from './files.js';

/**
 * Catalogue des outils exposés au modèle. Point d'extension principal : pour
 * ajouter une capacité (capture d'écran, recherche de fichiers, pilotage d'une
 * autre application), écrire un `defineTool` et l'ajouter ici. Rien d'autre
 * n'est à modifier — ni l'agent, ni l'IPC, ni l'interface.
 */
export function createToolManager(): ToolManager {
  return new ToolManager().registerAll([getSystemInfoTool, createFolderTool]);
}
