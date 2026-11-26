# Les yeux vers la Live : où on en est (27 novembre 2026, nuit)

Rapport seulement : rien n'est mis dans la Live. Les yeux restent dans Jarvis Test, coupés par défaut (`edition().yeux` vaut `true` dans Test seulement ; réglage `yeux` sans défaut Zod).

## 1. Ce qui est prêt

| Morceau | Code et essais automatiques | Essayé en vrai |
| --- | --- | --- |
| Registre des yeux, caméra de l'imprimante (Klipper, GET seulement), écran « Yeux » du tableau de bord | oui | oui, au clavier dans Jarvis Test (23/11), pas à la voix |
| Webcams du PC (fenêtre cachée à part, ouverte à la demande, coupées par défaut, jamais dans une chambre) | oui, deux webcams comme deux yeux | Logitech C922 : marche, mais image sombre. Elgato Facecam : image noire (à revoir de jour) |
| iPhone « Montrer à Jarvis » (photo, en mémoire) | oui | **non** : le téléphone est relié à la Live, qui n'a pas les yeux |
| Regarder une photo et répondre (modèle de vision, texte lu, recherche web vérifiée, doutes dits) | oui | oui dans la fenêtre, avec une image fabriquée ; aucune vraie photo d'électronique |
| Câblage de l'enceinte comparé à `config.h` (jamais « c'est bon », dit quoi mesurer) | oui | non |
| Vidéo (fenêtre et iPhone, images clés et son, 3 min au plus) | oui (branchée cette nuit) | **non** : Jarvis Test et la carte étaient pris |
| Veille des impressions (tâche Windows hors de Jarvis, photo toutes les 10 min, questionnaire, ntfy) | oui | **oui** : trois impressions, redémarrage du PC, notification reçue, questionnaire rempli |
| Image trop sombre = « je ne peux pas juger » | oui | oui sur les photos déjà prises : fausses alertes 46 → 30 |
| Programme de l'œil pour Raspberry Pi (rover, hub) | écrit | non, rien installé sur un Pi |

## 2. Ce qui manque avant la Live

1. **Un modèle de vision choisi sur tes photos.**
   - Aujourd'hui, `gemma3:4b` est provisoire.
   - Sur tes impressions, il n'a jamais dit « ça va » : 0 bonne réponse sur 97 photos.
   - Le banc de l'examen attend ta validation des 5 questions et les 8 photos vides à renvoyer.
2. **L'essai en vrai de la vidéo**, dans la fenêtre et sur l'iPhone.
3. **Un essai sur l'iPhone relié à Jarvis Test** (adresse `:8443`) : « Montrer à Jarvis », photo puis vidéo.
4. **Les derniers travaux dans `claude/dev`**, pour que Jarvis Test les ait : vidéo, ntfy, trop sombre. Une dizaine de commits de `claude/yeux-etape-1` n'y sont pas encore. Aucun conflit connu.
5. **De la lumière pour la caméra de l'imprimante.** La nuit, presque toutes les photos sont « trop sombres » (66 sur 67 le 25), donc les yeux ne surveillent rien la nuit.
6. **La lecture des réponses prudentes.**
   - Le modèle répond souvent par une liste « ce qui semble normal / ce qui pourrait indiquer un problème ».
   - La règle actuelle lit ça comme une alerte : ce sont les 29 fausses alertes du support de téléphone, sur des images claires.
   - Je ne l'ai pas changée cette nuit : ce serait ajuster la règle sur les photos mêmes qui servent à la mesurer.
7. **La mise en place dans la Live** :
   - activer `yeux` dans la table d'édition de la Live ;
   - laisser le réglage coupé par défaut ;
   - repasser les tests figés (`chat-unchanged`, etc.) sans régénération ;
   - faire la publication habituelle sur ton « publie ».

## 3. Ce que tu dois décider

1. **Faire une exception à « la Live ne reçoit que des corrections »**, comme pour l'atelier 3D, ou attendre ?
2. **Le modèle de vision** :
   - (a) garder `gemma3:4b` pour commencer ;
   - (b) essayer `qwen2.5vl:7b`. C'est environ 6 Go à télécharger, avec ton accord seulement. Il lit mieux le texte, mais charge plus la carte : il faut décharger le 7B du chat à chaque regard ;
   - (c) attendre le banc sur l'examen validé (mon conseil).
3. **Les webcams** :
   - lesquelles mettre dans la Live et dans quelle pièce (jamais une chambre) ;
   - faut-il de la lumière devant la C922 ;
   - garde-t-on l'Elgato (image noire, à réessayer de jour).
4. **La veille des impressions** :
   - (a) la laisser comme aujourd'hui : une tâche Windows à part, qui marche même quand Jarvis est fermé (mon conseil) ;
   - (b) la mettre dans la Live (elle ne tournerait que Jarvis ouvert).
   - Dans les deux cas : pas de commit, carte partagée par `gpu.json`, ntfy, port 8444.
5. **Une lampe près de l'imprimante** (achat), pour que les yeux servent aussi la nuit.
6. **Les réponses prudentes** : les compter comme « incertain » plutôt que comme « alerte » ? On le mesurerait d'abord sur les impressions suivantes, jamais sur celles qui ont servi à fixer la règle.

## 4. Ce qui ne bouge pas

- Aucune commande à l'imprimante. Une analyse n'est jamais une raison d'agir seule.
- Pas de caméra dans une chambre. Rien d'enregistré sans « garde cette photo ».
- La fenêtre principale refuse toujours la caméra.
- Les photos d'examen servent seulement à mesurer, jamais à entraîner.
