# Lot A — Fiabilité : bilan de santé, sauvegarde, « ce que Jarvis sait de moi », coffre des clés

Lire d'abord `docs/specs/regles-communes-lots.md`. Branche `cursor/lot-a-fiabilite`.

## A1. Bilan de santé au démarrage

But : l'utilisateur ne cherche plus pourquoi « ça ne marche pas ».

- **Contrôles, sans aucun appel de modèle**, chacun borné à 3 s, 10 s en tout, lancés **après l'affichage de la fenêtre** (règle 0.4.14 : la première image n'attend rien) : Ollama joignable et **chaque modèle réglé installé** (modèle du chat, repli, cerveau et équipes de l'orchestre, trieur, modèle de code) ; fichiers de voix présents (`REQUIRED_VOICE_ASSETS`), Piper prêt s'il est choisi ; Spotify : jeton valable et, si une enceinte est réglée, enceinte visible ; Google : connexion valable (`needsReconsent`) ; téléphone : Tailscale publié si le téléphone est activé ; enceintes : dernière phrase reçue ; robot joignable si son adresse est réglée ; imprimante (lot B) si réglée ; place libre sur le disque (alerte sous 10 Go) ; âge de la dernière sauvegarde (A2).
- Les services **non réglés ne sont pas contrôlés** (aucune alerte pour Google si Google n'est pas branché).
- **Résultat** : vert / orange / rouge par contrôle, une phrase simple chacun (« Le modèle qwen2.5:7b n'est plus installé : ton équipe Musique ne peut pas répondre. »), et un bouton qui ouvre le bon réglage (carte des réglages 5.0.70). Accueil : rien si tout est vert, sinon un bandeau discret « 2 choses à régler » qui ouvre le bilan. Réglages → Application → « Bilan de santé » : la liste complète et « Refaire le bilan ».
- **Dans la discussion** : « Jarvis, est-ce que tout va bien ? », « fais ton bilan » (règle express, sans modèle) → le même bilan en texte ; à la voix, une phrase courte (« Tout va bien » ou « Deux soucis : … »).
- **Lecture seule** : le bilan ne répare rien tout seul, ne télécharge rien, ne relance rien.
- Cœur pur : `packages/core/src/health/` (types, phrases, ordre, règle express) ; contrôles dans `apps/desktop/src/main/health/`.

## A2. Sauvegarde automatique

But : un disque qui lâche ne fait perdre ni la mémoire de Jarvis, ni les exercices, ni les modèles entraînés.

- Réglages → Application → « Sauvegarde » : dossier de destination choisi par l'utilisateur (disque externe, ou dossier d'un cloud synchronisé : OneDrive, Google Drive pour ordinateur), fréquence (chaque jour / chaque semaine), nombre de sauvegardes gardées (4 par défaut **dans le code**), cases « mes données d'entraînement (dossier jarvis-data) » et « mes modèles entraînés (fichiers .gguf) » (décochées par défaut : gros fichiers).
- **Contenu** : `settings.json` **sans aucun secret** (les champs secrets vidés), conversations, personnalisation, mémoire et index, `developer/` (projets, mémoires, missions), questionnaire, apprentissage du réveil, `phone.json` et `speakers.json` (empreintes seulement) ; en option le dossier jarvis-data et les `.gguf` indiqués. **Jamais** : les jetons Spotify et Google, le coffre des clés (A4) : après une restauration, on reconnecte ces services, et c'est dit.
- **Quand** : PC inactif (aucun tour de chat, aucune mission, aucune génération en cours), au plus une fois par période ; aussi « Sauvegarder maintenant ».
- **Format** : un `.zip` daté avec un `manifeste.json` (liste, tailles, sha256, version de Jarvis), écrit en `.partiel` puis renommé ; **relu après écriture** (empreintes vérifiées), sinon la sauvegarde est marquée ratée et le bilan (A1) le dit. Les plus anciennes au-delà du nombre gardé sont supprimées, **uniquement** les fichiers `jarvis-sauvegarde-*.zip` du dossier choisi.
- **Restaurer** : choix d'une sauvegarde, liste de ce qu'elle contient, carte de confirmation, copie de sécurité de l'état actuel, restauration, redémarrage de Jarvis.
- Jarvis n'envoie rien sur Internet lui-même : c'est le cloud de l'utilisateur qui synchronise son dossier.

## A3. « Ce que Jarvis sait de moi »

Réglages → Moi → « Ce que Jarvis sait de moi » : une ligne par catégorie, avec le nombre d'éléments, « Voir », « Exporter », « Effacer » (bouton en deux temps, `ui/confirmButton.tsx`) : personnalisation (prénom, règles), souvenirs (mémoire), corrections et préférences apprises, conversations (une par une ou toutes), documents indexés, phrases du trieur (dossier des données du trieur, s'il est réglé : à trier, examen, validées), réponses du questionnaire, extraits de l'apprentissage du réveil. « Tout exporter » : un `.zip` lisible (JSON et texte), sans aucun secret. « Tout effacer » : carte de confirmation, puis effacement de ces catégories seulement (jamais les réglages, jamais les projets de l'utilisateur).

## A4. Coffre des clés

But : plus aucune clé en clair dans `settings.json`.

- Champs secrets : ceux que `redactValue` masque déjà (clés API, secrets client, jetons : `apiKey`, `googleClientSecret`, `searchApiKey`, `marketDataApiKey`, `roverToken`, jeton SiteBlock…) — liste unique dans le cœur, testée contre le schéma.
- Rangés chiffrés par `safeStorage` dans `userData/coffre.bin` ; `settings.json` garde la chaîne vide. **Migration au démarrage** : une clé trouvée en clair est déplacée dans le coffre et `settings.json` réécrit sans elle (tmp + `rename`), **sans copie en clair** nulle part. Sans chiffrement disponible : comportement d'avant, et le bilan (A1) le signale.
- **La fenêtre ne reçoit jamais une clé** : elle reçoit un marqueur « clé enregistrée » ; un champ laissé tel quel garde la clé du coffre ; un champ vidé la retire ; un champ rempli la remplace. Le processus principal fusionne le coffre aux réglages pour les fournisseurs.
- Les réglages par défaut et `chat-unchanged` ne changent pas (les clés y sont vides).

## Tests

Cœur : phrases et ordre du bilan, règle express, liste des secrets contre le schéma, manifeste et rotation des sauvegardes. Bureau : faux Ollama / faux Spotify / faux Google pour le bilan (non réglé = non contrôlé, délai = orange) ; sauvegarde et restauration dans un dossier temporaire (contenu, aucun secret, empreinte fausse = ratée, rotation qui ne touche qu'aux `jarvis-sauvegarde-*.zip`) ; coffre (migration, aucune clé dans `settings.json` ni dans l'IPC, marqueur conservé, chiffrement absent) ; « ce que Jarvis sait de moi » (compte, export sans secret, effacement limité).
