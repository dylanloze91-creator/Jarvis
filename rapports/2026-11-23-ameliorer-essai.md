# Boucle d'amélioration : premier essai sur Jarvis Test — 23 novembre 2026

Tâche 1 sexies de la feuille de route, suite de `rapports/2026-11-23-idees-openjarvis.md`. Branche `claude/idees-openjarvis` (partie de `claude/dev`). Rien sur `main`, rien de publié. Veilleurs et garde de boucle **non branchés**.

Ce rapport ne contient aucune phrase de l'utilisateur : seulement des comptes, et les phrases d'essai écrites pour la règle.

## 1. Contrôles officiels

- `npm run typecheck` : vert.
- `npm run lint` : vert.
- `npm test` : vert (cœur 2 705 sur 2 705, bureau 891 et 8 ignorés), avant le changement. Après : cœur 2 706 sur 2 706.

## 2. Lancement

`npm run ameliorer --workspace @jarvis/core -- --conversations "%APPDATA%\Jarvis Test\conversations" …` **ne lit rien** : npm coupe le chemin à l'espace de « Jarvis Test » (même piège que `vitesse.ps1`, corrigé le 19 novembre). Le script affiche alors « 1 dossier absent, carnet absent » au lieu d'une erreur. Chemin qui marche :

```
npm run build --workspace @jarvis/core
cd packages/core
node scripts/ameliorer.mjs --conversations "%APPDATA%\Jarvis Test\conversations" --carnet "%APPDATA%\Jarvis Test\carnet\rates.jsonl" --dir C:\dev\jarvis-data
```

À faire plus tard, au choix : un `scripts\ameliorer.ps1` sur le modèle de `vitesse.ps1`, ou un arrêt net du script quand aucun dossier n'est lu.

## 3. Ce qui ressort (Jarvis Test, données du 18 au 20 novembre)

- 15 conversations, **37 demandes**, toutes avec le journal du tour ; 8 lignes du carnet, toutes rattachées à une demande.
- Chemins : 19 demandes triées par le cerveau, 14 par le chat d'avant (orchestre coupé à ce moment), 4 par une règle express.
- **Temps** : 51 % des demandes ont attendu un modèle pour choisir l'équipe (22,5 s en tout). Le tri seul est court (médiane 0,5 s, 4,2 s 9 fois sur 10). Les gros temps sont ailleurs : chargement du modèle (12,1 s 9 fois sur 10), écriture de la réponse (10,3 s), premier son (médiane 2,3 s, 14,3 s 9 fois sur 10).
- **Ratés** (7 familles, 8 ratés) : surtout de la **lenteur** (équipes Code et Mémoire, 5 sur 8), une répétition sur la bourse (express), une correction et une répétition sur l'équipe PC.
- Aucun outil en échec. Aucune suggestion de modèle par équipe (pas assez d'exemples : 5 par modèle).
- **Une règle proposée** : « mon pc » → équipe PC, qui passe la porte (5 prises, 100 % justes, 0 prise à une autre équipe).

**Limite** : 37 demandes, c'est peu. La porte exige 5 prises : avec cet historique, une seule règle peut passer, et ses chiffres valent pour ces 37 demandes seulement. La boucle prendra son sens après quelques semaines de Jarvis Test.

## 4. Règle ajoutée : `mon-pc`

Dans `EXPRESS_RULES` (`packages/core/src/agent/expressRules.ts`), **après** `infos-pc`, pour que « informations sur mon PC » garde l'appel direct de `get_system_info` (test ajouté).

- Déclencheurs : « mon pc », « mon ordinateur », « ma machine ».
- Empêchements : tout ce qui part ailleurs ou demande une explication (recherche, notes et mémoire, fichiers, mail, enceinte, code et création, « pourquoi », « comment », conseil et achat, musique, image).
- Phrases d'essai, écrites pour la règle : 6 « pour » (programmes qui tournent, erreurs système, logiciel au premier plan, fermer Chrome, capture d'écran, calculatrice), 8 « contre ».
- La proposition brute de la boucle (« mon pc », sans empêchement) aurait passé la porte aussi, mais elle aurait pris « note de nettoyer mon PC » ou « quel portable acheter pour remplacer mon PC » : la porte ne le voit pas, faute de telles phrases dans l'historique.
- Revérifiée avec `--regle` : passe la porte, avant et après l'ajout au code.

