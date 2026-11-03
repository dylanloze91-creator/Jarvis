/** Crédits affichés dans Réglages → Voix (Piper). Vérifié le 2026-11-03. */
export interface PiperVoiceCreditLine {
  voice: string;
  dataset: string;
  authors: string;
  license: string;
  url: string;
}

export const PIPER_VOICE_CREDITS: readonly PiperVoiceCreditLine[] = [
  {
    voice: 'Siwis (fr_FR-siwis-medium)',
    dataset: 'Siwis French Speech Synthesis Database',
    authors: 'University of Edinburgh (datashare.is.ed.ac.uk)',
    license: 'CC BY 4.0',
    url: 'https://huggingface.co/rhasspy/piper-voices/blob/main/fr/fr_FR/siwis/medium/MODEL_CARD',
  },
  {
    voice: 'UPMC Jessica / Pierre (fr_FR-upmc-medium)',
    dataset: 'UPMC Pierre & Jessica corpus (marytts/upmc-pierre-data)',
    authors: 'UPMC / MaryTTS community',
    license: 'CC BY-SA 4.0',
    url: 'https://huggingface.co/rhasspy/piper-voices/blob/main/fr/fr_FR/upmc/medium/MODEL_CARD',
  },
];

export const PIPER_ENGINE_CREDITS = {
  piper: {
    name: 'Piper',
    version: '2023.11.14-2',
    license: 'MIT',
    url: 'https://github.com/rhasspy/piper/blob/v2023.11.14-2/LICENSE.md',
  },
  espeakNg: {
    name: 'espeak-ng (dans le binaire Piper)',
    version: '1.52.0.1 (bibliothèque embarquée release 2023.11.14-2)',
    license: 'GPL-3.0',
    sourceUrl: 'https://github.com/espeak-ng/espeak-ng',
    commitNote:
      'Sources correspondant à la release Piper 2023.11.14-2 : binaire précompilé rhasspy/piper (espeak-ng-data et libespeak-ng.so.1.52.0.1 inclus).',
  },
  piperPhonemize: {
    name: 'piper-phonemize (dans le binaire Piper)',
    license: 'MIT',
    sourceUrl: 'https://github.com/rhasspy/piper-phonemize',
  },
} as const;
