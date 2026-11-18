/**
 * Modèles gardés chauds (Jarvis Test) : quoi charger au démarrage, quoi prolonger ensuite.
 *
 * Aucun modèle n'est ajouté ni changé : ce sont ceux que l'utilisateur a choisis pour le chef
 * d'orchestre. Une requête de chargement ne génère rien (prompt vide). Elle porte les mêmes
 * options de chargement que les vraies demandes (`num_ctx`, `num_gpu`) : sinon Ollama recharge
 * le modèle à la première demande, et le préchauffage n'a servi à rien.
 */
import { activeOrchestra, activeRouter, teamAssignment, type OrchestraSettingsLike } from '../agent/orchestra.js';
import { ORCHESTRA_TEAMS, type ModelPlace, type OrchestraTeam } from '../agent/orchestraTeams.js';
import { OLLAMA_RECOMMENDED_NUM_CTX } from '../providers/ollama.js';
import type { TurnLogEntry } from '../types.js';

/** Durée de garde demandée à chaque chargement ou prolongation. */
export const WARM_KEEP_ALIVE = '30m';
/** Rythme des prolongations. Plus court que la garde d'une équipe (10 min). */
export const WARM_BEAT_MS = 8 * 60_000;
/** Équipe préchauffée quand l'usage ne dit rien. */
export const WARM_DEFAULT_TEAM: OrchestraTeam = 'conversation';

export interface WarmTarget {
  model: string;
  place: ModelPlace;
  /** Pourquoi ce modèle : il trie, ou il répond pour l'équipe la plus utilisée. */
  role: 'cerveau' | 'trieur' | 'equipe';
}

export interface WarmLoadRequest {
  model: string;
  /** Vide : chargement seul, pas une génération. */
  prompt: '';
  stream: false;
  keep_alive: string;
  options: { num_ctx: number; num_gpu?: number };
}

interface WarmSettings {
  provider: string;
  orchestra?: OrchestraSettingsLike | undefined;
}

/**
 * Le modèle qui trie (trieur s'il est réglé, puis le cerveau) et celui de l'équipe la plus
 * utilisée. Orchestre coupé ou fournisseur autre qu'Ollama : rien.
 */
export function orchestraWarmTargets(settings: WarmSettings, mostUsed?: OrchestraTeam | null): WarmTarget[] {
  const orchestra = activeOrchestra(settings);
  if (!orchestra) return [];
  const targets: WarmTarget[] = [];
  const push = (target: WarmTarget): void => {
    if (!target.model.trim()) return;
    if (targets.some((item) => item.model === target.model && item.place === target.place)) return;
    targets.push(target);
  };
  const router = activeRouter(settings);
  if (router) push({ model: router.model, place: router.place, role: 'trieur' });
  push({ model: orchestra.brain, place: 'carte', role: 'cerveau' });
  const team = mostUsed && ORCHESTRA_TEAMS.includes(mostUsed) ? mostUsed : WARM_DEFAULT_TEAM;
  const assignment = teamAssignment(orchestra, team);
  push({ model: assignment.model, place: assignment.place, role: 'equipe' });
  return targets;
}

/**
 * Tous les modèles que le chef d'orchestre peut appeler : le tri et chaque équipe. Sert à la
 * prolongation : un modèle d'équipe déjà chargé (souvent sur le processeur, où relire un prompt
 * prend des dizaines de secondes) est gardé tant qu'il sert.
 */
export function orchestraModelTargets(settings: WarmSettings): WarmTarget[] {
  const orchestra = activeOrchestra(settings);
  if (!orchestra) return [];
  const targets = orchestraWarmTargets(settings);
  for (const team of ORCHESTRA_TEAMS) {
    const assignment = teamAssignment(orchestra, team);
    if (!assignment.model.trim()) continue;
    if (targets.some((item) => item.model === assignment.model && item.place === assignment.place)) continue;
    targets.push({ model: assignment.model, place: assignment.place, role: 'equipe' });
  }
  return targets;
}

export function warmLoadRequest(target: WarmTarget, keepAlive: string = WARM_KEEP_ALIVE): WarmLoadRequest {
  return {
    model: target.model,
    prompt: '',
    stream: false,
    keep_alive: keepAlive,
    options: {
      num_ctx: OLLAMA_RECOMMENDED_NUM_CTX,
      ...(target.place === 'processeur' ? { num_gpu: 0 } : {}),
    },
  };
}

/** Même modèle, que le nom porte ou non l'étiquette `:latest`. */
function sameModel(a: string, b: string): boolean {
  const full = (name: string): string => (name.includes(':') ? name : `${name}:latest`).toLowerCase();
  return full(a) === full(b);
}

/**
 * Prolongation : seulement les modèles **encore chargés**. Un modèle déchargé exprès (Jarvis
 * Imager, Jarvis Développeur) ou évincé par Ollama faute de place n'est jamais rechargé ici.
 */
export function warmTargetsToRefresh(targets: readonly WarmTarget[], loaded: readonly string[]): WarmTarget[] {
  return targets.filter((target) => loaded.some((name) => sameModel(name, target.model)));
}

/** Équipe qui a le plus répondu avec un modèle, d'après les journaux de tour. `null` : pas d'usage. */
export function mostUsedTeam(entries: readonly Pick<TurnLogEntry, 'team' | 'model'>[]): OrchestraTeam | null {
  const counts = new Map<OrchestraTeam, number>();
  for (const entry of entries) {
    if (!entry.model || !entry.team) continue;
    if (!ORCHESTRA_TEAMS.includes(entry.team as OrchestraTeam)) continue;
    const team = entry.team as OrchestraTeam;
    counts.set(team, (counts.get(team) ?? 0) + 1);
  }
  let best: OrchestraTeam | null = null;
  let bestCount = 0;
  for (const team of ORCHESTRA_TEAMS) {
    const count = counts.get(team) ?? 0;
    if (count > bestCount) {
      best = team;
      bestCount = count;
    }
  }
  return best;
}
