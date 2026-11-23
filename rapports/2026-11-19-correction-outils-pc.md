# Correction du défaut des outils de l'équipe PC — Jarvis Test 5.1.0-test.2 (19 novembre 2026)

Branche `claude/correction-outils-pc`, partie de `claude/dev` (`756dbfe`). **Rien n'est publié, rien n'est fusionné dans `main`, Live n'est pas touché.** L'installateur de Test est construit, pas installé.

## 1. La cause

Défaut des essais du 18 novembre : dans Jarvis Test, l'équipe PC annonçait une action sans la faire, ou inventait une réponse.

**La cause est la note d'heure placée devant la demande** (`withTrailingNote`, champ d'édition `clockAfterHistory`, mission « Jarvis plus rapide »). Elle ne suffit pas seule : il faut aussi la personnalisation, c'est-à-dire un prénom et la règle « réponds court » du questionnaire. Avec les deux, le modèle répond à la note (il parle de l'heure et de la date du PC) au lieu d'appeler l'outil.

Le mélange de tours n'est pas la condition : le défaut apparaît aussi en première phrase d'une discussion neuve. Le banc de vitesse du 17 novembre ne le voyait pas, parce qu'il tournait sans personnalisation (6 justes sur 6).

## 2. Les chiffres

Banc `banc:outils-pc` : la vraie session, le vrai catalogue, le vrai Ollama (`qwen2.5:7b` sur la carte). Une discussion mélangée (une note, une explication, puis les trois demandes), et les mêmes demandes chacune dans une discussion neuve. Le chiffre est le nombre de fois, sur 10, où le bon outil a été appelé.

### Série A — avant la correction, avec la vraie personnalisation de Test

| Cas | Bloc-notes | Infos du PC | Fenêtre active | Bloc-notes, neuve | Infos du PC, neuve | Fenêtre, neuve |
| --- | --- | --- | --- | --- | --- | --- |
| a) Test tel quel | 9 | 2 | 1 | 10 | 2 | 10 |
| b) Test sans la note d'heure | 10 | 10 | 10 | 10 | 7 | 10 |
| c) Test sans les modèles chauds | 10 | 1 | 1 | 10 | 1 | 10 |
| c) Test sans la mémoire courte | 10 | 1 | 2 | 10 | 0 | 8 |
| d) Live 5.0.79, avec les données de Live | 10 | 10 | 10 | 10 | 9 | 0 |

Seul le cas b) répare. Couper les modèles chauds ou la mémoire courte ne change rien : ces deux outils de vitesse sont hors de cause et restent en place.

Isolement (3 passages) : personnalisation seule, 0 sur 3 pour les informations du PC et la fenêtre ; mémoire apprise seule, presque tout juste ; aucune donnée, 6 sur 6.

### Série B — vérification, avec la personnalisation du banc (prénom inventé, « réponds court »)

| Cas | Bloc-notes | Infos du PC | Fenêtre active | Bloc-notes, neuve | Infos du PC, neuve | Fenêtre, neuve |
| --- | --- | --- | --- | --- | --- | --- |
| Avant la correction (`756dbfe`) | 9 | 0 | 0 | 10 | 2 | 10 |
| a) Après, Test tel quel | 10 | 10 | 10 | 10 | 8 | 10 |
| c) Après, sans les modèles chauds | 10 | 10 | 10 | 10 | 9 | 10 |
| c) Après, sans la mémoire courte | 10 | 10 | 10 | 10 | 8 | 10 |
| d) Live 5.0.79 | 10 | 10 | 10 | 10 | 10 | 10 |

Le cas b) n'existe plus après la correction : la note d'heure est retirée du code. Le banc voit bien le défaut (ligne « avant ») et la correction le fait disparaître dans la discussion mélangée : 30 sur 30.

### Ce qui reste

