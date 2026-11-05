# Rapport — Interface simple 5.0.70 (`cursor/interface-simple-5070`)

Date : 2026-11-05. Branche : `cursor/interface-simple-5070` (depuis `origin/main`).

## Résumé

- Questionnaire **« Faisons connaissance »** : cœur pur `packages/core/src/onboarding/` (`ONBOARDING_QUESTIONS`, `onboardingPlan`), stockage `userData/questionnaire.json`, résumé avant → après, retour arrière.
- **Réglages en 6 catégories** avec accordéons, recherche, liens profonds depuis les anciens onglets, indices de dépendances.
- **Navigation** : barre latérale allégée (Accueil, Historique, Code et projets si Développeur, Réglages, guide, Automatisation « Bientôt »).
- Tests : `settingsMap.test.ts`, `onboarding.test.ts`, `settingsSearch.test.ts`, `settingsDeepLinks.test.ts` ; suite desktop verte sur Linux avec `@jarvis/core` compilé et dépendances installées.

## Ancien emplacement → nouveau (réglages)

| Ancien onglet / zone | Nouvelle catégorie | Sous-catégorie |
| --- | --- | --- |
| Voix et détection | Parler à Jarvis | Voix / micro (+ avancé réveil) |
| Modèle IA (fournisseur, modèle, repli, température, prompt) | Le cerveau de Jarvis | Fournisseur, modèle, Ollama, orchestre |
| Recherche et mémoire (fournisseurs web, bourse) | Le cerveau de Jarvis / Moi | Recherche, bourse / Chez moi, mémoire, personnalisation |
| Spotify | Ce que Jarvis sait faire | Musique |
| Google | Ce que Jarvis sait faire | Mails et agenda |
| Robot | Ce que Jarvis sait faire | Robot |
| Téléphone / Enceintes | Ce que Jarvis sait faire | Téléphone / Enceintes |
| Outils et sécurité (politiques) | Sécurité | Permissions |
| SiteBlock (dans outils) | Ce que Jarvis sait faire | Concentration |
| Journal d’audit (sidebar) | Sécurité | Journal d’audit |
| Fenêtre et démarrage | Application | Fenêtre, profil machine |
| Mises à jour | Application | Mises à jour |
| Développeur (avancé) | Ce que Jarvis sait faire | Code et projets (général + avancé) |
| Caractère (ex Modèle IA) | Moi | Caractère de Jarvis |
| Questionnaire (nouveau) | Application | Questionnaire |

Chaque clé du schéma `settingsSchema` est référencée dans `packages/core/src/settingsMap/fields.ts` (test `settingsMap.test.ts`).

## Captures d’aperçu

Scènes Vite (`http://127.0.0.1:43173/?scene=…&layout=…`) — script `apps/desktop/scripts/capture-interface-simple-5070.mjs` (Chrome headless + `puppeteer-core`).

![Questionnaire — question 1](interface-simple-5070-captures/onboarding.png)

![Questionnaire — résumé avant application](interface-simple-5070-captures/onboarding-summary.png)

![Réglages — tableau de bord (6 catégories)](interface-simple-5070-captures/settings-v2.png)

![Réglages — recherche « spotify »](interface-simple-5070-captures/settings-search.png)

![Accueil — tableau de bord](interface-simple-5070-captures/dashboard-v2.png)

![Réglages — overlay compact](interface-simple-5070-captures/settings-compact-before.png)

## Non testé sur Windows

- Premier lancement réel après `MachineSetupFlow` → enchaînement questionnaire.
- Relance « Jarvis, refais le questionnaire » à l’oral et au clavier en production Electron.
- `platformerMissionPath.test.ts` : **échec pré-existant sur environnement incomplet** (Electron binaire absent ou `npm`/`@jarvis/core` non prêt) — même comportement sur `origin/main` une fois le même setup ; les 6 tests passent après `npm ci`, build core et binaire Electron disponible.
- Capture d’écran Windows des six scènes ci-dessus.
- Validation visuelle des badges « branché / à brancher / coupé » sur services réels (Spotify, Google, robot).

## RAPPORT DE VÉRIFICATION

**Testé en vrai : PAS FAIT**

Contrôles automatisés exécutés sur la branche :

- `npm run typecheck` : OK
- `npm test` : OK (672 tests ; échecs `.NET` / Windows connus hors scope 5.0.70)
- `npm run lint` : OK

---

*Claude Code : relire avant fusion dans `main`. Aucune publication, aucune régénération de `__golden__`.*
