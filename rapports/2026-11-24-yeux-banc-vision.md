# Yeux, point 5 : premier banc des modèles de vision (24 novembre 2026, nuit)

Chiffres seulement. Les photos restent sur le PC (`C:\dev\jarvis-data\yeux\photos-test\`), jamais dans le dépôt. Résultat brut : `C:\dev\jarvis-data\yeux\banc\banc-2026-11-24T01-21-33-084Z.json`.

## Conditions

- 20 photos prises par la caméra de Klipper, une toutes les 10 minutes de 23 h 07 à 2 h 18 (GET seulement, aucune commande envoyée à l'imprimante).
- **Une seule classe** : `en-cours-ok`. Pas encore de `ratee`, `plateau-vide` ni `plateau-occupe` (l'utilisateur les ajoutera).
- **L'impression était en pause** à 98,8 % (fin de filament) pendant toute la prise : les 20 images sont presque identiques.
- Photos de nuit, sombres.
- RTX 2060 6 Go, réservée dans `AGENTS-COORDINATION.md` pendant le banc. Modèles déjà chargés déchargés avant, rechargés après (`qwen2.5:7b`).
- Deux questions par photo :
  - « marche » : réponse attendue OK ;
  - « vide » : réponse attendue NON, puisqu'une pièce est sur le plateau.

## Résultats

| Modèle | « marche » justes | fausses alertes | « vide » justes | illisibles | durée médiane | première réponse (chargement) | mémoire carte | part sur la carte |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| qwen2.5vl:3b | 1 / 20 | 19 | 0 / 20 | 0 | 1,5 s | 18,9 s | 2,76 Go | 100 % |
| gemma3:4b | 0 / 20 | 20 | 20 / 20 | 0 | 1,4 s | 18,6 s | 2,88 Go | 100 % |

Aucune erreur, aucune réponse illisible.

## Lecture

- **« Plateau vide »** : gemma3:4b voit la pièce sur les 20 photos, même dans le noir. qwen2.5vl:3b répond « vide » sur les 20.
- **« Ça marche ? »** : les deux modèles disent « PROBLEME » presque à chaque fois.
  - Ce n'est pas forcément faux : l'impression était vraiment en pause.
  - Les raisons données ne tiennent pas, par exemple « impression obstruée », « qualité de l'image mauvaise ».
  - Cette question ne peut pas être jugée sur ces photos. Il faut des photos d'une impression qui avance, de jour, et de vraies impressions ratées.
- **Vitesse** : les deux tiennent entièrement sur la carte (moins de 3 Go). Comptez environ 19 s pour charger le modèle, puis 1,5 s par photo.

## Suite

- Ajouter les photos de l'utilisateur (`plateau-vide`, `ratee`), puis prendre une série pendant une impression qui avance, de jour. Repasser ensuite le banc.
- Aucun modèle n'est choisi.
