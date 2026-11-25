# Yeux, étape 2, point 1 : photo + question sur n'importe quel sujet (25 novembre 2026)

Cahier : `docs/specs/yeux-etape-2.md`, point 1. Branche `claude/yeux-etape-1`. Jarvis Test seulement, coupé par défaut (réglage `yeux.enabled`, sans défaut Zod). Pas de fusion, pas de publication.

## Ce qui change

**Dans la fenêtre**, tu joins une photo et tu poses ta question. Exemples : « c'est quoi ce composant ? », « mon câblage est bon ? ».

- La photo va aux yeux et reste en mémoire seulement, 30 minutes. Elle n'est ni écrite sur le disque ni envoyée au modèle du chat. L'historique garde seulement sa référence.
- Une demande d'image (« fais-en un sticker », « transforme-la en… ») reste à Jarvis Imager, comme avant.

**Sur l'iPhone**, tu fais « Montrer à Jarvis » puis tu poses la question, dans les 5 minutes. La photo sert une seule fois. « Montre-moi l'impression » reste à l'étape 1.

## Le chemin

1. **Regarder.** `gemma3:4b` décrit la photo, recopie le texte visible et donne une première réponse avec ses doutes. Avant, les modèles chargés sont déchargés, parce que le 7B et le modèle de vision ne tiennent pas ensemble sur la carte. Le modèle de vision repart dès qu'il a répondu.
2. **Chercher.** Les références lues sur la photo (au plus 2) partent sur le web, avec les mêmes outils et les mêmes contrôles que la recherche de cotes de l'atelier :
   - moteurs de recherche de Jarvis, avec repli ;
   - pages publiques lues avec les gardes de `fetch_page` (`guardUrl`, anti-robot), une page par site ;
   - le modèle du chat propose chaque fait avec la phrase exacte de la page ;
   - Jarvis retrouve cette phrase dans la page, sur une page qui nomme la référence, et retrouve dans la phrase chaque nombre du fait. Sinon, le fait est jeté.

   Le même fait trouvé sur deux sites compte comme confirmé. MAX98357 et MAX98357A comptent pour une seule référence. Les références de la question ne servent que si la photo n'en montre aucune.
3. **Répondre.** Le modèle du chat écrit la réponse et dit d'où vient chaque chose. Il ne donne le rôle d'une broche que si un fait vérifié le dit, sinon il écrit « rôle à vérifier dans la fiche ». S'il ne répond pas, la réponse est assemblée sans lui, avec seulement ce qui est sûr.
   - Une question de branchement ou de tension reçoit toujours le rappel « vérifie toi-même avant de mettre sous tension ».
   - La réponse cite ses sources et le modèle de vision utilisé.

## Fichiers

- `packages/core/src/yeux/regarder.ts` : la partie pure (consignes, lecture des réponses, références, vérification, recherche avec ses appels injectés). Tests dans `regarder.test.ts` (23 tests).
- `apps/desktop/src/main/yeux/regarder.ts` : les appels à Ollama et au web.
- `apps/desktop/src/main/yeux/yeuxPC.ts` : `garderPhotoJointe` et `regarder`, pour la photo jointe et celle de l'iPhone.
- `apps/desktop/src/main/session.ts` : le crochet `regarder`, placé avant le briefing et après « arrête tout ».
- `apps/desktop/src/main/yeux-regarder.test.ts` (9 tests) :
  - la vraie session : photo jointe, demande à Imager, yeux coupés, iPhone, photo trop ancienne ;
  - le regard contre un faux Ollama.
- `apps/desktop/src/main/yeux/regarder.banc.ts` : essai réel, `npm run banc:regarder --workspace @jarvis/desktop` (hors de `npm test`).
- Petits ajouts :
  - `OllamaControl.unload` ;
  - `guardUrl` exporté, le même changement que sur la branche de l'atelier ;
  - photo jointe affichée dans la discussion ;
  - note de l'iPhone : « pose ta question ».

## Essais réels

La carte graphique et Jarvis Test étaient réservés dans `AGENTS-COORDINATION.md` pendant les essais.

| Essai | Durée | Résultat |
| --- | --- | --- |
| Image de test fabriquée (carte violette, « MAX98357A », broches LRC, BCLK, DIN, GAIN, SD, GND, VIN), « c'est quoi ce composant ? je le branche comment sur mon ESP32 ? », banc | 141 s, puis 83 s | Référence lue juste. 3 pages lues, 8 faits vérifiés (ampli I2S, 4 Ω ou plus, LRC/BCLK/DIN). Après la consigne durcie : rôles des broches justes, alimentation « à vérifier dans la fiche », rappel de sécurité. |
| Même image, dans la fenêtre de Jarvis Test (instance de développement isolée) | 62 s | Photo affichée, réponse avec ses sources. Rien d'écrit sur le disque. Avant la consigne durcie, le 7B avait inventé des rôles (« GND pour le solénoïde », « SD pour le word select ») : c'est ce qui a fait durcir la consigne. |
| Vraie photo de la caméra de l'imprimante, de nuit, « qu'est-ce que tu vois ? », banc | 17 s | « Zone sombre et floue », aucun texte inventé, aucune recherche. |

Limites :

- **Une seule vraie photo** : celle de l'imprimante, de nuit. Il n'y a encore aucune vraie photo d'électronique sur le PC. Le test de lecture porte sur une image fabriquée, nette et sans reflet. Une vraie photo de puce sera plus difficile à lire.
- **Le passage par le web tient la vérification, pas toujours le sens.** Un fait peut être mal traduit tout en ayant sa phrase sur la page. Exemple : « 7uA pour une pile à une cellule » est sorti d'une phrase de pinoutdb.org.
- **La durée** vient surtout de la lecture des pages par le 7B : 15 à 20 s par page.

## qwen2.5vl:7b

- Il existe dans Ollama : `qwen2.5vl:7b`, qui est la version `q4_K_M`. Il existe aussi en `q8_0` (9,4 Go) et `fp16` (17 Go).
- Son fichier fait **6,0 Go**. Il ne tient pas entièrement sur la RTX 2060 (6 Go), qui doit aussi garder un peu de place pour l'écran et le contexte. Ollama mettrait une partie sur le processeur, ce qui le rendrait plus lent.
- **Il n'est pas téléchargé.** C'est à décider avec toi avant le banc du point 2.

## Rapport de vérification

- Types : `npm run typecheck` vert.
- Style : `npm run lint` vert.
- Tests : `npm test` vert (cœur 248 fichiers ; bureau 185 fichiers, 4 ignorés comme d'habitude).
- Secrets : aucun ajouté ; la photo n'est ni écrite ni journalisée.
- Testé en vrai, dans la fenêtre : FAIT. C'était dans l'instance de développement isolée de Jarvis Test, avec une image de test fabriquée ; aucune vraie photo d'électronique n'a été essayée.
- Testé en vrai, sur l'iPhone : PAS FAIT. Le téléphone est relié à Live ; le chemin est couvert par les tests de la vraie session.
- Testé à la voix : PAS FAIT (sans objet : pas de photo depuis une enceinte).
