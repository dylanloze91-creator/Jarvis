# Mode direct de Jarvis Imager — passer outre le cerveau

Date : 2026-11-10 (fin d'après-midi). Branche `claude/imager-mode-direct` (depuis `main` 5.0.73), **pas fusionnée**.

Demande de l'utilisateur (zip `imager_mode_direct_claude_code`, prompt en six étapes) : envoyer ses propres prompts tels quels à Forge, sans que le 7B les juge ni les modifie ; un panneau « Imager direct » ; la commande `/image` ; Imager qui complète la demande sans le 7B ; un repérage par règles avant le 7B ; le 7B qui aiguille sans réécrire.

Cursor avait ouvert `imager-mode-direct` et laissé deux brouillons (liste de déclencheurs, dictionnaire français → anglais) ; l'utilisateur m'a confié la suite. Le dictionnaire est gardé tel quel (`packages/core/src/images/localEnglish.ts`), la liste de déclencheurs est fondue dans `imager_rules.yaml` (section `direct`), et le fichier brouillon `config/imager_direct_rules.txt` est retiré.

## Ce qui est fait, étape par étape

| Étape du prompt | Fait | Où |
| --- | --- | --- |
| 1. Panneau « Imager direct » | consigne, négatif pré-rempli (projet + anatomie), modèle (fichiers de `models/Stable-diffusion`), LoRA (`models/Lora`) avec force, 7 tailles natives SDXL, nombre, graine, pas, CFG, échantillonneur, planificateur, ADetailer visages / mains, projet, « Générer », barre d'avancement (vrai avancement de Forge), aperçus, consigne finale, « Ouvrir » | `components/ImagerDirectPanel.tsx`, barre de gauche du tableau de bord et bouton de la fenêtre compacte (visibles si Jarvis Imager est activé) |
| 2. `/image` | `/image ta consigne` (ou `/img`) part à Imager sans aucun modèle ; projet déduit des mots (sinon perso) ; le tour est marqué `direct` et **jamais renvoyé au modèle**, ni à la mémoire, ni à l'apprentissage | `session.ts` (`directImageTurn`), `ChatMessage.direct`, `stripDirectTurns` |
| 2 bis. « Améliorer mon prompt » | coché par défaut (`direct.ameliorer`) : traduction par **dictionnaire local** (aucun modèle), type et nombre de personnes devinés par mots, règles d'Imager (qualité, style du projet, négatif d'anatomie, format du type, modèle selon le rendu, ADetailer). Rien n'est jugé ni filtré. La consigne finale est montrée dans la réponse, le panneau et le `.txt` | `ImagesService.generateDirect`, `buildImagerPrompt`, `toEnglishIfNeeded` |
| 2 ter. Repérage par règles | débuts de phrase (`direct.declencheurs`, modifiables) après « Jarvis, », « peux-tu »… ; « Imager, … » retire le mot ; projet déduit (« pour Driver's Ink », « miniature », « pour Jarvis ») | `detectDirectImageRequest`, `guessProject` |
| 2 quater. Le cerveau aiguille sans réécrire | `generer_image` n'a plus de prompt : paramètres `projet`, `photoDeBase`, `fidelite` ; la demande vient du message en cours, mot pour mot (`currentTurn`) ; description honnête ; si le cerveau répond sans Imager à ce qui ressemble à une image → bouton « Envoyer à Imager » | `tools/images.ts`, `noteUserTurn` (fenêtre, téléphone, enceinte), événement `imager_offer`, `Messages.tsx` |
| 3. Carte graphique | même ordre que d'habitude : décharger le 7B → Forge → image → libérer → **recharger, même en cas d'erreur** ; option « garder Forge chargé tant que le panneau est ouvert » (le 7B revient à la fermeture) | `generateDirect`, `setDirectPanelOpen`, réglage `images.directHoldForge` |
| 4. Rangement | `C:\dev\Jarvis_images\<projet>\<date>\` + `.txt` (« Mode direct … telle quelle / complétée par Imager ») ; option « perso : pas de .txt » ; rien ne sort du PC (Forge et Ollama en boucle locale, aucun appel réseau nouveau) | réglage `images.directNoTxtPerso` |

Ce qui n'est pas dans le mode direct : une **photo jointe** (image vers image) passe toujours par `generer_image` et l'ancien chemin (règles d'Imager, reformulation seulement si le réglage « Reformuler » est actif), parce que la photo doit être lue et recadrée ; l'enceinte et le téléphone ont `/image` et les règles, mais pas le panneau.

## Essai réel (vrai Forge, vrai Ollama, service réel)

Script `test-direct.ts` (bloc-notes de la session) : vraie `ImagesService`, vrai Ollama, vrai Forge, `fetch` espionné pour compter les appels `/api/chat`.

| Demande | Mode | Durée | Modèle | Appels au modèle de langage |
| --- | --- | --- | --- | --- |
| « a misty mountain lake at sunrise, pine trees, soft light » | telle quelle | 187 s (Forge démarré) | modèle courant de Forge (c'était Animagine, du tour précédent) → corrigé depuis : sans modèle choisi, celui d'Imager | **0** |
| « portrait d’une femme rousse qui sourit, lumière douce de fin de journée » | améliorée | 679 s (suites de tests en parallèle, Forge redémarré, première requête échouée puis réussie) | RealVisXL V5.0, retouche visages/mains | **0** |
| « une montre de plongée en acier sur un rocher mouillé, gros plan » | améliorée | arrêtée (carte graphique rendue à l'utilisateur pour son essai) | — | — |

Le 7B a été déchargé avant chaque image et rechargé après (`ollama ps` : `qwen2.5:7b`).

**Essai de l'utilisateur dans la fenêtre (version de développement, 17 h 49 à 17 h 56)** : trois demandes commençant par « génère une image… » parties en direct (route « Imager direct, sans modèle », journal d'audit `mode: direct`), 214 s, 214 s et 125 s ; bascule automatique sur Animagine pour « style de naruto manga anime ». Trois défauts vus et corrigés ensuite : le verbe de la demande restait dans la consigne (« génère image d'hInata… ») ; le dictionnaire ne connaissait pas la moitié des mots (nue, seins, caresser, « en train de », « vu de loin », « de face », « dans le style de », élisions « d'une ») ; le sujet était deviné « paysage » à cause de « plage » (pas de retouche du visage, format large). Et « pas mal mais en version anime manga » partait au cerveau, qui demandait des précisions : c'est maintenant une suite du tour direct (consigne précédente + changement), sans modèle. Ces quatre corrections sont testées (`direct.test.ts`, `direct-image-session.test.ts`) mais **pas rejouées en vrai** : l'utilisateur a demandé de clore le chantier images.

## Contrôles

| Vérification | Résultat |
| --- | --- |
| `npm run typecheck` | OK |
| `npm run lint` | OK |
| `npm test` (cœur) | 2288/2289 en suite complète pendant l'essai réel (un dépassement de délai : `learning/constraints.test.ts`, vrais processus node, 5 s) → délai explicite de 60 s ajouté, vert seul en 9 s |
| `npm test` (bureau, sans `windowsDesktopMissionPath.test.ts`) | 702/703 en suite complète pendant l'essai réel (un dépassement : `task/sandbox.test.ts`, vrai git, 5 s) → vert seul en 1,8 s, non modifié |
| Tests du mode direct | cœur `direct.test.ts` 11/11, `imagerRules.test.ts` (section `direct`) ; bureau `imagesService.test.ts` 17/17 (dont 5 directs), `direct-image-session.test.ts` 8/8, `tools/images-direct.test.ts` 3/3 ; `chat-unchanged.test.ts`, `orchestra-session.test.ts`, `catalog-images.test.ts` verts sans régénération |
| Secrets | 0 trouvé |

`release.sh` rejoue tout avant la publication.

## Pour l'utilisateur, en simple

- **Le panneau** : barre de gauche → « Imager direct » (visible quand Jarvis Imager est activé dans Réglages → Services). Écris ta consigne, choisis le modèle et les réglages, « Générer ». Case « Améliorer mon prompt » cochée : Imager ajoute la traduction, la qualité, le style du projet et les défauts à éviter, sans jamais juger ta demande ; décochée : ta consigne part mot pour mot.
- **Dans la discussion** : `/image un renard roux dans la neige`. Les phrases « Imager, … », « génère une image… », « dessine-moi… », « fais-moi une image… » y vont aussi toutes seules, sans le cerveau. Liste modifiable dans `C:\dev\Jarvis_images\imager_rules.yaml`, section `direct`.
- **Si le cerveau répond à côté** (il parle au lieu de faire l'image) : clique « Envoyer à Imager » sous sa réponse.
- **Réglages → Jarvis Imager** : « Garder Forge chargé tant que le panneau est ouvert » (pour enchaîner), « Projet perso : ne pas garder le fichier texte ».
- **Ce qui reste à faire** : tester le panneau dans la fenêtre (version de développement : `npm run dev`, ou après la prochaine publication) ; décider de la fusion dans `main` ; la photo jointe reste sur l'ancien chemin.

## RAPPORT DE VÉRIFICATION

```
RAPPORT DE VÉRIFICATION
Lancement : OK (cœur construit, version de développement lancée deux fois pour l'essai de l'utilisateur)
Types     : OK (0 erreur)
Style     : OK (0 avertissement)
Tests     : OK (cœur et bureau verts ; deux dépassements de délai sous charge pendant l'essai réel, verts seuls ; windowsDesktopMissionPath.test.ts exclu depuis la 5.0.73)
Secrets   : OK (0 trouvé ; Forge et Ollama en boucle locale, aucun appel réseau nouveau)
Fichiers modifiés : packages/core/src/images (direct.ts, direct.test.ts, localEnglish.ts, imagerRules.ts, index.ts, storage.ts), types.ts, settings.ts, settingsMap/fields.ts, learning/constraints.test.ts ; apps/desktop/src/main (images/ImagesService.ts, images/ForgeClient.ts, tools/images.ts, tools/index.ts, session.ts, index.ts + tests), shared/ipc.ts, preload/index.ts, renderer (ImagerDirectPanel.tsx, ImagesSettings.tsx, Messages.tsx, useChat.ts, Dashboard.tsx, App.tsx, UnifiedJarvisChat.tsx, preview/bridge.ts) ; config/imager_rules.yaml ; docs/images-jarvis.md ; CLAUDE.md ; AGENTS-COORDINATION.md ; ce rapport
Prêt à fusionner : OUI (décision de l'utilisateur : clore le chantier images et finaliser)
À corriger : la traduction par dictionnaire reste limitée aux mots connus (un petit modèle local optionnel serait mieux) ; la photo jointe passe par l'ancien chemin ; les quatre corrections de 18 h ne sont pas rejouées en vrai
Testé en vrai (à la voix, sur le PC) : FAIT à l'écrit par l'utilisateur dans la version de développement (trois images en direct, règles, bascule anime) ; PAS FAIT pour le panneau après les corrections de 18 h, ni à la voix
```