## 5. Essai dans Jarvis Test

Jarvis Test installé arrêté, cette branche lancée en édition Test (`JARVIS_EDITION=test`, `electron-vite dev`) avec les données et les réglages de Jarvis Test, phrases envoyées par la vraie session (port de débogage), vrai Ollama. Cartes refusées d'office. Copie des données avant : `C:\dev\jarvis-data\sauvegardes\test-avant-essai-mon-pc-2026-11-23`. Après : les 18 conversations d'essai retirées, carnet, apprentissage, journaux et journal d'audit remis comme avant, capture d'écran d'essai supprimée, Jarvis Test installé relancé.

| Phrase d'essai | Route | Outil | Temps |
| --- | --- | --- | ---: |
| Quels programmes tournent sur mon PC ? | PC · express | `list_processes` | 9,2 s |
| Y a-t-il des erreurs système sur mon ordinateur ? | PC · express | `get_system_errors` | 9,0 s |
| Ferme Chrome sur mon ordinateur | PC · express | `close_application` | 5,6 s |
| Fais une capture d'écran de mon PC | PC · express | `take_screenshot` | 7,3 s |
| Quel logiciel est au premier plan sur ma machine ? | PC · express | un outil (nom non relevé par le premier script ; la réponse donne bien la fenêtre active) | 5,2 s |
| Donne-moi les informations sur mon PC | PC · express, sans modèle (`infos-pc`) | `get_system_info` | 0,6 s |
| Pourquoi mon ordinateur chauffe autant ? | PC · cerveau | — | 8,2 s |
| Note dans ma liste de nettoyer mon PC | PC · cerveau | — | 4,7 s |
| Mets de la musique sur mon PC | Musique · cerveau | — | 14,9 s |
| Quel nouveau portable acheter pour remplacer mon PC ? | PC · cerveau | — | 5,7 s |

La règle prend ce qu'elle doit prendre, laisse le reste au cerveau, et le bon outil est appelé chaque fois. `infos-pc` n'est pas masquée. Capture et fermeture sans carte : c'est le réglage de Jarvis Test (« seulement les actions destructives » pour les applis et la capture).

Pas essayé à la voix.

## 6. Défauts vus en passant, non corrigés (pas dans cette tâche)

1. **« … sur mon PC en ce moment ? » part vers l'équipe Web** : `looksLikeWebResearchIntent` (`agent.ts`) prend « en ce moment » malgré le possessif. Trouvé par le contrôle des règles express.
2. **« Note dans ma liste de nettoyer mon PC »** : le cerveau l'envoie à l'équipe PC, qui répond « Bien noté » **sans rien noter** (l'équipe PC n'a pas l'outil des notes). Une réponse inventée.
3. **« Mets de la musique sur mon PC »** n'est pas reconnue par la règle Musique ; le cerveau trie, l'équipe Musique répond sans lancer Spotify.

## 7. Pour la suite

- `analyse.json` (comptes seulement) : `C:\dev\jarvis-data\amelioration\2026-11-23-1137\analyse.json`, à envoyer à Claude (le chat) si l'utilisateur le veut.
- Brancher la garde de boucle et les veilleurs : sur décision de l'utilisateur.

RAPPORT DE VÉRIFICATION

- Construction : FAIT (cœur construit ; bureau lancé par `electron-vite dev`).
- Types (`npm run typecheck`) : FAIT, vert.
- Style (`npm run lint`) : FAIT, vert.
- Tests : FAIT (cœur 2 706 sur 2 706 ; bureau 891 et 8 ignorés).
- Secrets : FAIT (aucun).
- Relecture : FAIT.
- Testé en vrai (à la voix, sur le PC) : PAS FAIT à la voix ; FAIT au clavier, par la vraie session de Jarvis Test (section 5).
