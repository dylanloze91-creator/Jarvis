# Brancher une enceinte — rapport

Branche `cursor/enceinte-raccordement`, à partir de `origin/main` (`6ad0fa5`, Jarvis 5.0.75). Version non changée. Pas de fusion, pas de publication. **Testé en vrai (sur la carte) : PAS FAIT.**

La réservation `cursor/enceinte-materiel` sur `firmware/jarvis-speaker/` était encore « en cours » alors que la branche est entièrement dans la 5.0.75. Elle a été close avant de réserver ce chantier.

## Fait / pas fait

| Partie | État | Pourquoi |
| --- | --- | --- |
| 0 Reconnaissance | Fait | `rapports/2026-11-11-enceinte-raccordement-choix.md` |
| 1 Programme de la carte | Fait dans le code, pas compilé ici | Protocole C testé sur le PC (`npm run test:firmware --workspace @jarvis/desktop`). PlatformIO n'a pas été lancé : pas de `pio`. |
| 2 Programme livré | Fait, sans `.bin` | Script `setup:speaker-firmware`, manifeste vérifié, dossier ignoré par git sauf les textes. |
| 3 Installation USB | Fait dans le clic et dans les tests | « Installer » appelle `installSpeaker` puis `esptoolFlasher` (esptool-js 0.7.1). Les tests utilisent un faux port et un faux programmeur : succès, même version, mauvaise puce, flash trop petite, geste BOOT, écriture arrêtée, mauvais mot de passe, PC introuvable. La vraie carte n'a pas été programmée. |
| 4 mDNS et diagnostic | Fait après la revue | L'annonce `multicast-dns` était déjà ouverte avec le pont. La revue a montré que les scripts n'étaient pas lancés : c'est corrigé, voir plus bas. |
| 5 Liste | Fait après la revue | Le signal et « Ancienne version » étaient là. Faire signe, Renommer, Changer le Wi-Fi et Remplacer manquaient : c'est corrigé, voir plus bas. |
| 6 Mise à jour sans fil | Pas fait | Taille mesurée : **aucune**. Il n'y a pas de `firmware.bin` ni de `srmodels.bin` sur cette machine, et `pio` n'est pas installé. On ne peut donc pas dire si deux emplacements tiennent à côté du modèle. La mise à jour reste par USB. |
| 7 Secours sans câble | Pas fait | Le reste n'est pas essayé sur la carte, et ce point compliquerait le programme. |
| 8 Guides | Fait | `docs/enceinte-brancher.md` et le README du programme. |

Le fichier `.github/workflows/firmware.yml` n'a pas été poussé : le jeton refuse d'écrire un workflow. À ajouter plus tard, compilation seule, sur `firmware/**`.

## Choix de la partie 0

Détail et liens : `rapports/2026-11-11-enceinte-raccordement-choix.md`.

- Electron **44.4.5**, Web Serial, geste obligatoire pour `requestPort()`.
- esptool-js **0.7.1** (Apache-2.0), sans `eval`.
- mDNS : **multicast-dns 7.2.5** (MIT), installé, une socket par interface, `reuseAddr` vrai.
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
10. Le clic « Installer » est branché. Sur la vraie carte, vérifier qu'esptool-js entre en programmation (sinon le geste BOOT) et que la phrase d'accueil est dite. Ce n'est pas fait ici.

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

## Corrections après la revue

Revue lue sur `origin/claude/specs-enceinte-raccordement` (`docs/revues/2026-11-11-enceinte-raccordement.md`). Le git fait foi.

