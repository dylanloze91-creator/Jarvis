# L'imprimante sous surveillance : le cœur (19 novembre 2026)

Écrit par Claude (le chat), sur la demande de l'utilisateur (« tu développes, toi de ton côté, les modules pour l'imprimante »). Branche `claude/imprimante-surveillance`, partie de `claude/socle-appendices`. Cahier : `docs/specs/imprimante-surveillance.md` (sur `claude/feuille-19-nov`).

**Fait ici : le cœur seulement, sans Electron.** Le branchement côté PC (service, outils, réglages, fenêtre) reste à faire par Claude Code, qui doit aussi lancer les contrôles complets : depuis le cloud, `npm install` est bloqué, donc ni `npm run typecheck`, ni `lint`, ni `vitest`, ni `electron-vite build` n'ont tourné. Les fichiers ont été vérifiés par `tsc` avec la configuration stricte du dépôt (`tsconfig.base.json`), et leurs essais ont tourné avec un petit lanceur qui imite `vitest` : 35 sur 35.

## 1. Ce qui est fait (`packages/core/src/impression/`)

| Fichier | Rôle |
| --- | --- |
| `surveillance.ts` | La logique, pure (aucune horloge, aucun réseau). `stepSurveillance(état, lecture, réglages)` rend le nouvel état et les gestes : dire (info, doute, alerte, avec ou sans photo), mettre en pause, annuler, couper la prise. `answerSurveillance(état, 'annuler' \| 'garder')` pour la réponse de l'utilisateur. |
| `printerWatch.ts` | `PrinterWatchClient` : lecture de Klipper avec l'objet `webhooks` (état ready/startup/shutdown/error), liste des caméras, image fixe, pause, annulation, arrêt d'urgence. **Aucun moyen de lancer, reprendre ou chauffer.** `CameraWatch` : image noire (très petite) et empreinte pour l'image figée, sans décoder le JPEG. |
| `shelly.ts` | `ShellyPlug` : état, puissance, couper (puis relire), rallumer, fiche ; mot de passe par digest SHA-256 (formules de la documentation Shelly). |
| `fakeShelly.testkit.ts` | Fausse prise qui vérifie le digest comme la vraie. |
| `surveillance.test.ts`, `devices.test.ts` | 35 essais. |

Exporté par `packages/core/src/impression/index.ts` et l'index du cœur. Aucun module n'importe `node:*` : ils peuvent être lus par la fenêtre (leçon du lot B).

### Règles tenues par la logique (vérifiées par les essais)

