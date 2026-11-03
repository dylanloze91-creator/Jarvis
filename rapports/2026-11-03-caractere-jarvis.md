# Caractère de Jarvis

Date : 2026-11-03. Branche : `claude/caractere-jarvis` (à partir de `main` `5b1a75d`, 5.0.65 publiée). Rien n'est publié ; le numéro de version n'est pas monté.

Demande : « faire en sorte que Jarvis ait une personnalité bien à lui, limite humaine ».

## Ce qui change

- **Une fiche de personnage** (`packages/core/src/agent/persona.ts`), ajoutée aux **consignes des équipes du chef d'orchestre** quand le réglage est activé (comme l'avis franc de 5.0.62) — entière pour Conversation et Code, courte pour les équipes à outils (ton, « une phrase de réaction au plus, puis le résultat de l'outil, tel quel », honnêteté) : tempérament (calme, loyal, curieux, des avis donnés avec la raison, jamais « en tant qu'IA »), façon de parler (comme quelqu'un, phrases courtes, réactions en une phrase, pas de liste pour une réponse simple), mémoire de l'utilisateur, « je ne sais pas » et « je me suis trompé » sans drame.
- **Humain dans la manière, honnête sur le fond** : Jarvis reste un programme sur ce PC et le dit si on le lui demande sérieusement ; il n'invente ni ressenti physique ni souvenir. Les règles d'action ne bougent pas : outils, résultats jamais inventés, refus accepté.
- **Trois tons** : complice (tutoiement chaleureux, défaut), majordome (vouvoiement, ironie fine, jamais servile), direct (peu de mots). **Humour** optionnel : sec, rare, jamais sur une erreur ni un sujet grave.
- **Contexte** dans la fiche : moment de la journée (heure du PC), prénom tiré de la personnalisation (« utilise son prénom parfois, pas à chaque phrase »), et à l'oral « réponds comme on parle, deux ou trois phrases, sans liste ».
- **Accueil dans sa voix** sans modèle : « Bonjour Dylan. Je t'écoute. », « Bonsoir. Tu ne dors pas ? Je suis là. », majordome « À votre service. » — dans l'état vide de la discussion et le sous-titre du tableau de bord.
- **Réglage** : Réglages → Modèle IA → « Caractère de Jarvis » (interrupteur, ton, humour, aperçu de l'accueil, fiche en lecture seule). L'ancien champ « Personnalité » s'appelle maintenant « Consignes de base (prompt système) ». Tant que rien n'a été choisi, l'état vide propose « Donner un caractère à Jarvis ».

## Ce qui ne change pas

`settings.persona` est facultatif, sans défaut Zod, coupé par défaut, et le profil du premier lancement ne le pose pas. **Le chat sans orchestre garde son prompt figé** (`chat-unchanged.test.ts`, fichiers `__golden__` intacts), même avec le caractère activé : la fiche n'entre que dans `teamPrompt(team, …)`. Le cerveau routeur ne la reçoit pas (il trie, il ne parle pas). Les phrases fixes sans modèle (heure, calcul, recherche vide) restent telles quelles. Aucun texte de la fiche ne va dans les données d'entraînement : l'apprentissage local enregistre les messages du tour, pas le prompt système ; le générateur d'exercices et le cahier n'y touchent pas.

## Contrôles

- `npm run typecheck` : vert.
- `npm run lint` : vert, 0 erreur.
- `npm test` : résultat complet ajouté ci-dessous dès la fin du passage (cœur puis bureau).
- Captures de l'aperçu Vite : section « Caractère de Jarvis » des réglages, lien « Donner un caractère à Jarvis » dans l'état vide, accueil « Bonjour. Je t'écoute. » une fois activé ; aucune erreur de console.

## À faire par l'utilisateur

Sur le PC : Réglages → Modèle IA → activer le chef d'orchestre (s'il ne l'est pas), puis « Donner un caractère à Jarvis », choisir le ton, Enregistrer. Donner son prénom à Jarvis (« retiens que je m'appelle Dylan ») pour qu'il l'utilise. Un petit modèle (qwen2.5:3b) suit la fiche de manière inégale ; le 7B de l'équipe Conversation la tient mieux.
