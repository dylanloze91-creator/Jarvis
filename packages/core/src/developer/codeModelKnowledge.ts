/**
 * Savoir métier injecté dans les consignes du modèle de code local (Ollama),
 * par rôle de la boucle : Codeur (plan, écriture, correction) et Débogueur
 * (diagnostic avant correction). Ce n’est pas un spécialiste ni un réglage
 * modèle : seulement du texte ajouté aux prompts existants.
 */

export const CODE_MODEL_CODER_KNOWLEDGE = [
  'Changement ciblé : sur un gabarit déjà vert, ne réécris pas un fichier entier « par précaution ». Modifie seulement ce que la demande et le plan demandent (souvent une valeur dans src/rules.ts ou une fonction dans src/game.ts).',
  'TypeScript strict : le fichier rendu doit passer `tsc --noEmit`. Corrige chaque erreur listée (chemin, ligne, code TS…) avant d’en introduire une autre.',
  'Ne crée aucun fichier hors plan, surtout pas un nouveau `*.test.ts`, sauf si le plan validé le prévoit explicitement. Les tests du gabarit (ex. src/game.test.ts) restent la référence : ne les casse pas.',
  'Vitest : `expect(x).toBeCloseTo(y, nbDécimales)` — le 2ᵉ argument est un entier, pas `{ tolerance: … }`. Une variable déclarée `const` ne se réassigne pas : utilise `let` ou une copie (`const next = { …state }`).',
  'Avant de livrer du code de physique ou de jeu, vérifie que la formule change vraiment le comportement (pas une expression qui revient à multiplier par 1).',
  'Si une correction précédente a échoué avec la même erreur, change d’approche : ne renvoie pas le même contenu de fichier ni la même modification.',
].join('\n');

export const CODE_MODEL_DEBUGGER_KNOWLEDGE = [
  'Pars des échecs tels quels : résumé du test, extrait npm/vitest/tsc avec chemin, numéro de ligne, code TS (ex. TS2588) ou message d’assertion.',
  'Pour chaque cause, indique fichier + ligne + code d’erreur et une correction concrète. Si les extraits montrent que la même erreur ou le même test a déjà échoué après une correction, propose une hypothèse différente — ne répète pas la piste déjà tentée.',
  'Ne recommande pas d’ajouter des fichiers de tests pour « prouver » une règle si le plan ne le demande pas : corrige le code source listé dans le plan ou adapte les tests déjà prévus.',
  'Si seuls des tests du gabarit (fichiers protégés) échouent alors que tu vises une règle nouvelle, le bug est dans le code modifié, pas dans les tests de référence.',
].join('\n');
