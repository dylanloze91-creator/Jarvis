# Cahier — la carte de l'utilisation réelle

12 novembre 2026. Mission Cursor n° 5 (décision de l'utilisateur du 12 au soir : c'est du code pur, Cursor le fait).

## Pourquoi

On n'entraîne un modèle que là où l'usage réel montre qu'il échoue. Il faut donc d'abord savoir, **en chiffres**, ce que l'utilisateur demande vraiment à Jarvis et à Claude :
- quels sujets ;
- quels langages de code ;
- quels outils ;
- à quelle fréquence ;
- où ça rate.

C'est la carte. Ensuite viendra l'examen fait de ses vraies tâches (autre mission, pas maintenant).

## Ce qu'on livre

Un script du cœur, sans modèle et sans réseau :

```
npm run carte:utilisation --workspace @jarvis/core -- \
  --conversations <dossier conversations> [--conversations <autre dossier>] \
  [--carnet <rates.jsonl>] [--export-claude <dossier ou .zip claude.ai>] \
  [--claude-code <dossier .claude\projects>] \
  [--dir C:\dev\jarvis-data] [--rapport <fichier.md>]
```

Plus `scripts/carte-utilisation.ps1` (UTF-8 **avec BOM**) qui trouve seul les dossiers habituels sur le PC (conversations de Jarvis Live et de Jarvis Test, carnet de Jarvis Test, `%USERPROFILE%\.claude\projects`), dit lesquels il a trouvés, et lance le script. Une source absente est dite, jamais une erreur.

Rien ne change dans l'appli Jarvis (ni Live, ni Test) : pas de réglage, pas d'outil, pas d'écran.

## Les sources (toutes facultatives, toutes en lecture seule)

1. **Conversations de Jarvis** (`userData\conversations\*.json`, format `Conversation` / `StoredConversation` de `packages/core/src/trieur/extract.ts`). On lit :
   - les messages de l'utilisateur ;
   - les appels d'outils et leur `toolStatus` ;
   - `routeLog` (équipe choisie) ;
   - les missions (`chatMission`, `missionId`).
2. **Carnet des ratés** (`rates.jsonl`), format décrit dans `packages/core/src/carnet/FORMAT.md` sur la branche `cursor/carnet-des-rates`. La branche du carnet n'est pas encore dans `main` : lire le fichier ligne à ligne, ignorer et compter une ligne illisible ou d'un type inconnu.
3. **Export claude.ai** : réutiliser `packages/core/src/trieur/claudeExport.ts`, sans le modifier.
4. **Sessions Claude Code** (`.claude\projects\**\*.jsonl`) : seulement les messages tapés par l'utilisateur (type `user` avec du texte). Ignorer les résultats d'outils, les messages de Claude et les résumés.

Un fichier abîmé est sauté et compté, jamais bloquant.

## Le classement : des règles, pas de modèle

Chaque demande de l'utilisateur reçoit **une famille** et, si c'est du code, **un langage**. Règles seulement (mots-clés, extensions de fichiers, blocs de code), dans `packages/core/src/carte/families.ts`, testées une par une.

Familles de départ (à garder dans une seule liste, facile à compléter) :

| Famille | Exemples d'indices |
| --- | --- |
| code | fichier `.ts` `.py` `.ps1` `.cpp` `.ino`, « bug », « compile », « script », bloc de code |
| impression 3D | gcode, Klipper, Moonraker, trancheur, buse, plateau |
| CAO et 3D | FreeCAD, Blender, STL, esquisse, pièce |
| électronique et enceinte | ESP32, micro, câblage, firmware, Wi-Fi |
| musique | Spotify, playlist, chanson |
| bourse et argent | action, cours, bourse, prix |
| météo et agenda | météo, pluie, rendez-vous, agenda |
| recherche | cherche, trouve, qu'est-ce que |
| images | image, logo, dessin, photo |
| vinyle et stickers | vinyle, sticker, bandeau, découpe |
| chantier | charpente, couverture, devis, chevron, liteau |
| quotidien | note, routine, rappel, briefing |
| Jarvis lui-même | Jarvis, réglage, mise à jour, version |
| conversation | salut, merci, phrases courtes sans demande |
| autre | le reste |

Langages : TypeScript, JavaScript, Python, PowerShell, C ou C++ (dont Arduino et ESP-IDF), G-code et Klipper, HTML et CSS, SQL, Bash, autre.

## Ce que la carte compte

Par source, puis toutes sources ensemble :

- nombre de demandes, de conversations, de jours actifs ;
- par famille : nombre, part en %, et **taux de ratés** ;
  - pour Jarvis, un raté est : une ligne du carnet, un outil en erreur ou refusé, ou une correction de l'utilisateur (`classifyUtterance`) ;
- par langage de code ;
- pour Jarvis seulement :
  - par équipe choisie et par façon de choisir (`how`) ;
  - par outil (réussi, raté, refusé) ;
  - par lieu (fenêtre, téléphone, enceinte), quand c'est connu ;
- par heure de la journée et par jour de la semaine ;
- par mois ;
- **les familles qui ratent le plus** : classées par nombre de ratés, puis par taux.

## Où vont les résultats

- **Sur le PC seulement**, dans `<dir>\carte\` (par défaut `C:\dev\jarvis-data\carte\`) :
  - `carte.json` et `carte.md` : les chiffres ;
  - `references.jsonl` : pour chaque demande, la source, l'identifiant de la conversation et du message, la famille et le langage. **Pas le texte.** Il servira à l'examen, plus tard.
- **`--rapport <fichier.md>`** : les mêmes chiffres en Markdown, sans aucun identifiant ni texte. C'est le seul fichier qui peut aller dans `rapports/` du dépôt.

## Règles qui ne bougent pas

- **Aucune phrase de l'utilisateur dans une sortie**, ni dans le dépôt, ni dans `carte.json`. Un test le garantit : avec des conversations `synthetique-test`, aucune suite de 4 mots des phrases d'entrée ne se retrouve dans `carte.json`, `carte.md` ni dans le rapport.
- **Lecture seule** des sources : aucun fichier source ouvert en écriture, rien de déplacé ni d'effacé.
- **Aucun modèle, aucun réseau.**
- Aucun chemin personnel, aucun nom réel dans le dépôt. Données de test marquées `synthetique-test`.
- `__golden__` jamais régénérés. `parseSettings({})` inchangé. Aucune dépendance native.
- `claudeExport.ts`, `extract.ts` et le trieur ne changent pas : on les réutilise.

## Fin de mission

Branche `cursor/carte-utilisation`, partie de `main`. Rapport `rapports/2026-11-AA-carte-utilisation.md` avec le RAPPORT DE VÉRIFICATION habituel. Pas de fusion. Claude relit. Puis Claude Code lance `carte-utilisation.ps1` sur le PC, et l'utilisateur envoie à Claude **le rapport chiffré seulement**.
