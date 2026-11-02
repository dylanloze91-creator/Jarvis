import { randomBytes } from 'node:crypto';
import { readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SPEAKER_SAMPLE_RATE, decodeWav, toSpeakerWav, type Settings } from '@jarvis/core';
import { POWERSHELL_UTF8_PREAMBLE, run, type RunOptions, type RunResult } from '../tools/platform/exec.js';
import type { VoiceBridge } from '../voice.js';

/**
 * 5.0.64 — la réponse vocale de l'enceinte doit être un **fichier** WAV (16 kHz, mono, 16 bits) :
 * la synthèse du navigateur ne sait que jouer. Par défaut, la voix Windows par PowerShell
 * (`System.Speech`) ; si l'utilisateur a choisi la synthèse OpenAI avec une clé, celle-ci en WAV
 * puis ramenée à 16 kHz. Hors Windows (tests Linux), un synthétiseur est injecté.
 */
export interface SpeakerSynthesizer {
  /** WAV PCM 16 bits mono 16 kHz du texte dit. Lève une erreur si aucune voix n'est disponible. */
  synthesize(text: string): Promise<Uint8Array>;
}

/**
 * Script **constant** : aucune valeur n'y entre, ni texte, ni chemin. Les deux chemins
 * temporaires créés par Jarvis lui sont passés en **arguments** (`-File … -InputPath … -OutputPath …`),
 * hors du script, et le texte à dire est lu dans le fichier d'entrée (UTF-8), jamais concaténé
 * (règle `psQuote` de CLAUDE.md, ici sans même avoir besoin de `psQuote`). `$ErrorActionPreference
 * = 'Stop'` : la moindre erreur arrête le script avec un code non nul au lieu de laisser un WAV vide
 * passer pour un succès. Voix française si elle existe, sinon la voix par défaut.
 */
export function windowsSpeechScript(): string {
  return [
    'param([Parameter(Mandatory = $true)][string]$InputPath, [Parameter(Mandatory = $true)][string]$OutputPath)',
    "$ErrorActionPreference = 'Stop'",
    POWERSHELL_UTF8_PREAMBLE,
    'Add-Type -AssemblyName System.Speech',
    '$text = [System.IO.File]::ReadAllText($InputPath, [System.Text.Encoding]::UTF8)',
    '$synth = New-Object System.Speech.Synthesis.SpeechSynthesizer',
    "$voice = $synth.GetInstalledVoices() | Where-Object { $_.Enabled -and $_.VoiceInfo.Culture.TwoLetterISOLanguageName -eq 'fr' } | Select-Object -First 1",
    'if ($voice) { $synth.SelectVoice($voice.VoiceInfo.Name) }',
    '$format = New-Object System.Speech.AudioFormat.SpeechAudioFormatInfo(16000, [System.Speech.AudioFormat.AudioBitsPerSample]::Sixteen, [System.Speech.AudioFormat.AudioChannelCount]::Mono)',
    '$synth.SetOutputToWaveFile($OutputPath, $format)',
    '$synth.Speak($text)',
    '$synth.Dispose()',
    "Write-Output 'OK'",
  ].join('\r\n');
}

/** Lance un fichier `.ps1` avec ses arguments, sans shell : PowerShell les reçoit tels quels. */
export function runPowerShellFile(scriptPath: string, args: string[], options: RunOptions = {}): Promise<RunResult> {
  return run('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', scriptPath, ...args], options);
}

const WINDOWS_SPEECH_TIMEOUT_MS = 60_000;

export interface WindowsSynthesizerDeps {
  /** `runPowerShellFile` ci-dessus ; remplaçable dans les tests. */
  runPowerShellFile?: (scriptPath: string, args: string[], options?: RunOptions) => Promise<RunResult>;
  tmpDir?: () => string;
}

/** Voix Windows : fichier texte → PowerShell → fichier WAV ; les trois fichiers supprimés après lecture. */
export class WindowsSpeechSynthesizer implements SpeakerSynthesizer {
  constructor(private readonly deps: WindowsSynthesizerDeps = {}) {}

