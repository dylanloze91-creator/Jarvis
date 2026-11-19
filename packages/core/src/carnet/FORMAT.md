# Carnet des ratés — format version 1

Stable pour qu'un futur outil d'entraînement puisse lire les entrées où l'utilisateur a écrit ce qu'il attendait. Cet outil n'existe pas encore. Rien ici n'est envoyé, et les fichiers décrits ne vont jamais dans le dépôt : ils vivent dans `userData/carnet/` sur le PC.

`version` vaut toujours `1`. Un lecteur ignore une ligne dont la version n'est pas `1`.

## `rates.jsonl`

Une entrée JSON par ligne.

| Champ            | Sens                                                                                             |
| ---------------- | ------------------------------------------------------------------------------------------------ |
| `version`        | `1`                                                                                              |
| `id`             | Identifiant unique                                                                               |
| `date`           | Date ISO 8601                                                                                    |
| `edition`        | `live` ou `test`                                                                                 |
| `source`         | `{ "kind": "fenetre" }`, `{ "kind": "enceinte", "name": "…" }`, ou `{ "kind": "telephone" }`     |
| `type`           | `correction`, `repetition`, `interruption`, `outil_echec`, `lenteur`, `chemin`, `signale`        |
| `rule`           | Identifiant de la règle (voir plus bas)                                                          |
| `userText`       | Phrase de l'utilisateur, secrets masqués                                                         |
| `replyStart`     | Début de la réponse de Jarvis, 300 caractères au plus, secrets masqués                           |
| `team`           | Équipe, ou `null`                                                                                |
| `model`          | Modèle, ou `null`                                                                                |
| `how`            | `calcul`, `express`, `cerveau`, `trieur`, `chemin-avant`, `mission-directe`, `direct`, ou `null` |
| `tools`          | `{ "name", "result" }[]`, une ligne par outil                                                    |
| `durations`      | Durées en millisecondes, par étape, quand elles existent                                         |
| `conversationId` | Discussion                                                                                       |
| `reviewed`       | `true` si l'utilisateur a classé l'entrée ou écrit ce qu'il attendait                            |
| `expected`       | Ce qu'il attendait, facultatif                                                                   |
| `category`       | `regle`, `bogue`, `modele`, `materiel`, `pas-grave`, facultatif                                  |

Plafond : 5 000 lignes. Au-delà, les plus anciennes déjà revues partent en premier. S'il n'y en a pas assez, les plus anciennes tout court.

Les secrets passent par `redactSecrets` avant l'écriture.

## `reglages.json`

Pas une clé de `parseSettings`.

```json
{ "version": 1, "enabled": true, "fenetrePremierMotMs": 10000, "enceintePremierSonMs": 6000 }
```

Absent : actif si l'édition est Test, coupé si l'édition est Live. Seuils : 10 s avant le premier mot (fenêtre et téléphone), 6 s entre la fin de la phrase et le premier son (enceinte).

## `fausses-alertes.json`

`{ "version": 1, "counts": { "<rule>": 1 } }`. « Ce n'était pas un raté » retire la ligne de `rates.jsonl` et ajoute 1 au compteur de sa règle.

## Règles (`rule`)

| `rule`                      | `type`                                                                         |
| --------------------------- | ------------------------------------------------------------------------------ |
| `correction-classify`       | `classifyUtterance` n'est pas `one-off`, juste après une réponse               |
| `correction-je-t-ai-dit`    | « je t'ai dit… »                                                               |
| `repetition-70-3min`        | Mots communs ≥ 70 % dans les 3 minutes                                         |
| `interruption-stop`         | « stop » dans les 5 s après le début de la réponse                             |
| `interruption-tais-toi`     | « tais-toi », même fenêtre                                                     |
| `interruption-bouton`       | Bouton Arrêter, même fenêtre                                                   |
| `interruption-parole`       | Parole pendant la voix, même fenêtre                                           |
| `outil-erreur`              | Outil en erreur                                                                |
| `outil-delai`               | Délai dépassé                                                                  |
| `outil-verification-failed` | `verification_failed`                                                          |
| `outil-refus`               | Refus que l'utilisateur n'a pas choisi                                         |
| `lenteur-fenetre`           | Premier mot après le seuil (fenêtre ou téléphone)                              |
| `lenteur-enceinte`          | Premier son après le seuil                                                     |
| `chemin-illisible`          | Cerveau illisible, chemin d'avant                                              |
| `chemin-sans-outil`         | Équipe choisie sans l'outil qu'il fallait                                      |
| `signale-phrase`            | Phrase seule (« ça n'a pas marché », « ça marche pas », « ça a pas marché », « c'était nul », « tu t'es trompé », « tu t'es planté ») : « C'est noté. ». Plus longue avec « ça n'a pas marché » ou « tu t'es trompé » : signal sans remplacer la réponse. « Le film, c'était nul » n'est pas un signal. |
| `signale-pouce`             | 👎 sous une réponse                                                            |

Ne sont pas des ratés : « non, mais… » (nouvelle demande), « stop » adressé à Spotify, « encore une blague » (répétition voulue), lenteur pendant un téléchargement demandé, refus explicite de l'utilisateur sur une carte.
