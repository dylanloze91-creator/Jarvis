# Cause des deux défauts d'outils en discussion neuve (19 novembre 2026)

Branche `claude/outils-pc-discussion-neuve`, partie de `claude/dev`. Recherche seulement : **rien n'est corrigé, Live n'est pas touché, rien sur `main`, rien de publié.** Seul le banc a changé (deux options de plus). Suite de `rapports/2026-11-19-correction-outils-pc.md`.

## 1. Live 5.0.79 : « Quelle fenêtre est active ? » ratée 10 fois sur 10

**Cause : un souvenir de la mémoire apprise de Live, rappelé à tort dans les consignes.** C'est une phrase dictée un jour à Jarvis, qui commençait par « non ». Elle n'était pas une règle, mais Jarvis l'a rangée comme « correction validée ». Depuis, elle est ajoutée aux consignes de l'équipe chaque fois qu'une demande lui ressemble, sous l'en-tête « Règles déjà validées… Applique-les… sans appeler un outil de mémoire ». Le modèle n'appelle alors plus aucun outil et invente la fenêtre active.

### La preuve

Live 5.0.79 (vrai code de l'étiquette `v5.0.79`), « Quelle fenêtre est active ? » en première phrase d'une discussion neuve, bon outil appelé :

| Cas | Résultat |
| --- | --- |
| Personnalisation de Live seule | 5 sur 5 |
| Mémoire apprise de Live seule | 0 sur 5, puis 0 sur 10 |
| Mémoire apprise de Live, ce seul souvenir retiré de la copie | **10 sur 10** |

Les réponses ratées citent des fenêtres inventées, différentes à chaque fois.

### Les trois maillons, dans le code (`packages/core/src/learning/continuous.ts`)

1. **Le classement est trop large.** `CORRECTION` prend toute phrase qui commence par « non, » ou « non » suivi d'une espace pour une correction, et elle est enregistrée « validée », confiance 0,9, sans rien demander. Une réponse ordinaire à une question de Jarvis (« non, pas pour le moment… ») devient une règle.
2. **Le rappel compte les petits mots.** `relevantRecords` rappelle un souvenir dès que 20 % des mots de la demande s'y trouvent, et « est » ou « quelle » comptent comme des mots. « Quelle fenêtre est active ? » partage deux mots sur quatre avec ce souvenir. Presque toute question avec « est » le rappelle : il a déjà été rappelé 32 fois.
3. **L'en-tête pousse à ne pas appeler d'outil.** « Applique-les… sans appeler un outil de mémoire pour les relire » : avec une fausse règle dessous, le petit modèle retient « sans appeler un outil ».

### Ce que cela touche

- Live et Test ont le même code. La mémoire de Live porte 2 corrections validées de ce genre ; celle de Test en porte une (une phrase de correction des essais du 18), rappelée elle aussi pour « Quelle fenêtre est active ? ». Dans Test elle gêne moins : 10 sur 10 et 8 sur 10 dans la série A du 19.
- Seules les demandes qui partagent des mots avec le souvenir sont touchées. « Donne-moi les informations sur mon PC » et « Ouvre le Bloc-notes » ne rappellent rien.

### Pour s'en débarrasser tout de suite, sans changer le code

Dans Jarvis Live : Réglages → Moi → « Ce que Jarvis sait de moi », effacer ce souvenir. Je ne l'ai pas fait : je n'ai lu les données de Live que par une copie temporaire.

### Corrections possibles (à décider, non faites)

- Ne plus enregistrer comme règle une phrase qui commence seulement par « non » : exiger une vraie correction (« non, c'est X », « pas ça », « plutôt… ») ou ne la valider qu'après accord.
- Ne pas compter les petits mots (« est », « quelle », « les », « pour »…) dans le rappel, et monter le seuil.
- Réécrire l'en-tête pour qu'il ne parle plus de ne pas appeler d'outil.

Ces trois changements touchent le chat de Live : ils demandent ta décision, et un passage par Test d'abord.

## 2. Jarvis Test : « Donne-moi les informations sur mon PC » en discussion neuve, 8 à 9 sur 10

**Ce n'est pas un défaut de Jarvis Test.** Rejouée 30 fois de chaque côté, avec la même personnalisation du banc et aucune mémoire apprise :

| Édition | Bon outil appelé |
| --- | --- |
| Jarvis Test (`claude/dev`, après la correction) | 25 sur 30 |
| Live 5.0.79 | 28 sur 30 |

L'écart de 3 sur 30 n'est pas significatif : sur 10 essais, Live avait donné 10 puis 9, Test 8, 9 et 8. Les deux éditions ratent de la même façon :

- le modèle invente une fiche du PC (système, processeur, mémoire, disque) sans appeler `get_system_info` ;
- ou il demande de préciser quelles informations on veut.

**Cause : `qwen2.5:7b` lui-même, sur une demande vague en première phrase.** Dans une discussion déjà commencée, la même phrase a donné 30 sur 30 après la correction.

### Corrections possibles (à décider, non faites)

- Une règle express sans modèle, comme pour l'horloge : « les informations sur mon PC » appelle `get_system_info` directement. C'est le plus sûr ; la règle demande ses phrases pour et contre (`expressRules.ts`).
- Ou une ligne de plus dans la consigne de l'équipe PC (« pour toute question sur l'état du PC, appelle l'outil, n'écris jamais une fiche de mémoire »), à repasser au banc.

## 3. Ce qui a changé dans le dépôt

`apps/desktop/src/main/vitesse/banc-outils-pc.banc.ts`, deux options :

- `JARVIS_BANC_SEULEMENT=fenetre-neuve,…` : ne rejouer que ces demandes en discussion neuve ;
- `JARVIS_BANC_SANS_SOUVENIR=<id>,…` : avec `JARVIS_BANC_DONNEES`, retirer ces souvenirs de la copie temporaire.

Aucune phrase de l'utilisateur n'est dans le dépôt : le souvenir en cause n'est cité nulle part, ni son texte ni son identifiant.

## RAPPORT DE VÉRIFICATION

```
RAPPORT DE VÉRIFICATION
Lancement : OK (banc des outils du PC passé sur le vrai Ollama, dans Test et dans Live 5.0.79)
Types     : OK (npm run typecheck)
Style     : OK (npm run lint)
Tests     : NON RELANCÉS (seul un fichier de banc, hors de npm test, a changé ; suites complètes vertes plus tôt ce soir sur claude/dev)
Secrets   : OK (aucune clé, aucune phrase de l'utilisateur, aucun identifiant de souvenir)
Fichiers modifiés : banc-outils-pc.banc.ts, AGENTS-COORDINATION.md, ce rapport
Prêt à fusionner : OUI dans claude/dev (banc et rapport seulement) ; rien pour main
À corriger : les deux causes ci-dessus, sur ta décision
Testé en vrai (à la voix, sur le PC) : PAS FAIT (banc sans fenêtre ni voix)
```
