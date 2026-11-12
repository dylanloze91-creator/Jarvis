# Revue — `cursor/deux-jarvis` (`747833e`), 12 novembre 2026, Claude

**Verdict : très bon travail.** La partie 0 est sérieuse, et deux idées du cahier ont été corrigées à juste titre :
- `5.1.N` seul aurait été pris pour une version stable : `5.1.N-test.M` avec un canal `test` est le bon choix ;
- le port Spotify doit rester fixe.

À garder tel quel :
- la table unique de l'édition ;
- Live sans `setPath` ;
- le dossier de Test fixé avant le verrou, `sessionData` compris ;
- les ports des enceintes et du téléphone décalés ;
- le raccourci sans repli dans Test ;
- la recopie en lecture seule ;
- `release-test.sh` qui refuse les versions sans `-test`.

## Une correction avant les essais (bloquante)

**Ne pas recopier les jetons de connexion : `spotify-token.json` et `google-token.bin`.** Seul `coffre.bin` (les clés API) peut être recopié.

Pourquoi : un jeton de connexion n'est pas une clé, c'est **une autorisation** que Spotify ou Google ont donnée à une installation. Si Live et Test partagent la même :
- **Spotify (PKCE)** peut rendre un nouveau jeton de rafraîchissement à chaque rafraîchissement et invalider l'ancien. Le premier des deux qui se rafraîchit peut **déconnecter l'autre**, et donc Live.
- **Google** : « Se déconnecter » dans Test révoque l'autorisation (`revoke`), donc **celle de Live aussi**.

Dans Test, Spotify et Google se reconnectent normalement, avec le même identifiant client. Chaque installation a ainsi sa propre autorisation, et la phrase du guide le dit déjà. Ajoute un test : ces deux fichiers ne sont jamais copiés, même lisibles.

## À vérifier sur le PC (essais de Claude Code)

- **Le coffre recopié est-il vraiment lisible par Test ?** Sous Windows, `safeStorage` passe par la clé de chiffrement de Chromium, rangée dans le « Local State » de chaque application et protégée par DPAPI. Test pourrait donc ne pas déchiffrer le coffre de Live, même avec le même compte Windows. Le code retombe alors sur le guide « reconnecte » : c'est sans danger, mais il faut savoir lequel des deux chemins se produit vraiment.
- L'échec `windowsDesktopMissionPath.test.ts` est corrigé dans `claude/live-5077` (5.0.77) : il disparaîtra à la fusion.

## Ordre

1. La Live 5.0.77 est publiée d'abord.
2. Ensuite, cette branche est mise à jour avec le nouveau `main` (fusion, sans `--force`).
3. Claude Code fait les 5 essais du rapport, plus celui du coffre.
4. Première publication de Test : `5.1.0-test.1`.
