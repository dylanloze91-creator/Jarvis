# Enceinte « chambre » : micro, phrases de 15 s, horloge — 11 novembre 2026

Branche `claude/enceinte-micro-diagnostic` (à partir de `main` 5.0.75). Pas de fusion, pas de publication. Carte copie XH-S3E branchée en USB sur COM9, firmware construit et flashé depuis `C:\dev\Jarvis-enceinte-materiel` (copie de l'utilisateur, `secrets.h`), fichiers identiques à ceux de cette branche.

## Symptômes relevés

- Chaque phrase dite à l'enceinte durait les 15 s maximum (chrono 5.0.75 : `audioMs` 15000), Whisper recevait 15 s de bruit, transcriptions fausses (« ma déviée », « Quel rétip ? »).
- Au démarrage, la carte mesurait un bruit de fond de 14 649 à 17 555 (seuil de parole 393).
- « Quel heure est-il ? » (Whisper écrit « Quel ») partait au 7B, qui inventait l'heure (« 14h37 » à 16 h 27).

## 1. Horloge tolérante (cœur)

`packages/core/src/agent/orchestra.ts` : les règles de l'heure et de la date acceptent les fautes habituelles de Whisper (« quel heure est-il », « qu'elle heure », « est-t-il », « est il », « il est quel heure », « t'as l'heure », « quel jour on est », « quelle jour », « on est le combien », « c'est quel jour », « quel est la date »). Le reste de la phrase doit rester vide : « à Tokyo », « du rendez-vous », « le match », « on est parti » vont toujours au modèle. 19 tests (`orchestra.test.ts`), typecheck et lint verts.

## 2. Analyse du son envoyé par la carte

Le pont ne garde pas les WAV reçus. Capture : Jarvis fermé 7 minutes, un enregistreur à sa place sur le port 53131 (même jeton), l'utilisateur a parlé à l'enceinte. Fichier hors dépôt : `C:\dev\jarvis-data\enceinte-capture\2026-11-11-carte-chambre.wav` (15,00 s) et une copie normalisée `…-ecoute.wav`.

| Mesure | Valeur | Lecture |
| --- | --- | --- |
| Décalage continu | +57 | négligeable |
| RMS / crête | 6 024 / 32 768, 0,75 % d'échantillons saturés | voix de près qui sature à ×8 (`MIC_SHIFT 13`) |
| Bits 0 à 7 à 1 | 49 à 50 % chacun | bits bien alignés (pas de décalage de mot I2S) |
| Pairs / impairs | RMS 6 025 / 6 022 | pas d'alternance de canaux (L/R correct) |
| Corrélation voisins | +0,982 | signal continu, vrai son |
| Seconde la plus calme | RMS 1 565, **98 % de l'énergie sous 20 Hz** | dérive lente, pas du bruit de pièce |
| Seconde la plus forte | RMS 10 987, 120–1 000 Hz 78 % | voix |
| Trames de 32 ms sous le seuil 393 | 1,7 % ; après passe-haut 100 Hz : 48,9 % ; passe-haut et ÷8 : 92,7 % | le silence n'existait jamais |

Verdict : **vrai son, câblage bon** (SCK/WS, alignement, L/R), mais une dérive sous 20 Hz que le filtre de la carte (2,5 Hz) laissait passer, plus un gain trop fort. Pas de fil à vérifier.

## 3. Whisper avec un WAV propre (fausse enceinte, 1,95 s)

| Passage | Transcription | Total |
| --- | --- | --- |
| 1 (Spotify jouait) | 14,2 s | 24,2 s |
| 2 (PC au repos) | 16,2 s | 33,3 s (trieur illisible → cerveau) |
| Fenêtre du PC, 5 dictées de 3,8 à 6,8 s | 13,6 à 22,3 s | — |

Le worker Whisper est bien chargé (« 4 threads »). La lenteur vient de Whisper sur ce PC, pas des 15 s de bruit. Non résolu ici ; à mesurer avec l'écoute de la fenêtre, l'apprentissage du réveil et Ollama coupés (0.4.17 donnait 2,3 s sur une VM).

## 4. Firmware de test, flashé sur COM9

- `include/mic_filter.h` (nouveau, sans matériel) : retrait de l'offset puis passe-haut du premier ordre à ~100 Hz, en entiers. Test `host-tests/mic_filter_test.c` ajouté à `run.sh` : dérive ±15 000 à 2 Hz → 132 RMS ; ton 400 Hz gardé à 95 % ; 150 Hz à 82 % ; bornes 16 bits tenues. **Pas de gcc sur ce PC** : syntaxe vérifiée avec le compilateur ESP (`-fsyntax-only`), les cinq contrôles rejoués à l'identique en Python (entiers).
- `config.h` : `MIC_SHIFT 14` (×4 au lieu de ×8, la voix de près ne sature plus) ; `SPEECH_RMS_MAX 2500` ; `MIC_DUMP_AT_BOOT` (0 ; à 1, une demi-seconde de micro brut en hexadécimal au démarrage, pour l'analyse).
- `main.c` : le seuil de parole devient 2 × le bruit mesuré au démarrage quand il dépasse 393 (2 500 au plus), journalisé.
- `led.c` : pile de la tâche LED 2 048 → 4 096 octets. Avec 2 048, le journal d'erreur du pilote RMT faisait déborder la pile au démarrage (11 plantages sur 12 démarrages observés) : défaut préexistant.

Mesures après flash (même carte, même place, à côté du PC) :

| Mesure | Avant | Après |
| --- | --- | --- |
| Bruit de fond au repos | 14 649 à 17 555 | 497 à 2 164 (546 au dernier démarrage ; le haut de la fourchette pendant une compilation, ventilateurs à fond) |
| Reste du bruit | — | sifflement à 450–480 et 890 Hz (48 % de l'énergie dans 8 raies) : ventilateur ou bruit électrique du PC à côté, pas du bruit de pièce |
| Seuil de parole | 393 fixe | 1 092 (2 × 546) |
| Phrase « Jarvis, quelle heure est-il ? » | 15 000 ms | **2 656 ms**, chemin réflexe, réponse « Il est 17 h 28 », total 14,7 s dont Whisper 13,8 s |

## 4 bis. Enceinte remise dans la chambre (sur son chargeur)

Sans câble USB, le bruit de fond du démarrage ne se lit pas (il n'est écrit que sur le port série). Mesure par le chrono du PC sur quatre phrases dites dans la chambre :

| Phrase (transcription Whisper) | Durée captée | Chemin | Réponse |
| --- | --- | --- | --- |
| « Qu'en aurais-tu ? » (était « quelle heure est-il ») | 2 176 ms | cerveau | hors sujet |
| « Je t'ai demandé quelle heure est-il ? » | 2 080 ms | trieur → modèle | **« Il est 15h30 »** (inventé, il était 17 h 52) |
| « Quelle heure est-il ? » | 3 392 ms | trieur | — |
| « Quel jour on est ? Quel jour on est ? » | 9 632 ms (dite deux fois) | trieur → modèle | **« C'est mardi »** (inventé, mercredi) |

Le seuil adaptatif tient dans la chambre : plus aucune phrase de 15 s. Les réponses fausses viennent d'ailleurs : une amorce (« je t'ai demandé ») ou une répétition empêchaient la règle de l'horloge, la phrase partait au trieur (toujours actif dans les réglages) puis au modèle, qui invente l'heure. Deux corrections sur la branche :

- `normalizeClockQuestion` : amorces (« je t'ai demandé », « tu peux me dire », « dis-moi », « s'il te plaît »), politesse finale et question répétée retirées avant les règles ; « quelle heure est le match » et « quelle heure est-il ? et demain ? » restent au modèle. 20 tests.
- `clockLinePrompt` : les équipes du chef d'orchestre reçoivent la date et l'heure du PC dans leur consigne (`teamPrompt(team, caractère, horloge)`, `session.ts`) : si une transcription abîmée échappe aux règles, le modèle a l'heure vraie sous les yeux. Le chat sans orchestre et le cerveau ne changent pas (`chat-unchanged`, `orchestra-session`, `persona-session` verts).

Ces corrections ne sont pas dans la 5.0.75 installée : elles prendront effet à la prochaine version.

## 5. Câblage

Rien à vérifier : le signal est bien aligné et continu, les deux moitiés d'échantillons sont identiques, le décalage continu est nul. Pas besoin de photo.

## Reste à faire

- Whisper à 14 s par phrase sur ce PC (point 3).
- Remettre l'enceinte à sa place (loin du PC, sur son chargeur) et relire le bruit de fond au démarrage : s'il tombe bien sous 393, le seuil reste 393.
- Le trieur est **encore** dans les réglages (`orchestra.router = jarvis-trieur`, chemin « trieur » dans le chrono) : à retirer dans Réglages → Le cerveau de Jarvis → Chef d'orchestre.
- Effets de la séance : carte redémarrée une dizaine de fois, Jarvis fermé trois fois puis relancé, Spotify lancé puis mis en pause, deux fausses questions dans la discussion « chambre ».

## RAPPORT DE VÉRIFICATION

```
RAPPORT DE VÉRIFICATION
Lancement : OK (firmware construit et flashé 5 fois par PlatformIO sur COM9 ; dernier démarrage sans plantage ; npm run build du cœur non relancé : seule une règle pure change)
Types     : OK (tsc du cœur, 0 erreur)
Style     : OK (eslint sur orchestra.ts et son test, 0 avertissement)
Tests     : OK (orchestra.test.ts 19/19 dont les fautes Whisper ; mic_filter_test.c : pas de gcc sur ce PC, syntaxe vérifiée avec le compilateur ESP et les 5 contrôles rejoués en Python)
Secrets   : OK (jeton de l'enceinte lu dans secrets.h hors dépôt, jamais affiché ; WAV de l'utilisateur hors dépôt)
Fichiers modifiés : packages/core/src/agent/orchestra.ts, orchestra.test.ts ; firmware/jarvis-speaker/include/{mic_filter.h,config.h}, src/{audio_io.c,main.c,led.c}, host-tests/{mic_filter_test.c,run.sh} ; ce rapport ; AGENTS-COORDINATION.md ; CLAUDE.md
Prêt à fusionner : PAS FAIT (demande de l'utilisateur : pas de fusion ; firmware à essayer à sa place habituelle)
À corriger : Whisper 14 s par phrase ; bruit tonal à côté du PC
Testé en vrai (à la voix, sur le PC) : FAIT (l'utilisateur a parlé à l'enceinte : phrase de 2,66 s, réponse juste)
```
