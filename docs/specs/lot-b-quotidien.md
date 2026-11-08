# Lot B — Au quotidien : briefing du matin, notes de chantier, routines (équipe « Tâches »), imprimante 3D

Lire d'abord `docs/specs/regles-communes-lots.md`. Branche `cursor/lot-b-quotidien`. Réutiliser : météo Open-Meteo et lieu « Chez moi » (`currentSearch`, `homePlace`), agenda Google (`google_calendar_list`), caractère de Jarvis, bilan de santé (lot A, s'il est fusionné ; sinon brancher plus tard).

## B1. Briefing du matin

- « Jarvis, mon briefing », « bonjour Jarvis », « quoi de neuf ce matin ? » (règle express, sans modèle) ; et, si l'utilisateur l'active (Réglages → Moi → « Briefing du matin », réglage facultatif `briefing` : activé, de quelle heure à quelle heure), **au premier réveil de la journée** dans cette plage.
- Contenu, **composé par des gabarits, sans modèle** : la date ; **la météo du chantier** au lieu « Chez moi » (ou au lieu du jour s'il est donné : « briefing à Évry ») : pluie (mm et heures), rafales (km/h), températures mini / maxi, et une **alerte couvreur** si la pluie ou les rafales dépassent les seuils de l'utilisateur (réglables, valeurs de départ 1 mm/h et 50 km/h, présentées comme « à ton goût ») ; les rendez-vous du jour (si Google est branché) ; les notes de chantier en attente (B2) ; ce qui a tourné cette nuit (génération d'exercices, sauvegarde, bilan de santé) quand ces modules existent.
- Écrit dans la discussion, lu à voix haute en version courte (3 ou 4 phrases) ; ton du caractère s'il est actif. Une source manquante (pas de Google, météo injoignable) est dite en une phrase, jamais inventée.

## B2. Notes de chantier

- Outils `chantier_note_ajouter`, `chantier_notes_lister`, `chantier_note_cocher`, `chantier_note_effacer` (risque `safe` pour ajouter / lister / cocher : ce sont ses propres notes ; effacer = confirmation). Stockage `userData/notes-chantier.json` (écriture tmp + `rename`).
- Phrases express : « note : 3 paquets de liteaux pour lundi », « rajoute à ma liste … », « qu'est-ce que j'ai noté ? », « c'est bon pour les liteaux ». Quantité, unité et jour relevés par règles quand ils sont dits (« 3 paquets », « lundi »), sinon la note est gardée telle quelle.
- Marche depuis le téléphone (session du téléphone) et les enceintes (ajout et lecture ; l'effacement demande le PC ou le téléphone). Visible dans un petit panneau « Notes » de l'accueil et dans le briefing.

## B3. Routines (équipe « Tâches »)

- Une routine = un nom + une liste ordonnée d'actions **prises dans les outils existants** (ouvrir une appli, mettre une musique sur un appareil, lancer un mode concentration de N minutes, ouvrir un dossier, lancer le briefing…). Aucune commande libre (`run_command` interdit dans une routine).
- Création : Réglages → Services → « Routines » (liste, ajout pas à pas avec des menus) ou à la voix « crée une routine Travail : ouvre Chrome, mets ma playlist Focus, bloque les réseaux sociaux 2 heures » → découpage par règles en étapes, **carte de résumé** à valider, rien d'enregistré sans « C'est bon ».
- Lancement : « Jarvis, lance la routine Travail » / « mode travail » (express). Chaque étape passe par le Tool Manager **avec ses confirmations habituelles** (une routine ne contourne aucune carte) ; une étape ratée est dite et les suivantes continuent sauf si elles en dépendent ; bilan final en une phrase.
- Équipe du chef d'orchestre `taches` (« Tâches ») : existe seulement si au moins une routine existe.

## B4. Imprimante 3D (Klipper / Moonraker)

L'utilisateur a une Ender 3 S1 Plus sous Klipper, Raspberry Pi 5 avec MainsailOS.

- Réglages → Services → « Imprimante 3D » : adresse Moonraker (réseau local seulement, contrôle de type `checkRoverBaseUrl`), clé API Moonraker facultative (secret : coffre du lot A s'il existe), bouton « Tester ».
- Client HTTP vers l'API Moonraker documentée (`/printer/objects/query?print_stats&heater_bed&extruder&virtual_sdcard`, `/server/files/list`, `/server/files/upload` avec `print=true`, `/printer/print/start|pause|resume|cancel`). **Vérifier chaque point d'accès sur la documentation officielle de Moonraker** et citer les liens dans le rapport.
- Outils : `imprimante_etat` (état, fichier, progression %, temps restant estimé, températures), `imprimante_fichiers` (safe) ; `imprimante_envoyer_et_imprimer` (fichier .gcode choisi sur le PC) et `imprimante_lancer` (fichier déjà sur l'imprimante) : **confirmation forcée** avec le nom du fichier et le rappel « vérifie que le plateau est vide » ; `imprimante_pause`, `imprimante_reprendre` (confirmation) ; `imprimante_annuler` (**safe** : un arrêt n'attend jamais un clic). Résultat vérifié par une relecture de l'état avant de dire « lancée », « en pause », « annulée ».
- Équipe `impression` du chef d'orchestre + règles express (« imprime », « où en est l'impression », « mets l'impression en pause », « annule l'impression »). Enceinte : lancer est refusé d'office (règle commune 5), état et annulation autorisés.
- Fin d'impression : tant que Jarvis est ouvert, un suivi toutes les 60 s quand une impression est en cours, puis un message « L'impression de X est terminée (2 h 14) » dans la discussion, au téléphone s'il est relié, et une phrase à voix haute si l'écoute est active.
- Faux Moonraker pour les tests (`fakeMoonraker.testkit.ts`).

## Tests

Gabarits du briefing (avec et sans Google, météo injoignable, seuils), phrases express des quatre parties, notes (quantités, jours, téléphone, enceinte), routines (découpage, carte, confirmations conservées, étape ratée, `run_command` refusé), imprimante (chaque outil sur le faux Moonraker, confirmation forcée, annulation sans clic, état relu, adresse non locale refusée, fin d'impression signalée une seule fois), catalogue identique sans réglage.
