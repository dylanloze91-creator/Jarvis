import {
  SpeechToTextRegistry,
  TextToSpeechRegistry,
  openAISttDescriptor,
  openAITtsDescriptor,
} from '@jarvis/core';
import { LocalBrowserSttProvider, localSttDescriptor } from './localStt';
import { LocalBrowserTtsProvider, localTtsDescriptor } from './localTts';
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