- **« Donne-moi les informations sur mon PC » en première phrase d'une discussion neuve : 8 à 9 sur 10 dans Test, 10 sur 10 dans Live.** L'écart est petit (2 ratés sur 10, sur une seule série) et je n'en connais pas la cause. Je ne l'ai pas cherchée : ce n'était pas la demande.
- **Live 5.0.79, « Quelle fenêtre est active ? » en discussion neuve : 0 sur 10 avec les données de Live (série A), 10 sur 10 avec la personnalisation du banc (série B).** L'équipe PC est bien choisie, mais aucun outil n'est appelé. Quelque chose dans les données de Live (personnalisation ou mémoire apprise) le provoque. C'est un autre défaut, déjà présent dans Live ; je n'ai pas touché à Live et je n'ai pas isolé la cause.

## 3. La correction

- `apps/desktop/src/main/session.ts` : la ligne d'heure est revenue dans le message système (`teamPrompt(team, character, clockLine)`) pour toutes les équipes, dans Test comme dans Live. La demande de l'utilisateur part telle quelle.
- `packages/core/src/edition.ts` : le champ `clockAfterHistory` est retiré. `vitesse/promptTail.ts` reste dans le code, sans être branché.
- Test : `vitesse/heure-session.test.ts` (2 échecs sur 4 avant la correction, 4 sur 4 après).
- Je n'ai cherché aucune autre place pour la note.

### Le gain perdu

Chiffres du rapport `2026-11-17-rapide-sans-modele.md`, que cette correction rend :

- lecture du prompt d'une question à outil : 0,6 s redevient 2,0 s (équipe PC), 0,3 s redevient 1,8 s (équipe Fichiers) ;
- lecture par la carte sur tout le banc de vitesse : 25 s redevient 37 s (le gain était de 33 %) ;
- à chaque nouvelle minute, Ollama relit le début du prompt : 3,0 s au lieu de 0,5 s pour 3 000 jetons.

Ces chiffres sont ceux du 17 novembre. Je n'ai pas repassé le banc de vitesse après la correction.

## 4. Le banc, pour toujours

`apps/desktop/src/main/vitesse/banc-outils-pc.banc.ts`, `npm run banc:outils-pc --workspace @jarvis/desktop`, hors de `npm test`. Il garde :

- la discussion mélangée et les demandes qui agissent ;
- une personnalisation (prénom inventé et « réponds court »).

`open_application` y est remplacé par une réussite : rien ne s'ouvre sur le PC. Les résultats ne contiennent que des comptes et des noms d'outil, aucune phrase. Variables : `JARVIS_BANC_PASSAGES`, `JARVIS_BANC_SANS=chauds,memoire`, `JARVIS_BANC_DONNEES=1|perso|memoire|sans`, `JARVIS_BANC_REPONSES=1`.

## 5. Les autres points du rapport du 18

- **Point 2, relecture des notes.** « Qu'est-ce qu'il y a sur ma liste ? », « Lis-moi ma liste », « Montre-moi mes notes », « ma liste de courses »… relisent la liste sans modèle (`quotidien/notes.ts`, `isListRequest`). La phrase entière doit être la demande. Test : 19 phrases acceptées, 8 refusées. Les outils des notes n'appartiennent toujours à aucune équipe du chef d'orchestre : tu n'as demandé que la règle.
- **Point 3, `scripts\vitesse.ps1`.** Le chemin « Jarvis Test » contient une espace et npm le coupait. Le script construit le cœur par npm, puis lance `node` avec le chemin entier. Relancé pour de vrai : 4 conversations lues, 21 tours, `vitesse.md` écrit.
- **Point 4, installateur de Test.** Il ferme lui-même Jarvis Test avant de copier (`apps/desktop/scripts/installer-test.nsh`). L'installateur de Live ne l'inclut pas. **Construit, mais pas essayé** : à voir ce soir en installant `test.2` par-dessus un Jarvis Test ouvert.
- **Point 5, énoncés.** Les énoncés 1 à 4 de `rapports/2026-11-17-jarvis-test-preparation.md` sont corrigés.

## 6. À savoir

