# Jarvis fabrique des images (module images)

Jarvis peut créer des images sur ton PC, sans Internet, avec **Forge** (une interface Stable Diffusion) et le modèle **SDXL**. Tout est installé hors du dépôt de Jarvis, dans `C:\dev\Forge`, et les images vont dans `C:\dev\Jarvis_images`.

## Lancer Forge

- Double-clique sur `C:\dev\Forge\lancer_forge.bat`. Une fenêtre noire s'ouvre ; quand tu lis `Running on local URL: http://127.0.0.1:7860`, Forge est prêt. Tu peux ouvrir cette adresse dans ton navigateur pour t'en servir à la main.
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
