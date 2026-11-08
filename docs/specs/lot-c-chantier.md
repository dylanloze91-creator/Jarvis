# Lot C — Équipe « Chantier » : les calculs du charpentier couvreur, exacts et sans modèle

Lire d'abord `docs/specs/regles-communes-lots.md`. Branche `cursor/lot-c-chantier`.

## Pourquoi

L'utilisateur est charpentier couvreur. Il veut que Jarvis l'aide dans son métier : métrés de couverture, quantités de tuiles, liteaux, chevrons. **Un modèle de langue se trompe en calcul** : comme le calcul exact du chef d'orchestre (`solveArithmetic`), ces calculs sont faits par du code, avec le détail affiché pour que l'utilisateur vérifie.

## Règle d'or : aucune valeur de produit inventée

Les valeurs propres à un produit ou à un chantier (tuiles au m², pureau, longueur utile d'une faîtière, entraxe des chevrons, taux de perte, dimensions d'un rouleau d'écran) **viennent de l'utilisateur** : soit dites dans la demande, soit enregistrées par lui dans « Mes produits » (Réglages → Services → Chantier). Jarvis ne propose jamais de valeur de fabricant de lui-même. Une valeur manquante = Jarvis la demande, une question à la fois.

## Calculs (cœur pur `packages/core/src/chantier/`)

Chaque calcul rend : le résultat arrondi utilement (quantités à l'unité supérieure), **les lignes de calcul** (formule avec les nombres), les hypothèses, les unités. Entrées en m, cm, mm, %, ° acceptées et converties.

1. **Pente** : % ↔ degrés ; pente depuis hauteur et portée.
2. **Longueur de rampant** : depuis portée horizontale et pente (ou hauteur), débord compris s'il est donné.
3. **Surface d'un pan** (rectangle, trapèze, triangle) et **surface totale** d'une toiture à deux pans ou quatre pans simple (croupes en triangles / trapèzes), moins les ouvertures (fenêtres de toit, cheminée) données.
4. **Tuiles** : surface × tuiles au m² × (1 + pertes %).
5. **Liteaux** : mètres linéaires ≈ surface ÷ pureau (avec le pureau en m), plus pertes ; nombre de bottes si l'utilisateur donne la longueur et le nombre par botte.
6. **Contre-liteaux** : mètres linéaires ≈ surface ÷ entraxe des chevrons.
7. **Chevrons** : nombre ≈ (longueur du pan ÷ entraxe) + 1, longueur = rampant + débord.
8. **Écran sous-toiture** : rouleaux = surface × (1 + recouvrement %) ÷ surface utile d'un rouleau.
9. **Faîtage, arêtiers, rives** : longueur, puis nombre de pièces = longueur ÷ longueur utile d'une pièce.
10. **Chiffrage indicatif** (facultatif) : seulement avec les prix que l'utilisateur a entrés dans « Mes produits » ; jamais un prix inventé.

Chaque formule est écrite dans le code avec un commentaire clair. Le rapport liste les formules et leurs limites (approximation des liteaux, tuiles de rive et de faîtage à part…). **Ne pas présenter ces calculs comme une norme (DTU)** : ce sont des aides au métré ; le rapport le dit.

## Dans Jarvis

- Équipe `chantier` du chef d'orchestre + règles express (tuiles, liteaux, contre-liteaux, chevrons, pente, rampant, toiture, couverture, faîtage, écran sous-toiture, m² de toit). La réponse vient du calcul, pas d'un modèle ; un modèle peut seulement aider à relever les nombres dans une phrase floue, et le résultat montre toujours les valeurs retenues (« J'ai compris : 8,40 m de long, pente 45 % … »).
- « Mes produits » : liste de produits de l'utilisateur (nom, type, valeurs, prix facultatif), choisis par leur nom (« avec mes tuiles Romanes »).
- **Fiche de métré** : chaque calcul peut être gardé dans « Mes chantiers » (nom du chantier, calculs, notes, date), exporté en texte ou en PDF simple (une page, lisible sur le téléphone), et relu par la voix en version courte.
- Téléphone et enceintes : calculs et lecture autorisés.

## Tests

Pour chaque calcul, **au moins 3 exemples vérifiés à la main** dans le test, avec le calcul écrit en commentaire (pas copié de la sortie du code). Conversions d'unités, valeurs manquantes demandées une à une, aucune valeur de produit sans source utilisateur, arrondis à l'unité supérieure, ouvertures déduites, phrases express (et faux positifs : « je suis sur le toit de la voiture » n'est pas un calcul). Catalogue et routeur identiques sans « Mes produits » ni chantier enregistré **seulement si** l'équipe dépend d'un outil réglé ; sinon, l'équipe Chantier est sans outil (comme Conversation) et le rapport explique pourquoi `catalogue-modele.json` reste identique.
