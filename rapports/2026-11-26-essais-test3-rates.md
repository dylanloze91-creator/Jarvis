# Essais de Jarvis Test 5.1.0-test.3 du 25 novembre au soir : ce qui a raté

Pour l'utilisateur, et pour l'agent Atelier et l'agent Yeux. Branche `claude/dev`. **Rien de publié. Le Jarvis Test installé n'a pas été touché** : son journal (conversation, journal des tours, carnet des ratés, journal d'audit) a été lu seulement, et les phrases ont été rejouées dans une copie d'essai (réglages copiés dans un dossier temporaire, atelier dans un dossier temporaire, Forge jamais lancé).

## Ce que dit le journal

Une seule discussion ce soir, dans la fenêtre, tapée au clavier, entre 23 h 05 et 23 h 08 (heure de Paris). Trois phrases, trois ratés. Aucun tour par le téléphone, par l'enceinte ni avec une photo.

| # | Phrase exacte | Chemin | Durée | Ce qui s'est passé |
| --- | --- | --- | --- | --- |
| 1 | « je veux un boitier pour mon esp32 S3 avec de la place pour un ecran 5 pouce et et un micro et des haut parleur » | atelier (règles, sans modèle) | 92,7 s avant le premier mot | longue liste de cotes trouvées sur Internet, dont des cotes fausses ; écran, micro et haut-parleurs oubliés ; question « mesure 5 sur 5 » |
| 2 | « daccord dessinne tout ca pour moi » | cerveau → équipe Images (`qwen2.5:7b`) | 16,8 s | `generer_image` appelé (une image 2D, pas une pièce 3D), puis annulé au bout de 11 s : « Démarrage de Forge annulé » |
| 3 | « modelise » | cerveau → équipe Images (`qwen2.5:7b`) | 3,8 s | réponse « Je suis désolé, mais l'outil de géné… », arrêtée par l'utilisateur, pouce baissé |

L'annulation de l'image (phrase 2) n'est pas un défaut à part : la phrase 3 est partie dans la même discussion une seconde plus tard, et un nouveau message arrête le tour en cours (même comportement que tout message, noté dans `rapports/2026-11-24-nuit-volume-image-playlists.md`, point 4, décision de l'utilisateur en attente). Le vrai raté est que la phrase 2 soit allée aux images.

## Rejeu dans une copie d'essai

Banc ajouté : `npm run banc:rejeu --workspace @jarvis/desktop` (`apps/desktop/src/main/vitesse/rejeu-discussion.banc.ts`). Il prend un fichier de phrases **hors du dépôt** (`JARVIS_REJEU=C:\dev\jarvis-data\essais\2026-11-25-test3.json`), la vraie session de Jarvis Test, le vrai Ollama, le vrai atelier et la vraie recherche web, sur une copie des réglages de Jarvis Test. `generer_image` y est remplacé par « non générée ».

| Version | Phrase 1 | Phrase 2 | Phrase 3 |
| --- | --- | --- | --- |
| `claude/dev` (= Jarvis Test installé) | atelier, 97,6 s, mêmes défauts | équipe Conversation : « Je ne peux pas dessiner directement… », cotes inventées (boîtier de « 82,7 cm ») | équipe Code : « je ne peux pas créer un modèle 3D directement… », mode d'emploi de Fusion 360 |
| `claude/dev` + dernier commit de l'atelier (`680b350`, examen du hub, pas encore fusionné) | atelier, 72,6 s, mêmes défauts | Conversation : « Je ne peux pas dessiner directement… prends un papier et un crayon » | Code : « je ne peux pas créer de modèle 3D », mode d'emploi de FreeCAD |

Le cerveau choisit tantôt Images, tantôt Conversation ou Code : aucune de ces équipes ne peut faire la pièce, et aucune ne sait que l'atelier existe.

## Ce qui vient de la fusion ou de la version installée

**Rien dans les trois phrases.** Le code de l'atelier dans `claude/dev` est celui de `claude/atelier-boitiers` au moment de la fusion, et le rejeu sur l'atelier seul (avec en plus son dernier commit) donne les mêmes ratés. Les yeux ne s'activent que sur une photo jointe ou depuis le téléphone (`regarderTour`) : ils n'ont pas touché à ces tours.

Un défaut vient bien de la version installée, et il est corrigé :

- **L'installateur de Jarvis Test restait bloqué** (plus de 10 minutes ce soir, avant que j'arrête la commande à la main) sur sa propre fermeture de Jarvis Test (`scripts/installer-test.nsh`). Cause, reproduite : sur ce PC, `taskkill` avec le filtre `USERNAME eq …` ne finit pas, même sans rien à fermer (plus de 60 s, arrêté) ; sans le filtre, 1,8 s. Correction : filtre retiré (sans droits d'administrateur, taskkill ne ferme de toute façon que les processus de l'utilisateur ; Jarvis Live s'appelle `Jarvis.exe` et n'est pas visé), attente bornée à 20 s (`nsExec::Exec /TIMEOUT=20000`). Test `packageTestConfig.test.ts` complété. Installateur d'essai construit dans un dossier à part pour vérifier qu'il se compile, puis effacé ; **pas lancé** (il aurait fermé le Jarvis Test installé). Prendra effet au prochain installateur de Jarvis Test.

## Pour l'agent Atelier

