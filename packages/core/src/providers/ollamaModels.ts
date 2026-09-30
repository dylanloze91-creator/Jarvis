/**
 * Catalogue de recommandations pour faire tourner Jarvis avec Ollama sur la
 * configuration cible : GeForce RTX 2060 **6 Go**, Core i7 10e génération,
 * 64 Go de RAM, SSD NVMe.
 *
 * Chaque chiffre de taille de téléchargement ci-dessous a été mesuré
 * directement (`ollama pull` + `ollama list`/`api/tags`) pendant le
 * développement de cette fonctionnalité, pas estimé. Les résultats d'appel
 * d'outils viennent d'un test réel contre un serveur Ollama local (voir
 * `internal/verification-ollama-provider.md` dans le dépôt de suivi du
 * projet, et le README pour le résumé). Les estimations de VRAM combinent
 * ces mesures avec la formule standard du cache clé/valeur de l'architecture
 * (nombre de couches × têtes clé/valeur × dimension de tête, lue via
 * `ollama show`), donc elles restent des estimations — seule une exécution
 * sur la carte réelle de l'utilisateur peut confirmer le partage GPU/CPU.
 */

export type OllamaRecommendationRole = 'default' | 'performance' | 'a-eviter';

export interface OllamaModelRecommendation {
  /** Rôle dans la recommandation : choix par défaut, option plus puissante, ou contre-exemple documenté. */
  role: OllamaRecommendationRole;
  /** Tag Ollama exact, ex. `qwen2.5:3b`. */
  model: string;
  label: string;
  pullCommand: string;
  parameterSize: string;
  quantization: string;
  /** Taille réelle du téléchargement, mesurée (pas estimée). */
  downloadSizeGb: number;
  /** VRAM totale estimée (poids + cache clé/valeur + tampons de calcul) pour la fenêtre de contexte recommandée. */
  estimatedVramGb: { min: number; max: number };
  fitsOn6GbVram: boolean;
  expectedSpeed: string;
  toolCallingEvidence: string;
  frenchSupport: string;
  notes: string;
}

/** Voir `OllamaProvider` : Jarvis demande toujours cette fenêtre, quelle que soit la config du serveur. */
export const OLLAMA_RECOMMENDED_NUM_CTX = 8192;

/**
 * Empreinte mesurée du catalogue d'outils de Jarvis (26 outils, description +
 * schéma JSON complets) sérialisé comme le fait `OllamaProvider` — mesuré via
 * `tools.schemas()` + `JSON.stringify`, converti en tokens avec
 * l'approximation usuelle 3,3 à 4 caractères par token pour un tokenizer BPE
 * de type GPT/Qwen sur du JSON technique. Remesuré lors de l'intégration des
 * huit outils Spotify, puis +1 pour `web_research` (valeurs indicatives).
 */
export const OLLAMA_TOOL_CATALOG_FOOTPRINT = {
  toolCount: 26,
  jsonBytes: 11500,
  estimatedTokensLow: 2850,
  estimatedTokensHigh: 3500,
} as const;

