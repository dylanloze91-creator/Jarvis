import { access } from 'node:fs/promises';
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

export interface PiperSynthInput {
  text: string;
  voiceId?: string;
}

export class PiperService {
  private benchmarkMs: number | null = null;
  private readonly runner: PiperRunner;

  constructor(runner: PiperRunner = new ProcessPiperRunner()) {
    this.runner = runner;
  }

  get streamingBenchmarkMs(): number | null {
    return this.benchmarkMs;
  }

  async isReady(): Promise<boolean> {
    try {
      const root = piperAssetsRoot();
      const binary = piperBinaryPath(root);
      await access(binary);
      const voice = describePiperVoice(undefined);
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
    const wav = await this.synthesizeSentence(text, voice);
    await this.maybeBenchmark(text, wav);
    return wav;
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
    return this.runner.synthesize({
      binaryPath,
      modelPath,
      espeakDataDir: piperEspeakDataDir(binaryPath),
      voice,
      text,
    });
  }

  private async maybeBenchmark(text: string, _wav: Uint8Array): Promise<void> {
    if (this.benchmarkMs !== null) return;
    if (text.length < PIPER_BENCHMARK_SAMPLE_CHARS) return;
    const sample = text.slice(0, PIPER_BENCHMARK_SAMPLE_CHARS);
    const start = performance.now();
    await this.synthesizeSentence(sample, describePiperVoice(undefined));
    this.benchmarkMs = Math.round(performance.now() - start);
  }
}

export function phoneVoiceMode(ttsProvider: string, piperReady: boolean): 'piper' | 'device' {
  if (ttsProvider === PIPER_TTS_ID && piperReady) return 'piper';
  return 'device';
}

export const PIPER_OUTPUT_SAMPLE_RATE = PIPER_SAMPLE_RATE;
