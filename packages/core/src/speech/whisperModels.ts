/**
 * Langue forcée pour la transcription du mot de réveil — délibérément
 * différente de la langue de la commande qui suit (le français). Constat
 * empirique : Whisper décode mieux « Jarvis » (un nom propre d'origine
 * anglophone, sans entrée lexicale française) en mode anglais qu'en mode
 * français, où il le rabat sur le mot français le plus proche
 * phonétiquement (« j'avise », « j'avis »). Vérifié : sur le même
 * enregistrement, `language: 'french'` donne « J'avis. », `language:
 * 'english'` donne « Jarvis » ou « Javis » (à distance 1, toujours accepté
 * par `matchesWakeWord`).
 */
export const WHISPER_WAKE_WORD_LANGUAGE = 'english';

/** Langue de la dictée et de l'écoute YouTube. */
export const WHISPER_DICTATION_LANGUAGE = 'french';
