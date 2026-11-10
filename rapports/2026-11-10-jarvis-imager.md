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

RESULTATS_COMPARAISON

## RAPPORT DE VÉRIFICATION

RAPPORT_VERIFICATION
