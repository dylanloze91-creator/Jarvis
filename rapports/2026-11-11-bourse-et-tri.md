# Bourse express et tri

Branche `cursor/bourse-et-tri`, depuis `origin/main` (5.0.76). Version inchangée. Pas de fusion, pas de publication. `speaker/` et `firmware/` non touchés.

## Ce que dit « le cours de SPIE »

Avec le chef d'orchestre allumé, la phrase ne passe plus par un modèle. Jarvis appelle `get_stock_quote` (Yahoo Finance, journal d'audit) et répond une phrase courte. Pastille « Bourse · express ».

Si Yahoo renvoie SPIE à Paris, par exemple : « SPIE, Euronext Paris : 34,12 €, en hausse de 1,2 % aujourd'hui (17 h 35). » Les chiffres sont ceux de Yahoo, jamais inventés.

Sans « Paris » dans la phrase, si une autre action correspond aussi (SPI Energy au Nasdaq), Jarvis ajoute : « J'ai pris SPIE (Paris). Tu voulais peut-être SPI Energy (Nasdaq) ? »

S'il ne trouve rien : « Je n'ai pas trouvé SPIE à la bourse. Tu peux me donner son symbole ? »

« Apple » donne le symbole AAPL. L'or, l'euro, le bitcoin, « cours de maths », « en cours » et « au cours de » ne prennent pas ce chemin.

## Tri

Avant tout modèle : Yahoo, Yahoo Finance, « sur internet », « sur le web », Wikipédia et « cherche sur Google » vont à l'équipe Internet. « cherche » seul n'y va que s'il n'y a ni possessif ni fichier, dossier, document, photo, PC, ordinateur, disque ou mail. « cherche sur Google le cours de SPIE » reste le cours express. L'équipe Google ne prend que les mails, l'agenda, Drive, Docs et Sheets. « Google » seul et « finance » n'y mènent pas.

Juste après un tour, « non », « je t'ai dit », « passe par » ou « pas Google » repassent par ces règles. Si aucune ne s'applique, le cerveau reçoit : « l'équipe X n'a pas su répondre au tour précédent ».

Dans Réglages → Chef d'orchestre, à côté du trieur, le dernier score s'affiche s'il existe. Sur les phrases Jarvis déjà mesurées : « Trieur : 42 % de bonnes équipes sur tes phrases. Le cerveau : 70 %. Pour l'instant, garde le cerveau. » Rien n'est activé tout seul.

« le cours de spi » sans indice ne part plus en express : le cerveau choisit. « le cours de spi en bourse » et « le cours de l'action spi » restent l'express.

## Corrections après la revue

Revue `docs/revues/2026-11-11-bourse-et-tri.md` (branche `claude/revues`). Deux points, deux commits.

1. `detectStockRequest` ne prend plus un « cours de X » sans indice. Indices : en bourse, l'action, cotation, Yahoo, combien vaut / ça vaut, bourse, CAC, Euronext, Nasdaq. Sans indice, le nom doit avoir une majuscule (SPIE, LVMH, Spie, Airbus). « spi » et « eau » en minuscules passent par le cerveau. Jamais la bourse, même avec une majuscule : possessif, mot de temps ou d'agenda, « j'ai cours », « un cours de », « des cours de », complément « de jeudi » ou « sur l'agenda ». Les phrases du tableau de la revue sont en `null` dans `stockIntent.test.ts`. Les oui gardés : « le cours de SPIE », « Jarvis, quel est le cours de Spie ? », « la cotation de Nvidia », « combien vaut Airbus en bourse », « comment va l'action Schneider », « Apple et Nvidia en bourse », « le cours de l'action TotalEnergies ».

2. « cherche » n'envoie vers Internet que s'il est suivi de « sur internet », « sur le web », « sur Google » ou « en ligne ». Sinon, seulement sans possessif et sans fichier, dossier, document, photo, PC, ordinateur, disque ou mail. « Cherche le fichier devis dans mes documents », « cherche mes photos de vacances » et « cherche le dossier Jarvis sur le PC » restent au cerveau (`orchestra.test.ts`).

Inchangé : appel direct de `get_stock_quote`, phrases fixes, aucun cours inventé, `chooseListing`, « Tu voulais peut-être », `isTeamCorrection`, score du trieur. `__golden__` non régénérés. `parseSettings({})` sans nouvelle clé. Version inchangée.

## RAPPORT DE VÉRIFICATION

Rejeu après les deux corrections.

| Commande | Résultat |
| --- | --- |
| `npm run typecheck` | succès |
| `npm run lint` | succès |
| `npm test` | cœur vert. Bureau : 791 réussis, 6 ignorés, 1 échec. |

L'échec est `windowsDesktopMissionPath.test.ts`, test « Construire manuel : la carte reste obligatoire » : « Bloqué : typecheck n'a pas été lancé. » Le même test échoue sur `origin/main` dans cette machine, où `dotnet` n'est pas installé. Les autres tests de ce fichier passent. Ce n'est pas une régression de cette branche.

Inchangés, sans régénération des `__golden__` : `chat-unchanged`, `ollama-unchanged`, `orchestra-session`, `machineProfile`, `profiles/jarvis`. `parseSettings({})` ne gagne aucune clé. Le catalogue de `get_stock_quote` (description, schéma) n'est pas modifié.

Aucune fusion dans `main`, aucune publication.
