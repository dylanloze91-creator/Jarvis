/**
 * Manuel technique livré avec Jarvis : copié dans
 * `<userData>/developer/knowledge/manual/` à la première utilisation.
 * Incrémenter quand on ajoute ou modifie une page seed (réécriture sur les installs existantes).
 */
export const DEVELOPER_MANUAL_SEED_VERSION = 3;

export const DEVELOPER_MANUAL_SEED: Record<string, string> = {
  'methode-travail.md': `---
tags: [method, methodology, all]
language: fr
---

## Méthode de travail

### Comprendre avant de coder

Lis la demande, le plan validé et les fichiers déjà touchés. Utilise les outils de lecture pour voir le code réel (noms, exports, tests existants). Ne pars pas d’une API ou d’un fichier que tu n’as pas ouvert.

### Ne pas inventer une API ni un fichier

N’ajoute pas de fonction, de module, de \`*.test.ts\` ou de dépendance qui n’est pas dans le plan validé. Si quelque chose manque, signale-le dans le plan ou la réponse — ne le crées pas « au cas où ».

### Changer le minimum

Sur un projet neuf, écris le programme demandé dans \`src/game.ts\` et adapte \`src/game.test.ts\` pour le vérifier. Sur un projet déjà vert, modifie le strict nécessaire.

### Les tests tranchent

Ce que demandent les tests du projet et ce que montrent \`tsc\` / Vitest font foi. Si un test échoue, corrige le code — adapte les tests seulement quand le plan validé le prévoit (projet neuf : les tests doivent décrire le programme demandé).

### Ne pas enregistrer une correction ratée

Une fiche « solution validée » ne se sauvegarde qu’après succès des tests et revue, pas après un échec répété. Si la même erreur revient, change d’hypothèse au lieu de renvoyer la même modification.

### Manuel et mémoire du projet

Le **manuel technique** (passages récupérés ici) = règles générales et pièges types. La **mémoire du projet** (notes utilisateur, décisions de discussion) = contexte propre à ce dépôt. Ne mélange pas les deux : le manuel ne remplace pas les décisions mémorisées sur le projet.

### Arrêt après trois corrections

Si trois tentatives de correction n’ont pas rendu les tests verts, ou si le même échec revient, arrête la boucle et explique ce qui bloque. Demande une décision ou un plan revu plutôt que d’empiler des changements au hasard.

### Règle finale

Choisis **la voie la plus simple, fiable et testable** pour obtenir **exactement** ce qui a été demandé — ni plus, ni à côté.
`,
  'typescript-strict.md': `---
tags: [typescript, all]
language: fr
---

## const et immutabilité

En TypeScript strict, une variable déclarée avec \`const\` ne se réassigne pas. Pour mettre à jour un objet d’état de jeu, crée une copie (\`const next = { ...state }\`) ou déclare avec \`let\` si la réassignation est voulue. L’erreur **TS2588** signifie souvent qu’on modifie une propriété d’un binding \`const\` destructuré.

## Types et exports

Garde \`createGame\`, \`update\` et \`render\` exportés depuis \`src/game.ts\` tant que \`main.ts\` ne change pas : le corps et l’état peuvent devenir le jeu demandé.

## Modules ES

Utilise \`import\` / \`export\` ; pas de \`require\` dans les projets gabarits Node/Vitest.
`,
  'vitest-tests.md': `---
tags: [vitest, tests, all]
---

## toBeCloseTo

\`expect(valeur).toBeCloseTo(attendu, nbDécimales)\` : le **deuxième** argument est un **entier** (nombre de décimales), pas un objet \`{ tolerance: … }\`.

## Ne pas multiplier les fichiers de tests

Pour un projet neuf jeu web, remplace les tests minimaux du gabarit par des tests du programme demandé dans \`src/game.test.ts\`. Ne multiplie pas les fichiers de tests sans raison.

## Assertions lisibles

Quand un test échoue, lis le nom du test et le message Vitest : ils indiquent souvent la règle métier attendue (vitesse, score, rebond).
`,
  'game-canvas.md': `---
tags: [canvas, game-loop, web-game]
templateId: web-game
---

## Boucle de jeu

Sépare \`update(state, input, dt)\` (logique) et \`render(ctx, state)\` (dessin). \`main.ts\` appelle déjà la boucle : ne la réécris pas sans besoin.

## Canvas 2D

Le contexte est \`CanvasRenderingContext2D\`. Efface ou repeins le fond chaque frame avant de redessiner.

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

## Tests et programme

Les tests doivent vérifier le programme demandé, pas un jeu livré par défaut. Si les tests et le code divergent, aligne-les selon le plan validé.
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

/** Contenu seed avec marqueur de version (écrit sur disque). */
export function developerManualSeedContent(filename: string): string {
  const body = DEVELOPER_MANUAL_SEED[filename];
  if (!body) throw new Error(`Page manuel inconnue : ${filename}`);
  return body;
}
