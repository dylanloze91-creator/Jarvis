# Module images — Forge + SDXL en local (9 novembre 2026)

Branche `claude/module-images` (pas de fusion dans `main`, pas de publication). Mission : générer des images en local pour quatre usages (`jarvis`, `vx`, `drivers-ink`, `perso`), avec Forge et le modèle SDXL, le 7B de Jarvis déchargé puis rechargé autour de chaque image, et la préparation de l'entraînement LoRA sur carte louée.

## Étape 1 — Forge installé hors du dépôt

- **Choix : Forge Classic** (fork Haoming02, branche `classic`, dernier commit 2026-04-22). Le dépôt d'origine de lllyasviel n'a plus de commit depuis le 2025-06-26 et son tableau d'état date d'août 2024 : il marche encore, mais il est abandonné. La branche `classic` est faite pour SD1 et SDXL seulement, légère, avec la même API que l'interface AUTOMATIC1111 (`/sdapi/v1/*`). La branche `neo` (commit du 2026-11-06) est expérimentale et écartée.
- `C:\dev\Forge` : clone, environnement Python 3.11 privé (`venv`, créé avec `uv`, car Forge exige 3.11 et le PC n'a que 3.13 et 3.14), PyTorch 2.10 **cu128** (le pilote NVIDIA 572.16 s'arrête à CUDA 12.8 ; la version cu130 par défaut n'aurait pas démarré), pas de xformers (aucune roue cu128 pour Python 3.11 ; Forge utilise l'attention de PyTorch).
- `webui-user.bat` : `--api --port 7860 --no-download-sd-model` (boucle locale seulement, pas de `--listen`). `lancer_forge.bat` : le raccourci demandé. Les deux appellent leurs fichiers par chemin complet (`%~dp0`) et sont en fins de ligne Windows.
- Modèles téléchargés : `models\Stable-diffusion\sd_xl_base_1.0.safetensors` (stabilityai, officiel, 6,94 Go) et `models\VAE\sdxl_vae_fp16_fix.safetensors` (0,33 Go, contre les images noires en demi-précision sur RTX 2060).
- Premier lancement : 15 minutes (PyTorch 2,87 Go puis les dépendances), puis `Running on local URL: http://127.0.0.1:7860`. Lancements suivants : 30 à 60 s.
- **Image de test** : « un chat sur un toit, photo », 1024×1024, 28 pas, 56 s chargement du modèle compris, rendu photo net. Fichier : `C:\dev\Jarvis_images\test\2026-11-09\212139-un-chat-sur-un-toit-photo-1.png` (graine 3266582468, `.txt` à côté).

## Étape 2 — module `images` dans Jarvis

- Réglage `settings.images` (`enabled`, `forgeDir`, `forgeUrl`, `outputRoot`, `keepForgeRunning`), facultatif, sans défaut Zod. Coupé : catalogue, équipes et prompts d'avant (`catalog-images.test.ts`, `chat-unchanged.test.ts` verts sans régénération).
- Outils `generer_image` (prompt, projet, nombre 1 à 4, format, style, LoRA et poids, graine, négatif) et `images_etat`, `safe`, en fin de catalogue. Sans orchestre : proposés seulement sur un tour qui parle d'image ou son suivi. Avec orchestre : équipe **Images**, règle express (« génère une image… », « dessine-moi… ») sans passer par le cerveau.
- `ImagesService.generate` : prévenir (« Je génère ton image : je décharge le modèle de langage, je reviens dans une minute ou deux… ») → décharger tous les modèles Ollama (`keep_alive: 0`) → Forge prêt (lancé par Jarvis s'il est éteint, 4 min au plus) → `txt2img` → PNG + `.txt` (+ `-nb.png` pour drivers-ink) dans `C:\dev\Jarvis_images\<projet>\<AAAA-MM-JJ>\` → libérer Forge (arrêt s'il a été lancé par Jarvis, sinon déchargement de son modèle) → **recharger le modèle de langage, même en cas d'erreur** (cerveau de l'orchestre, sinon celui qui tournait, sinon `settings.model`). Forge injoignable : message français, modèle rechargé.
- Réglages → Services → Images (interrupteur, dossiers, adresse, « Tester Forge »).

## Étape 3 — réglages par projet

`config/images_presets.yaml` (copie de référence) et `C:\dev\Jarvis_images\images_presets.yaml` (copie vivante, créée au premier usage, relue à chaque image). drivers-ink : fond blanc uni, contours nets, peu de couleurs, version noir et blanc, prompt négatif sans logos de marques, texte ni visages de vraies personnes. vx : 16:9 et 9:16. jarvis et perso : libres.

## Étape 4 — LoRA sur carte louée

