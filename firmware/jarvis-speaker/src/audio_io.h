// Micro (INMP441) et haut-parleur (MAX98357A) en I2S, tous deux en 16 kHz mono 16 bits.
#pragma once

#include <stdbool.h>
#include <stddef.h>
#include <stdint.h>

void audio_init(void);

/** Lit `samples` échantillons du micro (bloquant). Rend le nombre d'échantillons lus. */
size_t mic_read(int16_t *out, size_t samples);

/** Prépare la sortie à cette cadence (16 000 par défaut ; la réponse du PC peut en avoir une autre). */
void speaker_set_rate(uint32_t sample_rate);

/** Joue des échantillons PCM 16 bits mono, volume appliqué (bloquant). */
void speaker_play(const int16_t *pcm, size_t samples);

/** Attend que la file du haut-parleur soit vide, puis envoie un court silence (évite le « clac »). */
void speaker_flush(void);

/** Bip de réveil (deux notes montantes, ≈ 120 ms), généré ; ne bloque pas et ne coupe pas le micro. */
void tone_wake(void);

/** Son d'erreur (deux notes descendantes), généré. */
void tone_error(void);

/** Énergie moyenne (RMS, sur 32768) d'un bloc : sert à repérer parole et silence. */
int32_t pcm_rms(const int16_t *pcm, size_t samples);
