// Enceinte Jarvis — EXEMPLE. Copie ce fichier en `include/secrets.h` et remplace chaque valeur,
// ou mieux : colle le bloc que Jarvis affiche dans Réglages → Enceintes → « Ajouter une enceinte »
// (il contient déjà l'adresse du PC, le port, le jeton et le nom), puis complète le Wi-Fi.
// `secrets.h` est ignoré par git : il ne quitte jamais ton ordinateur.
#pragma once

// Ton Wi-Fi (2,4 GHz ; la carte ne voit pas le 5 GHz) :
#define WIFI_SSID        "A_REMPLIR"
#define WIFI_PASSWORD    "A_REMPLIR"

// Le PC où tourne Jarvis : son adresse sur le Wi-Fi de la maison (affichée dans les réglages),
// ou son nom en `.local` (ex. "pc-de-dylan.local").
#define JARVIS_HOST      "192.168.1.20"
#define JARVIS_PORT      53131

// Le jeton de cette enceinte : montré UNE fois à sa création dans Réglages → Enceintes.
#define JARVIS_TOKEN     "A_REMPLIR"

// Le nom de la pièce, le même que dans les réglages (pour le journal série seulement).
#define SPEAKER_NAME     "Salon"
