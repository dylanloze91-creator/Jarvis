/**
 * Contournement « experts en RAM » (décision 4) : des variables du serveur
 * Ollama, globales. Jarvis ne les change jamais : il montre ce qui
 * changerait et les commandes, que l'utilisateur lance lui-même (le tri de
 * sécurité refuse toute écriture dans le registre ou les variables système).
 */
export interface ServerVariable {
  name: string;
  value: string;
  effect: string;
}

export const EXPERTS_IN_RAM_VARIABLES: ServerVariable[] = [
  {
    name: 'LLAMA_ARG_CPU_MOE',
    value: '1',
    effect:
      'Garde les « experts » des modèles MoE (Qwen3.6-35B-A3B, Qwen3-Coder-30B) dans la RAM et met le reste sur la carte. Sans effet sur les modèles denses comme qwen2.5:3b du chat (pas de tenseurs d’experts).',
  },
  {
    name: 'GGML_CUDA_NO_PINNED',
    value: '1',
    effect:
      'Évite de réserver (« épingler ») de grosses zones de RAM pour la carte, conseillé avec la variable précédente sous Windows.',
  },
];

export interface VariableChange {
  name: string;
  current: string | null;
  proposed: string;
  changes: boolean;
  effect: string;
}

/** Ce qui changerait, d'après les variables visibles par Jarvis (celles d'Ollama peuvent différer s'il n'a pas redémarré). */
export function expertsInRamChanges(env: Record<string, string | undefined>): VariableChange[] {
  return EXPERTS_IN_RAM_VARIABLES.map((variable) => {
    const current = env[variable.name] ?? null;
    return {
      name: variable.name,
      current,
      proposed: variable.value,
      changes: current !== variable.value,
      effect: variable.effect,
    };
  });
}

export interface ServerInstructions {
  apply: string[];
  undo: string[];
  restart: string;
  caveat: string;
}

export function expertsInRamInstructions(platform: string): ServerInstructions {
  const caveat =
    'Retour d’un utilisateur Windows (Ollama ≥ 0.30), pas une option documentée par Ollama : à vérifier sur ta version. Le banc de code mesure si la carte se libère vraiment.';
  if (platform === 'win32') {
    return {
      apply: EXPERTS_IN_RAM_VARIABLES.map(
        (v) => `[Environment]::SetEnvironmentVariable('${v.name}', '${v.value}', 'User')`,
      ),
      undo: EXPERTS_IN_RAM_VARIABLES.map(
        (v) => `[Environment]::SetEnvironmentVariable('${v.name}', $null, 'User')`,
      ),
      restart:
        'Quitte Ollama (icône près de l’horloge → Quit Ollama), puis relance-le depuis le menu Démarrer.',
      caveat,
    };
  }
  return {
    apply: EXPERTS_IN_RAM_VARIABLES.map(
      (v) => `export ${v.name}=${v.value}   # dans l’environnement du service Ollama`,
    ),
    undo: EXPERTS_IN_RAM_VARIABLES.map((v) => `unset ${v.name}`),
    restart: 'Redémarre le service Ollama (systemctl restart ollama, ou relance « ollama serve »).',
    caveat,
  };
}
