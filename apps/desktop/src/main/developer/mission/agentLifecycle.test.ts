/**
 * Ces tests simulent les agents. Ce n’est pas une exécution réelle d’Ollama.
 */
import { describe, expect, it } from 'vitest';
import type { MissionAgentState } from '@jarvis/core';
import { claimAgent, haltDependents } from './agentLifecycle.js';

function agent(
  partial: Pick<MissionAgentState, 'id' | 'role' | 'dependsOn' | 'status'> &
    Partial<MissionAgentState>,
): MissionAgentState {
  return {
    name: partial.id,
    brief: 'brief',
    context: 'contexte',
    modelRequired: partial.role === 'code',
    ...partial,
  };
}

describe('cycle de vie des agents (sans Ollama réel)', () => {
  const plan = [
    agent({ id: 'prepare', role: 'préparation', dependsOn: [], status: 'done' }),
    agent({ id: 'architecture', role: 'architecture', dependsOn: ['prepare'], status: 'done' }),
    agent({ id: 'code', role: 'code', dependsOn: ['architecture'], status: 'pending' }),
    agent({ id: 'test', role: 'test', dependsOn: ['code'], status: 'pending' }),
    agent({ id: 'package', role: 'package', dependsOn: ['test'], status: 'pending' }),
  ];

  it('un codeur en échec arrête le testeur et le livreur, sans les marquer terminés', () => {
    const failed = plan.map((item) =>
      item.id === 'code' ? { ...item, status: 'failed' as const, error: 'génération refusée' } : item,
    );
    const next = haltDependents(failed, 'code', 'génération refusée', 'failed');
    expect(next.find((item) => item.id === 'test')?.status).toBe('failed');
    expect(next.find((item) => item.id === 'package')?.status).toBe('failed');
    expect(next.find((item) => item.id === 'architecture')?.status).toBe('done');
    expect(next.every((item) => item.status !== 'done' || item.id === 'prepare' || item.id === 'architecture')).toBe(
      true,
    );
  });

  it('une annulation n’est pas un échec', () => {
    const next = haltDependents(plan, 'code', 'Annulé.', 'cancelled');
    expect(next.find((item) => item.id === 'test')?.status).toBe('cancelled');
    expect(next.find((item) => item.id === 'package')?.status).toBe('cancelled');
  });

  it('le même agent ne repart pas', () => {
    expect(claimAgent(agent({ id: 'code', role: 'code', dependsOn: [], status: 'pending' }))).toBe(true);
    expect(claimAgent(agent({ id: 'code', role: 'code', dependsOn: [], status: 'running' }))).toBe(false);
    expect(claimAgent(agent({ id: 'code', role: 'code', dependsOn: [], status: 'done' }))).toBe(false);
    expect(claimAgent(agent({ id: 'code', role: 'code', dependsOn: [], status: 'failed' }))).toBe(false);
  });

  it('une mission en échec ne laisse pas les dépendances en attente', () => {
    const next = haltDependents(
      plan.map((item) => (item.id === 'code' ? { ...item, status: 'failed' as const } : item)),
      'code',
      'tests du projet en échec',
      'failed',
    );
    expect(next.filter((item) => item.status === 'pending')).toHaveLength(0);
    expect(next.find((item) => item.id === 'test')?.error).toMatch(/tests du projet/);
  });
});
