import { TEAM_SPECS, activeOrchestra, type OrchestraTeam } from '../agent/orchestra.js';
import type { Settings } from '../settings.js';

export interface ModelDuty {
  name: string;
  role: string;
  open: string;
}

/** Modèles que l'utilisateur a réellement réglés. Rien si aucun modèle local n'est choisi. */
export function modelsToCheck(settings: Settings): ModelDuty[] {
  const duties: ModelDuty[] = [];
  const push = (name: string | undefined, role: string, open: string): void => {
    const trimmed = name?.trim();
    if (!trimmed) return;
    duties.push({ name: trimmed, role, open });
  };

  if (settings.provider === 'ollama') {
    push(settings.model, 'ton chat', 'model');
    push(settings.fallbackModel, 'le repli', 'fallbackModel');
  }

  const orchestra = activeOrchestra(settings);
  if (orchestra) {
    push(orchestra.brain, 'le cerveau', 'orchestra.brain');
    const teams = settings.orchestra?.teams;
    if (teams) {
      for (const team of Object.keys(teams) as OrchestraTeam[]) {
        const assignment = teams[team];
        if (!assignment) continue;
        const label = TEAM_SPECS[team]?.label ?? team;
        push(assignment.model, `ton équipe ${label}`, `orchestra.teams.${team}.model`);
      }
    }
    push(settings.orchestra?.router?.model, 'le trieur', 'orchestra.router.model');
  }

  push(settings.developer.codeModel, 'le modèle de code', 'developer.codeModel');
  return duties;
}

/** `qwen2.5` sans étiquette veut `qwen2.5:latest`, jamais `qwen2.5:7b`. */
export function canonicalOllamaModel(name: string): string {
  const trimmed = name.trim();
  if (!trimmed) return trimmed;
  return trimmed.includes(':') ? trimmed : `${trimmed}:latest`;
}

export function modelInstalled(name: string, installed: readonly string[]): boolean {
  const wanted = canonicalOllamaModel(name);
  return installed.some((item) => canonicalOllamaModel(item) === wanted);
}

/** Un modèle manquant, une phrase : les rôles qui s'en servent sont regroupés. */
export function missingModelGroups(duties: readonly ModelDuty[], installed: ReadonlySet<string>): Array<{ name: string; role: string; open: string }> {
  const groups = new Map<string, { name: string; roles: string[]; open: string }>();
  for (const duty of duties) {
    if (installed.has(duty.name)) continue;
    const current = groups.get(duty.name);
    if (current) {
      if (!current.roles.includes(duty.role)) current.roles.push(duty.role);
    } else {
      groups.set(duty.name, { name: duty.name, roles: [duty.role], open: duty.open });
    }
  }
  return [...groups.values()].map((group) => ({
    name: group.name,
    role: group.roles.join(' et '),
    open: group.open,
  }));
}
