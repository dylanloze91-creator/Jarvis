# Revue — `cursor/bourse-et-tri` (`f02045f`), 11 novembre 2026, Claude

**Verdict : bon travail, mais deux corrections avant la fusion.**

Ce qui est bien et ne doit pas bouger :
- l'appel direct de `get_stock_quote` avec journal d'audit ;
- les phrases fixes, et jamais un cours inventé ;
- `chooseListing` (Paris d'abord) et « Tu voulais peut-être … » ;
- `isTeamCorrection` et la phrase donnée au cerveau ;
- le score du trieur affiché sans rien activer ;
- les tests figés verts.

## 1. `detectStockRequest` prend presque tout « cours de … » pour la bourse (bloquant)

`detectStockRequest` passe **avant** toutes les règles express, Google compris. J'ai exécuté le code de la branche (`node --experimental-strip-types`) sur des phrases de tous les jours. Toutes celles-ci partent à Yahoo Finance au lieu de leur vrai chemin :

| Phrase | Résultat actuel |
| --- | --- |
| à quelle heure est mon cours de demain | bourse « demain » |
| rappelle-moi mon cours de boxe | bourse « boxe » |
| le cours de boxe de jeudi | bourse « boxe de jeudi » |
| met le cours de musique sur l'agenda | bourse « musique sur l'agenda » (l'agenda Google n'est plus atteint) |
| j'ai raté le cours de ce matin | bourse « ce matin » |
| j'ai cours de 8h à 10h | bourse « 8h à 10h » |
| j'ai un cours de soutien | bourse « soutien » |
| le cours de l'eau / le cours de la Seine / le cours de la vie | bourse « eau », « Seine », « vie » |
| les cours de la récréation | bourse « récréation » |

Pire encore : si Yahoo trouve une action qui ressemble au mot (« EAU »…), Jarvis répond un cours de bourse à une question qui n'en est pas une.

À corriger :
- **Un « cours de X » sans autre indice ne suffit plus.** Les indices : « en bourse », « l'action », « cotation », « Yahoo », « combien vaut / ça vaut », « bourse », « CAC », « Euronext », « Nasdaq ». Sans indice, il faut que X **ressemble à un nom d'entreprise** : une majuscule dans la phrase d'origine, ou des capitales comme `SPIE` ou `LVMH`, ou un symbole boursier. Un mot en minuscules (« spi », « eau ») sans indice ne prend **pas** le chemin express. Le tour suit alors le chemin normal : le cerveau choisit, et l'équipe Internet a `get_stock_quote`.
- **Jamais la bourse**, même avec une majuscule :
  - un possessif (« mon », « ma », « mes », « ton », « ta », « tes », « notre », « votre ») ;
  - un mot de temps ou d'agenda (demain, aujourd'hui, ce matin, ce soir, jeudi…, une heure comme « 8h », « agenda », « rappelle », « rendez-vous », « à quelle heure », « raté ») ;
  - « j'ai cours », « un cours de », « des cours de » ;
  - un nom suivi d'un complément de lieu ou de temps (« de jeudi », « sur l'agenda »).
- Ajoute les phrases du tableau ci-dessus dans `stockIntent.test.ts`, toutes en `null`. Garde les « oui » d'aujourd'hui : « le cours de SPIE », « Jarvis, quel est le cours de Spie ? », « la cotation de Nvidia », « combien vaut Airbus en bourse », « comment va l'action Schneider », « Apple et Nvidia en bourse », « le cours de l'action TotalEnergies ».
- « le cours de spi » (Whisper qui écrit en minuscules) : sans indice, il passe par le cerveau, et c'est accepté. Avec « en bourse » ou « l'action », c'est l'express.

## 2. « cherche » envoie tout vers Internet (bloquant)

`looksLikeExpressWeb` rend vrai pour toute phrase qui contient « cherche ». « Cherche le fichier devis dans mes documents », « cherche mes photos de vacances » ou « cherche le dossier Jarvis sur le PC » partent à l'équipe Internet au lieu de l'équipe Fichiers (ou du cerveau).

À corriger : « cherche » ne mène à Internet **que** s'il est suivi de « sur internet », « sur le web », « sur Google » ou « en ligne ». Sinon, il ne mène à Internet que s'il n'y a ni possessif, ni « fichier », « dossier », « document », « photo », « PC », « ordinateur », « disque », « mail ». Dans tous les autres cas, la règle ne dit rien et le cerveau décide. Ajoute ces phrases aux tests (`orchestra.test.ts`).

## Livraison

Mêmes règles qu'avant : un commit par point, tests verts, et le rapport complété par une section « Corrections après la revue ».