Tout se passe dans `packages/core/src/atelier/discussion.ts` (`deciderAtelier`, `dernierAtelier`, `DEMANDE`) et dans la recherche des cotes (`apps/desktop/src/main/atelier/chercherCotes.ts`). Phrases exactes de l'utilisateur ci-dessus ; à rejouer avec `npm run banc:rejeu`.

1. **Phrase 1, cotes fausses acceptées.** Pour « esp32 S3 », la recherche a gardé une hauteur au-dessus de la carte de 53,7 mm et un écart entre les trous dans la largeur de 4,6 mm (marathon-os.com), une largeur de 23,7 mm à 28 mm. Aucune vraisemblance n'est contrôlée.
2. **Phrase 1, mauvaise carte.** La phrase dit « mon esp32 S3 » ; l'atelier a pris `esp32_s3_devkitc_1_borniers` (la carte sur bornier à vis), sans demander laquelle, puis a cherché sur Internet les cotes de la DevKitC nue (25 mm de large). L'utilisateur avait déjà mesuré cette carte sur bornier : 73 × 83 mm (`C:\dev\jarvis-data\atelier\composants-mesures.json`). La réponse annonce pourtant « longueur 62,87 mm, une seule source » et « largeur : les sources ne concordent pas » : soit les mesures de l'utilisateur ne passent pas avant, soit la réponse ne le dit pas. À vérifier.
3. **Phrase 1, réponse qui se contredit.** « 4 cotes sur 5 trouvées » puis une liste de 6 cotes ; « Trous de fixation pas trouvés » puis deux écarts entre les trous.
4. **Phrase 1, écran 5 pouces, micro et haut-parleurs oubliés sans le dire.** Ils ne sont pas dans la bibliothèque ; la réponse n'en parle pas.
5. **Phrase 1, 93 s avant le premier mot**, tout dans la recherche des cotes ; la réponse fait plus de 1 500 caractères et a été lue à voix haute en entier (la voix de la fenêtre est activée dans les réglages de l'utilisateur).
6. **Phrase 2, « daccord dessinne tout ca pour moi » sort de l'atelier.** L'atelier attendait une mesure (`etape: 'mesure'`, champ `hauteur_dessous`). Ce n'est ni un nombre, ni « prends large », ni un lien : « la phrase suit son chemin », et `DEMANDE` n'accepte « dessine » que suivi d'un article (« dessine-moi un… ») et sans faute de frappe (« dessinne »). L'utilisateur voulait dire « fais-la avec ce que tu as ». À décider : un ordre de dessiner pendant une mesure (« dessine », « modélise », « vas-y », « fais-le », « d'accord ») devrait-il valoir « prends large partout » en le disant, ou reposer la question avec cette possibilité ?
7. **Phrase 3, « modelise » seul.** La question de l'atelier ne compte que si c'est la dernière réponse de Jarvis (`dernierAtelier`, `premiere`) : après le tour des images, elle est perdue. Et « modelise » sans complément n'est pas une demande de pièce.
8. **Commun aux phrases 2 et 3 : les équipes ne savent pas que l'atelier existe.** Sorties de l'atelier, ces phrases vont au cerveau, qui choisit Images, Conversation ou Code ; le modèle répond « je ne peux pas dessiner / modéliser » et invente des cotes. Une règle avant le cerveau (« dessine / modélise / fais en 3D » quand une pièce ou une question de l'atelier est dans la discussion récente) ou une ligne dans les consignes de ces équipes est à décider par l'agent Atelier : `session.ts` et le chef d'orchestre sont communs, rien n'y a été changé cette nuit.

## Pour l'agent Yeux

Rien ce soir : aucun tour avec une photo, ni depuis le téléphone ou l'enceinte. Les yeux n'ont joué dans aucun des trois ratés. Les trois derniers commits de `claude/yeux-etape-1` (`7c0715d` et la coordination) ne sont pas dans `claude/dev`.

## Reste à décider par l'utilisateur

- Un nouveau message dans la même discussion arrête l'image en cours (déjà noté le 24 novembre, point 4).
- La voix de la fenêtre lit les longues réponses de l'atelier en entier (93 s de texte lu). Réglage de l'utilisateur, non modifié.
- Le Jarvis Test de l'atelier (`electron-vite dev`) avait été relancé à 20 h 31 et occupait le port 53140 du téléphone ; il n'était plus lancé cette nuit.

## RAPPORT DE VÉRIFICATION

```
RAPPORT DE VÉRIFICATION
Lancement : OK (npm run build du cœur ; installateur de Jarvis Test d'essai construit dans un dossier à part puis effacé)
Types     : OK (npm run typecheck)
Style     : OK (npm run lint)
Tests     : packageTestConfig.test.ts vert ; banc de rejeu passé deux fois (claude/dev, puis claude/dev + 680b350 dans une branche locale effacée) ; aucun __golden__ régénéré
Secrets   : OK (aucune clé ; les phrases de l'utilisateur restent hors du dépôt, sauf dans ce rapport, à sa demande)
Fichiers  : apps/desktop/scripts/installer-test.nsh, apps/desktop/src/main/packageTestConfig.test.ts, apps/desktop/src/main/vitesse/rejeu-discussion.banc.ts, apps/desktop/package.json (banc:rejeu)
Prêt à fusionner : OUI dans claude/dev (déjà dessus) ; jamais dans Live
Testé en vrai (à la voix, sur le PC) : PAS FAIT à la voix ; les trois phrases rejouées tapées dans une copie d'essai ; nouvel installateur non lancé (il fermerait le Jarvis Test installé)
```
