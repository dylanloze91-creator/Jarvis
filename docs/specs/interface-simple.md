# Cahier des charges — Jarvis plus simple, et qui s'adapte à toi (5.0.70)

Rédigé par Claude pour Cursor, le 5 novembre 2026. **Mission longue, à faire d'une traite.** Lire `CLAUDE.md` en entier, en particulier 0.4.17 (réglages en onglets), 0.4.26 (profil matériel au premier lancement), 5.0.64 (audit UX, `settingsPatch`, brouillon), 5.0.60 (chef d'orchestre), caractère de Jarvis, 5.0.68 et 5.0.69.

## Pourquoi

L'utilisateur n'est pas développeur. Il trouve l'application difficile à utiliser : « il y a beaucoup d'onglets un peu partout ». Constats réels :

- **12 onglets de réglages** (`SettingsTabs.tsx` : Voix et détection, Modèle IA, Recherche et mémoire, Spotify, Google, Robot, Téléphone, Enceintes, Outils et sécurité, Fenêtre et démarrage, Mises à jour, plus « Développeur (avancé) » caché), aux noms techniques.
- **Des réglages rangés au mauvais endroit** : l'interrupteur « Lancer les missions depuis la discussion » est dans « Fenêtre et démarrage », l'utilisateur l'a cherché dans « Développeur (avancé) » sans le trouver. Il dépend de deux autres réglages (Développeur, chef d'orchestre) situés dans deux autres onglets, sans que rien ne le dise.
- **Barre latérale du tableau de bord chargée** (`Dashboard.tsx` : Accueil, Discussion, Développeur, Historique, Google, Automatisation, Micro et voix, Journal, Réglages, Comment tout brancher) : raccourcis en double avec les réglages.
- Jargon visible partout (« QLoRA », « num_ctx », « Ollama », noms de modèles, « orchestre », « trieur »).

Demande de l'utilisateur : **une interface plus simple**, **un petit questionnaire grâce auquel Jarvis adapte lui-même l'application à ses goûts**, et **des réglages toujours accessibles mais simplifiés, rangés en sous-catégories**.

## Règles qui ne se discutent pas

