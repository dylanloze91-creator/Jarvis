# Live 5.0.80 : mêmes options Ollama que le chat — 23 novembre 2026

Ajouté aux corrections de la Live 5.0.80 sur la décision de l'utilisateur (« Oui pour la Live »). Branche `claude/corrections-5080-suite`. **Pas de publication sans « publie ».** Les essais sont groupés avec les autres corrections : `rapports/2026-11-19-live-5080-a-verifier.md`, section F (E16, E17).

Cause, mesures et version de Jarvis Test : `rapports/2026-11-23-notes-musique-rechargements.md` (section 7, branche `claude/idees-openjarvis`).

## Le défaut

Ollama recharge un modèle déjà en mémoire dès qu'on l'appelle avec un autre `num_ctx` ou `num_gpu`. Le chat envoie toujours `num_ctx 8192`, et `num_gpu 0` sur le processeur. Trois appels n'envoyaient rien, et Ollama prenait son défaut, 4 096 :

1. le préchauffage des enceintes (à chaque réveil ; avec « Garder Jarvis éveillé », le 7B en 4 096 était même gardé) ;
2. le déchargement et le rechargement du modèle autour d'une image (Imager) ;
3. la reformulation d'Imager.

## La correction

- `ollamaLoadOptions(réglages, modèle)` (`packages/core/src/vitesse/options.ts`) rend les options que la session enverrait pour ce modèle.
- Le préchauffage (`warmOllamaModels`), `OllamaControl` et `PromptRefiner` s'en servent (branchement dans `apps/desktop/src/main/index.ts`).
- Ces fichiers sont identiques à ceux de Jarvis Test. Seul le branchement diffère : dans Live il est toujours actif ; dans Test il passe par le champ d'édition `alignOllamaOptions`.

## Essais

- Essais automatiques :
  - `vitesse/options.test.ts` : cerveau, équipe sur le processeur, trieur, sans chef d'orchestre ;
  - `speaker/warmupRun.test.ts` : corps envoyé avec et sans options ;
  - `images/ollamaOptions-1123.test.ts` : rechargement, déchargement, reformulation.
- Mesure réelle, vrai Ollama, réglages de Live lus seulement. Une demande du chat, puis le préchauffage d'enceinte tel que Live le construit, puis une nouvelle demande :

| | Préchauffage | Demande suivante | Rechargements du 7B (journal d'Ollama) |
| --- | ---: | ---: | ---: |
| Avant | 5,8 s | 6,2 s | 2 (4 096, puis 8 192) |
| Après | 0,016 s | 0,30 s | 0 |

## Avec, sur cette branche

`eslint.config.js` ignore `.claude/worktrees/**` et `.gitignore` ignore `.claude/worktrees/` : plusieurs agents travaillent en même temps, chacun dans sa copie de travail sous `.claude/worktrees/`, et le contrôle de style comptait leur code (71 erreurs le 23 novembre).

## Le test du vrai modèle du labo seulement sur demande (P1)

`packages/core/src/developer/lab.test.ts`, « appelle le modèle réel » : il chargeait `qwen2.5:1.5b` dans le vrai Ollama à chaque `npm test` (donc à chaque `release.sh`) et évinçait le 7B du cerveau (22 fois en 10 jours dans les journaux d'Ollama). Il ne tourne plus qu'avec `JARVIS_LAB_REAL=1`, comme sur `claude/idees-openjarvis`. Fichier : 10 tests passés, 1 ignoré.

RAPPORT DE VÉRIFICATION

- Construction : FAIT (cœur construit).
- Types (`npm run typecheck`) : FAIT, vert.
- Style (`npm run lint`) : FAIT, vert, alors qu'une copie de travail d'un autre agent est présente.
- Tests : FAIT, cœur 2 554 sur 2 554, bureau 855 sur 855 (8 ignorés).
- Secrets : FAIT (aucun).
- Relecture : FAIT.
- Testé en vrai (à la voix, sur le PC) : PAS FAIT à la voix ni avec une vraie enceinte. FAIT sur le vrai Ollama avec les réglages de Live (tableau ci-dessus). E16 et E17 sont à faire avec toi.
