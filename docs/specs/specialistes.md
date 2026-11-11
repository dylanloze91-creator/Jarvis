# Les petits spécialistes de Jarvis : catalogue et méthode

Rédigé par Claude le 11 novembre 2026, à la demande de l'utilisateur : « développer des petits modèles d'IA capables de faire très bien une chose. Je te laisse faire les catégories que tu estimes bonnes. »

## La règle avant tout entraînement : la fiche

Aucun spécialiste n'est entraîné sans sa fiche, et une fiche répond à cinq questions :

1. **Que fait-il ?** En une phrase, avec trois exemples d'entrée et de sortie.
2. **Une règle suffirait-elle ?** Si oui, on écrit la règle et on n'entraîne rien (exemples : l'heure, le calcul, la bourse).
3. **Comment vérifie-t-on qu'un exemple est juste, sans demander à un modèle ?** Des tests qui tournent, un compilateur, un simulateur, une formule, ou le tri fait à la main par l'utilisateur. **Pas de vérification, pas d'entraînement.**
4. **D'où viennent les exemples ?** Il y a trois sources possibles :
   - un professeur ouvert, avec le vrai manuel dans sa consigne ;
   - un professeur plus gros, loué, seulement si sa licence permet d'entraîner ;
   - les données de l'utilisateur, triées par lui.

   Jamais une sortie de Claude ni de Cursor.
5. **Quel examen, tenu à l'écart, prouve qu'il fait mieux que le modèle de base ?** Et quel modèle de base (taille, licence) ?

Leçon du trieur (11 novembre) : le professeur savait écrire des phrases, mais pas celles de l'utilisateur. Le trieur a appris le style du professeur et s'est trompé sur les vraies phrases. Tout ce qui dépend de la façon de parler de l'utilisateur doit apprendre sur ses données à lui.

## Les catégories

| # | Spécialiste | Méthode | Vérification | Priorité |
| --- | --- | --- | --- | --- |
| 0 | **Réflexes** (heure, calcul, bourse, minuteurs, Spotify simple, météo d'une ville) | Règles, aucun modèle | Tests phrase par phrase | En continu |
| 1 | **Codeur général** (`jarvis-coder`) | Professeur ouvert + flotte de location | Tests cachés, 2 passages verts, erreurs glissées repérées | Fait (79/87), amélioré par la flotte |
| 2 | **Impression 3D** (G-code, macros Klipper, API Moonraker/Mainsail) | Professeur avec la documentation de Klipper et de Moonraker dans sa consigne | **Klipper en mode batch** (traite un G-code sans imprimante), faux Moonraker, limites de la machine (volume, températures) contrôlées par règles | 1 |
| 3 | **Chantier** (charpente, couverture : surfaces, pentes, liteaux, tuiles, chevrons, quantités) | **Règles et formules** pour le calcul ; petit modèle seulement pour **lire** la phrase et en sortir les cotes en JSON | Formules exactes ; la lecture est vérifiée sur des phrases de l'utilisateur triées par lui | 2 (lot C) |
| 4 | **Programmes de cartes** (ESP32 de l'enceinte et du rover) | Professeur avec la documentation ESP-IDF | Compilation ESP-IDF + tests C sur le PC | 3 |
| 5 | **Trieur** (choisir l'équipe) | Données de l'utilisateur seulement | Examen de ses vraies phrases (70 % pour le cerveau) | En pause : règles d'abord (mission bourse et tri) |
| 6 | **Images de Driver's Ink et textures** (stickers, bandeaux, textures) | LoRA SDXL entraîné sur **ses propres créations**, sur carte louée ; base RealVisXL ou SDXL (licence commerciale) | Œil de l'utilisateur, sur un lot fixe de demandes, avant et après | Plus tard (chantier images en pause depuis le 10 novembre) |
| 7 | **Voix de Jarvis** (studio de voix, à partir de Siwis, CC BY) | Entraînement Piper sur carte louée | Écoute par l'utilisateur, et Whisper qui doit retranscrire juste | Plus tard |

Hors catalogue, à ne pas entraîner :
- **Jarvis lui-même** (son propre code) : le dépôt bouge trop vite, et les tests du dépôt sont déjà la vérification. Le codeur général suffit, avec le dépôt lu au moment de la mission.
- **Ce qui exige un savoir à jour** (actualité, prix) : c'est la recherche web, pas l'entraînement.

## L'ordre retenu

1. **Flotte de location** (`docs/specs/flotte-location.md`), qui rend les nuits de génération rapides et le PC libre.
2. **Spécialiste Impression 3D** : sa fiche complète, puis l'outillage de vérification (Klipper en mode batch, faux Moonraker), puis la génération sur la flotte, l'entraînement et l'examen.
3. **Chantier** : le lot C (règles et formules), puis éventuellement le petit lecteur de cotes, entraîné sur les phrases de l'utilisateur.
4. Les autres, une fois les deux premiers prouvés.

Chaque spécialiste passe ensuite par le même chemin :
- fiche ;
- vérificateur ;
- générateur (ou tri des données de l'utilisateur) ;
- entraînement sur carte louée ;
- examen comparatif (`lab:compare` ou équivalent) ;
- décision de l'utilisateur ;
- installation dans Ollama **à côté** de l'existant, jamais à la place sans son accord.
