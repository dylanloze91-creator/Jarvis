import {
  SpeechToTextRegistry,
  TextToSpeechRegistry,
  createDefaultWakeWordEngineRegistry,
  createLocalTemplateWakeWordEngine,
  openAISttDescriptor,
  openAITtsDescriptor,
  type WakeWordEngineRegistry,
} from '@jarvis/core';
import { LocalBrowserTtsProvider, localTtsDescriptor } from './localTts';
import { LocalWhisperSttProvider, localWhisperSttDescriptor } from './localWhisperStt';
import { PorcupineWakeWordEngine, porcupineWakeWordDescriptor } from './porcupineWakeWordEngine';
import { IpcSttProvider, IpcTtsProvider } from './remote';
import { createWhisperWakeWordEngine, whisperWakeWordDescriptor } from './whisperWakeWordEngine';

/**
 * Registres complets côté renderer : les moteurs locaux (DOM, transformers.js)
 * et les moteurs distants (OpenAI, proxifiés par IPC) y sont enregistrés
 * côte à côte. C'est le seul endroit qui les assemble tous les deux —
 * exactement comme `createToolManager()` assemble les outils spécifiques à
 * Electron sur le `ToolManager` générique du cœur.
 *
 * La reconnaissance intégrée du navigateur (Web Speech API, id
 * `browser-local`) n'est plus enregistrée ici : elle est structurellement
 * cassée dans Electron (dépend de serveurs Google absents des builds
 * Electron — voir le README) et ne fonctionnera jamais. La laisser dans la
 * liste des moteurs choisissables n'aurait fait que tendre un piège à
 * l'utilisateur ; `LocalWhisperSttProvider` la remplace comme moteur
 * gratuit par défaut.
 */
export function createSttRegistry(): SpeechToTextRegistry {
  return new SpeechToTextRegistry()
    .register(localWhisperSttDescriptor, (config) => new LocalWhisperSttProvider(config))
    .register(openAISttDescriptor, () => new IpcSttProvider());
}

export function createTtsRegistry(): TextToSpeechRegistry {
  return new TextToSpeechRegistry()
    .register(localTtsDescriptor, () => new LocalBrowserTtsProvider())
    .register(openAITtsDescriptor, () => new IpcTtsProvider());
}

/**
 * Registre du mot de réveil : `whisper-transcript` (Whisper local sur de
 * courtes fenêtres glissantes) est le moteur par défaut — voir
 * `whisperWakeWordEngine.ts` pour le détail. Le gabarit par énergie
 * (`local-template`, dans le cœur) reste une option, désormais documentée
 * comme peu fiable. Porcupine s'y ajoute aussi comme option, jamais comme
 * repli automatique — voir le README pour son coût réel avant de le
 * choisir.
 */
export function createWakeWordEngineRegistry(): WakeWordEngineRegistry {
  const registry = createDefaultWakeWordEngineRegistry();
  registry.register(whisperWakeWordDescriptor, createWhisperWakeWordEngine);
  registry.register(
    porcupineWakeWordDescriptor,
    (config) => new PorcupineWakeWordEngine(config.apiKey ?? ''),
  );
  return registry;
}

export { createLocalTemplateWakeWordEngine };
