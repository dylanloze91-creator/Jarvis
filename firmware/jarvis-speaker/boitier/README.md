# Boîtier V2 de l'enceinte Jarvis (brouillon)

104 × 82 × 51 mm, deux pièces en PETG, sans supports : le boîtier debout, le couvercle à l'envers (le dessus sur le plateau).

- Carte à borniers (MRD076A, 62 × 67 mm) posée sur 4 plots, avec 16 mm libres de chaque côté des borniers pour les fils.
- Écran OLED 1,3 pouce I2C à 4 broches (SH1106) derrière une fenêtre de 31 × 16,5 mm, sur un rebord, entre deux butées. Un point de colle chaude suffit.
- Micro INMP441 à gauche de l'écran, à la même hauteur, derrière un trou de 2,5 mm.
- Haut-parleur sous le couvercle, avec une grille de trous.
- Ampli MAX98357A debout dans deux rails, sur la paroi droite.
- Fente USB à l'arrière, 4 vis M3 fraisées dans les coins, 4 creux sous le boîtier pour des patins.

**Brouillon.** Les cotes marquées « À MESURER » dans `boitier.py` sont des valeurs courantes, pas des mesures :
- haut-parleur ;
- trous de la carte à borniers ;
- hauteur avec l'ESP32 ;
- prises USB ;
- micro ;
- écran.

À corriger avant d'imprimer.

## Refaire les fichiers

Python 3 avec `numpy` et `scikit-image` (aucun logiciel de CAO) :

```
python boitier.py 0.3      # écrit enceinte-boitier.stl et enceinte-couvercle.stl
python rendu.py            # aperçus PNG (facultatif, demande matplotlib)
```

Le modèle est décrit par des distances (pas de maillage à la main). Changer une cote dans le dictionnaire `P` en tête de `boitier.py` suffit.