  async synthesize(text: string): Promise<Uint8Array> {
    const stamp = randomBytes(8).toString('hex');
    const dir = this.deps.tmpDir?.() ?? tmpdir();
    const scriptPath = join(dir, `jarvis-enceinte-${stamp}.ps1`);
    const inputPath = join(dir, `jarvis-enceinte-${stamp}.txt`);
    const outputPath = join(dir, `jarvis-enceinte-${stamp}.wav`);
    try {
      // BOM UTF-8 : Windows PowerShell 5.1 lit sinon le .ps1 dans la page de code locale.
      await writeFile(scriptPath, `\uFEFF${windowsSpeechScript()}`, { encoding: 'utf8', mode: 0o600 });
      await writeFile(inputPath, text, { encoding: 'utf8', mode: 0o600 });
      const result = await (this.deps.runPowerShellFile ?? runPowerShellFile)(
        scriptPath,
        ['-InputPath', inputPath, '-OutputPath', outputPath],
        { timeoutMs: WINDOWS_SPEECH_TIMEOUT_MS },
      );
      if (result.timedOut) throw new Error('La voix Windows a mis trop de temps.');
      if (result.code !== 0 || !result.stdout.includes('OK')) {
        throw new Error(`La voix Windows a échoué : ${(result.stderr || result.stdout).trim().slice(0, 300) || `code ${result.code}`}`);
      }
      const bytes = new Uint8Array(await readFile(outputPath));
      const decoded = decodeWav(bytes);
      return decoded.sampleRate === SPEAKER_SAMPLE_RATE ? bytes : toSpeakerWav(bytes);
    } finally {
      await rm(scriptPath, { force: true }).catch(() => undefined);
      await rm(inputPath, { force: true }).catch(() => undefined);
      await rm(outputPath, { force: true }).catch(() => undefined);
    }
  }
}

/** Synthèse OpenAI (`VoiceBridge.speak`, clé déjà réglée par l'utilisateur) en WAV, ramené à 16 kHz. */
export class OpenAiSpeechSynthesizer implements SpeakerSynthesizer {
  constructor(
    private readonly voice: Pick<VoiceBridge, 'speak'>,
    private readonly voiceName: () => string,
  ) {}

  async synthesize(text: string): Promise<Uint8Array> {
    const name = this.voiceName().trim();
    const result = await this.voice.speak({ text, format: 'wav', ...(name ? { voice: name } : {}) });
    if (!result.ok) throw new Error(result.error);
    return toSpeakerWav(result.data);
  }
}

export interface DefaultSynthesizerDeps {
  getSettings: () => Settings;
  voice: Pick<VoiceBridge, 'speak' | 'hasApiKey'>;
  platform?: NodeJS.Platform;
  windows?: SpeakerSynthesizer;
  log?: (line: string) => void;
}

/**
 * Choix de la voix : OpenAI si l'utilisateur l'a choisie **et** a une clé (repli sur Windows si
 * l'appel échoue), sinon la voix Windows. Hors Windows sans OpenAI : erreur claire.
 */
export function createSpeakerSynthesizer(deps: DefaultSynthesizerDeps): SpeakerSynthesizer {
  const platform = deps.platform ?? process.platform;
  const windows = deps.windows ?? (platform === 'win32' ? new WindowsSpeechSynthesizer() : null);
  const openai = new OpenAiSpeechSynthesizer(deps.voice, () => deps.getSettings().voice.ttsVoice);
  return {
    async synthesize(text: string): Promise<Uint8Array> {
      const settings = deps.getSettings();
      if (settings.voice.ttsProvider === 'openai-tts' && deps.voice.hasApiKey()) {
        try {
          return await openai.synthesize(text);
        } catch (error) {
          deps.log?.(`[enceinte] synthèse OpenAI en échec, voix Windows : ${error instanceof Error ? error.message : String(error)}`);
          if (!windows) throw error;
        }
      }
      if (!windows) throw new Error('Aucune voix disponible sur ce système (voix Windows requise, ou synthèse OpenAI avec une clé).');
      return windows.synthesize(text);
    },
  };
}
