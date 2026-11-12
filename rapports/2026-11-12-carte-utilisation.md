# Carte de l'utilisation réelle — 12 novembre 2026

Branche `cursor/carte-utilisation`, partie de `main`. Pas de fusion, pas de publication. Rien ne change dans l'application (ni Live, ni Test).

Le script compte, sans modèle et sans réseau, les demandes déjà enregistrées : sujets (familles), langages de code, outils, équipes, lieux quand on les connaît, heures, jours, mois, et les familles qui ratent le plus. Une phrase tapée n'est jamais recopiée.

## Où ça s'écrit sur le PC

`C:\dev\jarvis-data\carte\`

- `carte.json` et `carte.md` : les chiffres
- `references.jsonl` : pour chaque demande, la source, l'identifiant, la famille et le langage. Pas le texte. Ce fichier reste sur le PC.

## Essais pour Claude Code

Depuis la racine du dépôt, sur cette branche :

```powershell
powershell -File scripts\carte-utilisation.ps1
```

Le script cherche seul :

- conversations de Jarvis Live (`%APPDATA%\Jarvis\conversations`)
- conversations du développement (`%APPDATA%\@jarvis\desktop\conversations`)
- conversations de Jarvis Test (`%APPDATA%\Jarvis Test\conversations`)
- carnet de Jarvis Test (`%APPDATA%\Jarvis Test\carnet\rates.jsonl`)
- sessions Claude Code (`%USERPROFILE%\.claude\projects`)

Attendu :

1. Une ligne `trouvé` ou `absent` pour chaque dossier. Une source absente est dite, le script continue.
2. Trois fichiers dans `C:\dev\jarvis-data\carte\`. Le code de sortie est 0.
3. `carte.md` ne contient aucune phrase tapée : seulement des comptes (familles, langages, heures, ratés, équipes, outils, lieux).

Ensuite, envoyer à Claude **le fichier de chiffres seulement** (`carte.md`). Pas `references.jsonl`, pas les conversations.

Commande équivalente, si un dossier doit être indiqué à la main :

```text
npm run carte:utilisation --workspace @jarvis/core -- --conversations <dossier> --carnet <rates.jsonl> --export-claude <zip ou dossier> --claude-code <dossier> --dir C:\dev\jarvis-data --rapport <fichier.md>
```

`--rapport` écrit les mêmes chiffres, sans identifiant et sans texte.

## RAPPORT DE VÉRIFICATION

```
RAPPORT DE VÉRIFICATION
Lancement : ÉCHEC
Types     : OK (0 erreur)
Style     : OK (0 avertissement)
Tests     : ÉCHEC (2430/2430 cœur ; 782 réussis, 6 ignorés, 1 échec application)
Secrets   : OK (0 vraie valeur)
Fichiers modifiés : AGENTS-COORDINATION.md, packages/core/package.json, packages/core/src/carte/, packages/core/scripts/carte-utilisation.mjs, packages/core/src/developer/lab-node.d.ts, packages/core/src/node-path.d.ts, scripts/carte-utilisation.ps1, rapports/2026-11-12-carte-utilisation.md
Prêt à fusionner : NON
À corriger : empreinte Piper au téléchargement de la voix (déjà sur main, fichier non touché) ; test « Construire manuel » déjà rouge sur main (test non modifié)
Testé en vrai (à la voix, sur le PC) : PAS FAIT
```

Détail du lancement. `npm run build` s'arrête dans `apps/desktop/scripts/setup-piper.mjs` : l'empreinte du fichier de voix Piper téléchargé ne correspond pas à celle attendue. Ce fichier n'a pas été modifié. Le cœur se compile (`tsc`). La compilation de l'application (`electron-vite build`, après les icônes) se termine sans erreur.

Détail des tests. Cœur : 2430 réussis sur 2430. Application : 782 réussis, 6 ignorés, 1 échec — `windowsDesktopMissionPath.test.ts`, « Construire manuel : la carte reste obligatoire » (résumé : typecheck non lancé). Le même test échoue sur le code de `origin/main`, sans les fichiers de la carte. Il n'a pas été modifié ni affaibli. `dotnet` est absent ici ; les cinq échecs .NET décrits dans la routine ne sont pas ceux observés (ces tests sont verts dans cette exécution).

Secrets. Les recherches de la routine ne trouvent que des noms de variables, de la documentation et des valeurs factices déjà dans les tests. Aucun `.env` ni fichier de jeton ajouté. Les fichiers de cette branche ne contiennent pas de phrase d'utilisateur, pas de chemin personnel, pas de nom réel.

À essayer soi-même (pas à la voix : ce script ne parle pas) :

1. Lancer `scripts\carte-utilisation.ps1`. Attendu : la liste trouvé / absent, puis les trois fichiers dans `C:\dev\jarvis-data\carte\`.
2. Ouvrir `carte.md`. Attendu : des chiffres, aucune de tes phrases.
3. Si un dossier manque, le script le dit et continue. Attendu : pas d'erreur pour une source absente.

Ce que ça change pour toi : tu peux voir, en chiffres, ce que tu demandes vraiment à Jarvis, à Claude et à Claude Code, et où ça rate. L'application ne change pas. Rien n'est fusionné.
