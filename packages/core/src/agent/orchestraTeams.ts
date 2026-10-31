/**
 * Chef d'orchestre (5.0.60) : les équipes du chat et la répartition des modèles.
 * Fichier pur, sans dépendance : `settings.ts` en lit la liste des équipes.
 *
 * Principe : un modèle « cerveau » (un 7B, gardé sur la carte graphique) lit chaque
 * demande et la confie à une équipe. Chaque équipe a son modèle et seulement ses
 * outils, au lieu de tout le catalogue et d'un long mode d'emploi à chaque demande.
 */

export const ORCHESTRA_TEAMS = [
  'conversation',
  'pc',
  'fichiers',
  'web',
  'musique',
  'concentration',
  'memoire',
  'google',
  'code',
] as const;

export type OrchestraTeam = (typeof ORCHESTRA_TEAMS)[number];

/** Où tourne un modèle : sur la carte graphique, ou sur le processeur (`num_gpu: 0`). */
export const MODEL_PLACES = ['carte', 'processeur'] as const;
export type ModelPlace = (typeof MODEL_PLACES)[number];

export interface TeamAssignment {
  model: string;
  place: ModelPlace;
}

export interface TeamSpec {
  id: OrchestraTeam;
  /** Nom affiché (interface, pastille de la discussion). */
  label: string;
  /** Ce que l'équipe traite, tel que le cerveau le lit pour choisir. */
  description: string;
  /** Outils de l'équipe (noms exacts, ou préfixe terminé par `*`). Vide : aucun outil. */
  tools: readonly string[];
  /** Consigne courte ajoutée au prompt pour cette équipe. */
  prompt: string;
}

export const TEAM_SPECS: Record<OrchestraTeam, TeamSpec> = {
  conversation: {
    id: 'conversation',
    label: 'Conversation',
    description: 'discussion, explication, conseil, culture générale, rédaction d’un texte, question sur Jarvis',
    tools: [],
    prompt:
      'Tu réponds directement, sans outil. Si tu ne sais pas, dis-le simplement. Pour un calcul, pose-le étape par étape et vérifie le résultat.',
  },
  pc: {
    id: 'pc',
    label: 'PC et applications',
    description: 'ordinateur, applications et programmes à ouvrir ou fermer, processus, capture d’écran, commande Windows, état du système, heure',
    tools: [
      'get_system_info',
      'list_processes',
      'get_active_window',
      'get_system_errors',
      'open_application',
      'close_application',
      'take_screenshot',
      'run_command',
      'get_current_time',
    ],
    prompt:
      'Tu agis sur le PC avec les outils fournis. Choisis l’outil le plus simple qui fait la demande ; n’utilise run_command que si aucun autre outil ne convient.',
  },
  fichiers: {
    id: 'fichiers',
    label: 'Fichiers',
    description: 'chercher, lire, créer, déplacer, copier ou supprimer des fichiers et des dossiers, documents',
    tools: [
      'search_files',
      'read_file',
      'create_folder',
      'move_file',
      'copy_file',
      'delete_file',
      'read_document',
      'search_documents',
      'index_folder',
    ],
    prompt:
      'Tu travailles sur les fichiers avec les outils fournis. Si le chemin exact manque, cherche d’abord avec search_files. Ne décris jamais le contenu d’un fichier que tu n’as pas lu.',
  },
  web: {
    id: 'web',
    label: 'Internet',
    description: 'recherche sur Internet, actualité, météo, prix, bourse, vidéo YouTube',
    tools: ['web_search', 'web_research', 'fetch_page', 'get_stock_quote', 'youtube_transcript'],
    prompt:
      'Tu réponds à partir des résultats des outils et tu cites tes sources. Ce que les outils n’ont pas renvoyé, tu ne l’affirmes pas.',
  },
  musique: {
    id: 'musique',
    label: 'Musique',
    description: 'Spotify : lancer un morceau, pause, reprise, suivant, précédent, volume de la musique, aléatoire, morceau en cours',
    tools: ['spotify_*'],
    prompt: 'Tu pilotes Spotify avec les outils spotify_*. Ta réponse se base uniquement sur le résultat de l’outil.',
  },
  concentration: {
    id: 'concentration',
    label: 'Concentration',
    description: 'bloquer ou débloquer des sites, mode travail ou concentration, créneaux de blocage',
    tools: ['siteblock_*'],
    prompt: 'Tu gères le blocage des sites avec les outils siteblock_*. Ne dis jamais qu’un blocage a changé sans un résultat positif de l’outil.',
  },
  memoire: {
    id: 'memoire',
    label: 'Mémoire',
    description: 'retenir ou retrouver une information personnelle ou un projet passé, préférences et personnalité de Jarvis',
    tools: [
      'search_jarvis_memory',
      'remember_jarvis',
      'get_jarvis_memory_stats',
      'index_jarvis_folder',
      'clear_jarvis_memory',
      'remember_video',
      'get_jarvis_personalization',
      'set_jarvis_personalization',
      'add_jarvis_personalization_rule',
      'forget_jarvis_personalization',
      'reset_jarvis_personalization',
    ],
    prompt:
      'Tu retrouves ou retiens des informations avec les outils de mémoire. N’enregistre rien sans demande explicite, et n’affirme jamais qu’une information vient de la mémoire si l’outil ne l’a pas renvoyée.',
  },
  google: {
    id: 'google',
    label: 'Google',
    description: 'Gmail et mails, agenda et rendez-vous, Google Drive, Docs, Sheets',
    tools: ['google_*'],
    prompt: 'Tu utilises les outils google_*. Une écriture n’est faite que si l’outil le confirme.',
  },
  code: {
    id: 'code',
    label: 'Code',
    description: 'écrire, expliquer ou corriger du code, un script, un programme, une formule',
    tools: [],
    prompt:
      'Tu es le spécialiste du code. Donne du code complet et correct dans un bloc, avec une explication courte. Si la demande est floue, pose une seule question.',
  },
};

