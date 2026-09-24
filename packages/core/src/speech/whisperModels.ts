/**
 * Catalogue des modèles Whisper utilisables en local (transformers.js,
 * WebAssembly/WebGPU — aucune compilation native). Vit dans `packages/core`
 * car ce ne sont que des données (identifiants, tailles indicatives,
 * libellés) : ni le téléchargement ni l'inférence n'ont lieu ici, seulement
 * dans `apps/desktop` (DOM) et dans le script de diagnostic (Node), qui
 * partagent tous les deux ce catalogue pour rester cohérents entre eux.
 *
 * Tailles indicatives : poids ONNX quantifiés (`dtype: 'q8'`) des dépôts
 * `Xenova/whisper-*`, mesurées via l'API Hugging Face (encodeur +
 * décodeur fusionné) — pas la taille annoncée du modèle original, qui
 * inclurait aussi les poids non quantifiés.
 */
export interface WhisperModelOption {
  readonly id: 'tiny' | 'base' | 'small';
  /** Dépôt Hugging Face, au format attendu par `pipeline()` de transformers.js. */
  readonly repo: string;
  readonly label: string;
  readonly sizeLabel: string;
  readonly speedLabel: string;
}

export const WHISPER_STT_MODELS: readonly WhisperModelOption[] = [
  {
    id: 'tiny',
    repo: 'Xenova/whisper-tiny',
    label: 'Whisper tiny',
    sizeLabel: '≈ 40 Mo à télécharger',
    speedLabel: 'Très rapide, mais qualité médiocre en français',
  },
  {
    id: 'base',
    repo: 'Xenova/whisper-base',
    label: 'Whisper base',
    sizeLabel: '≈ 75 Mo à télécharger',
    speedLabel: 'Bon compromis vitesse/qualité (recommandé)',
  },
  {
    id: 'small',
    repo: 'Xenova/whisper-small',
    label: 'Whisper small',
    sizeLabel: '≈ 245 Mo à télécharger',
    speedLabel: 'Meilleure qualité, mais lent sans carte graphique compatible WebGPU',
  },
] as const;

export const DEFAULT_WHISPER_STT_MODEL_ID: WhisperModelOption['id'] = 'base';

/**
 * Modèle utilisé par le mot de réveil « par transcription ». L'intention
 * initiale était d'y mettre systématiquement `tiny`, le plus léger — mais
 * vérifié sur deux enregistrements réels (voix française prononçant
 * « Jarvis »), `tiny` hallucine systématiquement une phrase sans rapport
 * (« I'll see you soon. »), quelle que soit la langue forcée. `base` s'en
 * sort correctement (voir `WHISPER_WAKE_WORD_LANGUAGE` ci-dessous pour
 * l'autre correctif nécessaire). `tiny` est donc insuffisant pour cette
 * tâche : un modèle plus petit économiserait du CPU mais ne détecterait
 * jamais rien. `base` reste le plus petit modèle qui fonctionne
 * réellement, quel que soit le modèle choisi pour la dictée.
 */
export const WHISPER_WAKE_WORD_MODEL: WhisperModelOption = WHISPER_STT_MODELS[1]!;

/**
 * Langue forcée pour la transcription du mot de réveil — délibérément
 * différente de la langue de la commande qui suit (le français, voir
 * `LocalWhisperSttProvider`). Constat empirique : Whisper décode mieux
 * « Jarvis » (un nom propre d'origine anglophone, sans entrée lexicale
 * française) en mode anglais, où il existe probablement comme entité
 * connue de l'entraînement, qu'en mode français, où le modèle le rabat sur
 * le mot français le plus proche phonétiquement (« j'avise », « j'avis »).
 * Vérifié : sur le même enregistrement, `language: 'french'` donne
 * « J'avis. », `language: 'english'` donne « Jarvis » ou « Javis » (à
 * distance 1, toujours accepté par `matchesWakeWord`).
 */
export const WHISPER_WAKE_WORD_LANGUAGE = 'english';

export function findWhisperModel(id: string | undefined): WhisperModelOption {
  return (
    WHISPER_STT_MODELS.find((model) => model.id === id) ??
    WHISPER_STT_MODELS.find((model) => model.id === DEFAULT_WHISPER_STT_MODEL_ID)!
  );
}
