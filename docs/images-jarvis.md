# Jarvis Imager : Jarvis fabrique des images

Jarvis peut créer des images sur ton PC, sans Internet, avec **Forge** (une interface Stable Diffusion) et des modèles **SDXL**. Tout est installé hors du dépôt de Jarvis, dans `C:\dev\Forge`, et les images vont dans `C:\dev\Jarvis_images`. Le spécialiste s'appelle **Jarvis Imager** : le cerveau de Jarvis (le 7B) lui transmet ta demande, et c'est lui qui écrit la consigne, choisit le modèle, la taille et les retouches.

## Ce que fait Jarvis Imager pour éviter les mains et visages ratés

- **Un meilleur modèle** : RealVisXL V5.0 (photoréalisme, bonne anatomie, usage commercial autorisé) est utilisé en priorité, puis Juggernaut XI s'il est installé (réservé au perso : sa licence interdit l'usage commercial), puis le SDXL de base en secours. Les réglages recommandés par l'auteur de chaque modèle sont appliqués automatiquement.
- **Un modèle pour le dessin** : les modèles photo ignorent « style anime » et ne connaissent aucun personnage de manga (essai du 10 novembre : « Hinata dans Naruto, style anime » donnait une Japonaise réaliste). Quand ta demande parle d'anime, de manga, de dessin animé ou d'une série connue (Naruto, One Piece, Pokémon…), ou que tu dis « en photo » pour l'inverse, Jarvis Imager choisit le **rendu** : anime → Animagine XL 4.0 Opt (entraîné sur 8,4 millions d'images d'anime, il connaît les personnages par leur nom ; même licence que SDXL de base, usage commercial permis ; fichier `animagine-xl-4.0-opt.safetensors`, 6,94 Go) avec ses réglages d'auteur (Euler a, 28 pas, CFG 5, étiquettes « masterpiece, high score… ») ; réaliste → RealVisXL. Pour l'anime, le 7B garde le nom du personnage et de la série tels quels (étiquettes « hyuuga hinata, naruto (series) ») au lieu d'inventer une description. Si le modèle anime n'est pas sur le disque, l'image est faite avec SDXL de base et Jarvis le dit. Le fichier texte à côté de l'image porte « rendu anime » ou « rendu realiste ».
- **Les bonnes tailles** : seules les sept tailles natives SDXL sont envoyées à Forge ; une taille « bizarre » est ramenée à la plus proche. Pour une grande image, dis « en grand » : elle est générée en taille native puis agrandie.
- **Retouche des visages et des mains** : pour une image avec des personnes, l'extension ADetailer repasse automatiquement sur chaque visage et chaque main.
- **Consigne par règles** : le fichier `C:\dev\Jarvis_images\imager_rules.yaml` dit quels mots ajouter selon le type d'image (personne, objet, paysage, sticker…), quels défauts éviter (membres en trop, doigts déformés…), quel modèle utiliser. Tu peux le modifier avec le Bloc-notes.

## Lancer Forge

