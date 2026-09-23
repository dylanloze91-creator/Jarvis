import {
  SpeechToTextRegistry,
  TextToSpeechRegistry,
  createDefaultWakeWordEngineRegistry,
  createLocalTemplateWakeWordEngine,
  openAISttDescriptor,
  openAITtsDescriptor,
  type WakeWordEngineRegistry,
} from '@jarvis/core';
import { LocalBrowserSttProvider, localSttDescriptor } from './localStt';
import { LocalBrowserTtsProvider, localTtsDescriptor } from './localTts';
import { PorcupineWakeWordEngine, porcupineWakeWordDescriptor } from './porcupineWakeWordEngine';
import { IpcSttProvider, IpcTtsProvider } from './remote';

/**
 * Registres complets côté renderer : le moteur local (navigateur, DOM) et le
 * moteur distant (OpenAI, proxifié par IPC) y sont enregistrés côte à côte.
 * C'est le seul endroit qui les assemble tous les deux — exactement comme
 * `createToolManager()` assemble les outils spécifiques à Electron sur le
 * `ToolManager` générique du cœur.
 */
export function createSttRegistry(): SpeechToTextRegistry {
  return new SpeechToTextRegistry()
    .register(localSttDescriptor, () => new LocalBrowserSttProvider())
    .register(openAISttDescriptor, () => new IpcSttProvider());
}

export function createTtsRegistry(): TextToSpeechRegistry {
  return new TextToSpeechRegistry()
    .register(localTtsDescriptor, () => new LocalBrowserTtsProvider())
    .register(openAITtsDescriptor, () => new IpcTtsProvider());
}

/**
 * Registre du mot de réveil : le gabarit local (`createDefaultWakeWordEngineRegistry`,
 * dans le cœur) reste le moteur par défaut ; Porcupine s'y ajoute comme
 * option, jamais comme repli automatique — voir le README pour son coût
 * réel avant de le choisir.
 */
export function createWakeWordEngineRegistry(): WakeWordEngineRegistry {
  const registry = createDefaultWakeWordEngineRegistry();
  registry.register(
    porcupineWakeWordDescriptor,
    (config) => new PorcupineWakeWordEngine(config.apiKey ?? ''),
  );
  return registry;
}

export { createLocalTemplateWakeWordEngine };
