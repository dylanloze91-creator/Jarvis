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

__E2E__

## Contrôles

__CONTROLES__

## Pour l'utilisateur, en simple

- **Le panneau** : barre de gauche → « Imager direct » (visible quand Jarvis Imager est activé dans Réglages → Services). Écris ta consigne, choisis le modèle et les réglages, « Générer ». Case « Améliorer mon prompt » cochée : Imager ajoute la traduction, la qualité, le style du projet et les défauts à éviter, sans jamais juger ta demande ; décochée : ta consigne part mot pour mot.
- **Dans la discussion** : `/image un renard roux dans la neige`. Les phrases « Imager, … », « génère une image… », « dessine-moi… », « fais-moi une image… » y vont aussi toutes seules, sans le cerveau. Liste modifiable dans `C:\dev\Jarvis_images\imager_rules.yaml`, section `direct`.
- **Si le cerveau répond à côté** (il parle au lieu de faire l'image) : clique « Envoyer à Imager » sous sa réponse.
- **Réglages → Jarvis Imager** : « Garder Forge chargé tant que le panneau est ouvert » (pour enchaîner), « Projet perso : ne pas garder le fichier texte ».
- **Ce qui reste à faire** : tester le panneau dans la fenêtre (version de développement : `npm run dev`, ou après la prochaine publication) ; décider de la fusion dans `main` ; la photo jointe reste sur l'ancien chemin.

## RAPPORT DE VÉRIFICATION

```
RAPPORT DE VÉRIFICATION
__RAPPORT__
```
