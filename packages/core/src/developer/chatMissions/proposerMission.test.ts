import { describe, expect, it } from 'vitest';
import { isCreateOrBuildOrder } from '../engine/projectChatMissionRoute.js';
import { looksLikeCodeExplanationOnly } from './detect.js';
import { missionKindFromProposerType } from './proposerMission.js';

describe('proposer_mission — détection', () => {
  it('demandes de fichiers : ordre de création ou construction', () => {
    expect(isCreateOrBuildOrder('Crée-moi un petit jeu de plateforme')).toBe(true);
    expect(isCreateOrBuildOrder('Fais-moi une appli CLI')).toBe(true);
    expect(isCreateOrBuildOrder("C'est quoi une boucle for ?")).toBe(false);
  });

  it('questions d’explication : pas une mission', () => {
    expect(looksLikeCodeExplanationOnly("C'est quoi une boucle for ?")).toBe(true);
    expect(looksLikeCodeExplanationOnly('Montre-moi un exemple de boucle for en Python')).toBe(true);
    expect(looksLikeCodeExplanationOnly('Crée-moi une fonction qui trie')).toBe(false);
  });

  it('types de proposition → kind de mission', () => {
    expect(missionKindFromProposerType('modifier')).toBe('modify');
    expect(missionKindFromProposerType('corriger')).toBe('fix');
    expect(missionKindFromProposerType('nouveau-projet')).toBe('new-project');
    expect(missionKindFromProposerType('documenter')).toBe('document');
  });
});
