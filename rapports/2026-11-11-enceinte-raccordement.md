# Brancher une enceinte — rapport

Branche `cursor/enceinte-raccordement`, à partir de `origin/main` (`6ad0fa5`, Jarvis 5.0.75). Version non changée. Pas de fusion, pas de publication. **Testé en vrai (sur la carte) : PAS FAIT.**

La réservation `cursor/enceinte-materiel` sur `firmware/jarvis-speaker/` était encore « en cours » alors que la branche est entièrement dans la 5.0.75. Elle a été close avant de réserver ce chantier.

## Fait / pas fait

| Partie | État | Pourquoi |
| --- | --- | --- |
| 0 Reconnaissance | Fait | `rapports/2026-11-11-enceinte-raccordement-choix.md` |
| 1 Programme de la carte | Fait dans le code, pas compilé ici | Protocole C testé sur le PC (`npm run test:firmware --workspace @jarvis/desktop`). PlatformIO n'a pas été lancé : pas de `pio`. |
| 2 Programme livré | Fait, sans `.bin` | Script `setup:speaker-firmware`, manifeste vérifié, dossier ignoré par git sauf les textes. |
| 3 Installation USB | Fait pour la logique et l'écran, pas le dernier branchement esptool | Machine à états testée (chaque échec). L'écran a les trois étapes. Le clic « Installer » ne lance pas encore esptool-js : ce branchement n'est pas dans la fenêtre. |
| 4 mDNS et diagnostic | Fait pour le filtre, les réponses et les scripts | Annonce testée avec une fausse socket. Le pont coupé n'ouvre rien. Les scripts PowerShell ne sont pas lancés ici (pas Windows). |
| 5 Liste | Fait | Signal, ancienne version, recherche des réglages, scènes. |
| 6 Mise à jour sans fil | Pas fait | Aucune taille réelle de `firmware.bin` ni de `srmodels.bin`. La partition actuelle fait 3 Mo, l'exemple à deux emplacements n'en laisse que 2,81. Sans mesure, on ne l'écrit pas. La mise à jour reste par USB. |
| 7 Secours sans câble | Pas fait | Le reste n'est pas essayé sur la carte, et ce point compliquerait le programme. |
| 8 Guides | Fait | `docs/enceinte-brancher.md` et le README du programme. |

Le fichier `.github/workflows/firmware.yml` n'a pas été poussé : le jeton refuse d'écrire un workflow. À ajouter plus tard, compilation seule, sur `firmware/**`.

## Choix de la partie 0

Détail et liens : `rapports/2026-11-11-enceinte-raccordement-choix.md`.

- Electron **44.4.5**, Web Serial, geste obligatoire pour `requestPort()`.
- esptool-js **0.7.1** (Apache-2.0), sans `eval`.
- mDNS : **multicast-dns 7.2.5** (MIT), une socket par interface, `reuseAddr` vrai. Le paquet n'est pas encore dans `package.json` : les réponses sont pures et testées avec une fausse socket.
- ESP-IDF **5.5.0** via `espressif32 @ 6.12.0`, composant `espressif/mdns` **1.14.1**.

## Essais réels pour Claude Code

1. Installation complète depuis Jarvis sur Windows, carte XH-S3E, prise UART puis prise USB. Chronomètre. Cible : moins de 5 minutes. L'enceinte dit « Bonjour, je suis l'enceinte du Salon ».
2. Mauvais mot de passe. Réseau 5 GHz seul. Nom de réseau caché.
3. Retirer la règle de pare-feu, cliquer Réparer. Passer le réseau en Public, ouvrir le diagnostic.
4. Changer l'adresse du PC (nouveau bail). L'enceinte retrouve le PC seule.
5. Tailscale et Radmin allumés : aucune de leurs adresses n'est annoncée.
6. BOOT tenu 10 secondes, puis réinstallation. « Retirer » : l'enceinte passe en clé refusée.
7. L'enceinte déjà en 5.0.64 répond encore, puis « Remplacer » change la clé.
8. Mise à jour sans fil : **ne pas la faire** (partie 6 non écrite).
9. Une phrase normale après l'installation : la vitesse de Jarvis Réflexe n'a pas changé.
10. Brancher le driver esptool-js dans la fenêtre (il n'est pas encore appelé au clic) avant l'essai 1, ou le constater et le dire.

## Étape à ajouter à `release.sh`

Ne pas modifier `release.sh` dans cette branche. À ajouter avant la construction de l'installateur, sur le PC qui a PlatformIO :

```bash
npm run setup:speaker-firmware --workspace @jarvis/desktop
```

Ça compile `firmware/jarvis-speaker` et remplit `apps/desktop/speaker-firmware/` (hors git). Sans PlatformIO, la construction doit rester possible : le dossier ne contient alors que `LISEZMOI.md` et `LICENCES.md`.

Les essais C :

```bash
npm run test:firmware --workspace @jarvis/desktop
```

(Le script n'est pas à la racine : le profil Jarvis fige les scripts de `package.json`.)

## RAPPORT DE VÉRIFICATION

```
RAPPORT DE VÉRIFICATION
Lancement : OK (npm run build, code 0, une fois les fichiers voix déjà présents et conformes à l'empreinte épinglée)
Types     : OK (0 erreur)
Style     : OK (0 avertissement)
Tests     : OK côté cœur (2384/2384). Bureau : 759 réussis, 6 ignorés, 1 échec.
Secrets   : OK (0 vrai secret ajouté ; les sk- des tests existants sont factices)
Fichiers modifiés : enceinte (firmware, cœur speaker, fenêtre Enceintes, guides, coordination, ce rapport)
Prêt à fusionner : NON
À corriger : le clic Installer ne programme pas encore la carte ; multicast-dns n'est pas installé dans package.json ; l'échec bureau « Construire manuel : la carte reste obligatoire » existe déjà sur origin/main (même message) ; un téléchargement voix tout neuf échoue car le fichier Siwis sur Hugging Face n'a plus l'empreinte épinglée (641d1ab0…)
Testé en vrai (sur la carte) : PAS FAIT
```

L'échec bureau n'est pas un des 5 tests .NET attendus sans SDK. Il a été rejoué sur `origin/main` (`6ad0fa5`) : même échec, « Bloqué : typecheck n’a pas été lancé. » Rien de cette branche ne l'a ajouté.

`npm run build` a réussi ici parce que les fichiers voix étaient déjà là, avec la bonne empreinte. Un dossier vide retélécharge Siwis et s'arrête : l'empreinte reçue était `b1d946fd…`, l'empreinte épinglée `641d1ab0…`. Ce n'est pas un changement de cette branche.
