# La voix du robot

Le robot peut servir d’enceinte Jarvis : il entend « Jarvis » là où il est, envoie la phrase au PC, et joue la réponse. Le pilotage des roues ne change pas. C’est un deuxième programme, à côté.

Le Pi 5 n’a pas de prise casque. Il faut un son en USB.

## Quoi acheter

Un **haut-parleur-micro de conférence USB** : le micro et le haut-parleur sont dans le même boîtier, avec un seul câble, et l’appareil coupe l’écho tout seul. Sans ça, le robot s’entend parler et peut se réveiller avec sa propre voix.

C’est le même genre d’appareil que pour une réunion en ligne. Le prix bouge : le vérifier au moment de l’achat.

À la place : une carte son USB, un micro, et un petit haut-parleur. Ça marche, mais l’écho est plus difficile à éviter.

N’importe quel appareil reconnu par Linux (ALSA) convient. On choisit son nom dans la configuration.

## Brancher

1. Brancher l’appareil sur un port USB du Pi.
2. Allumer le Pi, avec le programme de pilotage déjà installé (il ne sert pas à la voix, mais « stop » l’appelle).
3. Sur le Pi, voir le nom du son :

```bash
arecord -L
```

Le nom à copier ressemble à `plughw:1,0` ou `default`. `default` convient souvent s’il n’y a qu’un seul appareil.

## Installer

Sur le Pi, copier le dossier `robot/voix`, puis :

```bash
cd robot/voix
sudo sh installer.sh
```

Le script crée un utilisateur `jarvis-voix`, un environnement Python à part, télécharge le modèle du mot « Jarvis » et le petit modèle de reconnaissance français (pour « stop »), et démarre le service. Il redémarre tout seul si le programme s’arrête.

La première fois, le fichier de réglages est créé vide :

```bash
sudo nano /etc/jarvis-robot-voix/config.toml
```

## Ajouter l’enceinte « Robot » dans Jarvis

Sur le PC, Jarvis doit avoir les enceintes (Réglages → Enceintes).

1. Activer « Enceintes Jarvis ».
2. « Ajouter une enceinte », nom **Robot**.
3. Jarvis affiche un jeton, une seule fois, et l’adresse du PC.
4. Coller dans `/etc/jarvis-robot-voix/config.toml` :
   - `pc_hote` : l’adresse indiquée (le nom qui finit par `.local`, ou l’adresse IP) ;
   - `pc_port` : le port indiqué (53131) ;
   - `jeton_enceinte` : le jeton affiché.
5. `jeton_robot` : le jeton du service de pilotage (celui déjà collé dans Jarvis → Réglages → Robot).
6. `peripherique` : le nom vu avec `arecord -L`, ou `default`.

Puis :

```bash
sudo systemctl restart jarvis-robot-voix
```

## Premier essai

1. Le PC est allumé, Jarvis aussi, les enceintes activées.
2. Dire « Jarvis » près du robot, puis « quelle heure est-il ».
3. Le robot joue la réponse. Pendant qu’il parle, il n’écoute pas.
4. Juste après, on peut enchaîner sans redire « Jarvis », pendant la fenêtre indiquée par le PC.
5. « Jarvis, stop » (ou « arrête », « arrête-toi », « stop robot ») coupe les roues tout de suite, sur le Pi, sans attendre le PC.

Le bouton d’arrêt d’urgence du robot reste la vraie sécurité.

## Si ça ne marche pas

| Ce qu’on voit | Quoi faire |
| --- | --- |
| Rien dans le journal | `journalctl -u jarvis-robot-voix -f` |
| Le service redémarre en boucle | Le jeton d’enceinte est vide, ou `config.toml` est illisible |
| Il n’entend pas « Jarvis » | Se rapprocher, monter un peu `sensibilite` (0,7), vérifier `peripherique` |
| Il s’entend lui-même | Préférer un haut-parleur-micro avec annulation d’écho, ou baisser le volume |
| « stop » ne coupe pas les roues | Le modèle français manque (`modeles/vosk-model-small-fr-0.22`), ou `jeton_robot` / le port 8765 |
| Un bip court, pas de réponse | Le PC est éteint, l’adresse est fausse, ou les enceintes sont coupées dans Jarvis |

« Avance de 50 cm » dit au robot ne le fait pas bouger : Jarvis, depuis une enceinte, refuse tout ce qui demande une confirmation. Il le dit. Pour conduire le robot, utiliser le PC ou le téléphone.
