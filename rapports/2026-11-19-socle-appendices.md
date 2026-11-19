# Le socle des appendices (19 novembre 2026)

Étape 0 du cahier Jarvis Development (`docs/specs/jarvis-development.md`, section 3, sur la branche `claude/jarvis-development`). Fait par Claude Code sur le PC Windows, la nuit du 18 au 19 novembre, sans l'utilisateur. **Jarvis Test seulement, coupé par défaut. Rien n'est fusionné, rien n'est publié. Jarvis Live, l'enceinte et le Jarvis Test installé n'ont pas été touchés.**

## 1. À savoir d'abord : la branche

La mission demandait de fusionner `claude/dev` dans `claude/jarvis-development`, et de s'arrêter en cas de conflit. **Il y a eu un conflit** : un seul fichier, `AGENTS-COORDINATION.md` (les deux branches ont ajouté des lignes au même endroit du tableau). Aucun fichier de code. La fusion a été **annulée**, rien n'a été écrasé, `claude/jarvis-development` n'a reçu que la correction de l'étude (étape 2 de la nuit).

Pour ne pas perdre la nuit, le socle est construit sur une branche à part, **`claude/socle-appendices`**, partie de `claude/dev`. Elle n'a pas le cahier ni la liste d'électronique, qui restent sur `claude/jarvis-development`.

**Résolu le 19 novembre, sur décision de l'utilisateur** : le conflit est réglé en gardant les lignes des deux côtés. `claude/dev` puis `claude/socle-appendices` sont fusionnées dans `claude/jarvis-development` (`94fcc8c`), qui porte maintenant l'étude et le socle. Contrôles refaits sur cette branche : types, style, cœur 2 667 tests, bureau 913 tests, construction réussie.

## 2. Ce qui est construit

| Demandé | Fait | Où |
| --- | --- | --- |
| a) Réseau local seulement, jeton | Adresse refusée si elle n'est pas dans la maison (même règle que le robot). Jeton en `Authorization: Bearer`. Le jeton est gardé **chiffré** par Windows dans le registre, jamais en clair ; sans chiffrement, il reste en mémoire et se redonne après un redémarrage. Il n'est jamais renvoyé à la fenêtre. | `packages/core/src/appendices/contract.ts`, `apps/desktop/src/main/appendices/client.ts`, `service.ts` |
| b) Présentation, état, résultat clair | L'appendice se présente (genre, nom, pièce, version, risque, capacités) ; une autre version du contrat est refusée. L'état se relit sur demande. **« Terminé » n'est dit que si l'appendice joint une mesure** ; sinon Jarvis dit qu'il ne peut pas dire que c'est fait. Bloqué, refusé, interrompu sont dits tels quels. | `contract.ts` (`parseAppendiceHello`, `describeAppendiceAction`) |
| c) « Stop » et arrêt d'urgence avant tout | L'arrêt et l'arrêt d'urgence n'attendent ni carte ni modèle, et partent sans exiger le jeton. Un tour annulé, un délai dépassé ou un lien coupé pendant une action envoient un stop avant de rendre la main. L'arrêt d'urgence est relu sur l'appendice ; le relâcher demande une carte et le jeton. Un appendice muet renvoie au bouton physique. | `client.ts`, `service.ts`, `tools/appendices.ts` |
| d) Un registre, comme les enceintes | `appendices.json` dans le dossier de Jarvis Test, hors de `settings.json`, écrit par l'écriture sûre. 20 appendices au plus. Écran Réglages → Appendices : interrupteur, relier (adresse et jeton), retirer, relire l'état, « Tout arrêter ». | `main/appendices/store.ts`, `components/AppendicesSettings.tsx` |
| e) Un faux appendice | `node apps/desktop/scripts/fake-appendice.mjs` : un petit serveur qui suit le contrat, en simulation (rien ne bouge). Il affiche son adresse et son jeton. Les tests utilisent le même. | `apps/desktop/scripts/fake-appendice.mjs` |
| f) « Jarvis, arrête tout » | Reconnue par des règles, avant le briefing, les notes, le chef d'orchestre et tout modèle. Envoie stop à chaque appendice inscrit **et au robot** s'il est réglé, en parallèle. Répond qui a reçu l'arrêt et nomme celui qui n'a pas répondu. Passe par un outil, donc par le journal d'audit. Fenêtre, téléphone et enceinte ont le même chemin. | `core/appendices/stopAll.ts`, `main/session.ts`, `main/index.ts` |

Cinq outils, en fin de catalogue, proposés seulement si le registre est activé et qu'un appendice est relié : `appendices_etat`, `appendice_action`, `appendices_stop`, `appendice_arret_urgence`, `appendice_relacher_urgence`. Avec le chef d'orchestre, seule l'équipe PC les reçoit.

## 3. Réglé sur le plus prudent

Les décisions sur les lumières, le chauffage, les caméras, le bouton « Oui » et les alertes ne sont pas prises. Donc :

