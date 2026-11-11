# Bourse express et tri

Branche `cursor/bourse-et-tri`, depuis `origin/main` (5.0.76). Version inchangée. Pas de fusion, pas de publication. `speaker/` et `firmware/` non touchés.

## Ce que dit « le cours de SPIE »

Avec le chef d'orchestre allumé, la phrase ne passe plus par un modèle. Jarvis appelle `get_stock_quote` (Yahoo Finance, journal d'audit) et répond une phrase courte. Pastille « Bourse · express ».

Si Yahoo renvoie SPIE à Paris, par exemple : « SPIE, Euronext Paris : 34,12 €, en hausse de 1,2 % aujourd'hui (17 h 35). » Les chiffres sont ceux de Yahoo, jamais inventés.

Sans « Paris » dans la phrase, si une autre action correspond aussi (SPI Energy au Nasdaq), Jarvis ajoute : « J'ai pris SPIE (Paris). Tu voulais peut-être SPI Energy (Nasdaq) ? »

S'il ne trouve rien : « Je n'ai pas trouvé SPIE à la bourse. Tu peux me donner son symbole ? »

« Apple » donne le symbole AAPL. L'or, l'euro, le bitcoin, « cours de maths », « en cours » et « au cours de » ne prennent pas ce chemin.

## Tri

Avant tout modèle : Yahoo, Yahoo Finance, « sur internet », « cherche », « sur le web », Wikipédia et « cherche sur Google » vont à l'équipe Internet. « cherche sur Google le cours de SPIE » reste le cours express. L'équipe Google ne prend que les mails, l'agenda, Drive, Docs et Sheets. « Google » seul et « finance » n'y mènent pas.

Juste après un tour, « non », « je t'ai dit », « passe par » ou « pas Google » repassent par ces règles. Si aucune ne s'applique, le cerveau reçoit : « l'équipe X n'a pas su répondre au tour précédent ».

Dans Réglages → Chef d'orchestre, à côté du trieur, le dernier score s'affiche s'il existe. Sur les phrases Jarvis déjà mesurées : « Trieur : 42 % de bonnes équipes sur tes phrases. Le cerveau : 70 %. Pour l'instant, garde le cerveau. » Rien n'est activé tout seul.

## RAPPORT DE VÉRIFICATION

| Commande | Résultat |
| --- | --- |
| `npm run typecheck` | succès |
| `npm run lint` | succès |
| `npm test` | cœur vert. Bureau : 791 réussis, 6 ignorés, 1 échec. |

L'échec est `windowsDesktopMissionPath.test.ts`, test « Construire manuel : la carte reste obligatoire » : « Bloqué : typecheck n'a pas été lancé. » Le même test échoue sur `origin/main` dans cette machine, où `dotnet` n'est pas installé. Les autres tests de ce fichier passent. Ce n'est pas une régression de cette branche.

Inchangés, sans régénération des `__golden__` : `chat-unchanged`, `ollama-unchanged`, `orchestra-session`, `machineProfile`, `profiles/jarvis`. `parseSettings({})` ne gagne aucune clé. Le catalogue de `get_stock_quote` (description, schéma) n'est pas modifié.

Aucune fusion dans `main`, aucune publication.
