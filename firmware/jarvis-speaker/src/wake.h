// Mot de réveil « Jarvis » sur la carte (ESP-SR : WakeNet dans l'AFE). Rien ne part au PC avant.
#pragma once

#include <stdbool.h>
#include <stddef.h>
#include <stdint.h>

/** Charge le modèle depuis la partition « model » et démarre la lecture du micro. */
bool wake_init(void);

/** Nombre d'échantillons de chaque trame rendue par `wake_fetch` (≈ 32 ms à 16 kHz). */
size_t wake_frame_samples(void);

typedef struct {
    const int16_t *pcm; // trame nettoyée (suppression de bruit, gain), 16 kHz mono
    size_t samples;
    bool wake_detected; // « Jarvis » vient d'être entendu dans cette trame
} wake_frame_t;

/** Trame suivante du micro (bloquant). Faux si rien n'est arrivé dans le délai. */
bool wake_fetch(wake_frame_t *out, uint32_t timeout_ms);

/** Le mot de réveil est-il surveillé ? Hors veille, on le coupe (une phrase peut le contenir). */
void wake_enable(bool enabled);

/** Le micro n'alimente plus la détection (pendant que la carte parle) ; puis purge à la reprise. */
void wake_mute(bool muted);
