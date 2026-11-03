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
    /** Fork rhasspy/espeak-ng, état de `master` à la release Piper 2023.11.14-2 (14/11/2023). */
    sourceUrl: 'https://github.com/rhasspy/espeak-ng/tree/0f65aa301e0d6bae5e172cc74197d32a6182200f',
    commitNote:
      'Sources correspondant à la release Piper 2023.11.14-2 : fork rhasspy/espeak-ng au commit 0f65aa3, compilé par piper-phonemize fccd4f3 (espeak-ng-data et libespeak-ng.so.1.52.0.1 inclus).',
  },
  piperPhonemize: {
    name: 'piper-phonemize (dans le binaire Piper)',
    license: 'MIT',
    sourceUrl: 'https://github.com/rhasspy/piper-phonemize/tree/fccd4f335aa68ac0b72600822f34d84363daa2bf',
  },
} as const;
