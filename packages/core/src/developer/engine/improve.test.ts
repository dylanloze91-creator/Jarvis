import { describe, expect, it } from 'vitest';
import {
  computeMetrics,
  improveSchema,
  metricIds,
  metricsText,
  proposalMissionKind,
  proposalRequest,
  verifyProposals,
} from './improve.js';
import {
  MISSION_CHAINS,
  missionUsesTask,
  rolesWithoutModel,
  suggestMissionKind,
} from './router.js';
import { researchSystem, skillSchema, skillTaskContext } from './skill.js';
import { factorySystem, renderTemplate } from './templates.js';

const big = Array.from({ length: 40 }, (_, i) => `export const v${i} = ${i};`).join('\n');
const FILES = [
  { path: 'src/big.ts', content: big },
  { path: 'src/tested.ts', content: `${big}\n// TODO: découper ce fichier` },
  { path: 'src/tested.test.ts', content: "import './tested';" },
  { path: 'src/small.ts', content: 'export const x = 1;' },
  { path: 'node_modules/lib/index.js', content: big },
  { path: 'README.md', content: 'TODO: doc' },
];

describe('mesures fixes de « Améliorer » (0.5.5)', () => {
  const metrics = computeMetrics(FILES);

  it('tailles, TODO et fichiers sans test, sans node_modules ni Markdown', () => {
    expect(metrics.files).toBe(4);
    expect(metrics.tests).toBe(1);
    expect(metrics.largest.map((m) => m.id)).toEqual([
      'largest:src/tested.ts',
      'largest:src/big.ts',
      'largest:src/small.ts',
    ]);
    expect(metrics.todos).toEqual([
      {
        id: 'todo:src/tested.ts:41',
        path: 'src/tested.ts',
        line: 41,
        text: '// TODO: découper ce fichier',
      },
    ]);
    expect(metrics.untested.map((m) => m.id)).toEqual(['untested:src/big.ts']);
    expect(metricIds(metrics).has('untested:src/big.ts')).toBe(true);
    expect(metricsText(metrics)).toContain('- untested:src/big.ts (40 lignes)');
  });

  it('C# : un fichier FooTests.cs couvre Foo.cs', () => {
    const cs = computeMetrics([
      { path: 'src/App.Core/Hosts.cs', content: big },
      { path: 'tests/App.Tests/HostsTests.cs', content: 'x' },
    ]);
    expect(cs.untested).toEqual([]);
    expect(cs.tests).toBe(1);
  });
});

describe('propositions : chaque preuve relue par Jarvis', () => {
  const read = async (path: string) =>
    path === 'src/big.ts' ? big : path === 'src/tested.ts' ? `${big}\n// TODO: x` : null;
  const ids = metricIds(computeMetrics(FILES));

  it('clés françaises acceptées, type inconnu = refactor', () => {
    const parsed = improveSchema.parse({
      propositions: [
        {
          titre: 'Découper big.ts',
          type: 'simplification',
          preuves: [{ chemin: 'src/big.ts', extrait: 'export const v3 = 3;' }],
          risque: 'faible',
        },
        { title: 'Autre', kind: 'magie' },
      ],
    });
    expect(parsed.proposals.map((p) => p.kind)).toEqual(['refactor', 'refactor']);
    expect(parsed.proposals[0]!.evidence[0]).toEqual({
      path: 'src/big.ts',
      excerpt: 'export const v3 = 3;',
    });
  });

  it('retenue si un extrait est relu ou une mesure existe ; sinon « avis non retenu »', async () => {
    const { proposals } = improveSchema.parse({
      proposals: [
        {
          title: 'Extrait vrai',
          evidence: [{ path: 'src/big.ts', excerpt: 'export const v3 = 3;' }],
        },
        {
          title: 'Extrait inventé',
          kind: 'bug',
          evidence: [{ path: 'src/big.ts', excerpt: 'eval(x)' }],
        },
        { title: 'Mesure connue', kind: 'test', evidence: [{ metric: 'untested:src/big.ts' }] },
        { title: 'Mesure inventée', evidence: [{ metric: 'largest:src/nulle.ts' }] },
        { title: 'Fichier secret', evidence: [{ path: '.env', excerpt: 'SECRET=1' }] },
        {
          title: 'Fichier absent',
          evidence: [{ path: 'src/absent.ts', excerpt: 'quelque chose' }],
        },
        { title: 'Architecture sans preuve', kind: 'architecture' },
      ],
    });
    const checked = await verifyProposals(proposals, read, ids);
    expect(
      checked.map((p) => `${p.title}:${p.retained}:${p.evidence.map((e) => e.status).join('+')}`),
    ).toEqual([
      'Extrait vrai:true:verified',
      'Extrait inventé:false:not-found',
      'Mesure connue:true:metric',
      'Mesure inventée:false:unknown-metric',
      'Fichier secret:false:refused',
      'Fichier absent:false:missing-file',
      'Architecture sans preuve:false:',
    ]);
    expect(proposalMissionKind(checked[1]!)).toBe('fix');
    expect(proposalMissionKind(checked[2]!)).toBe('modify');
    expect(proposalRequest(checked[0]!)).toBe(
      'Extrait vrai. Preuves : src/big.ts : « export const v3 = 3; ».',
    );
    expect(proposalRequest(checked[2]!)).toContain('mesure untested:src/big.ts');
  });
});

