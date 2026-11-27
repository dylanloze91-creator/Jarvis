# Jarvis Développeur facile, étape 3 : suivre son projet, et Claude en renfort

Écrit par Claude Code (agent Atelier), nuit du 26 au 27 novembre 2026. Branche `claude/developpeur-facile-etape3`, partie de `claude/dev` (qui contient les étapes 1 et 2). Cahier : `docs/specs/developpeur-facile-etape3.md`, §§ 2 et 3 (sur `claude/feuille-19-nov`).

**Jarvis Test seulement. Rien n'est fusionné dans `claude/dev`, rien n'est publié, la Live n'est pas touchée. Aucun appel payant : la clé Anthropic n'est pas réglée, tous les essais passent par un faux Claude.** Rien n'a été essayé dans la fenêtre, ni à la voix : essais automatiques seulement (voir § 6).

## 1. En bref

| Demandé | État |
| --- | --- |
| Le plan visible, coché étape par étape | fait (carte de la création) |
| « Où en est mon appli ? » | fait, sans modèle ; une phrase à l'enceinte |
| « Mes applis » | fait : phrase + carte (état, dossier, « Ouvrir l'appli », « Continuer ») |
| La carte « Claude en renfort » avec l'estimation et le plafond | fait, avec un faux Claude |
| Noms et prix des modèles vérifiés chez Anthropic | fait le 27 novembre (§ 3) |
| Reprendre une mission coupée | **pas fait** (§ 7) |
| Prévenir sur le téléphone à la fin | **pas fait** (§ 7) |

## 2. Suivre son projet

Tout est par règles, sans modèle (`packages/core/src/developer/facile/suivi.ts`).

- **Le plan** : six étapes, toujours les mêmes, en mots simples : comprendre ta demande, poser la base de l'appli, préparer le travail, écrire les fichiers, tester et corriger, relire mon travail. Il est sur la carte dès la première seconde (tout « à faire »), puis chaque étape prend son état d'après les étapes **réelles** du moteur : à faire, en cours (avec ce que Jarvis fait), faite ✓, ratée (avec la raison), en attente de toi, pas faite. Une étape n'est jamais dite faite si elle n'a pas eu lieu ; un essai rouge pendant le travail n'est pas un raté (Jarvis corrige).
- **« Où en est mon appli ? »** (« elle en est où mon appli », « ça avance mon projet », « t'en es où » pendant une création) : l'étape en cours, ce qui est fait et ce qui reste, ce que Jarvis attend. À l'enceinte : une phrase et « Le détail est sur le PC. ». Sans création en cours : la dernière appli. La phrase doit nommer une appli, un projet, un jeu, un site : « elle en est où, l'image ? » et « où en est l'impression ? » gardent leur chemin.
- **« Mes applis »** : la liste gardée dans `userData/developer/facile/applis.json` (hors des réglages, écriture sûre). Chaque appli : nom, état, dossier, « Ouvrir l'appli » (si elle est prête et que sa base s'ouvre), « Continuer » (pose « Dans mon appli « … », » dans la zone de saisie), « Ouvrir le dossier ». Au redémarrage de Jarvis, une appli restée « en cours » est dite « arrêtée, coupée par un redémarrage » : rien n'est inventé.

## 3. Les modèles Claude et leurs prix (vérifiés)

Relevés le 27 novembre 2026 dans la documentation d'Anthropic (`platform.claude.com/docs/en/about-claude/models/overview` et `…/pricing`), notés avec la date dans `packages/core/src/developer/renfort/renfort.ts` :

| Modèle | Identifiant | Lu, par million de jetons | Écrit, par million de jetons |
| --- | --- | --- | --- |
| Claude Haiku 5.5 | `claude-haiku-5-5` | 0,10 $ (0,50 $ si la demande dépasse 100 000 jetons) | 0,50 $ (2,50 $ au-delà) |
| Claude Sonnet 5.5 | `claude-sonnet-5-5` | 2 $ | 10 $ |
| Claude Opus 5.5 | `claude-opus-5-5` | 4 $ | 20 $ |

Trois choses à savoir :

- **La durée n'est pas un chiffre d'Anthropic.** Sa documentation dit seulement « le plus rapide / rapide / modéré ». Les vitesses qui servent à l'estimation (120, 70 et 50 jetons par seconde) sont **une hypothèse de ma part**, à corriger dès les premiers appels réels.
- **Dollars et euros.** Anthropic facture en dollars, ton plafond est en euros : un dollar est compté comme un euro tant que tu n'as pas réglé de taux (`developer.renfort.usdToEur`, pas encore dans l'interface).
- **Le fournisseur Anthropic du chat est ancien.** `packages/core/src/providers/anthropic.ts` a pour modèle par défaut `claude-sonnet-4-5` et envoie une `temperature` : les modèles de 2026 la refusent (erreur 400). Je ne l'ai pas touché (le chat ne change pas sans ta décision) ; le renfort a son propre appel, sans température ni réflexion réglée.

