# Idées reprises d'OpenJarvis — 23 novembre 2026

Demande de l'utilisateur : reprendre les idées d'OpenJarvis qui font gagner du temps et qui collent à la feuille de route, et les écrire dans le dépôt.

Branche `claude/idees-openjarvis`, partie de `claude/dev` (Jarvis Test). Écrit par Claude (le chat). **Ajouts seulement** : aucun fichier existant du chat, de l'agent, des réglages ou de l'interface n'a changé. Rien n'est branché dans l'appli.

## 1. D'où viennent les idées

OpenJarvis (https://github.com/open-jarvis/OpenJarvis) est un projet de Stanford, sous licence Apache 2.0, pour des assistants IA qui tournent sur sa propre machine. Il est écrit en Python ; Jarvis est en TypeScript. **Aucune ligne de leur code n'a été recopiée** : on a repris des idées, des façons de faire et quelques valeurs (seuils), réécrites pour Jarvis. Chaque fichier nouveau dit d'où vient l'idée.

Ce qui a été lu : leur code (tri des traces, routeur appris, découverte de compétences, recherche guidée, opérateurs, planificateur, garde de boucle, briefing du matin, mémoire, mesures de vitesse et d'énergie) et leur feuille de route.

## 2. Ce qui a été repris, et pourquoi

| Idée d'OpenJarvis | Ce que ça donne dans Jarvis | Ce que ça fait gagner (feuille de route) |
| --- | --- | --- |
| Recherche guidée (« LLM-guided spec search ») : un professeur lit les traces, regroupe les ratés, propose des changements ; une **porte** n'accepte un changement que s'il améliore ce qu'il vise sans abîmer le reste de plus de 1 % | **Boucle d'amélioration** : diagnostic des ratés par familles, porte pour les règles express, rejouée sur tout l'historique réel | « Claude en tire les règles express » (tâche 2) devient un outil : plus besoin de relire `carte.md` à la main pour trouver les règles |
| Découverte de compétences dans les traces | **Règles express proposées** : groupes de mots qui reviennent dans les demandes qu'une équipe traite bien après un tri par modèle | « Jarvis plus rapide sans nouveau modèle » : chaque règle retire un appel au cerveau |
| Analyseur de traces | **Où part le temps** : choix de l'équipe, chargement, lecture, écriture, outils, premier mot, d'après le chronomètre par étape | Mesure ce que les règles express peuvent faire gagner, en secondes |
| Routeur appris (note 0,6 × réussite + 0,4 × vitesse, 5 exemples au moins) | **Quel modèle pour quelle équipe** : suggestion seulement | Choix des modèles d'après l'usage réel, pas d'après un banc générique |
| Opérateurs (agents qui tournent tout seuls) et planificateur | **Veilleurs** : règles permanentes sans modèle, action seulement dans le sens de la sécurité | « Jarvis autonome », étape 2 (règles permanentes) : le moteur est prêt |
| Garde de boucle | **Garde de boucle** : un petit modèle qui refait le même appel d'outil est arrêté | Moins de tours perdus quand Qwen tourne en rond |

## 3. La boucle d'amélioration

Fichiers : `packages/core/src/amelioration/` (`tours.ts`, `diagnostic.ts`, `decouverte.ts`, `porte.ts`, `equipes.ts`, `boucle.ts`, `fichiers.ts`), script `packages/core/scripts/ameliorer.mjs`.

```
npm run ameliorer --workspace @jarvis/core -- --conversations "%APPDATA%\Jarvis Test\conversations" --carnet "%APPDATA%\Jarvis Test\carnet\rates.jsonl" --dir C:\dev\jarvis-data
```

(Les chemins exacts des dossiers de Jarvis Test sont à vérifier sur le PC.)

Elle lit le journal du tour (`turnLog`, Jarvis Test), le journal des équipes (`routeLog`) et le carnet des ratés. Aucun modèle, aucun réseau. Elle écrit dans `C:\dev\jarvis-data\amelioration\<date>\` (jamais dans le dépôt, refusé par le script) :

- `rapport.md` : familles de ratés, temps par étape, outils qui ratent, suggestions de modèle, règles proposées en code prêt à coller ;
- `exemples.md` : la même chose avec les phrases de l'utilisateur, pour regarder de près ;
- `analyse.json` : des comptes seulement, aucune phrase. C'est le seul fichier qui peut sortir du PC (par exemple pour Claude, le chat).

**La porte** (`porte.ts`) rejoue une règle sur toutes les demandes déjà faites :

- prise juste : la demande allait déjà dans l'équipe de la règle ;
- prise réparée : la demande était partie ailleurs et le carnet l'a notée comme ratée (la règle l'aurait envoyée au bon endroit) ;
- prise volée : la demande allait dans une autre équipe sans raté. C'est une régression.

Elle n'accepte une règle que si elle prend au moins 5 demandes, avec 95 % de prises justes ou réparées, au plus 1 % des demandes des autres équipes, et aucun conflit avec une règle déjà en place. `--regle fichier.json` passe à la porte une règle écrite à la main (par Claude Code) avant de l'ajouter.

**Règle de toujours** : une règle proposée n'entre dans `EXPRESS_RULES` qu'avec ses propres phrases d'essai, écrites pour elle, jamais recopiées des conversations (règle déjà écrite dans `expressRules.ts`).

## 4. Les veilleurs

Fichier : `packages/core/src/veilleurs/veilleurs.ts`. Module pur, pas encore branché.

Un veilleur, c'est : un nom, un horaire (toutes les N secondes, ou à des heures fixes certains jours), un outil de lecture, une condition (« température de la buse > 280 », « en ligne == non »), une action, et où prévenir (écran, enceinte, téléphone).

Sécurité :

- **seules actions permises, écrites dans le code** : aucune, mettre l'impression en pause, l'annuler, arrêter le robot, arrêt d'urgence, couper la prise. Un fichier qui demande autre chose (lancer, chauffer, avancer) est refusé et le veilleur est mis en pause sans rien faire ;
- au plus 3 actions par heure (au-delà, il prévient sans agir) ;
- pas deux alertes pour la même chose en 30 minutes ;
- condition exigible plusieurs passages de suite (contre les fausses alertes) ;
- lecture qui rate : nouvel essai après 10 s, 20 s, 40 s… (5 minutes au plus), puis pause après 3 échecs, et il le dit ; un jeton refusé met en pause tout de suite ;
- un veilleur qui ne tourne plus est repéré (`veilleursEnRetard`) pour le bilan de santé ;
- journal de chaque passage (200 lignes au plus).

La surveillance de l'imprimante (`claude/atelier-3d`) garde sa propre logique. Les veilleurs servent aux règles permanentes de l'utilisateur (« si l'imprimante ne répond plus, préviens-moi », « si la buse dépasse 280 degrés, mets en pause »).

## 5. La garde de boucle

Fichier : `packages/core/src/agent/gardeBoucle.ts`. Module pur, **pas branché** dans `agent.ts` : le brancher change le comportement de l'agent, c'est à essayer dans Jarvis Test.

- 2ᵉ appel identique (même outil, mêmes arguments) : avertissement ajouté au résultat ;
- 3ᵉ appel identique : pas exécuté, le modèle reçoit « sers-toi du résultat déjà reçu » ;
- alternance A, B, A, B : avertissement, puis blocage.

## 6. Idées notées, pas écrites

- **Début de consigne qui ne bouge pas** (OpenJarvis : « frozen prefix ») : Ollama réutilise le calcul d'une consigne dont le début est identique d'un tour à l'autre. Tout ce qui change (l'heure, la date) doit être **à la fin**. À mesurer par Claude Code avec le chronomètre (étape « lecture ») avant de toucher aux consignes : ça rejoint la décision du 19 novembre sur la ligne d'heure de l'équipe PC. Les tests figés (`chat-unchanged.test.ts`) ne doivent pas bouger.
- **Briefing gardé pour la journée** : le préparer au début de la fenêtre du matin pour que « bonjour » réponde tout de suite.
- **Importer des compétences toutes faites** (Hermes, OpenClaw) : écartée pour l'instant. Elles sont écrites pour de gros modèles avec un terminal, et une compétence importée peut contenir des consignes dangereuses.

## 7. Vérifications

- Tests nouveaux : `amelioration/amelioration.test.ts` (22), `veilleurs/veilleurs.test.ts` (18), `agent/gardeBoucle.test.ts` (4). Phrases d'essai écrites pour les tests, aucune venant d'une conversation.
- Suite complète du cœur, dans le cloud, avant et après : 2 522 sur 2 592 avant, 2 566 sur 2 636 après. **Mêmes 70 échecs** des deux côtés : ils viennent de l'environnement du cloud (version de zod, pas de npm ni de git complet), pas de ce travail.
- Aucun fichier figé touché (`__golden__`, `chat-unchanged`, `ollama-unchanged`, `parseSettings({})`).
- Aucun secret, aucun chemin personnel, aucune phrase de l'utilisateur dans le dépôt.

RAPPORT DE VÉRIFICATION

- Construction (`npm run build`) : PAS FAIT (pas de npm complet dans le cloud ; compilation TypeScript du cœur faite, aucune erreur dans les fichiers nouveaux).
- Types (`npm run typecheck`) : PAS FAIT officiellement (voir ci-dessus).
- Style (`npm run lint`) : PAS FAIT.
- Tests du cœur : FAIT dans le cloud (44 nouveaux, tous verts ; aucune régression).
- Secrets : FAIT (aucun).
- Relecture : FAIT.
- Testé en vrai (à la voix, sur le PC) : PAS FAIT. Rien n'est branché dans l'appli ; le seul essai en vrai possible est `npm run ameliorer` sur les conversations de Jarvis Test.

## 8. Pour Claude Code

1. `npm run typecheck`, `npm test`, `npm run lint` sur la branche.
2. Lancer `npm run ameliorer` sur les conversations et le carnet de Jarvis Test, lire `rapport.md` et `exemples.md`.
3. Pour chaque règle qui passe la porte : l'écrire dans `EXPRESS_RULES` avec ses phrases d'essai, relancer avec `--regle`, puis essais dans Jarvis Test.
4. Envoyer `analyse.json` (des comptes seulement) à Claude (le chat) pour la feuille de route.
5. Plus tard, sur décision : brancher la garde de boucle dans `agent.ts`, et les veilleurs dans le processus principal (fichier `userData/veilleurs.json`, hors de `settings.json`).
