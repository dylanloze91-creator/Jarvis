# Jarvis Test `5.1.0-test.1` : essais du 18 novembre 2026 (soirée)

Branche `claude/dev` (`84de899`), faite et essayée sur le PC Windows avec l'utilisateur. **Essais interrompus en cours de série C, à finir le 19 novembre. Rien n'est publié. Jarvis Live n'a pas été modifié.**

## 1. En bref

- La version de Test essayée contient `main` (Live 5.0.79) et `claude/rapide-sans-modele`.
- **Un défaut bloquant** : dans Jarvis Test installé, l'équipe PC n'appelle plus ses outils quand la discussion contient déjà un tour répondu sans outil. Jarvis annonce une action qu'il ne fait pas, ou invente une réponse. **Ne pas publier Jarvis Test en l'état.**
- Les outils de vitesse marchent (modèles chauds, mémoire courte, chronomètre), mais leur gain sur les questions au PC ne vaut rien tant que ce défaut est là.
- Cinq autres points à corriger, moins graves (section 4).

## 2. Ce qui a été préparé

| Étape | Résultat |
| --- | --- |
| Live 5.0.79 publiée | oui, release `v5.0.79` ; Live installé vérifié en 5.0.79 |
| `claude/feuille-development` dans `main` | fusionnée (`70b069f`), documentation seulement |
| `main` dans `claude/dev` | fusionnée (`06901a8`) ; conflits résolus en gardant les deux côtés ; version gardée `5.1.0-test.1` |
| `claude/rapide-sans-modele` dans `claude/dev` | fusionnée (`84de899`) |
| Contrôles | types et style verts ; cœur 2 650 tests ; bureau 879 tests, 8 ignorés ; aucun `__golden__` régénéré |
| Installateur | `apps/desktop/release-test/Jarvis-Test-Setup-5.1.0-test.1.exe`, 451 478 970 octets, canal `test` |
| SHA-256 | `dfcf415c461906763f8b59e745d31b424b7c9cabff761fd908f745e1c01406d8` |

## 3. Résultat de chaque essai

### Série A (essais 1 à 7 de `rapports/2026-11-17-jarvis-test-preparation.md`)

| Essai | Résultat | Détail |
| --- | --- | --- |
| A1 Installer | **réussi au second essai** | Le premier passage n'a rien remplacé : les fichiers installés dataient encore du 16 novembre et l'ancien Test tournait toujours. Cause inconnue. Après avoir quitté Test puis relancé l'installateur, l'application installée est identique à celle construite (même empreinte de `app.asar`). Les essais A2 à A4 avaient commencé sur l'ancienne version ; ils ont été refaits sur la bonne. |
| A2 Premier lancement | **réussi, en partie non rejouable** | Pastille TEST visible, modèle et personnalisation corrects, Live inchangé. La question « Copier mes réglages de Jarvis Live ? » ne s'est pas affichée : elle avait déjà été acceptée le 17 novembre, elle ne se pose qu'une fois. |
| A3 Raccourcis et fonctions réservées | **réussi** | Ctrl+Espace ouvre Live, « Jarvis » ne réveille que Live, enceintes, téléphone et mot de réveil affichent « Réservé à Jarvis Live ». Ctrl+Alt+Espace n'ouvre Test qu'après « Activer quand même » sur le raccourci : c'est voulu par le code, mais l'énoncé de l'essai ne le dit pas. |
| A4 Notes | **réussi pour noter, raté pour relire** | « Note : … » : noté sans modèle en quelques millisecondes, `notes.json` puis `notes.json.bak` écrits. « Ma liste » : relue tout de suite. La phrase de l'énoncé, « Qu'est-ce qu'il y a sur ma liste ? », n'est pas reconnue : le tour part à l'équipe Mémoire, qui n'a pas les outils de notes et répond qu'elle n'a pas de liste (1 min 42 sur le processeur). |
| A5 Journal du tour | **réussi** (vérifié sur le disque) | Dans Test : chaque tour au journal, notes marquées `provider: aucun`, étapes complètes sur un tour avec modèle (tri, chargement, lecture, écriture, premier mot, voix). Dans Live : aucune des 126 conversations ne porte de journal. |
| A6 Correction d'équipe, dans Live | **douteux** | Après « Ouvre le Bloc-notes » (ouvert pour de vrai dans Live), « non » : l'étiquette du second tour est encore celle de l'équipe PC. Impossible de dire d'ici si le cerveau a rechoisi PC ou si l'équipe a été recopiée : Live ne garde pas de journal du tri. La réponse elle-même était correcte. |
| A7 Carnet des ratés | **réussi** | « C'est noté », raté listé dans les réglages, `carnet/rates.jsonl` écrit. |

### Série B (essais 1 à 5 de la section 7 de `rapports/2026-11-17-rapide-sans-modele.md`)

Les équipes Mémoire et Code sont restées sur le processeur dans les réglages de Test : le changement demandé n'a pas été enregistré. Les essais B1 à B5 ne passent pas par elles.

