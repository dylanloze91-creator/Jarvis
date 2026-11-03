# Revue — voix Piper (5.0.67) et trieur (5.0.68), 3 novembre 2026

Relecture par Claude de `cursor/voix-piper-5067` (976378e) et `cursor/trieur-5068` (a967ff2). Travail globalement bon : contrats respectés, défauts inchangés, tests présents. Points à corriger avant fusion, du plus important au moins important. Chaque correctif a son test.

## Voix Piper (`cursor/voix-piper-5067`)

1. **Plantage possible du processus principal** (`main/piper/runner.ts`) : `child.stdin.write` sans écouteur `error` sur `child.stdin`. Si Piper s'arrête avant d'avoir lu (DLL manquante, modèle illisible), l'écriture lève `EPIPE` sur le flux, sans écouteur : exception non rattrapée dans le main. Ajouter `child.stdin.on('error', …)` (l'erreur réelle vient de `close` / stderr). Test avec un faux binaire qui sort tout de suite.
2. **Retours à la ligne** : Piper lit l'entrée standard **ligne par ligne** ; avec `--output_file`, vérifier dans le code source de la release `2023.11.14-2` ce qu'il fait d'un texte sur plusieurs lignes (risque : seul le dernier morceau reste dans le fichier). Dans tous les cas, `runner.ts` remplace tout blanc (`\s+`) par une espace avant d'écrire. Test.
3. **Licences à livrer avec l'installateur** : l'installateur public redistribue espeak-ng (**GPL-3.0**) dans le binaire Piper, et deux voix sous **CC BY 4.0** (Siwis) et **CC BY-SA 4.0** (UPMC). Il faut, dans `voice-assets/piper/` copié par `extraResources` : le texte de la GPL-3.0, le lien vers le **code source exact** d'espeak-ng utilisé par la release Piper (et de piper-phonemize), les fiches MODEL_CARD des voix avec auteurs et licences. Et dans Réglages → Voix, sous le choix Piper, une ligne « Crédits des voix » qui nomme les jeux de données, leurs auteurs et leurs licences. Documenter dans `CLAUDE.md`.
4. **Taille de l'installateur (+211 Mo)** : `extraResources: voice-assets/piper` copie aussi `piper/cache/` (les archives téléchargées, ~25 Mo pour rien) → exclure `cache/` (filtre electron-builder). Ensuite, proposer dans le rapport : n'embarquer que la voix par défaut et télécharger les autres au premier choix (même vérification SHA-256), sans le faire tant que l'utilisateur n'a pas décidé.
5. **Silences entre les phrases** (`renderer/voice/localPiperTts.ts`) : la phrase suivante n'est fabriquée qu'après la fin de la lecture de la précédente, et chaque appel relance Piper et recharge le modèle. Fabriquer la phrase N+1 **pendant** la lecture de la phrase N (une seule d'avance ; annulée par « Couper »). Mesurer le temps de chargement du modèle par appel et le noter ; si > 0,5 s, proposer (sans le faire) un processus Piper gardé ouvert.
6. **Mesure jamais faite** (`main/piper/service.ts`) : `maybeBenchmark` n'est appelé que pour un texte < 120 caractères mais exige ≥ 200 : `benchmarkMs` reste toujours `null`. Soit le brancher correctement, soit le retirer avec son réglage.
7. `isReady()` ne vérifie que la voix par défaut, pas celle choisie ; `phoneVoiceMode` peut donc annoncer `piper` alors que la voix choisie manque (le service retombe alors sur Siwis sans le dire). Vérifier la voix choisie.

Note pour le chantier 2 (studio de voix) : la voix inventée doit être affinée à partir de **Siwis (CC BY)**, pas d'UPMC (CC BY-SA imposerait la même licence à la voix de Jarvis).

## Trieur (`cursor/trieur-5068`)

1. **Page de tri sans style** (`trieur/sortServer.ts`) : la page a un `<style>` en ligne alors que sa politique dit `style-src 'self'` : le navigateur l'ignore, les gros boutons n'en sont plus. Servir la feuille à `/app.css` (comme `/app.js`). Test : la page ne contient plus de `<style>`, `/app.css` répond.
2. **Écritures depuis un autre site** : `POST /api/choose` accepte n'importe quel type de corps ; une page web ouverte en même temps peut envoyer un `text/plain` sans contrôle préalable du navigateur. Exiger `Content-Type: application/json` (415 sinon) et un corps ≤ 4 Ko. Test.
3. **Bouton « Annuler la dernière »** : un clic de travers est aujourd'hui définitif. Retirer la dernière ligne de `examen.jsonl` et reculer d'une phrase. Test.
4. **Le trieur se décharge après 10 min** (`session.ts` `askRouter`) : il sert à chaque phrase, il doit rester chargé comme le cerveau (`BRAIN_KEEP_ALIVE`, 30 min). Test sur l'option envoyée.
5. **Repli** : trieur illisible, en erreur ou trop lent → aujourd'hui le chat d'avant. Proposer (rapport) de demander alors au cerveau, et le faire seulement si `orchestra-session.test.ts` reste vert sans régénération.
6. **Candidats** : un seul candidat (`qwen2.5:1.5b`). Le cahier en demandait 2 ou 3 : ajouter les tailles Qwen3 de 1,7 B et 4 B si leurs fiches Hugging Face confirment Apache 2.0 (vérifier en ligne), avec l'estimation de mémoire en QLoRA sur 6 Go.

## Après correction

Les deux branches partent de l'ancien `main` (avant la publication 5.0.64) : les mettre à jour sur `origin/main` (fusion, pas de `--force`), garder les deux côtés de `CLAUDE.md` et `AGENTS-COORDINATION.md` en cas de conflit. Pas de fusion dans `main` : Claude relit les correctifs.
