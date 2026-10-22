/**
 * Laboratoire de missions (5.0.52). Pur : pas de modèle, pas de disque.
 * Le générateur ne note pas sa propre mission. Les tests cachés ne sont pas dans le brief.
 */
import type { MissionEvidence } from './evidence.js';
import { exportStagedEvidence } from './evidence.js';
import type { DatasetBuild } from '../learning/dataset.js';

export const LAB_MODEL_NAME = 'qwen2.5:1.5b';
export const LAB_MODEL_DIGEST_PREFIX = '65ec06548149';

export const LAB_LIMITS = {
  maxAttempts: 2,
  timeoutMs: 45_000,
  maxFileBytes: 32_000,
  maxDirBytes: 200_000,
  maxRounds: 4,
  numCtx: 4096,
  numPredict: 700,
  temperature: 0,
} as const;

export type LabLevel = 1 | 2 | 3;
export type LabSplit = 'development' | 'validation';
export type LabCategory =
  | 'logic'
  | 'functions'
  | 'collections'
  | 'strings'
  | 'json'
  | 'errors'
  | 'types'
  | 'files'
  | 'bugfix'
  | 'regression';

export type LabRowStatus = 'collected' | 'verified' | 'candidate' | 'accepted' | 'rejected';

export interface LabFile {
  path: string;
  content: string;
}

export interface LabMission {
  id: string;
  level: LabLevel;
  category: LabCategory;
  difficulty: LabLevel;
  goal: string;
  constraints: string[];
  passCriteria: string[];
  starterFiles: LabFile[];
  hiddenTests: LabFile[];
  split: LabSplit;
}

export interface LabBrief {
  id: string;
  goal: string;
  constraints: string[];
  passCriteria: string[];
  files: LabFile[];
}

const ID = /^[a-z0-9-]{3,80}$/;

export function labBrief(mission: LabMission): LabBrief {
  return {
    id: mission.id,
    goal: mission.goal,
    constraints: [...mission.constraints],
    passCriteria: [...mission.passCriteria],
    files: mission.starterFiles.map((file) => ({ ...file })),
  };
}

export function hiddenTestsIsolated(brief: LabBrief, hidden: readonly LabFile[]): boolean {
  const visible = `${brief.goal}\n${brief.constraints.join('\n')}\n${brief.passCriteria.join('\n')}\n${brief.files
    .map((file) => `${file.path}\n${file.content}`)
    .join('\n')}`;
  return hidden.every((file) => {
    const body = file.content.trim();
    if (!body) return false;
    if (visible.includes(body)) return false;
    if (visible.includes(file.path)) return false;
    if (brief.files.some((starter) => starter.path === file.path)) return false;
    return true;
  });
}

export function validateLabMission(mission: LabMission): { ok: true } | { ok: false; reason: string } {
  if (!ID.test(mission.id)) return { ok: false, reason: 'identifiant de mission illisible' };
  if (mission.level !== 1 && mission.level !== 2 && mission.level !== 3) {
    return { ok: false, reason: 'niveau hors de 1, 2 ou 3' };
  }
  if (!mission.goal.trim() || mission.passCriteria.length === 0) {
    return { ok: false, reason: 'objectif ou critères absents' };
  }
  if (mission.starterFiles.length === 0 || mission.hiddenTests.length === 0) {
    return { ok: false, reason: 'fichiers de départ ou tests cachés absents' };
  }
  const paths = new Set<string>();
  for (const file of [...mission.starterFiles, ...mission.hiddenTests]) {
    if (!file.path || file.path.includes('..') || file.path.startsWith('/') || file.path.includes('\\')) {
      return { ok: false, reason: `chemin refusé : ${file.path || '(vide)'}` };
    }
    if (paths.has(file.path)) return { ok: false, reason: `chemin en double : ${file.path}` };
    paths.add(file.path);
  }
  if (mission.hiddenTests.some((file) => !file.content.includes('assert'))) {
    return { ok: false, reason: 'un test caché ne contient aucune assertion' };
  }
  if (!hiddenTestsIsolated(labBrief(mission), mission.hiddenTests)) {
    return { ok: false, reason: 'les tests cachés sont visibles dans le brief' };
  }
  return { ok: true };
}

