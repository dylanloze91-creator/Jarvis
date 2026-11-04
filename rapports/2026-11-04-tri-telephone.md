# Rapport — Tri du trieur sur l'iPhone (Tailscale)

Date : 2026-11-04. Branche : `cursor/tri-telephone` (depuis `origin/main`). **Aucune fusion dans `main`, aucune publication.**

## Fait

- `npm run trieur:trier` accepte **`--port <n>`** (défaut : port libre) et **`--tailscale`** (jeton aléatoire 32 octets, page téléphone, QR terminal).
- Serveur toujours sur **127.0.0.1** ; hôtes **`*.ts.net`** acceptés seulement en mode Tailscale (`allowedPhoneHost`, factorisé dans `@jarvis/core`).
- API **`/api/*`** : jeton `Authorization: Bearer` obligatoire en mode Tailscale ; sans jeton valide → **401**.
- Page iPhone : grille **3×3**, gros boutons, « Je ne sais pas », « Pas une demande », « Annuler la dernière », compteur ; CSS/JS externes (pas de `<style>` inline).
- Guide **`training/TRIEUR.md`** : port **43160**, `tailscale serve --bg --https=8443 43160`, arrêt avec `tailscale serve reset`.
- `allowedPhoneHost` déplacé dans le cœur ; le serveur téléphone desktop réexporte la même fonction.

## Tests automatisés

| Suite | Résultat |
| --- | --- |
| `npm run typecheck` | OK |
| `npm run lint` | OK |
| `npm test` (@jarvis/core) | **2192 / 2192** |
| `chat-unchanged.test.ts` | **6 / 6**, aucun golden régénéré |

## Commits (branche)

Voir `git log origin/main..cursor/tri-telephone --oneline`.

---

## RAPPORT DE VÉRIFICATION

Testé en vrai : **PAS FAIT** (pas d’iPhone ni Tailscale sur l’agent cloud).

**À tester vous-même sur Windows + iPhone :**

1. `npm run trieur:trier --workspace @jarvis/core -- --dir C:\dev\jarvis-data\trieur --port 43160 --tailscale`
2. Taper une fois `tailscale serve --bg --https=8443 43160` (le téléphone Jarvis reste sur `53130`).
3. Scanner le QR ou ouvrir l’URL `https://<votre-pc>.ts.net:8443/#t=…` sur l’iPhone (Tailscale connecté).
4. Classer quelques phrases : vérifier le compteur, les gros boutons, « Annuler la dernière », reprise après fermeture de Safari.
5. Sans le jeton (ou après avoir effacé le stockage Safari) : les appels API doivent échouer (page « Accès refusé »).
6. `tailscale serve reset` pour couper l’accès depuis le tailnet ; Ctrl+C sur le PC pour arrêter le serveur local.

Fichiers modifiés : `packages/core/src/trieur/sortServer.ts`, `packages/core/src/trieur/sortServer.test.ts`, `packages/core/scripts/trieur-trier.mjs`, `packages/core/src/phone/phone.ts`, `packages/core/src/phone/phone.test.ts`, `packages/core/src/qr/qrTerminal.ts`, `packages/core/src/index.ts`, `apps/desktop/src/main/phone/server.ts`, `training/TRIEUR.md`, `AGENTS-COORDINATION.md`, ce rapport.

Prêt à fusionner : OUI (sous réserve du test iPhone par thedexios).
