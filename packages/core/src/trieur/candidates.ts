/** Candidats modèle de base pour le trieur (1–4B, QLoRA ~6 Go fp16). Licences : rapport 2026-11-02 + revue 2026-11-03. */
export const TRIEUR_BASE_CANDIDATES = [
  {
    id: 'qwen2.5-1.5b',
    huggingFace: 'Qwen/Qwen2.5-1.5B-Instruct',
    ollama: 'qwen2.5:1.5b',
    paramsB: 1.5,
    license: 'Apache-2.0',
    licenseUrl: 'https://huggingface.co/Qwen/Qwen2.5-1.5B-Instruct/raw/main/LICENSE',
    qlora6Go: 'recommandé (~3 Go estimés, training/train_lora.py memoire_estimee_go)',
  },
  {
    id: 'qwen3-1.7b',
    huggingFace: 'Qwen/Qwen3-1.7B',
    ollama: 'qwen3:1.7b',
    paramsB: 1.7,
    license: 'Apache-2.0',
    licenseUrl: 'https://huggingface.co/Qwen/Qwen3-1.7B/raw/main/LICENSE',
    qlora6Go: 'compatible (~3,5 Go estimés, training/train_lora.py memoire_estimee_go)',
  },
  {
    id: 'qwen3-4b',
    huggingFace: 'Qwen/Qwen3-4B',
    ollama: 'qwen3:4b',
    paramsB: 4,
    license: 'Apache-2.0',
    licenseUrl: 'https://huggingface.co/Qwen/Qwen3-4B/raw/main/LICENSE',
    qlora6Go: 'limite haute (~5 Go estimés, training/train_lora.py memoire_estimee_go)',
  },
] as const;

/** Qwen2.5-3B sur Hugging Face = Qwen RESEARCH (non commercial) : ne pas documenter comme base du trieur dans une release publique. */

export const TRIEUR_OLLAMA_EXPORT = {
  name: 'jarvis-trieur',
  quant: 'Q4_K_M',
  sourceModelfileFrom: 'modèle de base choisi (ollama show --modelfile)',
} as const;
