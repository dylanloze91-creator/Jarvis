import {
  PIPER_BENCHMARK_SAMPLE_CHARS,
  PIPER_SAMPLE_RATE,
  PIPER_TTS_ID,
  concatWavClips,
  describePiperVoice,
  shouldStreamPiperSpeech,
  splitFrenchSentences,
  type PiperVoiceDefinition,
} from '@jarvis/core';
import { piperAssetsRoot, piperBinaryPath, piperEspeakDataDir, piperModelPath } from './paths.js';
import type { PiperRunner } from './runner.js';
import { ProcessPiperRunner } from './runner.js';
import { access } from 'node:fs/promises';

export interface PiperSynthInput {
  text: string;
  voiceId?: string;
}

/** En dessous, une phrase est trop courte pour estimer la vitesse (le chargement du modèle domine). */
const BENCHMARK_MIN_CHARS = 40;

export class PiperService {
  private benchmarkMs: number | null = null;
  private readonly runner: PiperRunner;

  constructor(runner: PiperRunner = new ProcessPiperRunner()) {
    this.runner = runner;
  }

  get streamingBenchmarkMs(): number | null {
    return this.benchmarkMs;
  }

  async isReady(voiceId?: string): Promise<boolean> {
    try {
      const root = piperAssetsRoot();
      const binary = piperBinaryPath(root);
      await access(binary);
      const voice = describePiperVoice(voiceId);
      await access(piperModelPath(root, voice.modelFile));
      return true;
    } catch {
      return false;
    }
  }

  async synthesizeWav(input: PiperSynthInput): Promise<Uint8Array> {
    const text = input.text.trim();
    if (!text) throw new Error('Texte vide.');
    const voice = describePiperVoice(input.voiceId);
    if (shouldStreamPiperSpeech(text, this.benchmarkMs)) {
      const sentences = splitFrenchSentences(text);
      const clips: Uint8Array[] = [];
      for (const sentence of sentences) {
        clips.push(await this.synthesizeSentence(sentence, voice));
      }
      return concatWavClips(clips);
    }
    return this.synthesizeSentence(text, voice);
  }

  async synthesizeSentenceWav(text: string, voiceId?: string): Promise<Uint8Array> {
    const trimmed = text.trim();
    if (!trimmed) throw new Error('Texte vide.');
    return this.synthesizeSentence(trimmed, describePiperVoice(voiceId));
  }

  private async synthesizeSentence(text: string, voice: PiperVoiceDefinition): Promise<Uint8Array> {
    const root = piperAssetsRoot();
    const binaryPath = piperBinaryPath(root);
    const modelPath = piperModelPath(root, voice.modelFile);
    await access(binaryPath);
    await access(modelPath);
    const start = performance.now();
    const wav = await this.runner.synthesize({
      binaryPath,
      modelPath,
      espeakDataDir: piperEspeakDataDir(binaryPath),
      voice,
      text,
    });
    this.recordBenchmark(text, performance.now() - start);
    return wav;
  }

  /**
   * Vitesse mesurée sur la première vraie phrase assez longue, ramenée à
   * PIPER_BENCHMARK_SAMPLE_CHARS caractères : aucune synthèse en plus, donc la
   * toute première réponse n'attend pas une mesure.
   */
  private recordBenchmark(text: string, elapsedMs: number): void {
    if (this.benchmarkMs !== null || text.length < BENCHMARK_MIN_CHARS) return;
    this.benchmarkMs = Math.round((elapsedMs * PIPER_BENCHMARK_SAMPLE_CHARS) / text.length);
  }
}

export function phoneVoiceMode(ttsProvider: string, piperReady: boolean): 'piper' | 'device' {
  if (ttsProvider === PIPER_TTS_ID && piperReady) return 'piper';
  return 'device';
}

export const PIPER_OUTPUT_SAMPLE_RATE = PIPER_SAMPLE_RATE;
