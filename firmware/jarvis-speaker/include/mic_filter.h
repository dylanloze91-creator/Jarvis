// Filtre du micro, sans matériel (testé sur PC : host-tests/mic_filter_test.c).
//
// Mesure du 2026-11-11 sur la carte « chambre » (copie XH-S3E, INMP441) : au repos, le micro donnait
// 15 000 à 17 500 de RMS pour un seuil de parole de 393, et dans une phrase enregistrée 98 % de
// l'énergie des moments calmes était sous 20 Hz : une dérive lente de l'offset du micro, pas du bruit de
// pièce. L'ancien passe-haut à 2,5 Hz (constante de 64 ms) la laissait passer, l'AGC du réveil
// l'amplifiait, et le silence n'arrivait jamais : chaque phrase durait 15 s.
//
// Trois étages, en entiers : le retrait de l'offset (comme avant) puis deux passe-haut du premier ordre
// à 60 Hz en cascade (a = e^(-2π·60/16000) ≈ 0,9767 en Q16). Le second ordre coupe la dérive bien plus
// fort qu'un seul étage (10 Hz : ÷37 ; 2 Hz : ÷900) tout en gardant les graves de la voix (120 Hz : 80 %,
// 150 Hz : 86 %, 400 Hz : 98 %), ce qu'un seul étage à 100 Hz ne faisait pas (120 Hz : 77 %) : le mot de
// réveil, détecté sur ce signal, ne perd presque rien.
#pragma once

#include <stdint.h>

typedef struct {
    int32_t dc_q8;   // offset suivi, en huitièmes
    int32_t x1, y1;  // premier passe-haut : entrée et sortie précédentes
    int32_t x2, y2;  // second passe-haut
} mic_filter_t;

#define MIC_FILTER_HP_A_Q16 64010  // 0,9767 × 65536 : coupure 60 Hz à 16 kHz, deux étages

static inline void mic_filter_reset(mic_filter_t *f) {
    f->dc_q8 = 0;
    f->x1 = f->y1 = 0;
    f->x2 = f->y2 = 0;
}

static inline int32_t mic_filter_hp(int32_t x, int32_t *px, int32_t *py) {
    // y[n] = a · (y[n-1] + x[n] − x[n-1]) ; produit sur 64 bits : x peut dépasser 16 bits avant la borne.
    int64_t y = ((int64_t)MIC_FILTER_HP_A_Q16 * (int64_t)(*py + x - *px)) >> 16;
    if (y > 2147483647LL) y = 2147483647LL;
    if (y < -2147483648LL) y = -2147483648LL;
    *px = x;
    *py = (int32_t)y;
    return (int32_t)y;
}

/** Un échantillon déjà ramené à l'échelle 16 bits (après MIC_SHIFT) → échantillon filtré, borné. */
static inline int16_t mic_filter_sample(mic_filter_t *f, int32_t raw) {
    f->dc_q8 += ((raw * 256) - f->dc_q8) / 1024;
    int32_t v = raw - (f->dc_q8 / 256);
    v = mic_filter_hp(v, &f->x1, &f->y1);
    v = mic_filter_hp(v, &f->x2, &f->y2);
    if (v > 32767) v = 32767;
    if (v < -32768) v = -32768;
    return (int16_t)v;
}