`training/lora/` : `preparer_images.py` (15 à 40 images → 1024 px, `jeux/<nom>/20_<declencheur>/`, descriptions avec le déclencheur), `config_sdxl_lora_24go.toml` (kohya sd-scripts, 24 Go), `GUIDE_ENTRAINEMENT.md` (RunPod et Vast.ai pas à pas, 1 à 3 € par entraînement, étape « éteindre et supprimer la machine »), `requirements.txt`. Le `.safetensors` va dans `C:\dev\Forge\models\Lora\` et s'utilise par `generer_image` (option LoRA). Rien n'a été entraîné.

## Étape 5 — vérification de bout en bout

Script de test hors dépôt : la vraie `ChatSession` de Jarvis (chef d'orchestre, cerveau `qwen2.5:7b` sur la carte), le vrai Ollama, le vrai Forge (lancé à part), une demande par projet.

| Demande (projet) | Chemin | Image | Durée | Ollama avant → après |
| --- | --- | --- | --- | --- |
| « Génère une image d'un chat sur un toit, photo » | express → Images | 1216×832 (le modèle a choisi le projet `jarvis` et le format paysage) | 90 s | rien → `qwen2.5:7b` rechargé |
| « Fais-moi un sticker de renard pour Drivers Ink » (drivers-ink) | express → Images | 1216×832 couleur + version noir et blanc | 78 s | `qwen2.5:7b` déchargé → rechargé |
| « Crée une miniature YouTube pour ma vidéo sur les montres, projet vx » | express → Images | 1344×768 | 71 s | déchargé → rechargé |
| « Génère une image pour le projet jarvis : un orbe bleu lumineux… » | express → Images | 1344×768 | 73 s (après correction) | déchargé → rechargé |

Observé puis corrigé pendant le test : sur la quatrième demande, le 7B a d'abord **annoncé** la génération sans appeler l'outil (quatre appels mal formés, puis un chemin inventé). Consignes de l'équipe Images et du tour image resserrées : appeler `generer_image` tout de suite, sans phrase d'introduction (l'outil prévient lui-même), ne jamais dire « je vais générer » sans appeler l'outil. Rejoué : outil appelé, image produite, 7B rechargé.

Points à améliorer plus tard (non bloquants) : le sticker a un fond gris plutôt que blanc (SDXL dessine un « sticker découpé » posé sur un fond) ; la version noir et blanc est un seuil, utile pour le contour de découpe mais pas un vrai dessin au trait ; le 7B écrit parfois le prompt en français (SDXL comprend moins bien) ; sans précision, il choisit parfois `jarvis` au lieu de `perso`.

## Ajout du soir — photo de départ, ouverture automatique, chemins cliquables

Demande de l'utilisateur après le premier test à la voix : « envoyer des photos à Jarvis pour qu'il se base dessus », « qu'il envoie le lien de l'emplacement du fichier et qu'il ouvre automatiquement l'image ».

- **Photos jointes** : bouton « image + » et glisser-déposer dans la zone de saisie (3 photos au plus, 20 Mo, PNG/JPEG/WebP), envoyées en base64 au processus principal, enregistrées dans `C:\dev\Jarvis_images\_references\AAAA-MM-JJ\`, gardées sur le message (`ChatMessage.attachments`, vignette cliquable dans la bulle). Le modèle de langage ne reçoit qu'une note avec le chemin (`withAttachmentNotes`) ; une photo jointe route vers l'équipe Images.
- **Image vers image** : `generer_image` prend `photoDeBase` et `fidelite` ; Forge `/sdapi/v1/img2img`, force du changement = 1 − fidélité (bornée 0,2 à 0,95, 0,55 par défaut), format choisi d'après les proportions de la photo, copie de la photo à côté du résultat et ligne « Photo de départ » dans le `.txt`.
- **Ouverture et liens** : l'image s'ouvre dans la visionneuse à la fin (réglage `images.openAfterGeneration`, oui par défaut) ; dans la discussion, les chemins de fichiers du dossier des images deviennent des liens (IPC `images:open`, limité à ce dossier).
- **Test réel** (version de développement, 9 novembre 23 h 15) : capture d'écran jointe, « transforme-la en manga japonais ». Premier essai raté : le 7B a oublié le champ `prompt` (description mise dans `style`), trois refus de validation ; corrigé (`effectivePrompt` reconstruit la description). Second essai : image 832×1216 en 84 s à partir de la photo, copie `-source.png` à côté, 7B rechargé, image ouverte.

## Ajout du soir (suite) — reformulation de la demande pour SDXL

Demande : « améliorer la compréhension de Stable Diffusion ». Avant de décharger le cerveau, Jarvis lui fait réécrire la demande en consigne SDXL (JSON `prompt` + `negative`, anglais structuré, négatif propre à la demande), avec garde-fou (longueur, mots français), un second essai, puis repli sur la demande d'origine. Réglage `images.refinePrompts` (oui par défaut), consigne envoyée montrée dans la réponse et dans le `.txt`.

Essais réels (version de développement, 23 h 45 à 23 h 55) :

| Demande (du 7B) | Consigne envoyée | Observation |
| --- | --- | --- |
| « femme en lingerie rouge, anime ref : SAO » | « femme in lingerie red, anime style, SAO reference, standing, confident smile, minimalistic background, soft lighting, close-up, shallow depth of field… » | structure correcte, mais un mot français gardé et ordre bancal ; négatif générique → consigne durcie (traduction de chaque mot, adjectifs avant noms, garde-fou sur les noms français, second essai, négatif spécifique) |
| « Asuna du jeu SAO in a bikini at the beach, sunny day, vibrant colors… » | « Asuna in a blue bikini, long hair flowing, standing, smile, beach sand, palm trees, clear blue sky, watercolor style, sunlight casting shadows, wide-angle lens, dynamic composition, joyful, carefree, high quality, detailed » ; négatif « extra limbs, distorted features, unnatural colors, dark shadows, blurry background » | tout en anglais, bien ordonné, négatif adapté ; « watercolor » inventé → règle ajoutée : technique gardée si demandée, sinon déduite du contexte, jamais imposée |

## RAPPORT DE VÉRIFICATION

```
RAPPORT DE VÉRIFICATION
Lancement : OK
Types     : OK (0 erreur)
Style     : OK (0 avertissement)
Tests     : OK (2956/2956 réussis, 8 ignorés ; cœur 2259/2259, bureau 697/697 — dans la suite complète lancée pendant que Jarvis dev et Forge tournaient, 4 tests ont échoué pour des raisons de charge ou d'environnement : `settingsMap.test.ts` (clé `images.openAfterGeneration` manquante dans la carte des réglages, corrigée), `lintBaseline.test.mjs` (délai de 5 s dépassé), `windowsDesktopMissionPath.test.ts` (EBUSY au nettoyage d'un dossier .NET), `taskWorkflow.test.ts` (étape `pause-1` sensible au temps) ; les trois derniers repassent seuls)
Secrets   : OK (0 trouvé)
Fichiers modifiés : commits 67b71c0, 0a8b6f7, 946b70e… 5977df5 et celui-ci (packages/core/src/images, apps/desktop/src/main/images, tools/images.ts, Composer.tsx, Messages.tsx, useChat.ts, UnifiedJarvisChat.tsx, ImagesSettings.tsx, ipc.ts, preload, main/index.ts, session.ts, settings.ts, types.ts, config/, docs/images-jarvis.md, training/lora/, CLAUDE.md, .gitignore, rapport)
Prêt à fusionner : OUI (après relecture par l'utilisateur ; rien sur main)
À corriger : fond gris du sticker (forcer un fond blanc par post-traitement ou un modèle/LoRA dédié) ; noir et blanc = seuil (un vrai trait demanderait un LoRA « line art ») ; prompt parfois en français ; projet par défaut parfois `jarvis` au lieu de `perso` ; `taskWorkflow.test.ts` et `lintBaseline.test.mjs` sensibles à la charge de la machine (hors module)
Testé en vrai (à la voix, sur le PC) : FAIT (version de développement, 9 novembre 21 h 50 : « Jarvis, génère une image d'un chat sur un toit » dit à la voix → Forge lancé par Jarvis, image 832×1216 dans perso en 114 s, qwen2.5:7b rechargé ; Whisper a transcrit « chtah », le 7B l'a recopié et SDXL a dessiné un canidé : défaut de transcription, pas du module)
```

Correctif trouvé par ce test à la voix : Jarvis lançait `lancer_forge.bat` par son nom relatif, refusé dans certains environnements (« n'est pas reconnu en tant que commande interne ou externe ») ; le lancement passe maintenant par le chemin complet, et l'arrêt de Forge par Jarvis après l'image n'est plus journalisé comme une panne.

À tester à la voix une fois la branche installée (version de développement `npm run dev`, ou installateur construit depuis la branche) : « Jarvis, génère une image d'un chat sur un toit, photo » → Jarvis dit qu'il décharge son modèle, une image arrive dans `perso` (ou `jarvis`) et Jarvis redonne le chemin ; « Jarvis, fais-moi un sticker de renard pour Drivers Ink » → deux fichiers (couleur et `-nb`) dans `drivers-ink` ; « Jarvis, crée une miniature pour ma vidéo sur les montres » → une image 1344×768 dans `vx`.

## Pour l'utilisateur, en simple

- **Ce qui marche** : Jarvis fabrique des images sur ton PC, sans Internet, en une à deux minutes. Il prévient, met son cerveau de côté le temps de l'image, allume Forge si besoin, range l'image et un petit fichier texte qui garde tous les réglages, puis reprend son cerveau. Cinq images produites ce soir, dont le sticker de renard en couleur et en noir et blanc.
- **Lancer Forge** : pas obligatoire, Jarvis le fait. Pour l'utiliser à la main : `C:\dev\Forge\lancer_forge.bat`, puis `http://127.0.0.1:7860` dans ton navigateur.
- **Demander une image** : dans la discussion, « Génère une image de… », « Fais-moi un sticker de… pour Drivers Ink », « Crée une miniature pour ma vidéo sur… ». Les images sont dans `C:\dev\Jarvis_images`.
- **Activer le module** : Réglages → Services → Images → interrupteur, puis Enregistrer (il est coupé par défaut). La version 5.0.70 installée n'a pas encore ce module : il faut la version de développement ou un installateur construit depuis la branche.
- **Ce qui reste à faire** : relire et fusionner la branche ; essayer à la voix ; pour un rendu « vinyle » parfait, un fond vraiment blanc et un vrai dessin au trait (LoRA à entraîner avec le guide).