1. **Micro — Fait.** Un seul gestionnaire de permissions. `serial` n'est accordé qu'à la fenêtre de Jarvis. Le micro garde `allowPermissionCheck`. Le test vérifie qu'une demande `media` suit encore cette règle quand la liaison série est en place.
2. **Programmation — Fait.** Un seul propriétaire du port. La liaison texte a un lecteur permanent et relâche l'écrivain après chaque ligne. Le port est fermé avant esptool, et c'est esptool qui l'ouvre. Après la remise à zéro, le port est retrouvé (même objet en UART, nouvel objet de même VID/PID en USB natif). Le faux port refuse une seconde ouverture, un second verrou, et compte les octets jetés par l'annulation. Branché sur le clic « Elle est branchée ».
3. **Délais et liste Wi-Fi — Fait.** Le test attend 25 s (Wi-Fi), 12 s (PC), 8 s (pont) et 20 s (voix). Le scan attend 5 s. L'écran Wi-Fi vient après la reconnaissance et montre la liste du scan, plus « Autre réseau… ». Le nom du réseau est échappé dans le JSON de la carte (`"` et `\`) ; un caractère de contrôle est écarté.
4. **Diagnostic et réparation — Fait.** Un script constant lit les règles TCP 53131 et UDP 5353 et le profil des interfaces, sans rien changer. Le panneau est dans Enceintes. Il s'ouvre tout seul si le test échoue à `pc` ou `bridge`. « Réparer » et « Passer ce réseau en Privé » ne partent qu'au clic, par `Start-Process -Verb RunAs`. Un refus de Windows est dit tel quel. Privé ne reçoit que l'index de l'interface de la maison. La règle mDNS ouvre UDP 5353. L'accord Windows n'a pas été demandé sur cette machine.
5. **Liste des enceintes — Fait.** « Faire signe » pose `identify` dans le prochain hello, une seule fois, et la carte ne le prend que si c'est `true`. « Renommer » pose `rename` dans ce même hello, et le nom du PC change au moment où la carte est prévenue. « Changer le Wi-Fi » est le chemin court par USB : pas de réécriture du programme, pas de nouvelle clé, commande `wifi`. « Remplacer l'enceinte … » s'affiche avant d'écraser une carte déjà connue.

Moins graves, faits ensuite :

- L'annonce mDNS se refait toutes les 60 s si la liste des adresses de la maison a changé. Sinon elle reste.
- Une carte sans MAC n'est plus enregistrée comme `00:00:00:00:00:00`.
- Les parties 4 et 5 du premier passage étaient « fait à moitié ». Le tableau du haut le dit maintenant.

L'échec bureau n'est pas un des 5 tests .NET attendus sans SDK. Il a été rejoué sur `origin/main` (`6ad0fa5`) : même échec, « Bloqué : typecheck n’a pas été lancé. » Rien de cette branche ne l'a ajouté.

`npm run build` a réussi au passage précédent parce que les fichiers voix étaient déjà là, avec la bonne empreinte. Un dossier vide retélécharge Siwis et s'arrête : l'empreinte reçue était `b1d946fd…`, l'empreinte épinglée `641d1ab0…`. Ce n'est pas un changement de cette branche. Ce passage n'a pas relancé `npm run build`.

## RAPPORT DE VÉRIFICATION

```
RAPPORT DE VÉRIFICATION
Lancement : non relancé (la consigne demandait typecheck, test, lint)
Types     : OK (npm run typecheck, 0 erreur)
Style     : OK (npm run lint, 0 avertissement)
Tests     : cœur 2389/2389. Bureau : 781 réussis, 6 ignorés, 1 échec déjà présent sur origin/main. chat-unchanged, ollama-unchanged, orchestra-session verts. Essais C du protocole verts.
Secrets   : OK (0 vrai secret, 0 mot de passe Wi-Fi sur disque ou dans un journal)
Fichiers modifiés : micro, port USB, liste Wi-Fi, diagnostic, liste des enceintes, annonce, rapport
Prêt à fusionner : NON
À corriger : essai sur la vraie carte ; partie 6 sans binaire mesuré ; l'échec bureau « Construire manuel : la carte reste obligatoire » existe déjà sur origin/main
Testé en vrai (sur la carte) : PAS FAIT
```
