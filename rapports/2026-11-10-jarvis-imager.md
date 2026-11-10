# Jarvis Imager — nuit du 9 au 10 novembre 2026

Branche `claude/jarvis-imager`, partie de `claude/module-images` (pas de fusion dans `main`, pas de publication). Mission : faire du module images un spécialiste, **Jarvis Imager**, qui reçoit la demande du 7B et rend des images propres (plus de bras en trop, mains et visages déformés). Le 7B reste déchargé pendant la génération puis rechargé.

## Étape 1 — modèles

| Modèle | Version vérifiée | Taille | Licence | Décision |
| --- | --- | --- | --- | --- |
| RealVisXL V5.0 (SG161222) | V5.0, oct. 2024, dernière non-Lightning | 6,94 Go (fp16) | CreativeML Open RAIL++-M (même que SDXL de base) : **usage commercial possible** | **téléchargé** dans `C:\dev\Forge\models\Stable-diffusion\`, vérifié (en-tête safetensors lisible, 2526 tenseurs) ; modèle prioritaire |
| Juggernaut XI v11 (RunDiffusion) | XI v11 (XII/XIII « Ragnarok » seulement sur leur site payant) | 7,11 Go | **CC BY-NC-ND 4.0** : usage commercial interdit sans licence RunDiffusion | choisi par l'utilisateur, **non téléchargé** : dépôt Hugging Face réservé aux comptes connectés ayant accepté la licence. À faire par l'utilisateur (fichier à poser dans le dossier des modèles, ou jeton de lecture fourni le temps du téléchargement). Réservé au perso dans la documentation. |
| SDXL base 1.0 | — | déjà présent | RAIL++-M | secours |

Réglages des auteurs appliqués automatiquement (`imager_rules.yaml`, sections `checkpoint-*`) : RealVisXL = DPM++ SDE Karras, 30 pas, CFG 5, négatif conseillé ; Juggernaut = DPM++ 2M Karras, 35 pas, CFG 5 ; SDXL base = DPM++ 2M Karras, 28 pas, CFG 6, VAE fp16 fix. Le choix est `auto` (premier présent dans l'ordre RealVisXL, Juggernaut, SDXL base), modifiable.

## Étape 2 — tailles

Seules les sept tailles natives SDXL partent à Forge (1024×1024, 832×1216, 1216×832, 896×1152, 1152×896, 1344×768, 768×1344). Une taille libre (« 1920x1080 », « 4:3 ») est ramenée à la plus proche en rapport largeur/hauteur. « Agrandir » = génération native puis `/sdapi/v1/extra-single-image` ×2 (agrandisseur des règles, repli Lanczos : Forge Classic n'a que Lanczos, Nearest et ESRGAN sans modèle), fichier `-grand.png`.

## Étape 3 — retouches

- **ADetailer 26.2.0** cloné dans `C:\dev\Forge\extensions\adetailer` ; au premier démarrage Forge a installé `ultralytics` 8.4 et ses dépendances ; chargé par Forge Classic (« ADetailer initialized, num models: 10 », `adetailer` dans `/sdapi/v1/scripts`).
- Pour les types `personne` et `scene` : passe visages (`face_yolov8n.pt`, force 0,35) puis mains (`hand_yolov8n.pt`, force 0,30), vérifié par l'API (la ligne d'informations de l'image porte « ADetailer model: face_yolov8n.pt, ADetailer model 2nd: hand_yolov8n.pt »).
- Négatif d'anatomie par défaut (bras et membres en trop, doigts en trop ou fusionnés, mains déformées, visages déformés, yeux asymétriques…) pour les personnes, réglable dans `imager_rules.yaml` (section `anatomie`).
- **Bogue trouvé et contourné** : avec ADetailer installé, les arguments par défaut du script intégré « Never OOM Integrated » se décalaient dans l'API de Forge (il se croyait activé pour le VAE avec une tuile nulle) → `ZeroDivisionError` et HTTP 500 sur **toutes** les images, même sans demander ADetailer. Jarvis passe maintenant toujours ses arguments explicitement (désactivé, 512, 64) : plus d'erreur. Un 500 isolé est retenté une fois.

## Étape 4 — Imager écrit ses consignes

Le 7B transmet `demande` (mots de l'utilisateur), `projet`, `type` (personne, objet, paysage, logo-sticker, scene, autre) et `nombrePersonnes`. Imager : (1) fait décrire le sujet en anglais par le 7B encore chargé (reformulation 5.0.x, sans mots de qualité), avec repli sur la demande telle quelle ; (2) assemble la consigne par règles (`config/imager_rules.yaml`, copie vivante `C:\dev\Jarvis_images\imager_rules.yaml`) : règle du projet → sujet → nombre de personnes (« solo, one person only », « exactly two people ») → style → mots du type → suffixe du projet → qualité → LoRA ; négatif = projet + type + anatomie + modèle + reformulation + utilisateur, sans doublon. La consigne finale est dans la réponse et dans le `.txt` à côté de l'image, avec une ligne « Jarvis Imager : sujet, modèle, retouche, agrandissement ».

## Étape 5 — identité

Équipe du chef d'orchestre « Jarvis Imager » ; consigne du 7B « pour toute image, tu passes par Jarvis Imager » ; Réglages → Services → « Jarvis Imager » (modèles présents, modèle actif, ADetailer) ; `images_etat` ; `CLAUDE.md` et `docs/images-jarvis.md` mis à jour.

## Étape 6 — comparaisons

Cinq demandes avec personnes, mêmes consignes et mêmes graines des deux côtés, Forge laissé allumé entre les images, 7B déchargé puis rechargé à chaque image (vérifié : `qwen2.5:7b` chargé après chacune des dix). Fichiers dans `C:\dev\Jarvis_images\tests_imager\` : `ancien\perso\2026-11-10\` (SDXL de base, aucune règle, aucune retouche, DPM++ 2M 28 pas) et `nouveau\perso\2026-11-10\` (Jarvis Imager : RealVisXL, règles, ADetailer), récapitulatif `COMPARAISON.md`.

| Cas | Ancien | Nouveau (Imager) | Ce que j'ai vu |
| --- | --- | --- | --- |
| 1 portrait (femme, taches de rousseur) | 77 s | 249 s | les deux corrects ; le nouveau est plus photographique, mains sous le menton plausibles |
| 2 personne entière debout (homme en costume) | 58 s | 236 s | nouveau : visage et mains nets, pose naturelle |
| 3 deux personnes au café | 58 s | 193 s (après correctif) | l'ancien était déjà correct ; le nouveau a d'abord **planté Forge deux fois** (erreur interne de placement de tenseurs pendant la passe « mains » sur une image 1216×832 à deux personnes, mémoire vidéo saturée) → règle : pour une scène à plusieurs personnes, retouche des visages seulement |
| 4 mains visibles (tasse à deux mains) | 58 s | 242 s | **ancien : doigts fusionnés et pouces déformés ; nouveau : deux mains à cinq doigts, ongles nets** |
| 5 geste (homme qui salue) | 58 s | 240 s | **ancien : deux bras levés et mains floues alors qu'une seule main devait saluer ; nouveau : une main levée, cinq doigts, visage net** |

Temps moyen par image : **ancien 62 s, nouveau 242 s** (avec les retouches à 30 pas ; mesure faite avant le passage des retouches à 16 pas, qui devrait ramener une personne seule vers 2 minutes ; à remesurer). Le surcoût vient de l'échantillonneur recommandé par RealVisXL (DPM++ SDE, environ deux fois plus lent par pas) et des deux passes de retouche. Pour aller plus vite : `adetailer: false` ou `adetailerMains: false` dans `imager_rules.yaml`, ou `checkpoint-realvisxl` avec `sampler: "DPM++ 2M"`.

Autres défauts relevés sur Forge Classic en 6 Go, contournés dans Jarvis : HTTP 500 systématique (« Never OOM » mal argumenté dès qu'ADetailer est installé) → arguments explicites ; coupure « fetch failed » sur une image lourde → un nouvel essai, puis l'erreur dite telle quelle.

Juggernaut XI : non téléchargé (dépôt réservé aux comptes Hugging Face ayant accepté la licence). Dès que le fichier `Juggernaut-XI-byRunDiffusion.safetensors` est dans `C:\dev\Forge\models\Stable-diffusion\`, Imager le voit (section `checkpoint-juggernaut`) ; il passe après RealVisXL dans l'ordre `auto`, et sa licence interdit l'usage commercial.

## Suite du 10 novembre (matin) — essai de l'utilisateur, deux correctifs

**Onglet du navigateur à chaque image.** Forge ouvre son interface dans le navigateur à chaque démarrage (réglage `auto_launch_browser` à « Local » par défaut, aucun `config.json` dans le dossier de Forge) ; Jarvis l'arrêtant après chaque image et le relançant à la suivante, un onglet s'ouvrait à chaque fois. Correctif : `config.json` de Forge écrit avec le réglage coupé, et `ImagesService` coupe lui-même ce réglage par `/sdapi/v1/options` au premier lancement par Jarvis (jamais pour un Forge lancé par l'utilisateur). Commit `0092e61`.

**« Hinata dans Naruto, style anime » rendue en Japonaise réaliste.** La consigne envoyée disait bien « anime style, Naruto universe », mais RealVisXL est un modèle photo : il ignore le style et ne connaît aucun personnage ; le 7B avait en plus inventé « yeux bleus, cheveux noirs ». Correctif : notion de **rendu** (`auto`, `realiste`, `anime`) transmise par le 7B (`rendu` de `generer_image`) ou lue dans la demande (anime, manga, dessin animé, séries connues ; photo, réaliste), modèle **Animagine XL 4.0 Opt** téléchargé avec l'accord de l'utilisateur (6,94 Go, CreativeML Open RAIL++-M comme SDXL de base, usage commercial permis ; entraîné sur 8,4 M d'images d'anime avec les étiquettes Danbooru), réglages de la fiche du modèle (Euler a, 28 pas, CFG 5, qualité « masterpiece, high score, great score, absurdres », négatif de l'auteur), reformulation en étiquettes Danbooru avec les noms gardés (« 1girl, hyuuga hinata (naruto), … »), négatif « photo, réaliste, 3D » en anime et « cartoon, dessin » en réaliste, modèle anime jamais pris pour une photo, avertissement si le rendu anime est demandé sans modèle anime (SDXL de base alors), ligne « rendu … » dans le `.txt` et la réponse. Un négatif reformulé en français (« très pudique ») est maintenant écarté seul. Sections `rendu-anime` / `rendu-realiste` et clés `rendu`, `qualite` dans `imager_rules.yaml` (fichier de référence et copie vivante régénérés : l'utilisateur ne l'avait pas modifié).

Essai réel (vrai service, vrai Ollama, vrai Forge, `C:\dev\Jarvis_images\tests_imager\anime\perso\2026-11-10\`) :

| Cas | Rendu | Modèle | Durée | Résultat |
| --- | --- | --- | --- | --- |
| « Hinata dans Naruto, style anime, qui sourit » | anime | Animagine XL 4.0 Opt, retouche visages et mains | 179 s (Forge démarré) | **vraie Hinata en anime** (cheveux bleu nuit, yeux clairs du Byakugan, sourire), consigne « 1girl, hyuuga hinata (naruto), smiling, … masterpiece, high score, great score, absurdres » |
| « un renard roux dans une forêt, en photo » | realiste | RealVisXL V5.0 | 182 s (Forge redémarré) | photo réaliste, négatif « anime, cartoon, drawing » ajouté |

Le 7B est rechargé après chacune des deux images.

## RAPPORT DE VÉRIFICATION

```
RAPPORT DE VÉRIFICATION
Lancement : OK
Types     : OK (0 erreur)
Style     : OK (0 avertissement)
Tests     : OK (2971/2971 réussis, 8 ignorés ; cœur 2271/2271, bureau 700/700 — dans la suite complète, `windowsDesktopMissionPath.test.ts` a échoué au nettoyage d'un dossier (EBUSY, verrou .NET sous charge) et repasse seul 6/6)
Secrets   : OK (0 trouvé)
Fichiers modifiés : 24 fichiers depuis claude/module-images (packages/core/src/images : imagerRules, presets, request, refine, storage, intent, index, tests ; apps/desktop/src/main/images : ForgeClient, ImagesService, PromptRefiner, tests ; tools/images.ts ; orchestraTeams.ts ; ImagesSettings.tsx, SettingsPanel.tsx, ipc.ts, preview/bridge.ts ; config/imager_rules.yaml ; docs/images-jarvis.md ; CLAUDE.md ; AGENTS-COORDINATION.md ; ce rapport)
Prêt à fusionner : OUI (après relecture de l'utilisateur ; rien sur main ; la branche contient aussi tout claude/module-images)
À corriger : temps par image avec personnes (≈ 4 min à 30 pas de retouche ; 16 pas maintenant, à remesurer) ; Juggernaut XI à poser à la main ; Forge Classic en 6 Go reste fragile sur une image 1216×832 à plusieurs personnes avec deux passes de retouche (contourné : visages seuls pour les scènes) ; fond gris des stickers et noir et blanc par seuil (inchangé, voir rapport du 9 novembre)
Testé en vrai (à la voix, sur le PC) : PAS FAIT (testé par le service réel avec le vrai Forge, le vrai Ollama et les vrais modèles : 10 images de comparaison + 5 images d'essai ; pas de test dans la fenêtre de Jarvis cette nuit)
```

À tester toi-même dans Jarvis (version de développement `npm run dev`) : « Jarvis, génère le portrait d'une femme rousse qui sourit » → réponse « Jarvis Imager : modèle RealVisXL V5.0, sujet « personne », retouche visages et mains faite » et une image nette ; « Jarvis, fais une image de deux amis qui trinquent en terrasse » → type scène, retouche des visages ; « Jarvis, un sticker de renard pour Drivers Ink » → règles sticker, pas de retouche.

## Pour l'utilisateur, en simple

- **Ce qui a changé** : pour toute image, le cerveau passe par Jarvis Imager, qui écrit lui-même la consigne (règles dans `C:\dev\Jarvis_images\imager_rules.yaml`), choisit RealVisXL (meilleure anatomie, usage commercial permis), n'envoie que des tailles natives SDXL, repasse sur les visages et les mains des personnes, et dit dans sa réponse quel modèle et quelles retouches il a utilisés.
- **Où voir les comparaisons** : `C:\dev\Jarvis_images\tests_imager\ancien\` contre `…\nouveau\` (mêmes demandes, mêmes graines), tableau dans `COMPARAISON.md`. Regarde surtout « mains » et « geste » : doigts fusionnés et deux bras levés avant, mains correctes après.
- **Temps moyen par image** : ancien 62 s, nouveau 242 s (mesure avec les retouches à 30 pas ; passées à 16 pas depuis, à remesurer). Réglable dans le fichier de règles.
- **Ce qui reste à faire** : poser Juggernaut XI dans le dossier des modèles si tu le veux (compte Hugging Face, licence non commerciale) ; relire et fusionner la branche ; remesurer le temps avec les retouches à 16 pas ; essayer à la voix dans Jarvis.

## RAPPORT DE VÉRIFICATION (suite du 10 novembre, matin)

```
RAPPORT DE VÉRIFICATION
Lancement : OK (cœur construit ; version de développement lancée pour l'essai de l'utilisateur ; au second lancement, le Jarvis installé tournait déjà et tient le verrou d'instance unique : à fermer avant de relancer)
Types     : OK (0 erreur)
Style     : OK (0 avertissement sur les fichiers modifiés)
Tests     : OK (cœur 2277/2277 ; bureau 693/693 réussis, 8 ignorés — dans la suite complète, lancée pendant l'essai réel sur Forge, `lintBaseline.test.mjs` (délai 5 s) et `windowsDesktopMissionPath.test.ts` (EBUSY) ont échoué sous charge et repassent seuls 3/3 et 6/6)
Secrets   : OK (0 trouvé)
Fichiers modifiés : packages/core/src/images (imagerRules, refine, request, storage, intent, index + tests), packages/core/src/agent/orchestraTeams.ts, apps/desktop/src/main/images/ImagesService.ts (+ test), apps/desktop/src/main/tools/images.ts, config/imager_rules.yaml, docs/images-jarvis.md, CLAUDE.md, ce rapport
Prêt à fusionner : OUI (après relecture de l'utilisateur ; rien sur main)
À corriger : temps par image toujours ≈ 3 min quand Forge doit démarrer (≈ 1 min de démarrage) ; les mains de la Hinata anime sont correctes mais un peu raides (retouche « mains » faite avec le modèle de visage/main photo) ; le trieur ne connaît pas le champ « rendu » (règle express inchangée)
Testé en vrai (à la voix, sur le PC) : PAS FAIT (testé par le service réel : Hinata en anime sur Animagine et renard en photo sur RealVisXL, 7B rechargé ; l'essai dans la fenêtre de Jarvis revient à l'utilisateur)
```
