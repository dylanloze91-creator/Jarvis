import { describe, expect, it } from 'vitest';
import { fallbackSupervisorPlan, supervisorPlanSchema } from './supervisor.js';

describe('Superviseur dynamique', () => {
  it('crée seulement les agents nécessaires à une bibliothèque', () => {
    const plan = fallbackSupervisorPlan('Crée une bibliothèque TypeScript de calcul.');
    expect(plan.tasks.map((task) => task.role)).toEqual([
      'préparation',
      'architecture',
      'code',
      'test',
    ]);
    expect(plan.tasks.every((task) => task.brief && task.context)).toBe(true);
  });

  it('ajoute la livraison pour un jeu jouable', () => {
    const plan = fallbackSupervisorPlan('Crée un jeu de plateforme jouable.');
    expect(plan.tasks.map((task) => task.role)).toContain('package');
    expect(supervisorPlanSchema.parse(plan)).toEqual(plan);
  });
});

