/** Agents visibles dans le chat Développeur (5.0.28) — un rôle, une tâche. */
export type DeveloperMissionAgent = 'web' | 'preparer' | 'architecte' | 'codeur' | 'testeur';

export const DEVELOPER_MISSION_AGENT_LABELS: Record<DeveloperMissionAgent, string> = {
  web: 'Chercheur web',
  preparer: 'Préparateur',
  architecte: 'Architecte',
  codeur: 'Codeur',
  testeur: 'Testeur',
};

export function developerAgentStarted(agent: DeveloperMissionAgent, task: string): string {
  const label = DEVELOPER_MISSION_AGENT_LABELS[agent];
  const t = task.trim();
  return `▶ ${label} — ${t}`;
}

export function developerAgentFinished(agent: DeveloperMissionAgent, result: string): string {
  const label = DEVELOPER_MISSION_AGENT_LABELS[agent];
  const r = result.trim();
  return `✓ ${label} — ${r}`;
}