- Double-clique sur `C:\dev\Forge\lancer_forge.bat`. Une fenêtre noire s'ouvre ; quand tu lis `Running on local URL: http://127.0.0.1:7860`, Forge est prêt. Tu peux ouvrir cette adresse dans ton navigateur pour t'en servir à la main.
- Forge ouvre son interface dans le navigateur à chaque démarrage (son réglage par défaut). Comme Jarvis le relance pour chaque image, un onglet s'ouvrait à chaque fois : Jarvis coupe ce réglage la première fois qu'il lance Forge (Forge l'écrit dans `C:\dev\Forge\config.json`, ligne `"auto_launch_browser": "Disable"`). Pour le remettre, change cette ligne en `"Local"` ou ouvre l'adresse à la main.
- Tu n'es **pas obligé** de le lancer : si Forge est éteint quand tu demandes une image, Jarvis le démarre lui-même (environ une minute) et l'arrête après l'image.
- Le premier lancement installe PyTorch et les dépendances (environ 3 Go, 10 à 20 minutes). Les suivants prennent 30 à 60 secondes.

## Demander une image à Jarvis

Dans la discussion (ou à la voix), par exemple :

- « Génère une image d'un chat sur un toit, photo »
- « Fais-moi un sticker de renard pour Drivers Ink »
- « Crée une miniature YouTube pour ma vidéo sur les montres, projet vx »
- « Dessine-moi un robot qui lit un livre, en 9:16 »
- « La même avec la graine 123 » (pour refaire une image à l'identique)

Ce qui se passe : Jarvis prévient (« je décharge le modèle de langage, je reviens dans une minute ou deux »), décharge le modèle 7B de la carte graphique, allume Forge si besoin, fabrique l'image, éteint Forge (ou décharge son modèle si tu l'avais allumé toi-même), **recharge le 7B**, puis donne le chemin des fichiers. Si Forge ne répond pas, Jarvis le dit en français et recharge quand même le 7B.

## Mode direct : passer outre le cerveau

Quand tu veux envoyer **ta** consigne telle quelle à Forge, sans que le modèle de langage la lise, la réécrive ou la juge :

- **Dans la discussion** : commence par `/image`, par exemple `/image un renard roux dans la neige, lumière douce`. La demande part directement à Jarvis Imager (projet perso, sauf si tu nommes « pour Driver's Ink », « miniature », « pour Jarvis »). Les phrases qui commencent par « Imager, … », « génère une image… », « dessine-moi… », « fais-moi une image… » y vont aussi toutes seules (liste modifiable dans `imager_rules.yaml`, section `direct`, clé `declencheurs`).
- **Le panneau « Imager direct »** (bouton dans la barre de gauche, visible quand Jarvis Imager est activé) : ta consigne, le prompt négatif pré-rempli, le modèle et les LoRA présents dans Forge, la taille (natives SDXL), le nombre d'images, la graine, les pas, le CFG, l'échantillonneur, ADetailer, le projet de rangement, « Générer », une barre d'avancement et l'aperçu des images.
- **« Améliorer mon prompt »** (coché par défaut, réglable dans le panneau et par `direct.ameliorer` du fichier de règles) : Imager ajoute seulement ce qui aide Stable Diffusion — traduction en anglais par un petit dictionnaire local (aucun modèle), mots de qualité, style du projet, taille native selon le sujet, défauts à éviter. Le contenu de ta demande n'est ni jugé ni filtré. Décoché : la consigne part mot pour mot. La consigne finale est montrée dans la réponse et gardée dans le fichier `.txt`.
- **Si le cerveau répond sans faire l'image** alors que ta phrase ressemblait à une demande d'image, un bouton « Envoyer à Imager » apparaît sous sa réponse : il renvoie ta demande telle quelle à Imager.
- **Carte graphique** : comme d'habitude, le modèle de langage est déchargé, l'image faite, puis le modèle rechargé, même en cas d'erreur. Option (Réglages → Jarvis Imager) : « garder Forge chargé tant que le panneau est ouvert » pour enchaîner plusieurs images ; le modèle de langage revient quand tu fermes le panneau.
- **Rangement** : `C:\dev\Jarvis_images\<projet>\<date>\` avec le `.txt` des réglages. Option : « projet perso : ne pas garder le fichier texte du prompt ». Rien de tout ça ne sort de ton PC.

Les tours `/image` ne sont jamais renvoyés au modèle de langage dans la suite de la conversation, ni mis dans sa mémoire.

## Partir d'une photo

Clique sur le bouton « image + » à côté du bouton d'envoi (ou glisse une photo sur la zone de saisie), puis écris ce que tu veux : « fais-en un sticker pour Drivers Ink », « transforme-la en manga japonais », « reste très proche de la photo ». Jusqu'à trois photos par message (PNG, JPEG ou WebP, 20 Mo au plus). Jarvis recopie la photo dans `C:\dev\Jarvis_images\_references\`, s'en sert comme base, et range une copie à côté du résultat (`…-source.png`). La photo n'est jamais envoyée au modèle de langage : il ne connaît que son chemin.

## Comment Jarvis parle à Stable Diffusion

Stable Diffusion comprend l'anglais, et surtout une consigne bien rangée : le sujet, puis le décor, la technique (photo, anime, illustration…), la lumière, le cadrage, la qualité. Avant chaque image, Jarvis fait donc réécrire ta demande par son cerveau en consigne de ce type, et choisit des défauts à éviter adaptés (mains et doigts pour une personne, perspective pour un bâtiment…). Si la réécriture échoue ou laisse du français, ta demande part telle quelle. La consigne réellement envoyée est écrite dans la réponse (« Consigne envoyée à Stable Diffusion ») et dans le fichier `.txt` : tu peux la recopier et la modifier dans Forge si tu veux affiner à la main. Réglage « Reformuler la demande pour Stable Diffusion » dans Réglages → Services → Images.

Conseils pour de meilleures images : dis la technique voulue (« photo », « style anime », « dessin au trait »), le cadrage (« gros plan », « vue large »), la lumière (« coucher de soleil », « studio »), et le format (16:9, portrait…). Une graine (« avec la graine 123 ») permet de refaire la même image en changeant un détail.

## Voir le résultat

Dès que l'image est prête, elle s'ouvre dans la visionneuse Windows (réglage « Ouvrir l'image dès qu'elle est prête », activé par défaut). Dans la réponse de Jarvis, le nom du fichier est un lien : un clic l'ouvre. Seuls les fichiers du dossier des images de Jarvis peuvent s'ouvrir ainsi.

## Où sont les images

`C:\dev\Jarvis_images\<projet>\<date>\<heure>-<sujet>-<n>.png`, et à côté un fichier `.txt` du même nom avec le prompt complet, le prompt négatif, la taille, la graine, le modèle et le LoRA : de quoi refaire l'image.

## Les quatre projets

| Projet | Pour quoi | Particularités |
| --- | --- | --- |
| `jarvis` | images pour Jarvis lui-même | libre |
| `vx` | montage vidéo | formats 16:9 (miniatures) et 9:16 (shorts) |
| `drivers-ink` | stickers en vinyle découpé | fond blanc uni, contours nets, peu de couleurs ; une **version noir et blanc** `-nb.png` est produite à côté ; pas de logos de marques, pas de texte, pas de visages de vraies personnes (prompt négatif) |
| `perso` | tout le reste | libre |

Les réglages de chaque projet (texte ajouté au prompt, prompt négatif, formats, nombre de pas, CFG…) sont dans `C:\dev\Jarvis_images\images_presets.yaml`, créé au premier usage. Modifie-le avec le Bloc-notes et enregistre : Jarvis le relit à chaque image. La copie de référence est `config/images_presets.yaml` dans le dépôt.

## Réglages dans Jarvis

Réglages → Services → **Images** : activer le module, dossier de Forge, dossier des images, adresse de l'API, « laisser Forge allumé », bouton **Tester Forge**. Module coupé : rien ne change dans Jarvis.

## LoRA (ton style à toi)

Un LoRA entraîné sur une carte louée (voir `training/lora/GUIDE_ENTRAINEMENT.md`) se range dans `C:\dev\Forge\models\Lora\`. Ensuite : « Génère un sticker de renard avec le LoRA mon-style », et le mot-clé déclencheur dans le prompt.