/** Vrai si l'outil `name` appartient à l'équipe. */
export function teamHasTool(team: OrchestraTeam, name: string): boolean {
  return TEAM_SPECS[team].tools.some((pattern) =>
    pattern.endsWith('*') ? name.startsWith(pattern.slice(0, -1)) : pattern === name,
  );
}

export interface OrchestraConfig {
  brain: string;
  teams: Partial<Record<OrchestraTeam, TeamAssignment>>;
}

/**
 * Répartition proposée pour le PC de l'utilisateur (RTX 2060 6 Go, 64 Go de RAM), d'après
 * les modèles qu'il a installés. Le cerveau reste sur la carte ; les petits modèles tournent
 * sur le processeur, pour ne jamais le décharger. Tout se change dans Réglages → Modèle IA.
 */
export const SUGGESTED_ORCHESTRA: OrchestraConfig = {
  brain: 'qwen2.5:7b',
  teams: {
    conversation: { model: 'qwen2.5:7b', place: 'carte' },
    pc: { model: 'qwen2.5:7b', place: 'carte' },
    fichiers: { model: 'qwen2.5:7b', place: 'carte' },
    web: { model: 'qwen2.5:7b', place: 'carte' },
    google: { model: 'qwen2.5:7b', place: 'carte' },
    musique: { model: 'qwen2.5:3b', place: 'processeur' },
    concentration: { model: 'qwen2.5:3b', place: 'processeur' },
    memoire: { model: 'qwen3.5:4b', place: 'processeur' },
    code: { model: 'qwen2.5-coder:7b', place: 'processeur' },
  },
};

/** Équipe sans réglage : le cerveau, sur la carte. */
export function teamAssignment(config: OrchestraConfig, team: OrchestraTeam): TeamAssignment {
  const chosen = config.teams[team];
  if (chosen?.model.trim()) return { model: chosen.model.trim(), place: chosen.place };
  return { model: config.brain, place: 'carte' };
}