- **Chaque action d'un appendice demande une carte**, quel que soit son niveau de risque (même « lire » ou « allumer une lampe »). Aucun réglage ne retire cette carte.
- **Seuls l'arrêt et l'arrêt d'urgence agissent tout de suite.**
- Depuis une enceinte, une carte est refusée d'office (règle qui existait déjà) : une enceinte peut arrêter, jamais lancer.
- Aucune boucle en fond : Jarvis ne contacte un appendice que sur demande. Aucun port n'est ouvert.
- Cette prudence tient en un seul endroit, `APPENDICE_POLICY` (`contract.ts`). Le jour où une décision est prise, c'est là qu'elle s'écrit.

## 4. Ce qui ne change pas

- **Jarvis Live** : la table des éditions ne lui donne pas le champ `appendices`. Pas d'outil, pas de fichier, pas de phrase reconnue, pas de section dans les réglages. Aucun changement de code sur `main`.
- `parseSettings({})` ne gagne aucune clé (testé).
- Sans appendice relié, le catalogue vu par le modèle est exactement celui d'avant, profils complet et modeste (testé).
- Aucun `__golden__` régénéré ; `chat-unchanged`, `ollama-unchanged`, `orchestra-session`, `machineProfile` et `profiles/jarvis` passent tels quels.

## 5. Essais sans matériel

51 tests nouveaux, tous avec le faux appendice ou des règles pures :

- `packages/core/src/appendices/appendices.test.ts` (17) : présentation, adresse, accord, résultat, « arrête tout » (11 phrases reconnues, 10 refusées), éditions, réglages.
- `apps/desktop/src/main/appendices/appendices.test.ts` (24) : registre coupé par défaut, hors de Test, jeton jamais en clair sur le disque, mauvais jeton, autre contrat, adresse d'Internet, redémarrage avec et sans chiffrement, « terminé » sans mesure, bloqué, capacité inconnue, tour annulé au milieu d'une action, appendice trop lent, lien coupé, arrêt d'urgence, « arrête tout » avec un appendice muet, cartes des outils.
- `apps/desktop/src/main/appendices-session.test.ts` (10, les deux profils comptés) : « arrête tout » dans la vraie session sans aucun appel de modèle, phrase voisine non prise, rien à arrêter, Jarvis Live, catalogue inchangé.

## 6. Ce qui n'est pas fait

- **Le pont pour les appendices qui appellent Jarvis** (capteurs, boutons). Son port est réservé dans la table des éditions (base + 8, soit 53232 pour Test) mais rien ne l'ouvre. Il arrivera avec le premier capteur.
- **La ligne par appendice dans le bilan de santé** et l'annonce sur le réseau : prévues par le cahier, pas dans cette étape.
- **L'imprimante dans « arrête tout »** : seul le robot est branché en plus des appendices. Mettre l'impression en pause toucherait au code de l'imprimante ; à décider.
- **Rien n'a été essayé dans la fenêtre ni à la voix.** L'installateur de Test n'a pas été reconstruit (interdit cette nuit). En particulier, je n'ai pas vérifié que « arrête tout » dit à voix haute arrive bien jusqu'à la session (la fenêtre et l'enceinte filtrent déjà certains « stop » avant).
- Le défaut bloquant trouvé le 18 au soir (l'équipe PC n'appelle plus ses outils dans Test, `rapports/2026-11-18-jarvis-test-essais.md`) est toujours là. Les outils des appendices sont dans l'équipe PC : ils en souffriront tant qu'il n'est pas corrigé.

## 7. Pour l'essayer (quand Test sera reconstruit)

1. Dans un terminal : `node apps/desktop/scripts/fake-appendice.mjs`. Noter l'adresse et le jeton affichés.
2. Jarvis Test, Réglages → Appendices : activer, coller l'adresse et le jeton, « Relier ». Le faux bras apparaît, « Prêt ».
3. Écrire « Demande au faux bras de saisir » : une carte s'affiche ; refuser, rien ne part ; accepter, « terminé » avec sa mesure.
4. Écrire « Jarvis, arrête tout » : réponse immédiate, « Arrêt envoyé : Faux bras (établi). »
5. Arrêter le faux appendice (Ctrl+C), puis « arrête tout » : Jarvis dit qu'il ne répond pas et renvoie au bouton d'arrêt d'urgence.

## RAPPORT DE VÉRIFICATION

```
RAPPORT DE VÉRIFICATION
Lancement (npm run build) : FAIT par npx electron-vite build (réussi)
Types (npm run typecheck) : OK
Style (npm run lint) : OK
Tests (npm test) : cœur 233 fichiers, 2 667 tests ; bureau 174 fichiers, 913 tests réussis, 8 ignorés
Secrets : aucun ; le jeton du faux appendice est tiré au hasard à chaque lancement
Relecture : faite ; aucun __golden__ modifié
Testé en vrai (à la voix, sur le PC) : PAS FAIT
Reste à vérifier : la fenêtre des réglages, « arrête tout » à la voix, le conflit de fusion de la section 1
```