| Essai | Résultat | Chiffres du journal |
| --- | --- | --- |
| B1 Premiers mots après le démarrage | **réussi** | question posée 19 s après le lancement : premier mot en 0,86 s, chargement du modèle 9 ms, tour entier 3,8 s |
| B2 Deux questions sur le PC | **raté** | premiers mots en 0,9 s et 1,0 s, mais **aucun outil appelé** : informations du PC et nom de fenêtre inventés. En première phrase d'une discussion neuve, la même question appelle l'outil et donne le vrai nom (7,1 s). |
| B3 Heure juste | **réussi** | bonne heure citée ; la phrase a été confiée à l'équipe PC, choix étrange du cerveau, sans conséquence |
| B4 Cours de bourse gardé | **réussi** | 1re demande 0,5 s ; 2e, 13 s après, 1 ms avec la réponse gardée et le même cours ; 3e, 6 min après, 0,7 s, cours cherché de nouveau |
| B5 `vitesse.ps1` et « premier son » | **raté pour le script, réussi pour le contenu** | `scripts\vitesse.ps1` écrit un résumé vide (0 conversation lue). Le même outil lancé à la main avec le chemin entre guillemets lit 4 conversations, 21 tours dont 15 avec étapes, et la colonne « premier son » est dans `vitesse.md`. |

### Série C (Live comme avant, Test ouvert)

| Essai | Résultat |
| --- | --- |
| Ctrl+Espace ouvre Live | **réussi** pendant A3 et A6 ; **pas refait** en fin de soirée |
| Une question à l'enceinte | **pas encore fait** |

Vérifié sur le PC pendant la série C : le pont des enceintes (port 53131) et celui du téléphone (53130) sont tenus par Jarvis Live ; Jarvis Test n'a pris aucun port et n'a que le raccourci d'activé.

L'essai à l'enceinte a été arrêté par un souci matériel : l'enceinte est restée en lumière orange fixe (« démarrage »), sans voir son écran. Un redémarrage par le câble USB l'a fait repartir, puis l'utilisateur a trouvé les fils de l'écran mal branchés et a tout rebranché. Rien ne relie ce blocage à Jarvis Test.

## 4. À corriger

1. **Bloquant. L'équipe PC n'appelle plus ses outils dans Jarvis Test.** Vu 5 fois sur 5 dans l'application installée : ouverture du Bloc-notes annoncée sans être faite (3 fois), informations du PC et fenêtre active inventées. Ce que l'on sait :
   - même phrase, même modèle (`qwen2.5:7b`), même équipe : Live 5.0.79 appelle l'outil, Test non ;
   - le modèle reçoit bien les outils (taille du prompt) et choisit de ne pas s'en servir ;
   - les 5 ratés suivaient tous un tour répondu sans outil dans la même discussion (une note, une explication) ; la seule réussite est une discussion neuve ;
   - au banc de vitesse, avec ou sans la ligne d'heure déplacée, les outils sont appelés : le banc ne mélange jamais dans une même discussion un tour sans outil puis une demande au PC, et ne contient aucune demande qui agit.
   Reste à faire : rejouer au banc une discussion mélangée, avec chaque outil de vitesse coupé à son tour (`JARVIS_BANC_SANS`), et la même situation dans Live, pour savoir si une nouveauté de Test est en cause. Ajouter au banc des demandes qui agissent et des discussions mélangées.
2. **Notes** : élargir la règle de relecture (« qu'est-ce qu'il y a sur ma liste », « lis-moi ma liste »…) et donner les outils de notes à une équipe, pour qu'une phrase non prévue ne tombe pas chez une équipe qui ne peut pas lire la liste.
3. **`scripts\vitesse.ps1`** : le chemin « Jarvis Test » contient une espace et arrive coupé au script du cœur.
4. **Installateur de Test** : comprendre pourquoi le premier passage n'a rien remplacé alors que Test tournait ; au minimum, le dire dans l'énoncé (« quitter Jarvis Test avant »).
5. **Énoncés des essais** : A3 doit dire d'activer d'abord le raccourci dans Test ; A2 doit dire que la question de copie ne se pose qu'une fois.
6. **A6** : revoir la correction d'équipe dans Live avec un moyen de lire le tri.
7. **Enceinte, à vérifier sans urgence** : le programme promet qu'un écran absent ou défaillant ne bloque ni le réveil ni le son. Un écran mal branché a coïncidé avec une enceinte coincée au démarrage. Faux contact d'alimentation, ou vrai blocage sur un écran qui répond mal : à trancher.

## 5. Reste à faire avec l'utilisateur

- Série C : une question à l'enceinte et Ctrl+Espace, Test ouvert.
- Mettre Mémoire et Code sur la carte graphique dans Test, puis une question à chacune.
- Après correction du point 1 : refaire B2 et l'ouverture du Bloc-notes dans Test.
- Jarvis Test n'est publié que sur son « publie ».

## RAPPORT DE VÉRIFICATION

```
RAPPORT DE VÉRIFICATION
Lancement (npm run build) : FAIT, par npm run package:win:test (build compris)
Types (npm run typecheck) : OK
Style (npm run lint) : OK
Tests (npm test) : cœur 2 650, bureau 879 réussis et 8 ignorés
Secrets : aucun dans le dépôt
Relecture : fusions relues, conflits résolus en gardant les deux côtés
Testé en vrai (à la voix, sur le PC) : FAIT en partie (séries A et B au clavier, voix de la fenêtre active ; enceinte PAS FAIT)
Reste à vérifier : série C, défaut des outils de l'équipe PC, points de la section 4
```