- Un **doute** (caméra noire ou figée, Moonraker qui ne répond pas une ou deux fois, température qui s'écarte depuis 90 s) donne une phrase, **jamais un geste**. Une caméra aveugle ne dit jamais « tout va bien ».
- La **chauffe du début** n'est pas un écart : un écart ne compte qu'une fois la consigne atteinte (à 5 °C près).
- **Problème confirmé** (écart de plus de 15 °C pendant 3 min, avancement bloqué 10 min) : pause, alerte avec photo ; la lecture suivante dit « en pause, vérifié » et donne le délai ; sans réponse, annulation au délai (10 min par défaut), puis « annulée, vérifié ». Une pause ou une annulation demandée mais pas constatée au bout d'une minute est dite.
- **Klipper en erreur** (`shutdown`, `error`) : alerte seulement (Klipper a déjà coupé ses chauffes).
- **Pause faite par l'utilisateur** : une information, jamais d'annulation. **Reprise** après une pause de Jarvis : la surveillance repart de zéro.
- **Coupure de la prise** seulement si : impression en cours au dernier état connu, Moonraker injoignable depuis 2 min, option « coupure de secours » cochée, seuil de chauffe réglé, prise qui mesure une chauffe ; puis une minute d'annonce ; puis la coupure est relue (« coupée, vérifié »). Klipper qui revient pendant l'annonce, ou une prise qui ne chauffe plus : pas de coupure. Imprimante et prise muettes : « je ne peux rien faire, va voir ».

### Faits vérifiés dans la documentation officielle (19 novembre)

- Shelly 2e génération et plus : `GET /rpc/Switch.GetStatus?id=0` (`output`, `apower` en W, `temperature.tC`, `errors`), `GET /rpc/Switch.Set?id=0&on=false` (rend `was_on`), digest RFC 7616 SHA-256 avec l'utilisateur `admin` et le royaume = identifiant de la prise ; `Shelly.GetDeviceInfo` sans mot de passe. Liens dans l'en-tête de `shelly.ts`.
- Moonraker : `/server/webcams/list` (`snapshot_url` absolu, ou relatif servi en HTTP sur le port 80 de la même machine), `POST /printer/emergency_stop` ; `webhooks.state` de Klipper. Liens dans l'en-tête de `printerWatch.ts`.
- **Non vérifié en vrai** : la prise Shelly Plug S Gen3 elle-même (pas achetée). Le premier essai avec l'utilisateur dira si une prise de 3e génération a une différence.

## 2. Ce qui reste à faire par Claude Code (côté PC, Jarvis Test seulement)

1. **Contrôles complets** sur le PC : `npm run typecheck`, `npm run lint`, `npm test`, `npx electron-vite build`. Corriger ce qui sort (le style surtout).
2. **Réglages**, facultatifs et sans défaut Zod (`parseSettings({})` ne gagne aucune clé) : adresse et mot de passe de la prise (mot de passe dans le coffre), surveillance activée, délai d'annulation, coupure de secours, seuil de chauffe en watts. La surveillance et la coupure de secours s'activent par une **carte** qui dit exactement ce qu'elles feront.
3. **Service de surveillance** (`apps/desktop/src/main/impression/`) : une lecture toutes les 10 s pendant une impression (image toutes les 30 s), `stepSurveillance`, puis les gestes : `say` → phrase dans la discussion, notification avec photo sur le PC, enceinte qui a parlé en dernier, téléphone si l'appli est ouverte ; `pause`/`cancel` → `PrinterWatchClient` ; `cut` → `ShellyPlug.off()`. Les images restent en mémoire, sauf le dossier de photos s'il est activé (cahier 3.5). L'état de la surveillance peut être gardé en mémoire seulement (un redémarrage repart de zéro, c'est prudent).
4. **Registre des appendices** : la prise (genre `energie`, risque `agir`) et la caméra (`oeil`, risque `lire`) par un adaptateur côté PC ; « Jarvis, arrête tout » met l'impression **en pause** (pas d'annulation, pas de coupure).
5. **Outils** de l'équipe Impression (cahier, section 4) : `imprimante_regarder` (sûr), `imprimante_surveiller` (carte toujours), `prise_etat` (sûr), `prise_couper` (carte sur demande), `prise_rallumer` (carte toujours, jamais depuis une enceinte). Règle express « montre-moi l'impression ».
6. **Essais avec l'utilisateur** quand la webcam et la prise seront là : cahier, section 5. La coupure de secours ne s'essaie pas en vrai pendant une impression chaude.

## RAPPORT DE VÉRIFICATION

```
RAPPORT DE VÉRIFICATION
Lancement (npm run build) : PAS FAIT (dépendances npm absentes dans le cloud)
Types : tsc strict (tsconfig.base.json) sur les fichiers de impression/ : OK ; typecheck complet du dépôt : PAS FAIT
Style (npm run lint) : PAS FAIT
Tests : 35 sur 35 avec un lanceur qui imite vitest ; vitest réel : PAS FAIT
Secrets : aucun (adresses et mots de passe des essais marqués synthetique-test)
Relecture : faite par Claude (le chat)
Testé en vrai (à la voix, sur le PC) : PAS FAIT
Reste à vérifier : contrôles complets sur le PC, puis le branchement de la section 2
```
