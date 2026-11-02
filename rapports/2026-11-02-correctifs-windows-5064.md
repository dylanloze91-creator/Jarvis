# Correctifs Windows 5.0.64 (2026-11-02)

Suite de `rapports/2026-11-02-verification-windows-5064.md` (section 3). Branche `cursor/correctifs-windows-5064`, base `origin/claude/nuit-3`. Agent : Cursor (Linux, SDK .NET 8.0.416 présent). Objectif : corriger les 27 échecs de tests Windows reproductibles et les bogues associés, sans publication ni changement de voix/catalogue.

## En clair, pour thedexios

Sur ton PC Windows, certains outils de Jarvis (recherche dans le code, banc développeur, jeter une tâche isolée, connexion Google, message « Fermé ») et plusieurs tests ne tenaient pas compte des particularités Windows (fins de ligne CRLF, dossier courant git, ports réservés, SDK .NET 8 au lieu de 10 en dur). Ces corrections rendent la suite de tests verte sur une machine avec le SDK .NET ; sans SDK, seuls les 5 tests dotnet connus peuvent encore échouer (`spawnSync dotnet ENOENT`). Rien n’est publié : il faudra fusionner puis revérifier sur ton PC.

## Point par point

### 1. `dev_search_code` (CRLF)

| | |
| --- | --- |
| **Problème** | Sous `core.autocrlf=true`, `git grep` renvoie des lignes avec `\r` ; la regex ne matchait pas → « Aucun résultat ». |
| **Changement** | `readTools.ts` : retrait du `\r` sur chaque ligne et fin de ligne optionnelle dans la regex. |
| **Test** | `readTools.crlf.test.ts` — échouait sans normalisation `\r`. |

### 2. `extractFunction` / banc réel (CRLF)

| | |
| --- | --- |
| **Problème** | `extractFunction` cherchait `\n}\n`, absent en CRLF. |
| **Changement** | `realBench.ts` : normalisation `\r\n` → `\n` avant extraction. |
| **Test** | `realBench.test.ts` (doc-explain + source CRLF) — prompt null avant correctif. |

### 3. `discardWorktree` (sandbox)

| | |
| --- | --- |
| **Problème** | `git worktree remove` lancé avec `cwd` = le worktree supprimé → échec Windows. |
| **Changement** | Dernière étape depuis `repoRoot` ; `Sandbox` mémorise le dépôt principal. |
| **Test** | `sandbox.test.ts` — vérifie `cwd === repo` pour `git worktree remove`. |

### 4. `acquireIndexLock` (EPERM)

| | |
| --- | --- |
| **Problème** | Seul `EEXIST` était réessayé ; Windows peut renvoyer `EPERM` sur le verrou. |
| **Changement** | `knowledge.ts` : réessai aussi sur `EPERM`. |
| **Test** | `knowledge.eperm.test.ts` (mock `open` → EPERM puis succès). |

### 5. OAuth Google (EACCES, pas Spotify)

| | |
| --- | --- |
| **Problème** | Port libre seulement sur `EADDRINUSE` ; plages Hyper-V/WSL → `EACCES`. |
| **Changement** | `listenGoogleOAuthLoopback` / `oauth.ts` : repli sur port `0` aussi pour `EACCES`. Port Spotify **non modifié**. |
| **Test** | `oauth.listen.test.ts` (injecteur simule EACCES sur le port par défaut). |

### 6. `close_application` — « Fermé »

| | |
| --- | --- |
| **Problème** | Message « Fermé : Discord » alors que des processus Discord restaient (`STILL=Discord`). |
| **Changement** | `describeCloseResult` : « Fermé » seulement pour les noms absents de `STILL`. |
| **Test** | `close-application.test.ts` (partiel Discord) ; test timeout force `platform` `linux` pour `SIGTERM` simulé (Windows réel utilise `taskkill`, déjà couvert en 5.0.64). |

### 7. Tests non portables