- **Version `5.1.0-test.2`** : c'est mon choix, pour que tu voies ce soir que la bonne version est installée.
- Installateur : `apps/desktop/release-test/Jarvis-Test-Setup-5.1.0-test.2.exe` (SHA-256 `3DFE4C65D669DE78…`). Pas installé, pas publié.
- La fusion de `claude/dev` dans `claude/jarvis-development` (les deux côtés gardés) était déjà faite avant cette branche. Cette branche-ci n'y est pas encore fusionnée.

## 7. Ce soir, avec toi

1. Installer `test.2` avec Jarvis Test ouvert (point 4), et vérifier le numéro de version.
2. B2.
3. « Ouvre le Bloc-notes », dans une discussion déjà commencée.
4. La série C.
5. Mémoire et Code sur la carte graphique.

### Résultats du 19 novembre au soir

L'utilisateur dit que tous les essais sont passés. Ce que le journal de Jarvis Test confirme (une discussion, trois tours de suite, équipe PC, `qwen2.5:7b` sur la carte) :

| Essai | Résultat | Journal |
| --- | --- | --- |
| B2, informations du PC | **réussi** | `get_system_info` appelé, premier mot en 2,4 s |
| B2, fenêtre active | **réussi** | `get_active_window` appelé, premier mot en 2,1 s |
| Bloc-notes, dans la même discussion | **réussi** | `open_application` appelé, premier mot en 2,7 s |

Mémoire et Code sur la carte graphique, refait ensuite (réglages enregistrés : les deux équipes sont sur « carte ») :

| Essai | Résultat | Journal |
| --- | --- | --- |
| Une question à l'équipe Mémoire | **réussi** | `qwen3.5:4b` sur la carte, chemin express ; chargement du modèle 12,1 s, premier mot à 14,3 s, tour entier 14,3 s ; aucun outil appelé : réponse tirée de la personnalisation, d'après l'utilisateur |
| Une question à l'équipe Code | **réussi** | `jarvis-coder` sur la carte, choisi par le cerveau ; chargement 5,1 s pour le tri puis 5,5 s pour l'équipe, premier mot à 12,9 s, tour entier 27,3 s |

La carte n'a que 6 Go : chaque changement d'équipe décharge un modèle pour charger l'autre, d'où 10 à 12 s d'attente avant le premier mot. Après la question au Code, seul `jarvis-coder` restait chargé (4,3 Go sur la carte) : la demande suivante à une autre équipe rechargera `qwen2.5:7b`.

Pas de trace dans les journaux, donc sur la seule parole de l'utilisateur : l'installateur qui ferme Jarvis Test, et la série C.

## RAPPORT DE VÉRIFICATION

```
RAPPORT DE VÉRIFICATION
Lancement : OK (npx electron-vite build ; installateur de Test 5.1.0-test.2 construit ; banc des outils du PC passé sur le vrai Ollama)
Types     : OK (npm run typecheck)
Style     : OK (npm run lint)
Tests     : OK (cœur 232 fichiers, 2651 tests ; bureau 172 fichiers, 879 tests, 8 ignorés par leur propre condition ; aucun __golden__ régénéré, les tests figés passent tels quels)
Secrets   : OK (aucune clé, aucun nom de réseau, aucune phrase de l'utilisateur ; le prénom du banc est inventé)
Fichiers modifiés : session.ts, edition.ts, vitesse/promptTail.ts (commentaire), heure-session.test.ts, banc-vitesse.banc.ts, banc-outils-pc.banc.ts (nouveau), quotidien/notes.ts et son test, scripts/vitesse.ps1, installer-test.nsh (nouveau), packageTestConfig.mjs et son test, versions, CLAUDE.md, rapports
Prêt à fusionner : NON (dans claude/dev seulement, après les essais de ce soir ; jamais dans main sans ta décision)
À corriger : infos du PC en discussion neuve (8 à 9 sur 10 dans Test) ; fenêtre active en discussion neuve dans Live avec ses données (0 sur 10), cause non isolée
Testé en vrai (à la voix, sur le PC) : PAS FAIT (banc sans fenêtre ni voix ; installateur pas installé)
```