export const OLLAMA_RTX2060_6GB_RECOMMENDATIONS: OllamaModelRecommendation[] = [
  {
    role: 'default',
    model: 'qwen2.5:3b',
    label: 'Qwen2.5 3B Instruct (Q4_K_M) — recommandé par défaut',
    pullCommand: 'ollama pull qwen2.5:3b',
    parameterSize: '3,1 milliards de paramètres',
    quantization: 'Q4_K_M',
    downloadSizeGb: 1.93,
    estimatedVramGb: { min: 2.5, max: 2.9 },
    fitsOn6GbVram: true,
    expectedSpeed:
      "Rapide. Mesures communautaires publiées pour ce modèle sur une RTX 2060 : ~36 tokens/s. Sur cette VM sans GPU (CPU seul), un aller-retour avec appel d'outil a pris 2 à 9 secondes.",
    toolCallingEvidence:
      'Vérifié directement pendant ce travail contre un vrai serveur Ollama : 3 appels sur 3 corrects (get_system_info, arguments vides comme attendu) avec une consigne système explicite, et un appel réaliste d\'open_application avec l\'argument { name: "Google Chrome" } correctement extrait depuis « Ouvre Google Chrome ». Capacité « tools » confirmée par `ollama show`/`api/tags`.',
    frenchSupport:
      "Qwen2.5 annonce officiellement le support de plus de 29 langues, français inclus, avec des scores multilingues publiés par l'équipe Qwen (IFEval, MMLU traduits).",
    notes:
      'Tient très largement dans 6 Go. C’est le modèle par défaut et le repli. Le modèle documenté comme recommandé est `qwen3.5:4b` (`ollama pull qwen3.5:4b`) : il n’est pas le défaut tant que l’appel d’outils n’est pas vérifié sur une RTX 2060 6 Go.',
  },
  {
    role: 'performance',
    model: 'qwen2.5:7b',
    label: 'Qwen2.5 7B Instruct (Q4_K_M) — plus capable, déborde sur le CPU',
    pullCommand: 'ollama pull qwen2.5:7b',
    parameterSize: '7,6 milliards de paramètres',
    quantization: 'Q4_K_M',
    downloadSizeGb: 4.68,
    estimatedVramGb: { min: 5.1, max: 5.8 },
    fitsOn6GbVram: false,
    expectedSpeed:
      "Nettement plus lent dès que le modèle déborde sur le CPU. Sur cette VM sans GPU, une réponse courte avec appel d'outil a pris 26 secondes (contre 2 à 9 s pour la version 3B) ; sur la RTX 2060 réelle de l'utilisateur, l'essentiel du modèle devrait tenir sur le GPU avec un débordement partiel, donc une vitesse intermédiaire — mais nettement sous les ~36 tokens/s du 3B.",
    toolCallingEvidence:
      'Vérifié directement : get_system_info correctement appelé (arguments vides), capacité « tools » confirmée.',
    frenchSupport: 'Même famille Qwen2.5, même support multilingue officiel que la version 3B.',
    notes:
      "C'est précisément à cette taille que le débordement CPU commence sur une RTX 2060 6 Go : les poids seuls pèsent 4,68 Go, et il faut compter environ 0,5 Go de cache clé/valeur pour 8192 tokens de contexte plus 0,4-0,6 Go de tampons de calcul — soit 5,1 à 5,8 Go, alors que Windows et son pilote réservent déjà une part de la carte (couramment 0,5 à 1 Go). Le modèle reste utilisable grâce aux 64 Go de RAM (Ollama complète automatiquement par la RAM système), mais sensiblement plus lentement dès que ce débordement se produit.",
  },
  {
    role: 'a-eviter',
    model: 'qwen2.5:1.5b',
    label: 'Qwen2.5 1.5B Instruct (Q4_K_M) — à éviter pour l’appel d’outils',
    pullCommand: 'ollama pull qwen2.5:1.5b',
    parameterSize: '1,5 milliard de paramètres',
    quantization: 'Q4_K_M',
    downloadSizeGb: 0.99,
    estimatedVramGb: { min: 1.3, max: 1.6 },
    fitsOn6GbVram: true,
    expectedSpeed:
      'Très rapide (le plus petit modèle testé), mais la vitesse ne compense pas la fiabilité.',
    toolCallingEvidence:
      "Testé directement, 3 essais sur 3 : le modèle n'appelle jamais l'outil malgré une consigne système explicite (« tu DOIS appeler la fonction... ») — il répond en texte libre (« Je vais vérifier la mémoire vive... ») sans jamais produire d'appel structuré. Ollama annonce pourtant la capacité « tools » pour ce modèle : c'est exactement le piège que ce projet cherchait à documenter — l'annonce de compatibilité ne garantit pas un comportement fiable.",
    frenchSupport: 'Même famille, mais sans intérêt si l’appel d’outils ne fonctionne pas.',
    notes:
      "Gardé dans ce catalogue comme contre-exemple documenté plutôt que masqué : c'est la preuve concrète qu'il faut tester l'appel d'outils avant de choisir un modèle, pas seulement regarder sa taille ou sa capacité annoncée.",
  },
];

export function getOllamaDefaultRecommendation(): OllamaModelRecommendation {
  const found = OLLAMA_RTX2060_6GB_RECOMMENDATIONS.find((entry) => entry.role === 'default');
  if (!found) throw new Error('Aucune recommandation par défaut définie.');
  return found;
}