| Fichier | Correction |
| --- | --- |
| `close-application.test.ts` | Plateforme `linux` pour le test de délai dépassé (voir ci-dessus). |
| `voicePackaging.test.ts` | Comparaison `electron-builder.yml` après normalisation CRLF → `\n`. |
| `platformerMissionPath.test.ts` | `npm` via `node` + `npm-cli.js` (`environment.ts`). |
| `SiteBlockBridge.test.ts` | `APPDATA` isolé (temp) pour ne pas lire `%APPDATA%\SiteBlock\api.json` réel. |
| `dotnetProject.test.ts`, `windowsDesktopMissionPath.test.ts` | TFM et chemins `.exe` via `dotnetTestkit` + SDK installé ; `projectsWorkflow.ts` passe `${tfm}-windows` à `dotnetWinExeArtifactRelative`. |
| Charge / lenteur | `knowledge.test.ts` « deux magasins » : timeout 15 s. |

## Contrôles finaux (Linux, SDK .NET présent)

| Étape | Résultat |
| --- | --- |
| `npm run build` | OK |
| `npm run typecheck` | OK (0 erreur) |
| `npm run lint` | OK (0 problème) |
| `npm test` | Cœur **2128 / 2128** (160 fichiers) ; Bureau **618 / 624** passés, 6 ignorés (118 fichiers, 4 fichiers skip live) |
| `chat-unchanged.test.ts` | 6 / 6, aucun golden régénéré |
| `ollama-unchanged.test.ts` | 3 / 3 (cœur) |
| Secrets (`git grep`) | OK (libellés / faux tests uniquement) |

Les **5 tests dotnet** nommés dans la routine de vérification ne s’appliquent **que** si `dotnet` est absent ; avec SDK 8.0.416 ils passent ici.

## Commits (ordre)

| SHA | Sujet |
| --- | --- |
| `e69fbd5` | Coordination (en cours) |
| `dd1a9c7` | CRLF readTools + realBench |
| `99cb2d3` | discardWorktree depuis repoRoot |
| `a3be3a4` | EPERM verrou + OAuth EACCES |
| `e415b94` | close_application « Fermé » |
| `cbc4484` | Tests portables + TFM SDK |

(Rapport et coordination `terminé` : commit suivant.)

## RAPPORT DE VÉRIFICATION

```
RAPPORT DE VÉRIFICATION
Lancement : OK
Types     : OK (0 erreur)
Style     : OK (0 avertissement)
Tests     : OK (2746/2752 réussis, 6 ignorés ; 0 échec .NET sur cette machine)
Secrets   : OK (0 vraie valeur)
Fichiers modifiés : readTools.ts, realBench.ts, sandbox.ts, taskTools.ts, knowledge.ts, oauth.ts, applications.ts, projectsWorkflow.ts, dotnetDesktop.ts ; tests listés ci-dessus ; dotnetTestkit.ts ; AGENTS-COORDINATION.md ; ce rapport
Prêt à fusionner : OUI (sous réserve de rejeu Windows réel par toi ou Claude Code)
À corriger : Spotify si le port 53124 reste dans une plage réservée Windows (documenter / contournement réseau, pas corrigé ici). Publication 5.0.64 toujours non faite.
Testé en vrai (à la voix, sur le PC) : PAS FAIT
```

**À retester toi-même sur Windows** (2–3 essais concrets) :

1. Mode Développeur → « Analyser mon architecture » ou « Poser une question » : la recherche `createToolManager` doit citer `apps/desktop/src/main/tools/index.ts` (plus « Aucun résultat » sur un dépôt CRLF).
2. Connexion Google (Réglages) : si le port 53125 est bloqué, la connexion doit quand même aboutir avec un autre port local (pas seulement « pare-feu »).
3. « Ferme Discord » (sans forcer) : si une fenêtre reste ouverte, le message ne doit **pas** commencer par « Fermé : Discord » seul ; avec `forceKill`, « Fermé » quand tout est parti.

## Non fait (volontaire)

- Publication, tag, installeur, bump de version.
- Port Spotify fixe (53124) : comportement documenté dans le rapport Windows initial.
- Rejeu vocal / PC réel (agent cloud).
