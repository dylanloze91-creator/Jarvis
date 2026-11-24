#pragma once
// Volume de sortie vers l'ampli, avec des crêtes adoucies.
//
// Le 24 novembre 2026, l'ampli de la deuxième carte est alimenté en 3,3 V (la broche 5V de la
// carte n'est pas alimentée depuis la prise USB native) : il est plus faible qu'en 5 V. Le volume
// peut donc dépasser 100 % ; au-dessus de SPEAKER_GAIN_KNEE de la pleine échelle, la crête est
// arrondie (tanh) au lieu d'être coupée net : pas de grésillement, et jamais de débordement.

#include <math.h>
#include <stdint.h>

#define SPEAKER_GAIN_KNEE 0.5f

static inline int16_t speaker_gain_sample(int16_t sample, int volume_percent) {
    float v = (float)sample * (float)volume_percent / (100.0f * 32767.0f);
    float a = fabsf(v);
    if (a > SPEAKER_GAIN_KNEE) {
        a = SPEAKER_GAIN_KNEE + (1.0f - SPEAKER_GAIN_KNEE) * tanhf((a - SPEAKER_GAIN_KNEE) / (1.0f - SPEAKER_GAIN_KNEE));
        v = v < 0.0f ? -a : a;
    }
    long out = lrintf(v * 32767.0f);
    if (out > 32767) out = 32767;
    if (out < -32767) out = -32767;
    return (int16_t)out;
}
