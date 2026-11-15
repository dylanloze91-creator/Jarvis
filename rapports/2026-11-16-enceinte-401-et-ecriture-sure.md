# Enceinte de la chambre en 401, et écriture sûre des fichiers d'état (5.0.78)

16 novembre 2026, Claude Code sur le PC Windows. Branche `claude/missions-roles-5078`.

Ce rapport ne contient ni jeton, ni nom de Wi-Fi, ni mot de passe.

## 1. Le bogue de la Live 5.0.77

**Symptôme.** L'enceinte de la chambre entend « Jarvis » mais ne joint plus le PC.

**Cause, en une phrase.** Le fichier `speakers.json` a été retrouvé rempli de zéros après les coupures de courant du 13 novembre. Jarvis l'a mis de côté et repart avec une liste vide : la clé de l'enceinte n'est plus connue, et le PC répond 401.

### Vérifications, dans l'ordre demandé

| # | Contrôle | Résultat |
| --- | --- | --- |
| 1 | Adresse IPv4 du PC (Wi-Fi, donnée par la box) contre `JARVIS_HOST` de `secrets.h` (dépôt `Jarvis-enceinte-materiel`) | identiques (192.168.1.88) ✅ |
| 2 | Écoute sur 53131 | `Jarvis.exe` 5.0.77 écoute sur `0.0.0.0:53131` ✅ |
| 2 | Service Enceintes | activé (`enabled: true`) ✅ |
| 3 | Pare-feu | règle « Jarvis — enceintes (TCP 53131) » active, profil Privé ; le réseau Wi-Fi est en Privé ✅ |
| 4 | Journal de l'enceinte par USB (`journal_enceinte.py COM9 180`) | « Jarvis » entendu → envoi de 3,0 s → **réponse 401**, « jeton refusé » ❌ |
| — | Enceintes enregistrées sur le PC | **0** ❌ |
| — | Essai depuis le PC avec le jeton de `secrets.h` (`fake-speaker.mjs --hello`) | **401** : « Cette enceinte n'est pas reliée à Jarvis » ❌ |

L'adresse du PC n'a pas changé : la réservation d'adresse dans la box n'est pas nécessaire pour ce bogue. Elle reste conseillée, puisque l'adresse est donnée par la box (DHCP).

### Ce qui s'est passé

- Le dossier de données est `%APPDATA%\@jarvis\desktop`, pas `%APPDATA%\Jarvis`.
- `speakers.json.illisible` : **413 octets, tous à zéro**, daté du 13 novembre à 12 h 10.
- Le journal de Windows note deux coupures de courant ce jour-là (Kernel-Power 41 à 14 h 58 et à 15 h 32).
- Au démarrage suivant, `SpeakerStore.load()` a jugé le fichier illisible et l'a copié en `.illisible`. Il est reparti d'une liste vide, réécrite à 17 h 53 quand le service a été réactivé.
- **Pourquoi des zéros.** L'écriture faisait « fichier temporaire, puis renommage », mais sans forcer les données sur le disque (`fsync`). Après une coupure, Windows peut garder le renommage et perdre le contenu.

### Restauration

- Aucune archive `jarvis-sauvegarde-*.zip` sur les disques C à G.
- La sauvegarde automatique n'a jamais été réglée (pas de bloc `backup` dans `settings.json`).
- **Il faut donc refaire « Ajouter une enceinte »**, puis renvoyer le nouveau `secrets.h` par USB.

### Autres fichiers abîmés

Recherche en lecture seule de tous les fichiers d'état du dossier de données : 166 fichiers, journaux compris, sans les caches du navigateur intégré. Un seul est abîmé : `speakers.json.illisible`. Rien n'a été modifié.

## 2. Écriture sûre commune (5.0.78)

Nouveau module `apps/desktop/src/main/safeFile.ts`.

**À l'écriture (`writeStateFile`)**, dans cet ordre :
1. écrire un fichier temporaire au nom unique, puis le forcer sur le disque ;
2. copier la version actuelle en `<fichier>.bak`, forcée sur le disque, **seulement si elle est saine** : un fichier de zéros n'écrase jamais la dernière bonne copie ;
3. renommer le temporaire à la place du fichier ;
4. forcer le dossier (sans effet sous Windows).

