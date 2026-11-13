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

## 4. Résultats des essais du 12 novembre au soir (PC Windows, avec l'utilisateur jusqu'à 22 h 30, puis seul)

Jarvis 5.0.77 construit en local et installé sur le PC (quatre fois : chaque correction a été réinstallée et rejouée). Les essais 12 à 18 (USB) et 34 à 36 étaient exclus d'avance par la feuille de route.

| # | Résultat | Détail |
| --- | --- | --- |
| E1 | FAIT | typecheck, lint OK ; cœur 2479/2479 ; bureau 791 réussis, 8 ignorés, 1 échec « Construire manuel » sous charge seulement |
| E2 | FAIT | 6/6 trois fois de suite seul : remis dans `release.sh`, à part et sans charge |
| E3 | FAIT | seul `whisper-small` dans `voice-assets/whisper` |
| E4 | FAIT | PlatformIO 6.2.0 trouvé ; programme compilé (322 s) : `firmware.bin` 1 638 912 octets + `srmodels.bin` 291 168 octets, première mesure de sa taille ; dans l'installateur |
| E5 | FAIT | empreinte Siwis `641d1ab0…baf99` |
| E6 | FAIT | étiquette `v5.0.72` supprimée (aucune release attachée), décision de l'utilisateur |
| E7 | FAIT, 2 bogues corrigés | le diagnostic disait « bloqué » avec les règles faites à la main ; puis « ouvert » un port fermé (voir corrections 1 et 2) |
| E8 | FAIT, 2 bogues corrigés | « Réparer » ne faisait rien (chemin avec espaces) ; puis ne réactivait pas une règle désactivée (corrections 3 et 5) ; les deux règles « Jarvis — enceintes … » créées avec un vrai tiret |
| E9 | FAIT, 1 bogue corrigé | le refus de la fenêtre d'accord passait pour un succès (correction 4) ; « Windows n'a pas donné l'accord. » affiché ensuite |
| E10 | FAIT | « Passer ce réseau en Privé » : seul « Chezdydy » repasse en Privé, Tailscale et Radmin inchangés |
| E11 | FAIT | micro accordé, caméra refusée (journal `[autorisation] vérification media (video) → refusée`) |
| E19 | FAIT | réveil 3/3, premier réveil de loin plus difficile (modèle « hey jarvis ») |
| E20 | FAIT | heure et date par le chemin réflexe, premier son à 4,9 s (4,5 s de transcription) |
| E21 | FAIT | réponse dès les premières phrases, « Le détail est sur le PC », bloc « Vitesse » avec ses médianes ; le détail est dans la discussion « chambre · … » de l'historique, pas dans la discussion ouverte (à dire mieux, voir § 5) |
| E22 | FAIT, 4 bogues corrigés | la question était remplacée par « C'est parti » (correction 7) ; « fantôme » non reconnu (8 et 9) ; « stop la musique » : réponse Spotify non JSON (10), puis petit modèle qui ne coupait rien (11). Fin d'essai : question posée, « sur la fantôme » → lecture sur la Phantom 98 dB ; le stop final vérifié seul depuis la fenêtre (pause forcée en 0,3 s, Spotify fermé donc « aucun appareil actif », honnête) |
| E23 | FAIT en partie | « Génère-moi une image de Inata de Navuto » → Imager, jamais Spotify ; premier essai bloqué par un Forge d'hier resté en vie (port 7860 pris, « Forge n'a pas démarré en quatre minutes », honnête) ; second essai : image produite (Animagine, 832×1216) mais pas de Hinata (nom déformé par Whisper, mode direct sans reformulation) et pas vue ouverte à l'écran (à vérifier) |
| E24 | FAIT | « Pour ça, il me faut ton accord : demande-le-moi sur le PC ou le téléphone. » |
| E25 | FAIT | cours de SPIE sans modèle, rapide |
| E26 | FAIT | « cours de maths », « cours de guitare » : pas la bourse |
| E27 | FAIT | « cherche le fichier devis » : recherche sur le PC |
| E28 | FAIT, 1 bogue corrigé | la ville extraite était « Internet » (pas d'Open-Meteo, réponse creuse) : correction 12 ; rejoué seul : bloc Open-Meteo présent, 13 °C, nuages, pluie ; ce tour a pris 302 s (à regarder : chargement des modèles après Forge ?) |
| E29 | FAIT, 1 bogue corrigé | la ligne de score n'apparaissait pas dans le Jarvis installé (correction 13) ; rejoué seul : « Trieur : 25 % de bonnes équipes sur tes phrases. Le cerveau : 36 %. Pour l'instant, garde le cerveau. » |
| E30 | FAIT | clés vides dans `settings.json`, `coffre.bin` présent, recherche web encore fonctionnelle ; modèle de chat Ollama, sans clé |
| E31 | FAIT | bilan de santé affiché, rien en rouge d'après l'utilisateur |
| E32 | PAS FAIT | sauvegarde et restauration : l'utilisateur est parti se coucher, la restauration redémarre Jarvis |
| E33 | FAIT | export : 8 fichiers texte, 0 clé ni jeton (vérifié par script) |

### Corrections faites pendant les essais (toutes sur `claude/live-5077`, chacune avec son test)

| # | Commit | Correction |
| --- | --- | --- |
| 1 | `40f40c2` | Enceintes : le diagnostic lit le pare-feu par l'API COM quand les commandes NetSecurity sont refusées sans élévation (« Accès refusé » sur ce PC) |
| 2 | `3510487` | Enceintes : une règle limitée à une appli du Store, un service, une adresse ou une interface n'ouvre pas le port (26 règles « tout » faisaient dire « ouvert ») |
| 3 | `5e898d6` | Enceintes : « Réparer » et « Passer en Privé » partent même depuis un dossier avec des espaces (chemin entre guillemets) ; code de sortie du script élevé remonté |
| 4 | `fd9dce3` | Enceintes : un refus de la fenêtre d'accord sort en code 1 (try/catch autour de Start-Process) |
| 5 | `70c19c6` | Enceintes : « Réparer » réactive une règle du bon nom déjà là mais désactivée |
| 6 | `d2b5df6` | Programme de l'enceinte étiqueté 5.0.77 ; PlatformIO en UTF-8 dans `setup:speaker-firmware` |
| 7 | `a60c492` | Enceinte : la question « Sur la Devialet ou sur le PC ? » n'est plus remplacée par « C'est parti » |
| 8 | `9679698` | Spotify à la voix : « fantôme » ou « la Phantom » reconnus comme « Phantom 98 dB » (comparaison à l'oreille, début du nom) |
| 9 | `76bfd22` | Spotify à la voix : correspondances dédoublonnées (la liste cite chaque enceinte deux fois) |
| 10 | `c256af4` | Spotify : pause et reprise acceptent une réponse 200 sans JSON ; « stop / coupe / éteins la musique » = musique |
| 11 | `c7e7848` | Spotify : « stop la musique », « pause », « reprends » → `spotify_pause` / `spotify_resume` sans modèle |
| 12 | `8ae00b9` | Météo : les mots du web (« Internet », « Google ») ne sont jamais une ville |
| 13 | `5a950bd` | Chef d'orchestre : le score du trieur est aussi lu dans le dossier `rapports` de la copie de travail |
| 14 | `f0dfd41` | `release.sh` : `windowsDesktopMissionPath.test.ts` remis, à part et sans charge |

## 5. Vu pendant les essais, à faire plus tard (pas dans cette version)

- **Image demandée à l'enceinte : aucun retour pendant la génération.** L'enceinte dit une fois « Je la prépare sur le PC » et ne peut rien dire ensuite (c'est elle qui appelle le PC) ; la fenêtre reçoit « montre cette discussion » mais la discussion de l'enceinte n'est enregistrée qu'à la fin du tour, donc rien n'apparaît avant l'image. À faire : afficher sur le PC « image en cours, 44 % » pour une demande venue de l'enceinte, et dire où est le détail (« dans l'historique, discussion chambre »).
- **Image demandée à l'enceinte : nom propre déformé** (« Inata ») et mode direct sans reformulation : le personnage n'est pas reconnu. Piste : passer la demande de l'enceinte par la reformulation du modèle, comme dans la fenêtre.
- **Image non vue ouverte à l'écran** après la génération depuis l'enceinte (le code appelle bien la visionneuse) : à reproduire depuis la fenêtre.
- **Un tour météo à 302 s** lors de la vérification seule (22 h 40) : à mesurer à nouveau à froid.
- **« Jarvis, stop » seul** à l'enceinte met l'enceinte en veille, il ne coupe pas la musique : dire « stop la musique ». À documenter dans le guide de l'enceinte.
- **Un Forge lancé par Jarvis survit à un arrêt forcé de Jarvis** et bloque le port 7860 au tour suivant (quatre minutes d'attente avant le message). Piste : au démarrage, repérer un ancien Forge de Jarvis qui ne répond pas et le dire tout de suite.

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