## 4. Claude en renfort

Coupé par défaut. Réglages → Développeur → « Claude en renfort » (visible dans Jarvis Test seulement) : l'interrupteur, la clé (dans le coffre ; la fenêtre ne revoit que « clé enregistrée »), le plafond par appli (2 € si tu ne mets rien) et le plafond par mois (aucun si tu ne mets rien).

- **Quand la carte apparaît** : seulement sur un signe mesuré. Branchés : la même erreur deux fois de suite (l'arrêt net du moteur), une étape qui dépasse sa durée, une réponse illisible après la relance, et ta demande (« passe à Claude pour cette étape », « essaie avec Sonnet »). **Pas encore branché** : la mission refusée d'avance parce que trop grande (§ 7).
- **Ce que la carte dit** : l'étape, pourquoi le local n'y arrive pas, le modèle proposé (le plus petit qui convient : Haiku pour une correction, Sonnet pour une étape difficile, Opus seulement si tu le demandes), l'estimation toujours écrite « environ » (durée et coût), ce qui est déjà dépensé sur cette appli et le plafond, et ce qui partirait (ta demande, le plan, les erreurs des essais, les fichiers du projet nommés un par un). Boutons : « Oui, avec Claude », « Non, continue en local », « Arrête ».
- **Le plafond** : vérifié pour la carte, puis **revérifié juste avant chaque appel** avec ce que l'appel peut coûter au plus. S'il serait dépassé : pas d'appel, carte « plafond atteint ». Après chaque appel, le coût réel (calculé d'après les jetons rendus par l'API) est ajouté à l'appli et au mois (`userData/developer/facile/renfort.json`) et affiché. Si ce registre est abîmé et sans copie, Jarvis n'appelle pas Claude plutôt que de repartir de zéro.
- **Ce qui ne part jamais** : les clés, les fichiers de réglages, `.env`, les jetons, les bases, tout ce qui est hors du dossier du projet, `node_modules`, `.git`. Tout ce qui part passe par la même garde que le journal (`redactSecrets`) : une clé écrite par erreur dans un fichier du projet est masquée.
- **Après le « oui »** : le travail est relancé sur le projet **dans la boucle du moteur**, et Claude écrit les fichiers à la place du modèle local. Le reste ne change pas : plan, écriture sous la règle du plan, revue du diff, essais, cartes pour les fichiers hors plan. C'est un point d'accroche facultatif du moteur (`TaskHooks.writer`) ; sans lui, rien ne change.
- **Sans clé** : la carte ne propose que le local et dit où ajouter la clé. **Depuis une enceinte** : jamais (« demande-le-moi sur le PC »).
- **Rien de Claude dans l'entraînement** : une appli où Claude a écrit est marquée (`claude: true` dans la liste), et une preuve de mission faite avec un modèle Claude est rejetée par la mise de côté des exemples (`evidence.ts`).

## 5. Les fichiers

- Cœur : `packages/core/src/developer/facile/suivi.ts`, `packages/core/src/developer/renfort/renfort.ts`, `settings.ts` (`developer.renfort`, facultatif, sans défaut), `settingsMap/fields.ts`, `evidence.ts`, `chatMissions/envelope.ts`.
- PC : `apps/desktop/src/main/chatMission/facile.ts` (coordinateur), `suiviStore.ts`, `ipc.ts`, `session.ts` (le suivi passe avant l'atelier et avant le tri du chef d'orchestre), `index.ts` ; moteur : `task/taskRun.ts`, `task/taskFlow.ts`, `mission/missionWorkflow.ts`, `controller.ts` (le rédacteur).
- Fenêtre : `ChatMissionFacileCard.tsx` (plan, carte du renfort), `ChatMissionAppsCard.tsx`, `developer/RenfortSettings.tsx`.

## 6. Les essais

- Cœur : `suivi.test.ts` (15 essais), `renfort.test.ts` (17 essais, faux Claude et faux `fetch`).
- PC : `chatMission/etape3.test.ts` (8 essais : plan, « où en est », « mes applis », carte, oui / non / arrête, plafond, sans clé, coupé, enceinte), `facile-session.test.ts` (3 essais de plus, vraie session).
- **Ce qui n'est pas essayé** : la fenêtre (la carte n'a été vue par personne), la voix, l'iPhone, et surtout **une vraie mission relancée avec le rédacteur** : le point d'accroche du moteur est vérifié par les types et par le coordinateur avec un faux moteur, pas de bout en bout. À faire avant de mettre une clé : une mission d'essai avec un faux Claude branché à la place du vrai.