describe('routeur : « Améliorer » et « Compétence »', () => {
  it('propositions du routeur, chaînes, modèles nécessaires', () => {
    expect(suggestMissionKind('Analyse Jarvis et propose des améliorations')).toBe('improve');
    expect(suggestMissionKind('Crée une compétence qui génère des modèles 3D')).toBe('skill');
    expect(suggestMissionKind('Ajoute un réglage pour le thème')).toBe('modify');
    expect(MISSION_CHAINS.improve.map((s) => s.actor)).toEqual(['JARVIS', 'ARCHITECT', 'JARVIS']);
    expect(MISSION_CHAINS.skill.map((s) => s.actor)).toEqual([
      'REASONER',
      'RESEARCHER',
      'ARCHITECT',
      'USER',
    ]);
    expect(missionUsesTask('improve')).toBe(false);
    expect(missionUsesTask('skill')).toBe(true);
    expect(rolesWithoutModel('improve', { codeModel: '' })).toEqual(['ARCHITECT']);
    expect(rolesWithoutModel('skill', { codeModel: '' })).toContain('RESEARCHER');
  });
});

describe('compétence : conception, recherche, gabarit hors du chat', () => {
  it('noms d’outils en snake_case, au moins un outil', () => {
    const design = skillSchema.parse({
      nom: 'Modèles 3D',
      outils: [{ name: 'Cube STL', description: 'Écrit un cube au format STL' }],
    });
    expect(design.tools[0]!.name).toBe('cube_stl');
    expect(skillSchema.safeParse({ name: 'X', tools: [] }).success).toBe(false);
    expect(
      skillSchema.safeParse({ name: 'X', tools: [{ name: '1x', description: 'abc' }] }).success,
    ).toBe(false);
    const context = skillTaskContext(design, {
      findings: [{ fact: 'STL est un format texte simple', source: 'connaissance' }],
      uncertainties: ['licence'],
      recommendation: 'écrire le STL à la main',
    });
    expect(context).toContain('- cube_stl : Écrit un cube au format STL');
    expect(context).toContain('"chat": false');
    expect(context).toContain('À vérifier : licence');
    expect(researchSystem()).toContain('hors ligne');
    expect(researchSystem()).toContain('pas accès au web');
  });

  it('gabarit node-skill : manifeste hors du chat, absent de la liste « Nouveau projet »', () => {
    const files = renderTemplate('node-skill', {
      packageName: 'modeles-3d',
      title: 'Modèles 3D',
      description: 'Génère des modèles',
      skillTools: [{ name: 'cube_stl', description: 'x' }],
    });
    const manifest = JSON.parse(files.find((f) => f.path === 'jarvis-skill.json')!.content);
    expect(manifest).toMatchObject({ chat: false, tools: ['bonjour'], planned: ['cube_stl'] });
    expect(files.find((f) => f.path === 'README.md')!.content).toContain('**Hors du chat**');
    expect(factorySystem()).not.toContain('node-skill');
  });
});
