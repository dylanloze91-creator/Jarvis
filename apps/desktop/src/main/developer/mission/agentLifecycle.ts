import type { MissionAgentState, MissionAgentStatus } from '@jarvis/core';

/** Un agent déjà parti ou terminé ne repart pas. */
export function claimAgent(agent: { status: MissionAgentStatus }): boolean {
  return agent.status === 'pending';
}

/**
 * Un agent en échec arrête ceux qui dépendent de lui.
 * `cancelled` seulement si l’utilisateur a annulé. Personne n’est marqué terminé sans résultat.
 */
export function haltDependents(
  agents: readonly MissionAgentState[],
  failedId: string,
  message: string,
  mode: 'failed' | 'cancelled',
): MissionAgentState[] {
  const next = agents.map((agent) => ({ ...agent }));
  const blocked = new Set<string>([failedId]);
  let changed = true;
  while (changed) {
    changed = false;
    for (const agent of next) {
      if (blocked.has(agent.id)) continue;
      if (agent.status === 'done' || agent.status === 'failed' || agent.status === 'cancelled') continue;
      if (!agent.dependsOn.some((id) => blocked.has(id))) continue;
      blocked.add(agent.id);
      agent.status = mode;
      agent.error = message.slice(0, 300);
      agent.finishedAt = agent.finishedAt ?? Date.now();
      changed = true;
    }
  }
  return next;
}