## 7. Ce qui reste

1. **Essai de bout en bout du rédacteur dans le moteur** (voir § 6) : c'est le point le plus important avant le premier appel payant.
2. **Mission trop grande** (« Mission non lancée ») : la carte ne propose pas encore « avec Claude ». Le contrôle de difficulté juge le Codeur local ; il faut lui dire que le rédacteur sera Claude.
3. **Reprendre une mission coupée** : pas fait. Aujourd'hui elle est dite « arrêtée », et « Continuer » repart d'une nouvelle demande.
4. **Prévenir sur le téléphone** à la fin ou quand Jarvis attend : pas fait.
5. **L'examen** du cahier (suivi de commandes de Driver's Ink, plafond 2 €) : pas passé, il demande ta clé et ta présence.
6. Le taux du dollar n'a pas de champ dans l'interface ; le fournisseur Anthropic du chat est à mettre à jour sur ta décision.
7. Le téléphone n'affiche pas encore le plan ni la carte du renfort (sa page ne connaît que le texte et les cartes d'avant).

## 8. À essayer par toi (Jarvis Test construit depuis cette branche)

1. « Fais-moi une appli pour noter mes heures » : le plan apparaît tout de suite, puis se coche.
2. Pendant qu'il travaille : « où en est mon appli ? » dans la fenêtre, puis à l'enceinte.
3. « Mes applis » : la liste, « Ouvrir l'appli », « Continuer ».
4. Réglages → Développeur → « Claude en renfort » : l'activer **sans clé**, puis provoquer un échec (une appli trop dure pour le petit modèle) : la carte doit dire comment ajouter la clé, sans rien proposer d'autre.
5. Seulement après l'essai du § 7.1 : mettre ta clé, plafond à 0,50 € pour commencer, et dire oui une fois.

## RAPPORT DE VÉRIFICATION

```
RAPPORT DE VÉRIFICATION
Lancement : OK pour le cœur (npm run build --workspace @jarvis/core) ; l'application elle-même n'a pas été construite ni lancée
Types     : OK (npm run typecheck)
Style     : OK (npm run lint, 0 erreur)
Tests     : cœur 267 fichiers verts (3 396 essais, 1 ignoré comme d'habitude) ; bureau 199 fichiers verts (1 098 essais), 4 fichiers ignorés comme d'habitude
            essais figés (chat-unchanged, ollama-unchanged, orchestra-session, machineProfile, profiles/jarvis) verts, aucun __golden__ régénéré
            au premier passage complet du bureau, history.test.ts (« journal sous EPERM ») a échoué une fois sous la charge ; il passe seul et au passage complet suivant
Secrets   : OK (aucune clé ; faux Claude et clés « synthetique-test » dans les essais ; aucun appel à Anthropic)
Fichiers  : voir § 5
Prêt à fusionner : NON tant que le rédacteur n'a pas été essayé de bout en bout dans une vraie mission (§ 7.1) et que tu n'as pas vu la carte ; ensuite, dans claude/dev par l'agent Corrections
Testé en vrai (à la voix, sur le PC) : PAS FAIT
```
