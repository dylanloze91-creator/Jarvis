import { describe, expect, it } from 'vitest';
import { LOCATION_ASK_REPLY, planCurrentInfoTurn, weatherFocusFromQuestion } from './homePlace.js';

const NOW = new Date('2026-10-04T12:00:00Z'); // dimanche

const home = { label: 'Ville Exemple', latitude: 48.1, longitude: -1.7 };

describe('planCurrentInfoTurn — lieu Chez moi', () => {
  it('météo sans ville : demande le lieu si Chez moi absent', () => {
    expect(planCurrentInfoTurn('Quel temps demain ?', NOW)).toEqual({ action: 'ask' });
  });

  it('répond LOCATION_ASK_REPLY exact', () => {
    expect(LOCATION_ASK_REPLY).toBe('Pour quel endroit ?');
  });

  it('météo sans ville : utilise Chez moi', () => {
    const turn = planCurrentInfoTurn('Quel temps demain ?', NOW, home);
    expect(turn.action).toBe('search');
    if (turn.action !== 'search') return;
    expect(turn.plan.city).toBe('Ville Exemple');
    expect(turn.plan.homeCoordinates).toEqual({ latitude: 48.1, longitude: -1.7, label: 'Ville Exemple' });
    expect(turn.plan.query.toLowerCase()).toContain('ville exemple');
  });

  it('une ville nommée l’emporte sur Chez moi', () => {
    const turn = planCurrentInfoTurn('Météo à Ville-Alpha demain', NOW, home);
    expect(turn.action).toBe('search');
    if (turn.action !== 'search') return;
    expect(turn.plan.city).toBe('Ville-Alpha');
    expect(turn.plan.homeCoordinates).toBeUndefined();
  });

  it('recherche locale : ajoute la ville au query', () => {
    const turn = planCurrentInfoTurn('Pharmacie de garde ouvert maintenant ?', NOW, home);
    expect(turn.action).toBe('search');
    if (turn.action !== 'search') return;
    expect(turn.plan.query.toLowerCase()).toContain('ville exemple');
  });
});

describe('weatherFocusFromQuestion', () => {
  it('demain → demain', () => {
    expect(weatherFocusFromQuestion('Quel temps demain ?', NOW)).toBe('tomorrow');
  });

  it('jeudi → offset vers jeudi', () => {
    expect(weatherFocusFromQuestion('Météo jeudi ?', NOW)).toBe(4);
  });
});

describe('weatherFocusFromQuestion — ce week-end', () => {
  it('un dimanche, « ce week-end » est aujourd’hui, pas le samedi suivant', () => {
    expect(weatherFocusFromQuestion('Quel temps ce week-end ?', new Date('2026-10-04T12:00:00'))).toBe('today');
  });
  it('un samedi, « ce week-end » est aujourd’hui', () => {
    expect(weatherFocusFromQuestion('Quel temps ce week-end ?', new Date('2026-10-03T12:00:00'))).toBe('today');
  });
  it('un mercredi, « ce week-end » est le samedi qui vient (dans 3 jours)', () => {
    expect(weatherFocusFromQuestion('Quel temps ce week-end ?', new Date('2026-09-30T12:00:00'))).toBe(3);
  });
});