1. **Rien ne disparaît.** Chaque champ de `Settings` (schéma Zod de `packages/core/src/settings.ts`), chaque bloc d'état hors réglages (`phone.json`, `speakers.json`, personnalisation, mémoire, Google, Spotify, Développeur…) et chaque bouton d'action existant (tester la voix, relier un téléphone, ajouter une enceinte, analyser à nouveau, vérifier les mises à jour…) **garde une place** dans la nouvelle carte des réglages. Un test le vérifie (voir « Tests »).
2. **Le chat ne change pas** : `chat-unchanged.test.ts`, `ollama-unchanged.test.ts`, `orchestra-session.test.ts`, `machineProfile.test.ts`, `engine/profiles/jarvis.test.ts` verts **sans jamais régénérer** les `__golden__`. `parseSettings({})` ne gagne **aucune clé**. Aucun nouveau défaut Zod.
3. **Le questionnaire ne change rien sans ton accord** : il propose, montre « avant → après » en mots simples, et n'applique qu'après « C'est bon ». Il ne télécharge rien, ne connecte aucun compte, n'ouvre aucun port, n'active rien qui demande un compte ou un matériel absent.
4. **Retour arrière** : avant d'appliquer, une copie des réglages touchés est gardée ; « Revenir à mes réglages d'avant » la restaure (dans Application → Questionnaire).
5. **Confirmations de sécurité intouchables** : `forceConfirm`, `shell` toujours confirmé, Google sans catégorie, robot, SiteBlock. Le questionnaire peut seulement régler les politiques déjà réglables (`apps`, `files`, `capture` : `always` / `destructive-only`), jamais `never`.
6. **Mêmes chemins d'enregistrement qu'aujourd'hui** : brouillon + `settingsPatch` (seulement les clés changées, `absorbSavedSettings`), réglages « enregistrés tout de suite » (micro, Développeur, téléphone, enceintes) inchangés dans leur comportement.
7. **Règles de CLAUDE.md conservées** : overlay compact sous 1100 px avec ses 4 vues, tableau de bord au-dessus ; « Automatisation » reste affichée « Bientôt » ; preload étroit, aucun IPC brut dans React ; `packages/core` sans Electron.
8. **Écriture** : tutoiement, phrases courtes, aucun mot anglais ni nom technique dans les libellés principaux. Les noms techniques (modèle Ollama, `num_ctx`, nom de l'outil…) vont dans un repli « Détails » (`ui/disclosure.tsx`).

## À livrer

### 1. Le questionnaire « Faisons connaissance »

**Quand** : juste après l'écran de premier lancement (`MachineSetupFlow`), et **une fois** pour les utilisateurs existants après la mise à jour, sous forme d'une carte non bloquante sur l'accueil (« Nouveau : adapte Jarvis à toi en 2 minutes » — « C'est parti » / « Plus tard » / « Ne plus me le proposer »). Toujours relançable : Réglages → Application → « Refaire le questionnaire », et dans la discussion « Jarvis, refais le questionnaire » (règle express sans modèle, qui ouvre l'écran).

**Forme** : une question par écran, gros boutons, barre de progression, « Passer » sur chaque question, retour possible, au clavier comme à la souris. 2 minutes au plus. Pas de modèle IA : tout est décidé par des règles écrites (fonction pure, testée).

**Questions** (libellés de départ, à garder simples) :

1. **Comment je t'appelle ?** → prénom dans la personnalisation (même chemin que les outils `*_jarvis_personalization`, sans carte de confirmation puisque c'est l'utilisateur qui tape).
2. **Tu me parles surtout…** à la voix / au clavier / les deux → écoute et mot de réveil (`voice.*`), fenêtre de suivi (`voice.followUpSeconds` : voix 8 s, clavier : écoute coupée).
3. **Qu'est-ce que tu veux que je fasse pour toi ?** (plusieurs choix) : musique, mails et agenda, recherches sur internet, ouvrir des applis et des fichiers, m'aider à me concentrer (bloquer des sites), code et projets, piloter le robot, me parler depuis le téléphone, enceintes dans la maison. → sert à **ranger** : les services choisis passent en tête de « Ce que Jarvis sait faire » et de l'accueil ; les autres restent accessibles plus bas, dans « Autres possibilités ». Un service choisi mais pas branché (Spotify, Google, robot…) est marqué « à brancher » avec son guide ; **rien n'est connecté automatiquement**.
4. **Quel caractère tu préfères ?** complice / majordome / direct / « neutre, sans personnage » → `persona` (`enabled`, `style`). Si un caractère est choisi et que le chef d'orchestre est coupé, le résumé le dit et propose de l'activer (voir question 7).
5. **Tes réponses, plutôt…** courtes / détaillées → une règle dans la personnalisation (« réponds court », « détaille »).
6. **Avant d'agir sur ton PC, je te demande…** toujours / seulement si c'est risqué → politiques `apps`, `files`, `capture` (`always` / `destructive-only`). Rien d'autre.
7. **Tu veux que je sois plus malin ?** (« je trie chaque demande et j'appelle le bon spécialiste ; un peu plus lent au premier message ») → chef d'orchestre. Proposé seulement si les modèles nécessaires sont déjà installés (`ollamaStatus`) ; sinon la question dit ce qui manque et n'active rien.
8. **Ta fenêtre, plutôt…** petite fenêtre / grand tableau de bord ; « toujours au-dessus » oui/non → réglages de fenêtre existants.

Si « code et projets » est choisi : le résumé propose d'activer Développeur **et** « Lancer les missions depuis la discussion » ensemble, seulement si la copie de travail est déjà valide ; sinon il renvoie au guide « Comment tout brancher ».

**Résumé** : « Voici ce que je vais changer » — une ligne par changement, en mots simples, avant → après ; ce qui ne change pas n'apparaît pas. Boutons « C'est bon », « Modifier mes réponses », « Ne rien changer ». Après « C'est bon » : copie de retour arrière, application, puis l'accueil s'affiche déjà rangé selon les réponses.

**Stockage** : réponses et copie de retour arrière dans `userData/questionnaire.json` (**hors de `settings.json`**, comme `phone.json`), écrit par tmp + `rename`. Aucune nouvelle clé dans `settings.json` hormis celles qui existent déjà et que les réponses règlent.

**Cœur** : `packages/core/src/onboarding/` — `ONBOARDING_QUESTIONS` (texte, choix), `onboardingPlan(answers, current, environment) → { changes: { label, before, after }[], patch, personalization, layout }` pure, `environment` = modèles installés, profil machine, services branchés, copie de travail valide.

### 2. Réglages en 6 catégories, avec sous-catégories

Remplacer les 12 onglets par **6 catégories** (barre à gauche dans le tableau de bord, liste déroulante en haut dans l'overlay), chacune faite de **sous-catégories en accordéon** : une phrase d'explication, les 2 à 4 réglages utiles, puis « Réglages avancés » replié.

- **Moi** : prénom et personnalisation, caractère de Jarvis, façon de répondre, ce dont Jarvis se souvient (mémoire), lieu « Chez moi ».
- **Parler à Jarvis** : micro, mot de réveil, voix de Jarvis (voix Windows / Piper, crédits des voix), discussion et suivi, vérification « est-ce à moi qu'on parle », « Tester la voix ». Avancé : apprentissage du réveil, diagnostic, analyse d'un fichier audio.
- **Ce que Jarvis sait faire** : une sous-catégorie par service, avec un badge **« branché » / « à brancher » / « coupé »** : Musique (Spotify, enceinte de lecture), Mails et agenda (Google), Recherche internet, PC et fichiers, Concentration (SiteBlock), Code et projets (Développeur, missions depuis la discussion, copie de travail, modèle de code), Robot, Téléphone, Enceintes de la maison. Ordre : services choisis au questionnaire d'abord.
- **Le cerveau de Jarvis** (« pour les curieux ») : modèle de discussion, chef d'orchestre et équipes, trieur, modèle de repli, température, consignes de base. Libellés simples, noms de modèles dans « Détails ».
- **Sécurité** : ce que Jarvis peut faire sans demander (politiques), ce qui est toujours demandé (liste fixe, lecture seule), journal des actions (l'actuel `AuditPanel`, déplacé ici).
- **Application** : fenêtre et raccourci, démarrage, profil de la machine (« Analyser à nouveau »), mises à jour, **questionnaire** (refaire, revenir aux réglages d'avant).

**Dépendances visibles** : un réglage qui dépend d'un autre le dit sur place et offre le bouton (« Il faut d'abord activer le chef d'orchestre — [Activer] »). Cas obligatoires : missions depuis la discussion (Développeur + chef d'orchestre), caractère (chef d'orchestre), avis franc, trieur, enceinte Spotify (Spotify connecté), voix Piper (fichiers présents).

**Recherche dans les réglages** : un champ en haut (« Chercher un réglage… ») ; un index de libellés et de mots-clés (`spotify`, `musique`, `micro`, `mission`, `voix`, `mot de passe`…) ouvre la bonne catégorie, déplie la sous-catégorie et met le réglage en évidence. Sans résultat : « Je ne trouve pas ce réglage » + lien vers le questionnaire.

**Liens profonds** : tout appel existant (`openSettingsTab('voice')`, `'google'`, `'developer'`, liens de l'état vide, des cartes, du guide…) arrive au bon endroit de la nouvelle carte (table de correspondance testée). « Développeur (avancé) » n'est plus un onglet caché : tout son contenu va dans « Code et projets ».

Le comportement d'enregistrement ne change pas (règle 6) : même brouillon, même « Enregistrer », mêmes réglages enregistrés tout de suite, même avertissement « Modifications non enregistrées ».

### 3. Navigation et accueil

- **Barre latérale du tableau de bord** : Accueil, Historique, Réglages ; « Code et projets » seulement si Développeur est activé ; « Comment tout brancher » ; « Automatisation » reste « Bientôt » (en bas). Retirés de la barre (toujours accessibles dans Réglages) : Google, Micro et voix, Journal. « Discussion » et « Accueil » ne font qu'un.
- **Accueil** : les cartes d'action rapide et les cartes de services suivent les réponses du questionnaire (pas de « Lire mes emails » si l'utilisateur n'a pas choisi mails et agenda) ; sans questionnaire, l'accueil d'aujourd'hui.
- **Overlay compact** (< 1100 px) : mêmes 4 vues, réglages en 6 catégories (liste déroulante).

## Tests

- **Carte complète** (`settingsMap.test.ts`) : parcourt **toutes** les clés de `settingsSchema` (y compris les blocs facultatifs `orchestra`, `persona`, `developer`, `voice`…) et les actions existantes, et échoue si l'une n'a pas de place dans la nouvelle carte, ou si une place pointe vers un réglage inexistant.
- **Questionnaire** (`onboarding.test.ts`) : chaque réponse → le bon `patch` ; rien de demandé = rien changé ; chef d'orchestre jamais activé sans ses modèles ; politiques jamais à `never` ; aucune connexion ni téléchargement ; Développeur proposé seulement avec une copie de travail valide ; `parseSettings({})` inchangé.
- **Résumé et retour arrière** (renderer) : rien n'est enregistré avant « C'est bon » ; « Ne rien changer » n'écrit rien ; « Revenir à mes réglages d'avant » restaure exactement la copie.
- **Liens profonds** : chaque ancien identifiant d'onglet mène au bon endroit.
- **Recherche** : « spotify », « mission », « micro », « voix » trouvent le bon réglage.
- Tests existants verts, **sans régénération** des `__golden__`.
- **Captures avant / après** (scènes d'aperçu `?scene=onboarding`, `?scene=onboarding-summary`, `?scene=settings-v2`, `?scene=settings-search`, `?scene=dashboard-v2`, et l'overlay compact), jointes au rapport.

## Livraison

- Branche `cursor/interface-simple-5070` depuis `origin/main`, inscrite dans `AGENTS-COORDINATION.md`. Dans `CLAUDE.md`, ajoute seulement ta section « 5.0.70 — Jarvis plus simple » et tes lignes dans « Ce qu'il ne faut pas casser » ; mets à jour les chemins décrits dans « UI » et « 0.4.17 » s'ils changent.
- Commits petits et nommés, un par partie (cœur du questionnaire, écrans du questionnaire, carte des réglages, catégories, recherche, navigation, accueil, tests, captures).
- Avant de pousser : `npm run typecheck`, `npm test`, `npm run lint` (seuls les échecs dotnet attendus sans SDK .NET).
- Pas de fusion dans `main`, pas de publication : Claude relit d'abord. Rapport `rapports/2026-11-0X-interface-simple-5070.md` : ce qui a bougé (ancien emplacement → nouveau, pour chaque réglage), captures, ce qui n'a pas pu être testé sur Windows, puis le RAPPORT DE VÉRIFICATION.
