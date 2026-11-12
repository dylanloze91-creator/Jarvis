# Jarvis Live 5.0.77 — ce qui reste à vérifier

Date : 2026-11-12. Branche `claude/live-5077` (à partir de `main`, 5.0.76). Rien n'est fusionné dans `main`, rien n'est publié.

Sources relues : rapports de publication 5.0.70 à 5.0.76, les rapports de chantier qu'ils citent (interface simple, lot A, Spotify, Imager, mode direct, Réflexe, écran du PC, micro, raccordement, bourse et tri, Whisper), la revue du raccordement (deuxième relecture) et `AGENTS-COORDINATION.md`. Tout ce qui y est marqué « PAS FAIT », « non testé », « non essayé » ou « à vérifier sur Windows » est ci-dessous, une fois.

Cette session tourne sur une machine Linux dans le nuage : pas de Windows, pas de PowerShell, pas d'enceinte, pas de carte graphique, pas d'accès à Hugging Face. Rien de ce qui suit n'a donc pu être essayé « en vrai » ici.

## 1. Corrigé dans cette branche (sans matériel)

| # | Point | D'où il vient | Ce qui est fait | Test |
| --- | --- | --- | --- | --- |
| C1 | Le diagnostic et « Réparer » des enceintes étaient refusés sur un Windows réglé par défaut (politique d'exécution PowerShell) | Revue du raccordement, retouche 1 | `-ExecutionPolicy Bypass` à la lecture et au lancement élevé (`repair.ts`) | `repair.test.ts` |
| C2 | Une vérification de la caméra passait (l'origine était lue à la place du type de média) | Revue, retouche 2 | `details.mediaType` lu (4e argument d'Electron) ; le faux de session du test suit la vraie signature (`serialAccess.ts`) | `serialAccess.test.ts` (échoue sur l'ancien code) |
| C3 | Le diagnostic disait « pare-feu fermé » avec une règle faite à la main ou créée par Windows pour Jarvis.exe | Revue, retouche 3 | Le script rapporte toutes les règles entrantes actives ; le cœur décide (`firewallOpens`) : TCP 53131 ou Jarvis.exe, UDP 5353, profil Privé | `diag.test.ts` |
| C4 | « Réparer » échouait si Jarvis est installé sous un nom d'utilisateur accentué | Revue, petit point | `psQuote` accepte les lettres accentuées, toujours aucun caractère dangereux | `repair.test.ts` |
| C5 | La règle de pare-feu créée par « Réparer » s'appelait « Jarvis â€” enceintes » (tiret abîmé par Windows PowerShell 5.1) | Vu en relisant les scripts | Les trois scripts `speaker-*.ps1` portent la marque UTF-8 | `diag.test.ts` |
| C6 | L'installateur 5.0.76 est parti sans l'étape qui compile le programme de l'enceinte, demandée par le rapport du raccordement (« Étape à ajouter à `release.sh` ») | Rapport du raccordement | `release.sh` compile le programme si PlatformIO est là, prévient sinon, et vérifie qu'il est dans l'installateur | lecture seule (`bash -n`), voir E1 |
| C7 | `whisper-base` était parti dans l'installateur 5.0.76 (+47 Mo) | Publication 5.0.76 | `release.sh` s'arrête si un modèle Whisper en trop est dans `voice-assets/whisper` | lecture seule, voir E1 |
| C8 | `windowsDesktopMissionPath.test.ts` « Construire manuel » échouait 8 fois sur 8 (exclu de `release.sh` depuis la 5.0.73, « à réparer ») | Publications 5.0.73 à 5.0.76 | Le test écrivait le nom du projet en dur alors qu'il vient de la demande : corrigé. 6/6 verts ici (`dotnet` simulé) | le test lui-même ; voir E2 |
| C9 | `npm test` échouait hors ligne (un test appelle Hugging Face) | Vu en lançant la suite ici | Hugging Face injoignable = test ignoré, pas raté ; une mauvaise réponse reste un échec | `candidates.test.ts` |
| C10 | Un test du lanceur échouait dans un conteneur sans « init » (processus tué resté zombie) | Vu en lançant la suite ici | Un zombie compte comme arrêté (il ne peut plus rien exécuter) | `runner.test.ts` |
| C11 | CLAUDE.md disait encore « points 4 et 5 à vérifier sur Windows » (audit 5.0.64) | `AGENTS-COORDINATION.md`, CLAUDE.md | Déjà vérifiés conformes le 2 novembre (`rapports/2026-11-02-verification-windows-5064.md`) : phrase mise à jour | — |

## 2. Essais à faire ensemble, sur le PC Windows

Dans l'ordre conseillé. « Attendu » = ce que tu dois voir ou entendre.

### A. Avant de publier (dans `C:\dev\Jarvis`, branche `claude/live-5077`)

| # | Essai | Attendu |
| --- | --- | --- |
| E1 | `npm run typecheck`, `npm run lint`, `npm test` sous Windows | tout vert (les 5 tests .NET passent puisque le SDK est là) |
| E2 | `npm test -w @jarvis/desktop -- src/main/developer/project/windowsDesktopMissionPath.test.ts`, trois fois de suite | 6/6 à chaque fois. Si oui, on le remet dans `release.sh` ; sinon il reste exclu |
| E3 | Vérifier que `apps/desktop/voice-assets/whisper/Xenova/` ne contient que `whisper-small` | `release.sh` s'arrête sinon, avec le dossier en trop |
| E4 | `release.sh` trouve PlatformIO (`pio`) et compile le programme de l'enceinte | ligne « Programme de l'enceinte présent dans l'installateur. » ; sans PlatformIO : un avertissement, et l'installateur part **sans** le programme |
| E5 | Empreinte de la voix Siwis : Cursor a noté qu'un téléchargement neuf ne correspondait plus à l'empreinte épinglée (`641d1ab0…` attendu, `b1d946fd…` reçu). Sur ton PC le fichier est déjà là, donc la construction passe. À contrôler : `certutil -hashfile apps\desktop\voice-assets\piper\fr_FR-siwis-medium.onnx SHA256` | `641d1ab0…baf99`. Non vérifiable ici (Hugging Face bloqué) |
| E6 | Supprimer l'étiquette `v5.0.72` posée par erreur (`git push origin :refs/tags/v5.0.72`) | ta décision : je ne l'ai pas fait |

### B. Raccordement d'une enceinte (jamais essayé sur la carte)

| # | Essai | Attendu |
| --- | --- | --- |
| E7 | Réglages → Enceintes → diagnostic, avec ta règle de pare-feu faite à la main | « ouvert » pour TCP 53131 ; UDP 5353 « ouvert » seulement si une règle le laisse entrer pour Jarvis |
| E8 | Désactiver ta règle, rouvrir le diagnostic, cliquer « Réparer » | fenêtre d'accord de Windows, puis « ouvert » ; dans le pare-feu Windows, deux règles « Jarvis — enceintes … » avec un vrai tiret |
| E9 | Refuser la fenêtre d'accord de Windows | « Windows n'a pas donné l'accord. », rien n'est changé |
| E10 | Passer le Wi-Fi en « Public », ouvrir le diagnostic, « Passer ce réseau en Privé » | le réseau repasse en Privé, seulement celui de la maison |
| E11 | Demander la caméra ne doit rien donner ; le micro marche toujours (« Tester la voix », étape « Accès au micro ») | micro accordé, aucune caméra |
| E12 | Installation complète par USB (carte XH-S3E, prise UART puis prise USB), chronomètre | moins de 5 minutes ; l'enceinte dit « Bonjour, je suis l'enceinte du Salon » ; si esptool n'entre pas en programmation, le geste BOOT est proposé |
| E13 | Mauvais mot de passe Wi-Fi ; réseau 5 GHz seul ; réseau au nom caché | une phrase claire à chaque fois, rien d'écrit sur le disque |
| E14 | Nouvelle adresse du PC (nouveau bail) | l'enceinte retrouve le PC seule (mDNS) |
| E15 | Tailscale et Radmin allumés | aucune de leurs adresses n'est annoncée |
| E16 | BOOT tenu 10 s puis réinstallation ; « Retirer » | l'enceinte oublie ; après « Retirer », violet fixe (clé refusée) |
| E17 | « Faire signe », « Renommer », « Changer le Wi-Fi », « Remplacer » | chacun fait ce qu'il dit, sans nouvelle clé pour le Wi-Fi |
| E18 | L'enceinte « chambre » déjà installée (ancien chemin `secrets.h`) | elle répond encore |

### C. Enceinte à la voix

| # | Essai | Attendu |
| --- | --- | --- |
| E19 | Gain du micro ×4 (déjà flashé, validé dans la chambre) : « Jarvis » de loin, une phrase de près, une de loin | réveil 3/3, phrases comprises (déjà FAIT le 11 novembre, à redire une fois sur la 5.0.77 installée) |
| E20 | « Jarvis, quelle heure est-il ? » puis « quel jour on est ? » | l'heure et la date du PC, sans modèle, en 2 à 5 s |
| E21 | Mode enceinte rapide (Réglages → Enceintes) : une longue question | l'enceinte parle dès les premières phrases, puis « Le détail est sur le PC. » ; Réglages → Enceintes → « Vitesse » montre les durées |
| E22 | « Jarvis, mets de la musique » avec « Me demander où jouer la musique » | « Sur la Devialet ou sur le PC ? », puis la lecture au bon endroit ; « stop » n'attend pas la question |
| E23 | « Jarvis, génère-moi une image de Hinata de Naruto » | Jarvis Imager, jamais Spotify ; l'image s'ouvre sur l'écran du PC |
| E24 | Une action à confirmer dite à l'enceinte (« supprime le fichier … ») | « Pour ça, il me faut ton accord : demande-le-moi sur le PC ou le téléphone. » |

### D. Bourse et tri (fusionnés dans cette version, jamais essayés à la voix)

| # | Essai | Attendu |
| --- | --- | --- |
| E25 | « Jarvis, le cours de SPIE » | le cours de SPIE (Paris), sans modèle ; éventuellement « Tu voulais peut-être … ? » |
| E26 | « J'ai cours de maths demain ? », « le cours de guitare de jeudi » | pas la bourse |
| E27 | « Cherche le fichier devis dans mes documents » | pas Internet : la recherche sur le PC |
| E28 | « Cherche sur Internet la météo à Lyon » | Internet, avec les sources |
| E29 | Réglages → Chef d'orchestre | le score du trieur s'affiche (« garde le cerveau »), rien n'est activé |

### E. Fiabilité (lot A, 5.0.75) — jamais essayé sur Windows

| # | Essai | Attendu |
| --- | --- | --- |
| E30 | Coffre des clés : après la mise à jour, ouvrir `%APPDATA%\…\settings.json` | les clés API y sont vides, `coffre.bin` existe, les services marchent encore (une question à un fournisseur à clé, la recherche) |
| E31 | « Jarvis, est-ce que tout va bien ? » et Réglages → Application → « Bilan de santé » | une phrase courte à la voix ; le bilan liste Ollama, voix, Piper, Spotify, Google, Tailscale, enceintes, disque |
| E32 | Sauvegarde : choisir un dossier, « Sauvegarder maintenant », puis « Restaurer » | un zip `jarvis-sauvegarde-*.zip` ; restauration après une carte, puis redémarrage |
| E33 | Réglages → Moi → « Ce que Jarvis sait de moi » : voir, exporter | export sans aucune clé |

### F. Interface (5.0.70) et images (5.0.71 à 5.0.74)

| # | Essai | Attendu |
| --- | --- | --- |
| E34 | Les six catégories des réglages, la recherche, « Jarvis, refais le questionnaire » | tout s'ouvre, le questionnaire revient |
| E35 | Panneau « Imager direct » : une consigne telle quelle, puis avec « Améliorer mon prompt » | l'image sort, la consigne finale est affichée, le modèle de langage est rechargé après |
| E36 | Une photo jointe + « refais-la en dessin » | image vers image (ancien chemin, gardé) |

## 3. Connu, pas corrigé dans cette version (ce serait une nouveauté ou il faut le matériel)

- **Mise à jour sans fil de l'enceinte** et **secours sans câble** (parties 6 et 7 du raccordement) : non écrites. La taille du programme n'a jamais été mesurée. Mise à jour par USB.
- **La carte n'appelle pas `/api/speaker/wake`** : le préchauffage part à l'activation, pas au mot « Jarvis ».
- **Gains de Jarvis Réflexe** : estimations, jamais mesurées avec la vraie enceinte (le chrono de E21 donnera les vrais chiffres).
- **Réglage « Transcription : précise / rapide »** (`whisper-base`) : proposé, non fait ; `whisper-small` reste.
- **Whisper à l'enceinte** déforme encore certains noms propres (« Inata Tenauto ») ; **Jarvis ne fait pas de vidéo** et ne le dit pas nettement.
- **Images** : temps par image avec les retouches, mains des personnages anime, dictionnaire du mode direct limité, Juggernaut XI non posé (licence non commerciale).
- **Trieur** : non activé ; chez toi `orchestra.router = jarvis-trieur` était resté dans les réglages (à retirer dans Réglages → Le cerveau de Jarvis → Chef d'orchestre si ce n'est pas fait).
- **Bruit de fond de l'enceinte** à relire à sa place habituelle (seuil 393), et bruit tonal à côté du PC.
- **`.github/workflows/firmware.yml`** (compilation du programme de l'enceinte à chaque changement) : jamais poussé, le jeton de Cursor refusait d'écrire un workflow.
- **`windowsDesktopMissionPath.test.ts`** : réparé ici, mais toujours exclu de `release.sh` tant que E2 n'est pas fait.
