// Filtre du micro, sans matériel (testé sur PC : host-tests/mic_filter_test.c).
//
// Mesure du 2026-11-11 sur la carte « chambre » (copie XH-S3E, INMP441, MIC_SHIFT 13) : au repos, le
// micro donnait 15 000 à 17 500 de RMS pour un seuil de parole de 393, et dans une phrase enregistrée
// 98 % de l'énergie des moments calmes était sous 20 Hz : une dérive lente de l'offset du micro, pas du
// bruit de pièce. L'ancien passe-haut à 2,5 Hz (constante de 64 ms) la laissait passer, l'AGC du réveil
// l'amplifiait, et le silence n'arrivait jamais : chaque phrase durait 15 s.
//
// Deux étages, en entiers : le retrait de l'offset (comme avant) puis un passe-haut du premier ordre
// à environ 100 Hz (a = e^(-2π·100/16000) ≈ 0,9615 en Q16). La voix (120 Hz et plus) passe presque
// entière ; la dérive est divisée par 50 et plus.
#pragma once

#include <stdint.h>

typedef struct {
    int32_t dc_q8;   // offset suivi, en huitièmes
    int32_t hp_x;    // entrée précédente du passe-haut
    int32_t hp_y;    // sortie précédente du passe-haut
} mic_filter_t;

#define MIC_FILTER_HP_A_Q16 63008  // 0,9615 × 65536 : coupure ≈ 100 Hz à 16 kHz

static inline void mic_filter_reset(mic_filter_t *f) {
    f->dc_q8 = 0;
    f->hp_x = 0;
    f->hp_y = 0;
}

/** Un échantillon déjà ramené à l'échelle 16 bits (après MIC_SHIFT) → échantillon filtré, borné. */
static inline int16_t mic_filter_sample(mic_filter_t *f, int32_t raw) {
    f->dc_q8 += ((raw * 256) - f->dc_q8) / 1024;
    int32_t v = raw - (f->dc_q8 / 256);
    // y[n] = a · (y[n-1] + x[n] − x[n-1]) ; produit sur 64 bits : v peut dépasser 16 bits avant la borne.
    int64_t y = ((int64_t)MIC_FILTER_HP_A_Q16 * (int64_t)(f->hp_y + v - f->hp_x)) >> 16;
    f->hp_x = v;
    if (y > 2147483647LL) y = 2147483647LL;
    if (y < -2147483648LL) y = -2147483648LL;
    f->hp_y = (int32_t)y;
    if (y > 32767) y = 32767;
    if (y < -32768) y = -32768;
    return (int16_t)y;
}