**À la lecture (`readStateFile`)** :
- Un fichier vide, rempli de zéros, ou refusé par le lecteur du fichier est **mis de côté, jamais effacé**. Une copie déjà mise de côté n'est jamais écrasée : la suivante porte la date.
- Ensuite le `.bak` est repris s'il se lit, et réécrit à la place du fichier.
- Un fichier absent reste absent : le `.bak` ne ressuscite pas un fichier effacé exprès.
- Chaque cas est noté pour le bilan de santé.

**Fichiers concernés :**

| Fichier | Copie mise de côté |
| --- | --- |
| `settings.json` | `settings.json.corrompu` (nom d'avant gardé) |
| `speakers.json` | `speakers.json.illisible` |
| `phone.json` | `phone.json.illisible` |
| `questionnaire.json` | `questionnaire.json.illisible` |
| `personalization.json` (avant : écrit directement, sans temporaire) | `personalization.json.illisible` |
| `coffre.bin` | `coffre.illisible.bin` (nom d'avant gardé) |
| `developer/code-model.json` | `.illisible` |
| `developer/projects/registry.json` | `.illisible` |

Pour les autres fichiers des projets (`memory.json`, discussions), l'écriture est sûre, mais sans `.bak`.

**Pas convertis (décision à prendre)** :
- les conversations : un fichier par discussion, un `.bak` chacune doublerait le dossier ;
- `knowledge-index.json` : il se reconstruit, et il a son propre verrou ;
- l'index de l'apprentissage du réveil ;
- l'état de la sauvegarde.

**Bilan de santé.** Nouveau contrôle `files`, facultatif dans `HealthFacts` et affiché seulement s'il y a un incident :
- orange : « speakers.json était abîmé (gardé en speakers.json.illisible) : j'ai repris sa version précédente. Vérifie ce qui a changé depuis. » ;
- rouge : la même chose sans version précédente.

**Report d'un correctif de `main`.** Le registre des projets reprend la protection ENOENT du commit `78dbae4` (5.0.77), absente de cette branche. Sans elle, la suite affichait un rejet non traité.

## 3. Tests

- `apps/desktop/src/main/safeFile.test.ts` couvre :
  - fichier de 413 octets nuls, comme celui du PC ;
  - `.bak` gardé et non écrasé par un fichier de zéros ;
  - mise de côté sans écrasement ;
  - fichier absent non ressuscité ;
  - **`speakers.json` de zéros : l'enceinte et sa clé reviennent** ;
  - même chose pour `phone.json` ;
  - lignes du bilan et collecteur.
- `store.test.ts` : un test ajouté (réglages de zéros → `.bak`). Le test de 5.0.64 retire d'abord le `.bak` laissé par le test d'avant : il vérifie toujours « sans version précédente → défauts, copie `.corrompu` ».
- Aucun `__golden__` régénéré. `parseSettings({})` ne gagne aucune clé.
- `windowsDesktopMissionPath.test.ts` (« Construire manuel ») échoue aussi **sans** ce changement : sa correction est dans la 5.0.77, sur `main`. Il passera après la fusion de la 5.0.77 dans cette branche.

Résultats de la suite complète : voir le rapport de vérification ci-dessous.

## RAPPORT DE VÉRIFICATION

- `npm run typecheck` : vert.
- `npm run lint` : 0 erreur.
- `npm test` :
  - cœur : 209 fichiers, 2 397 tests verts ;
  - bureau : 793 verts, 8 ignorés, **1 rouge** (`windowsDesktopMissionPath.test.ts`, « Construire manuel »). Il est rouge aussi sans ce changement (vérifié en mettant le changement de côté) : sa correction est dans la 5.0.77, sur `main`.
- Secrets : aucun jeton, aucun nom de Wi-Fi dans le diff (recherche faite).
- `__golden__` : aucun fichier régénéré ni modifié.
- `npm run build` : pas lancé.
- Testé en vrai (à la voix, sur le PC) : **PAS FAIT**. L'enceinte attend toujours une nouvelle clé : « Ajouter une enceinte », puis envoi par USB.
