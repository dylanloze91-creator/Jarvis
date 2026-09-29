import { describe, expect, it } from 'vitest';
import {
  compareSemver,
  githubLatestYmlUrl,
  interpretLatestYmlResponse,
  parseLatestYmlVersion,
} from './feed.js';

describe('githubLatestYmlUrl', () => {
  it('pointe vers le latest.yml public du dépôt configuré', () => {
    expect(githubLatestYmlUrl()).toBe(
      'https://github.com/dylanloze91-creator/Jarvis/releases/latest/download/latest.yml',
    );
  });
});

describe('compareSemver', () => {
  it('ordonne les versions x.y.z', () => {
    expect(compareSemver('0.4.1', '0.4.0')).toBe(1);
    expect(compareSemver('0.4.0', '0.4.1')).toBe(-1);
    expect(compareSemver('0.4.0', '0.4.0')).toBe(0);
    expect(compareSemver('v0.5.0', '0.4.9')).toBe(1);
  });
});

describe('parseLatestYmlVersion', () => {
  it('extrait le champ version d’un latest.yml electron-builder', () => {
    expect(parseLatestYmlVersion('version: 0.4.0\npath: Jarvis-Setup-0.4.0.exe\n')).toBe('0.4.0');
  });

  it('renvoie null si le champ est absent', () => {
    expect(parseLatestYmlVersion('path: foo.exe\n')).toBeNull();
  });
});

describe('interpretLatestYmlResponse', () => {
  it('traite un 404 comme une absence de publication, pas une panne', () => {
    expect(interpretLatestYmlResponse(404, '', '0.4.0')).toEqual({ kind: 'empty' });
  });

  it('signale une version plus récente', () => {
    expect(interpretLatestYmlResponse(200, 'version: 0.5.0\n', '0.4.0')).toEqual({
      kind: 'available',
      publishedVersion: '0.5.0',
    });
  });

  it('signale que la version installée est déjà la plus récente publiée', () => {
    expect(interpretLatestYmlResponse(200, 'version: 0.4.0\n', '0.4.0')).toEqual({
      kind: 'current',
      publishedVersion: '0.4.0',
    });
  });

  it('traite un latest.yml illisible comme une absence de flux', () => {
    expect(interpretLatestYmlResponse(200, 'not yaml', '0.4.0')).toEqual({ kind: 'empty' });
  });

  it('traite un 500 comme une réponse invalide', () => {
    expect(interpretLatestYmlResponse(500, 'oops', '0.4.0')).toEqual({ kind: 'invalid' });
  });
});
