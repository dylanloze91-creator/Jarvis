# Brancher une enceinte

Tu branches la carte au PC, tu cliques dans Jarvis, tu choisis la pièce et le Wi-Fi. C'est tout.

## Ce qu'il te faut

- La carte ESP32-S3 déjà câblée (micro et haut-parleur). Le guide de montage est `firmware/jarvis-speaker/README.md`.
- Un câble USB **données** (pas un câble de charge seule).
- Le Wi-Fi de la maison en **2,4 GHz**. La carte ne voit pas le 5 GHz.

## Les cinq minutes

1. Branche la carte sur la prise marquée **UART** ou **COM**.
2. Ouvre Jarvis → **Parler à Jarvis** → **Enceintes**.
3. Active **Enceintes** si ce n'est pas déjà fait.
4. Clique **Ajouter une enceinte**.
5. Choisis la pièce (Salon, Chambre, Cuisine, Bureau, ou un autre nom).
6. Choisis le Wi-Fi, tape le mot de passe, clique **Installer**.
7. Attends que l'enceinte dise « Bonjour, je suis l'enceinte du Salon ».
8. Débranche-la et pose-la dans la pièce.

Le mot de passe ne reste pas sur le PC.

## Si la carte ne se laisse pas installer

Maintiens le bouton **BOOT**.
Appuie une fois sur **RESET**.
Relâche **BOOT**.
Clique **Réessayer**.

```
  BOOT maintenu ──► appui RESET ──► relâche BOOT ──► Réessayer
```

## Si elle ne répond plus dans la pièce

Dans Enceintes, clique **Mon enceinte ne répond pas**.

- Une ligne rouge dit ce qui bloque (pont arrêté, pare-feu, réseau en mode Public).
- **Réparer** ouvre la fenêtre d'accord de Windows. Rien ne se fait tout seul.
- Passer le réseau en Privé est un autre bouton. Fais-le seulement si c'est le réseau de ta maison.

## La lumière

| Lumière | Sens |
| --- | --- |
| Violet qui respire | elle attend que tu l'installes |
| Orange | elle démarre |
| Éteinte | elle attend « Jarvis » |
| Verte | elle écoute |
| Bleue | elle réfléchit ou elle parle |
| Violet fixe | la clé ne marche plus : réinstalle-la |
| Rouge | elle a perdu le Wi-Fi ou le PC depuis un moment |

Tenir **BOOT** dix secondes efface les réglages. Elle revient au violet qui respire.

## Pour les développeurs

PlatformIO et `secrets.h` restent possibles. C'est la fin du guide de montage, section « Pour les développeurs ».