function tokens(text: string): Set<string> {
  return new Set(
    text
      .toLowerCase()
      .replace(/[0-9]+/g, '#')
      .split(/[^a-zàâçéèêëîïôùûü+#]+/i)
      .filter((token) => token.length > 2),
  );
}

function jaccard(left: Set<string>, right: Set<string>): number {
  if (left.size === 0 || right.size === 0) return 0;
  let shared = 0;
  for (const token of left) if (right.has(token)) shared += 1;
  return shared / (left.size + right.size - shared);
}

export function nearDuplicate(left: Pick<LabMission, 'id' | 'goal' | 'category'>, right: Pick<LabMission, 'id' | 'goal' | 'category'>): boolean {
  if (left.id === right.id) return true;
  return jaccard(tokens(`${left.category} ${left.goal}`), tokens(`${right.category} ${right.goal}`)) >= 0.75;
}

export function labContamination(
  mission: Pick<LabMission, 'id' | 'goal'>,
  origins: readonly { missionId?: string; goal?: string; skillId?: string }[],
): string | null {
  for (const origin of origins) {
    if (origin.missionId && origin.missionId === mission.id) {
      return `la mission ${mission.id} a déjà servi à la compétence ${origin.skillId ?? 'inconnue'}`;
    }
    if (origin.goal && nearDuplicate({ id: mission.id, goal: mission.goal, category: 'logic' }, { id: 'origine', goal: origin.goal, category: 'logic' })) {
      return `trop proche d’une ligne déjà utilisée (${origin.skillId ?? origin.missionId ?? 'origine'})`;
    }
  }
  return null;
}

/** Étapes seulement. Un exemple qui contient le test caché ou un correctif complet est une fuite. */
export function skillBrief(steps: readonly string[], hidden: readonly LabFile[]): { text: string; leaked: boolean } {
  const text = steps.map((step) => step.trim()).filter(Boolean).join('\n');
  const leaked = hidden.some((file) => text.includes(file.content.trim()) || /\bassert\./.test(text));
  return { text: leaked ? '' : text, leaked };
}

export function classifyLabRow(input: {
  evidence: MissionEvidence | null;
  declaredSuccess: boolean;
  leak: boolean;
  duplicate: boolean;
  contaminated: boolean;
  synthetic: boolean;
  acceptedByGates: boolean;
}): { status: LabRowStatus; reason: string } {
  if (input.leak) return { status: 'rejected', reason: 'fuite : le brief contient les tests cachés ou leur solution' };
  if (input.duplicate) return { status: 'rejected', reason: 'doublon ou variante trop proche' };
  if (input.contaminated) return { status: 'rejected', reason: 'exemple contaminé : la mission a servi à régler la compétence' };
  if (!input.evidence) {
    return {
      status: 'rejected',
      reason: input.declaredSuccess ? 'succès déclaré sans preuve' : 'preuve absente',
    };
  }
  if (input.declaredSuccess && input.evidence.status !== 'success_verified') {
    return { status: 'rejected', reason: 'succès déclaré sans preuve vérifiée' };
  }
  if (input.synthetic && input.acceptedByGates) {
    return { status: 'rejected', reason: 'ligne synthétique : hors du jeu réel' };
  }
  if (input.evidence.status !== 'success_verified') {
    return { status: 'collected', reason: input.evidence.statusReason || 'conservé pour l’analyse, pas comme réponse' };
  }
  if (input.acceptedByGates && input.evidence.staging.validationStatus === 'accepted' && !input.synthetic) {
    return { status: 'accepted', reason: 'accepté par les portes du jeu' };
  }
  if (input.evidence.staging.validationStatus === 'candidate') {
    return { status: 'candidate', reason: input.evidence.staging.reason };
  }
  return { status: 'verified', reason: input.evidence.staging.reason || input.evidence.statusReason };
}

export function labRealExport(rows: readonly { status: LabRowStatus; synthetic: boolean; evidence: MissionEvidence | null }[]): DatasetBuild {
  const accepted = rows.flatMap((row) =>
    row.status === 'accepted' && !row.synthetic && row.evidence ? [row.evidence] : [],
  );
  return exportStagedEvidence(accepted);
}

export function levelSound(rows: readonly { excluded: boolean; evidenceId: string | null; promptHasHidden: boolean; verifiedWithoutExit: boolean }[]): boolean {
  const kept = rows.filter((row) => !row.excluded);
  return kept.length > 0 && kept.every((row) => row.evidenceId && !row.promptHasHidden && !row.verifiedWithoutExit);
}

function file(path: string, content: string): LabFile {
  return { path, content: content.endsWith('\n') ? content : `${content}\n` };
}

export function referenceMissions(): LabMission[] {
  return [
    {
      id: 'l1-keel-sign',
      level: 1,
      category: 'logic',
      difficulty: 1,
      split: 'development',
      goal: 'keel(n) vaut 1 si n est positif, -1 si n est négatif, et 0 si n est nul.',
      constraints: ['Un seul fichier.', 'Pas d’appel réseau.', 'Ne modifie pas le nom keel.'],
      passCriteria: ['Les trois signes sont distincts.', 'Zéro reste zéro.'],
      starterFiles: [file('src/keel.mjs', 'export function keel(n) {\n  return 0;\n}\n')],
      hiddenTests: [
        file(
          'hidden/keel.test.mjs',
          `import test from 'node:test';
import assert from 'node:assert/strict';
import { keel } from '../src/keel.mjs';
test('positif', () => assert.equal(keel(4), 1));
test('negatif', () => assert.equal(keel(-2), -1));
test('nul', () => assert.equal(keel(0), 0));
`,
        ),
      ],
    },
    {
      id: 'l1-span-clamp',
      level: 1,
      category: 'functions',
      difficulty: 1,
      split: 'development',
      goal: 'span(value, low, high) ramène value dans l’intervalle fermé low..high.',
      constraints: ['Un seul fichier.', 'Ne change pas le nom span.'],
      passCriteria: ['Une valeur déjà dans l’intervalle ne bouge pas.', 'Les bornes sont incluses.'],
      starterFiles: [file('src/span.mjs', 'export function span(value, low, high) {\n  return value;\n}\n')],
      hiddenTests: [
        file(
          'hidden/span.test.mjs',
          `import test from 'node:test';
import assert from 'node:assert/strict';
import { span } from '../src/span.mjs';
test('dedans', () => assert.equal(span(1, 0, 3), 1));
test('sous le plancher', () => assert.equal(span(-4, 0, 3), 0));
test('au-dessus', () => assert.equal(span(9, 0, 3), 3));
`,
        ),
      ],
    },
    {
      id: 'l1-basket-sum',
      level: 1,
      category: 'collections',
      difficulty: 1,
      split: 'validation',
      goal: 'basket(nums) additionne les nombres. Une liste vide vaut 0.',
      constraints: ['N’indexe pas un élément absent.', 'Ne change pas le nom basket.'],
      passCriteria: ['La liste vide est 0.', 'L’ordre des nombres ne change pas la somme.'],
      starterFiles: [file('src/basket.mjs', 'export function basket(nums) {\n  return nums[0];\n}\n')],
      hiddenTests: [
        file(
          'hidden/basket.test.mjs',
          `import test from 'node:test';
import assert from 'node:assert/strict';
import { basket } from '../src/basket.mjs';
test('vide', () => assert.equal(basket([]), 0));
test('deux', () => assert.equal(basket([2, 5]), 7));
test('ordre', () => assert.equal(basket([1, 2, 3]), basket([3, 1, 2])));
`,
        ),
      ],
    },
    {
      id: 'l1-fold-label',
      level: 1,
      category: 'strings',
      difficulty: 1,
      split: 'validation',
      goal: 'foldLabel(text) retire les espaces de début et de fin, et réduit les espaces internes à un seul. Une chaîne vide reste vide.',
      constraints: ['Ne change pas le nom foldLabel.'],
      passCriteria: ['Les bords sont retirés.', 'Les espaces internes multiples deviennent un seul.'],
      starterFiles: [file('src/foldLabel.mjs', 'export function foldLabel(text) {\n  return text;\n}\n')],
      hiddenTests: [
        file(
          'hidden/foldLabel.test.mjs',
          `import test from 'node:test';
import assert from 'node:assert/strict';
import { foldLabel } from '../src/foldLabel.mjs';
test('bords', () => assert.equal(foldLabel('  a   b '), 'a b'));
test('vide', () => assert.equal(foldLabel(''), ''));
test('court', () => assert.equal(foldLabel('x'), 'x'));
`,
        ),
      ],
    },
    {
      id: 'l2-qty-json',
      level: 2,
      category: 'json',
      difficulty: 2,
      split: 'validation',
      goal: 'readQty(raw) lit le nombre qty d’un objet JSON. Si le texte n’est pas cet objet, ou si qty n’est pas un nombre, le résultat est null.',
      constraints: ['Ne change pas le nom readQty.', 'Pas de fichier supplémentaire.'],
      passCriteria: ['Un objet valide donne son nombre.', 'Un texte illisible donne null.'],
      starterFiles: [file('src/readQty.mjs', 'export function readQty(raw) {\n  return 0;\n}\n')],
      hiddenTests: [
        file(
          'hidden/readQty.test.mjs',
          `import test from 'node:test';
import assert from 'node:assert/strict';
import { readQty } from '../src/readQty.mjs';
test('nombre', () => assert.equal(readQty('{"qty":4}'), 4));
test('vide', () => assert.equal(readQty(''), null));
test('texte', () => assert.equal(readQty('{"qty":"x"}'), null));
`,
        ),
      ],
    },
    {
      id: 'l2-need-name',
      level: 2,
      category: 'errors',
      difficulty: 2,
      split: 'validation',
      goal: 'needName(value) retourne le nom sans espaces de bord. Une chaîne vide ou une valeur qui n’est pas une chaîne lève TypeError.',
      constraints: ['L’erreur est un TypeError.', 'Ne change pas le nom needName.'],
      passCriteria: ['Un nom entouré d’espaces est nettoyé.', 'Le vide et un nombre lèvent TypeError.'],
      starterFiles: [file('src/needName.mjs', 'export function needName(value) {\n  return value;\n}\n')],
      hiddenTests: [
        file(
          'hidden/needName.test.mjs',
          `import test from 'node:test';
import assert from 'node:assert/strict';
import { needName } from '../src/needName.mjs';
test('nom', () => assert.equal(needName(' Ada '), 'Ada'));
test('vide', () => assert.throws(() => needName('  '), TypeError));
test('nombre', () => assert.throws(() => needName(3), TypeError));
`,
        ),
      ],
    },
    {
      id: 'l2-kind-tag',
      level: 2,
      category: 'types',
      difficulty: 2,
      split: 'validation',
      goal: 'kindTag(value) vaut "number" pour un nombre, "string" pour une chaîne, et "other" sinon.',
      constraints: ['Ne change pas le nom kindTag.', 'Le fichier doit rester un module JavaScript syntaxiquement valide.'],
      passCriteria: ['Nombre et chaîne sont distingués.', 'null n’est ni un nombre ni une chaîne.'],
      starterFiles: [file('src/kindTag.mjs', 'export function kindTag(value) {\n  return "other";\n}\n')],
      hiddenTests: [
        file(
          'hidden/kindTag.test.mjs',
          `import test from 'node:test';
import assert from 'node:assert/strict';
import { kindTag } from '../src/kindTag.mjs';
test('nombre', () => assert.equal(kindTag(2), 'number'));
test('chaine', () => assert.equal(kindTag('2'), 'string'));
test('nul', () => assert.equal(kindTag(null), 'other'));
`,
        ),
      ],
    },
    {
      id: 'l2-note-file',
      level: 2,
      category: 'files',
      difficulty: 2,
      split: 'validation',
      goal: 'noteTitle(root) lit le fichier notes/title.txt dans root et en retire les espaces de fin. Il ne recolle pas une constante.',
      constraints: ['Lecture seule de ce fichier.', 'Pas d’écriture hors de root.', 'Ne change pas le nom noteTitle.'],
      passCriteria: ['Le texte lu est celui du fichier, pas une valeur figée.'],
      starterFiles: [
        file('src/note.mjs', 'export function noteTitle(root) {\n  return "bleu";\n}\n'),
        file('notes/title.txt', 'bleu\n'),
      ],
      hiddenTests: [
        file(
          'hidden/note.test.mjs',
          `import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { noteTitle } from '../src/note.mjs';
test('lit le fichier', () => {
  const root = join(import.meta.dirname, '..');
  mkdirSync(join(root, 'notes'), { recursive: true });
  writeFileSync(join(root, 'notes/title.txt'), 'vert\\n');
  assert.equal(noteTitle(root), 'vert');
});
`,
        ),
      ],
    },
    {
      id: 'l3-quote-fee',
      level: 3,
      category: 'bugfix',
      difficulty: 3,
      split: 'validation',
      goal: 'quote(cents) vaut cents plus un seul appel à fee(cents). fee reste 5 pour cent du montant arrondi. Ne casse pas fee.',
      constraints: ['Deux fichiers déjà là.', 'fee ne change pas de formule.', 'Ne change pas les noms fee et quote.'],
      passCriteria: ['fee reste la référence.', 'quote n’ajoute pas fee deux fois.'],
      starterFiles: [
        file('src/fee.mjs', 'export function fee(cents) {\n  return Math.round(cents * 0.05);\n}\n'),
        file(
          'src/quote.mjs',
          'import { fee } from "./fee.mjs";\nexport function quote(cents) {\n  return cents + fee(cents) + fee(cents);\n}\n',
        ),
      ],
      hiddenTests: [
        file(
          'hidden/quote.test.mjs',
          `import test from 'node:test';
import assert from 'node:assert/strict';
import { fee } from '../src/fee.mjs';
import { quote } from '../src/quote.mjs';
test('fee inchangé', () => assert.equal(fee(200), 10));
test('un seul fee', () => assert.equal(quote(200), 210));
`,
        ),
      ],
    },
  ];
}

export function missionsForLevel(level: LabLevel): LabMission[] {
  return referenceMissions().filter((mission) => mission.level === level);
}
