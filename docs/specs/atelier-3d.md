# Cahier des charges : l'atelier 3D (Jarvis modélise et imprime)

Écrit par Claude (le chat) le 19 novembre 2026. **Priorité de l'utilisateur**, au même rang que le
travail en cours de Claude Code. Jarvis Development, juste après l'imprimante sous surveillance.
Jarvis Test seulement.

## 0. En bref, pour l'utilisateur

« Jarvis, fais-moi un support pour mon téléphone, incliné à 60° » : Jarvis dessine la pièce, te la
montre, la règle avec toi, prépare le fichier pour l'Ender 3 S1 Plus, te donne le temps et le
filament, puis, **avec ton accord**, lance l'impression ; la surveillance prend le relais.

Principe, le même que Jarvis Développeur facile : **le gabarit fait la pièce, le modèle remplit les
mesures.** Les petits modèles du PC dessinent mal à partir de rien, mais comprennent très bien
« une boîte de 80 par 50, hauteur 30, avec couvercle ».

## 1. Ce qui ne bouge pas

- Jarvis Test seulement, coupé par défaut ; `parseSettings({})` sans clé nouvelle ; tests figés
  intacts ; aucun `__golden__` régénéré ; aucune dépendance native dans l'application.
- **Lancer une impression demande toujours une carte** (avec « vérifie que le plateau est vide »),
  jamais depuis une enceinte. Le reste (dessiner, montrer, préparer le fichier) ne touche pas à
  l'imprimante et n'a pas besoin de carte.
- Gratuit et local : logiciels libres lancés comme programmes à part (comme Piper), jamais liés à
  l'application. Licences vérifiées et notées.
- Tout se passe dans la **discussion normale**, comme Jarvis Développeur facile (même ligne de
  travail, mêmes questions une à la fois avec une réponse proposée).
- Fichiers dans un dossier de l'utilisateur hors du dépôt (`C:\dev\jarvis-data\atelier\`), un
  dossier par pièce : le modèle, l'image, le fichier pour l'imprimante.

## 2. Le déroulé

1. **Comprendre** : la phrase va à l'équipe Impression (règle express « fais-moi / imprime-moi /
   dessine-moi un … » + cerveau). Le modèle choisit le gabarit et remplit les mesures en JSON
   validé par Zod ; ce qu'il ne sait pas reste vide.
2. **Demander ce qui manque**, une question à la fois, avec une valeur proposée
   (« Je pars sur 3 mm d'épaisseur, ça te va ? »).
3. **Dessiner** : le gabarit + les mesures donnent la pièce (par OpenSCAD en ligne de commande,
   à vérifier en section 6). Contrôles sans modèle : mesures dans les bornes du gabarit, pièce
   qui tient dans le volume de l'imprimante, parois assez épaisses pour la buse.
4. **Montrer** : une image de la pièce dans la discussion (vue en 3/4 et cotes principales).
   « Plus haut », « trou plus gros » : nouvelle version, l'ancienne est gardée.
5. **Préparer pour l'imprimante** : le trancheur en ligne de commande avec le profil de l'Ender 3
   S1 Plus de l'utilisateur (matière, remplissage, supports). Jarvis donne le temps et le filament
   lus dans le fichier produit, jamais estimés à la main.
6. **Imprimer** : carte « Lancer l'impression de … (temps, filament). Vérifie que le plateau est
   vide. » → envoi par Moonraker (client du lot B) → la surveillance démarre.

## 3. La bibliothèque de gabarits (première version)

Chaque gabarit : un nom simple, ses mesures avec bornes et valeurs par défaut, des phrases
d'exemple, ses essais (pièce fermée, dimensions justes). Pour commencer, une dizaine :
boîte, boîte avec couvercle, bac à compartiments, entretoise / rondelle, équerre percée, crochet
mural, support de téléphone incliné, socle rond ou carré, porte-étiquette, cale. On en ajoute au fil
de l'usage réel (le carnet des ratés dira ce qui manque).

## 4. Plus tard (hors de cette étape)

- Pièces libres avec un moteur plus fort (par exemple Claude Code qui dessine avec SolidCraft ou
  un autre logiciel de 3D), sur décision de l'utilisateur.
- Partir d'une photo avec une règle à côté, ou de la caméra, pour relever les cotes.
- Vider le plateau avec le bras du robot et enchaîner.

## 5. Qui fait quoi

- **Claude (le chat)** écrit le cœur, sans Electron : les gabarits, la lecture des mesures, les
  contrôles, la préparation des commandes des programmes externes, et leurs essais.
- **Claude Code** branche côté PC (programmes externes, dossier, image, carte, discussion), fait
  les contrôles complets et les essais avec l'utilisateur, après les tâches en cours.

## 6. À vérifier avant de coder le branchement (Claude Code, documentation officielle)

1. OpenSCAD en ligne de commande sous Windows (`openscad -o pièce.stl pièce.scad`, image
   `-o pièce.png`) : licence, installation (winget, jamais lancée par Jarvis), version.
2. Le trancheur : **OrcaSlicer**, celui de l'utilisateur (dit le 19 novembre), en ligne de commande,
   avec **ses** préréglages de l'Ender 3 S1 Plus (machine, réglages d'impression, filament) tels
   qu'il les a enregistrés dans OrcaSlicer. Vérifier la ligne de commande d'OrcaSlicer sous Windows
   dans sa documentation officielle, et où sont rangés ses préréglages ; Jarvis les lit sans jamais
   les modifier.
3. Le G-code produit accepté par Klipper (gcode_flavor, macros de début et de fin de
   l'utilisateur).

## 7. Essais

- Sans imprimante : chaque gabarit produit une pièce fermée aux bonnes dimensions ; mesures hors
  bornes refusées avec une phrase claire ; phrases d'exemple → bon gabarit et bonnes mesures ;
  aucune impression lancée sans carte ; rien depuis une enceinte.
- Avec l'utilisateur : trois pièces simples, de la phrase à l'impression, surveillance comprise.
