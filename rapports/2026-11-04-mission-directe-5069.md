# Rapport — Mission directe (5.0.69)

Branche : `cursor/mission-directe-5069`  
Date : 2026-11-04  
Agent : Cursor (cloud)

## Livrables

| Point | Contenu |
| --- | --- |
| 1 | `directMissionRequest`, chemin sans modèle Code, pastille `mission directe` |
| 2 | Filet mission écrite en texte → carte depuis la phrase utilisateur |
| 3 | Avertissement langage non pris en charge + `launchObjectif` Node |
| 4 | Consigne `CODE_MISSION_TOOL_PROMPT` |
| 5 | Fin du saut vers Développeur si `chatMissions` ; G-code / corrections / accents dans `voiceAssistantRoute` |

## Commits (ordre)

1. Coordination `AGENTS-COORDINATION.md`  
2. Point 1 — détection et tests `detect.test.ts`  
3. Points 2–3 — session, hub, carte, tests `chat-missions-direct.test.ts`  
4. Point 4 — consigne équipe Code  
5. Point 5 — `voiceAssistantRoute`, `UnifiedJarvisChat`, tests renderer  
6. Documentation — `CLAUDE.md`, `docs/specs/mission-directe.md`, rapport  

## Vérifications automatiques

- `npm run typecheck` : OK  
- `npm test` : 663 passés, 6 ignorés (liveProof) ; aucune régénération `__golden__`  
- `npm run lint` : OK  

## RAPPORT DE VÉRIFICATION

**Testé en vrai : PAS FAIT** (agent cloud, pas de Jarvis Windows + Ollama).

À essayer sur ton PC (5.0.68 + cette branche) :

1. Réglages : Développeur ON, chef d'orchestre ON, « Lancer les missions depuis la discussion » ON.  
2. Discussion : « Jarvis, écris-moi un script Python pour lancer mes impressions 3D depuis Mainsail » → pastille **Code · mission directe**, carte avec objectif = ta phrase (sans SSH/M3U inventés), avertissement Python → Node.  
3. « Lancer » seulement après choix du projet — rien ne démarre avant.  
4. Pendant une mission en cours, redemander un script → message « déjà en cours », pas de nouvelle carte.  
5. Correction : « Non, c'est faux. Il faut envoyer un fichier G-code… » → **reste dans la discussion**, pas de bascule onglet Développeur.  
6. Couper `chatMissions` : une demande explicite de jeu peut encore ouvrir Développeur comme avant ; une correction reste dans le chat.

## Fichiers principaux

- `packages/core/src/developer/chatMissions/detect.ts`  
- `apps/desktop/src/main/session.ts`  
- `packages/core/src/developer/voiceAssistantRoute.ts`  
- `apps/desktop/src/renderer/src/components/UnifiedJarvisChat.tsx`  
