# Veille permanente des impressions (yeux de Jarvis) — 26 novembre 2026

Branche `claude/yeux-etape-1`. Rien n'est envoyé à l'imprimante : la veille ne fait que des GET vers Moonraker (état, métadonnées, G-code, photo de la caméra).

## Ce qui a changé

- **Veille permanente** : tâche planifiée Windows « Jarvis - veille des impressions », lancée à l'ouverture de session, sans fenêtre (`wscript` → `node`). Si elle plante, Windows la relance au bout d'une minute (999 fois au plus). Elle lance une copie du script, `C:\dev\jarvis-data\yeux\veille\observer-impressions.mjs` : un changement de branche dans le dépôt ne la touche pas. Installation : `apps/desktop/scripts/veille-impressions.ps1 installer`.
- **Relevé toutes les 30 s.** Dès qu'une impression démarre, lancée par Jarvis ou depuis Mainsail : une photo toutes les 10 minutes, l'état de Klipper, l'avis de gemma3:4b, une dernière photo à la fin, puis le questionnaire.
- **Une seule instance** : le port du questionnaire (127.0.0.1:53190) sert de verrou. Une deuxième veille voit le port pris et s'arrête (essayé : code de sortie 0, ligne « une veille tourne déjà » au journal). La tâche refuse aussi un second lancement (`IgnoreNew`).
- **Carte graphique sans commit** : réservation par le fichier local `C:\dev\jarvis-data\coordination\gpu.json`, créé en exclusif le temps d'une analyse (10 minutes au plus), puis supprimé. Un fichier périmé (date passée, ou processus disparu) est repris. La veille lit aussi la table « Ressource GPU » (copie de `main` et branches poussées depuis 12 h), sans jamais l'écrire. Règle ajoutée dans `AGENTS-COORDINATION.md` (sur `main`, commit `d3a1bfc`).
- **Supports** : au début de chaque impression, le G-code est lu une fois (GET). On y voit si les supports sont activés dans le trancheur et s'ils ont vraiment été générés (lignes `;TYPE:Support…`).
- **Questionnaire** : deux questions en plus. « La pièce tient-elle ? » (oui / fragile / non / pas encore essayée), puis, seulement si le trancheur a généré des supports, comment ils se sont retirés. Les réponses vont dans `etiquettes.json` (`piece`), toujours de la main de l'utilisateur seulement.
- **Pause** : si le fichier `C:\dev\jarvis-data\yeux\veille\pause` existe, la veille ne regarde plus l'imprimante. Le questionnaire reste servi.
- **Ollama absent au démarrage** : l'analyse attend, sans compter d'essai raté.
- **Journal** : `C:\dev\jarvis-data\yeux\impressions\observateur.log`, mis de côté (`.ancien`) au-delà de 5 Mo.

## L'impression en cours (support de téléphone)

- Début 17 h 48, environ 4 h 27 prévues par OrcaSlicer, 389 couches, PETG. Dossier `2026-11-26_17-48_support-de-telephone-2026-11-26-1-v1` (jeu : entraînement).
- **Supports : activés dans OrcaSlicer (`normal(auto)`, angle 30°), mais aucun n'a été généré.** Le G-code ne contient aucun bloc de support : la pièce n'en avait pas besoin à cet angle. Il y a une bordure (brim) de 5 mm.
- **Est-ce que la pièce tient ?** On ne peut pas le savoir avant la fin. C'est la question 4 du questionnaire.
- 26 photos à 22 h 32 (86 %, couche 302/389) : 25 « alertes » et 1 « incertain » de gemma3:4b, comme la nuit d'avant. L'image est sombre et le modèle dit presque toujours « difficile à dire… ce qui pourrait poser problème ». Ce n'est pas un défaut constaté : seul le questionnaire le dira.

## Vérifié en vrai

- **Plus aucun commit** : depuis 18 h 25, la dernière ligne de `claude/yeux-etape-1` est le commit du code ; 22 analyses faites avec la réservation locale (`reservationLocale: true` dans le journal), fichier `gpu.json` supprimé après chacune.
- **Redémarrage du PC** : à 19 h 10 le PC a été éteint (démarrage rapide de Windows), il est revenu à 19 h 36. La tâche a relancé la veille seule à 19 h 38, qui a repris la même impression, le même dossier, et pris la photo 9. Ollama n'était pas encore prêt : l'analyse a attendu 6 minutes, sans compter d'échec. Pas de photo entre 19 h 01 et 19 h 38 (PC éteint).
- **Une seule instance** : une deuxième veille lancée à la main s'est arrêtée seule (port pris, code 0).

## Prévenir sur l'iPhone : ntfy (décision de l'utilisateur, 26 novembre au soir)

- À la fin d'une impression, la veille envoie à ntfy.sh, sur un sujet secret de 22 lettres tiré au hasard (`veille\notification.json`, hors du dépôt), un message qui contient **seulement** « Questionnaire prêt » et le lien `https://desktop-hah329d.taild65d4d.ts.net:8444/questionnaire`. Ni le nom du fichier d'impression, ni celui du dossier : le lien `/questionnaire` mène au dernier questionnaire pas encore rempli, sinon à la liste.
- Le port **8444 reste publié en permanence** par Tailscale (`tailscale serve --bg --https=8444 http://127.0.0.1:53190`), visible seulement des appareils du tailnet. Pour le retirer : `tailscale serve --https=8444 off`.
- Sans `notification.json`, rien ne part. Le lien local est aussi écrit dans `veille\dernier-questionnaire.txt`.
- La veille comprend aussi une réservation de la table qui dit « partagée avec la veille » : elle analyse alors si le fichier local est libre.

## Arrêter ou mettre en pause

```
powershell -ExecutionPolicy Bypass -File C:\dev\jarvis-data\yeux\veille\veille-impressions.ps1 statut
… pause | reprendre | arreter | demarrer | desinstaller
```

`arreter` vaut jusqu'au prochain démarrage de Windows. `desinstaller` retire la tâche ; les impressions observées restent.
