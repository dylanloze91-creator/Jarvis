# Les yeux de Jarvis, étape 1, point 1 : le chemin de l'image et « montre-moi l'impression » (23 novembre 2026)

Cahier : `docs/specs/yeux-etape-1.md` (§ 2.1 et 2.2). Branche `claude/yeux-etape-1`. Jarvis Test seulement, coupé par défaut. Pas de fusion, pas de publication.

## Ce qui est fait

- **Cœur** (`packages/core/src/yeux/`) : `YeuxImprimante` lit la liste des caméras de Moonraker, prend une photo **en mémoire** (heure de prise, taille, nom de la caméra), lit l'état (couches comprises quand Klipper les connaît) et la file d'attente. Toutes les requêtes passent par `lectureSeule` : **seul GET peut partir**, tout autre méthode est refusée avant l'appel réseau. Réseau local seulement, aucune redirection suivie, 5 s par appel, 5 Mo au plus (lus par morceaux, même sans taille annoncée), JPEG ou PNG reconnus aux premiers octets (un type annoncé faux est refusé). Chaque échec rend une raison en mots simples, jamais une exception ni une vieille image.
- **Règle express** `intentionYeux` (« montre-moi l'impression », « montre l'imprimante », « fais voir l'impression », « montre-moi la caméra de l'imprimante », « où en est l'impression ? », avec « Jarvis, », « peux-tu », « s'il te plaît »). Fenêtre : « 83 %, il reste 1 h 46, buse 254 °C, plateau 80 °C. Photo prise à 21 h 42 min 29 s. » Enceinte : « 83 %, il reste 1 h 46. La photo est sur le PC. » (la photo va dans la discussion de l'enceinte, visible dans l'historique du PC ; jamais envoyée à l'enceinte).
- **PC** (`apps/desktop/src/main/yeux/yeuxPC.ts`) : photos en mémoire (20 au plus, 30 minutes), crochet `yeux` de la session placé avant l'imprimante du lot B ; la discussion ne garde que la **référence** de la photo (`ChatMessage.yeux` : `photoId`, `prisA`, `camera`), jamais l'image. IPC `yeux:photo` (référence vérifiée). Fenêtre : `YeuxPhoto` sous la réponse, avec la caméra et l'heure de la prise ; après 30 minutes ou un redémarrage : « Photo plus disponible ».
- **Réglage** `yeux: { enabled?, camera? }`, facultatif, sans défaut Zod (`parseSettings({})` ne gagne aucune clé). Adresse = `printer.baseUrl` (même imprimante décochée). Case « Les yeux de Jarvis » dans Réglages → Services → Imprimante 3D, visible dans Jarvis Test seulement. Édition : `yeux: true` pour Test.
- **Téléphone** : texte seulement pour l'instant (point 3 du cahier).

## Essais

- `packages/core/src/yeux/yeux.test.ts` (21) : fausse caméra et faux Moonraker HTTP locaux ; JPEG, PNG, sans taille, trop gros (annoncé ou non), pas une image, type faux, délai, redirection non suivie, caméra hors réseau local, caméra coupée, choix par nom, imprimante éteinte, état et file, **aucune requête autre que GET sur tout le chemin**, `lectureSeule` refuse POST/PUT/DELETE sans rien envoyer, phrases reconnues et refusées, phrases d'état et d'enceinte.
- `apps/desktop/src/main/yeux-session.test.ts` (6) : vraie session, sans modèle, référence seule dans l'historique (pas de base64), événement `yeux`, enceinte, coupé / absent / Jarvis Live = chemin d'avant sans toucher l'imprimante, autre phrase au modèle, adresse hors réseau refusée, mémoire 30 min / 20 photos.
- Tests figés : rien régénéré.

## Essai en vrai

Jarvis Test de développement dans un dossier de données à part (le Jarvis Test installé n'est pas touché), fournisseur de démonstration (aucun modèle, Ollama non utilisé), imprimante `http://mainsailos.local` pendant une impression (PETG, 83 %) : « Jarvis, montre-moi l'impression » → état et vraie photo de la caméra dans la discussion. Seules des requêtes GET sont parties.

## RAPPORT DE VÉRIFICATION

- Construction : cœur `tsc` OK ; fenêtre construite et lancée par `electron-vite dev` (Jarvis Test).
- Types : `npm run typecheck` (bureau) OK.
- Style : ESLint sur les fichiers changés, 0 erreur.
- Essais : yeux 21 + 6 verts ; suite du cœur 2884 verts, 2 essais d'apprentissage ratés sous charge et verts seuls (sans rapport).
- Secrets : aucun ; la clé Moonraker n'est envoyée qu'à Moonraker, pas à la caméra.
- Relecture : aucune requête autre que GET possible ; image jamais sur le disque ni dans l'historique.
- Testé en vrai (à la voix, sur le PC) : PAS FAIT à la voix ; FAIT au clavier sur le PC (Jarvis Test de développement), avec la vraie caméra pendant une impression.
