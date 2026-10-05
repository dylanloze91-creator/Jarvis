/**
 * Manuel technique livré avec Jarvis : copié dans
 * `<userData>/developer/knowledge/manual/` à la première utilisation.
 */
export const DEVELOPER_MANUAL_SEED: Record<string, string> = {
  'typescript-strict.md': `---
tags: [typescript, all]
language: fr
---

## const et immutabilité

En TypeScript strict, une variable déclarée avec \`const\` ne se réassigne pas. Pour mettre à jour un objet d’état de jeu, crée une copie (\`const next = { ...state }\`) ou déclare avec \`let\` si la réassignation est voulue. L’erreur **TS2588** signifie souvent qu’on modifie une propriété d’un binding \`const\` destructuré.

## Types et exports

Garde les noms d’interface et d’export existants du gabarit. Si un test attend une fonction \`bounce\` ou \`update\`, ne la renomme pas : ajuste son corps seulement.

## Modules ES

Utilise \`import\` / \`export\` ; pas de \`require\` dans les projets gabarits Node/Vitest.
`,
  'vitest-tests.md': `---
tags: [vitest, tests, all]
---

## toBeCloseTo

\`expect(valeur).toBeCloseTo(attendu, nbDécimales)\` : le **deuxième** argument est un **entier** (nombre de décimales), pas un objet \`{ tolerance: … }\`.

## Ne pas multiplier les fichiers de tests

Sur un gabarit déjà vert, les tests dans \`src/game.test.ts\` (ou équivalent) font foi. Ne crée pas un second fichier \`regle.test.ts\` sauf si le plan validé le demande explicitement.

## Assertions lisibles

Quand un test échoue, lis le nom du test et le message Vitest : ils indiquent souvent la règle métier attendue (vitesse, score, rebond).
`,
  'game-canvas.md': `---
tags: [canvas, game-loop, web-game]
templateId: web-game
---

## Boucle de jeu

Sépare \`update(state, dt)\` (logique) et \`render(ctx, state)\` (dessin). Le gabarit Pong appelle déjà ces fonctions depuis \`main.ts\` : ne réécris pas toute la boucle requestAnimationFrame.

## Canvas 2D

Le contexte est \`CanvasRenderingContext2D\`. Efface le fond chaque frame (\`clearRect\`) avant de redessiner balle et raquettes.

## Clavier

Les touches sont lues dans les handlers ; les vitesses et touches par défaut sont dans \`src/rules.ts\`. Pour changer une touche ou une vitesse, modifie souvent **seulement** \`rules.ts\`.

## Physique simple

Quand tu changes une formule (rebond, accélération), vérifie qu’elle n’est pas équivalente à multiplier par 1 (ex. \`speed * maxSpeed / speed\` quand speed ≠ 0).
`,
  'debugging.md': `---
tags: [debugging, all]
errorCodes: [TS2588, TS2322, TS2339]
---

## Lire l’erreur réelle

Corrige d’abord ce que montrent **fichier**, **ligne** et **code TS** (ex. TS2588) dans la sortie \`tsc\` ou Vitest. Ne réécris pas tout le fichier si une seule ligne est en cause.

## Même échec après correction

Si le même test ou la même ligne TS échoue encore, change d’hypothèse : une autre variable, une autre formule, ou un \`let\` au lieu d’un \`const\`.

## Tests du gabarit protégés

Si seuls les tests fournis avec le gabarit échouent après ta modification, le bug est dans **ton** code modifié, pas dans les tests de référence.
`,
  'jarvis-conventions.md': `---
tags: [jarvis, all]
---

## Copie isolée

Jarvis Développeur modifie une branche \`jarvis-dev/*\` dans une copie isolée. Rien n’est fusionné dans ta copie de travail sans « Appliquer » après ta confirmation.

## Changement ciblé

Sur un gabarit déjà vert, modifie le minimum : souvent \`src/rules.ts\` pour une valeur, ou une fonction dans \`src/game.ts\` pour une règle de jeu.

## Fichiers protégés

Les fichiers du cœur de Jarvis (agent, IPC, module Développeur lui-même) demandent une confirmation explicite même après validation du plan.
`,
};
