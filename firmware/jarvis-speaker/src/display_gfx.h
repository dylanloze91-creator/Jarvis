// Dessin en mémoire pour le petit écran OLED de l'enceinte : sans matériel, testé sur le PC (host-tests).
#pragma once

#include <stdbool.h>
#include <stddef.h>
#include <stdint.h>

#define GFX_MAX_W 128
#define GFX_MAX_H 64

/** Image de l'écran, au format des puces SSD1306 / SH1106 : un octet = 8 points verticaux d'une « page ». */
typedef struct {
    uint8_t w, h;
    uint8_t buf[GFX_MAX_W * GFX_MAX_H / 8];
} gfx_t;

void gfx_init(gfx_t *g, uint8_t w, uint8_t h);
void gfx_clear(gfx_t *g);
void gfx_pixel(gfx_t *g, int x, int y, bool on);
bool gfx_get(const gfx_t *g, int x, int y);
void gfx_fill(gfx_t *g, int x, int y, int w, int h, bool on);

/** Largeur en points d'un texte UTF-8 à l'échelle `scale` (1 = 5 x 7, 2 = 10 x 14…). */
int gfx_text_width(const char *utf8, int scale);
/** Écrit un texte UTF-8 ; renvoie la largeur dessinée. Les lettres inconnues deviennent « ? ». */
int gfx_text(gfx_t *g, int x, int y, const char *utf8, int scale);
/** Centré horizontalement ; coupé avec « … » s'il dépasse la largeur de l'écran. */
void gfx_text_center(gfx_t *g, int y, const char *utf8, int scale);

/**
 * Coupe `in` pour qu'il tienne dans `max_w` points à l'échelle `scale` (ajoute « … »).
 * Écrit dans `out` (au plus `size` octets, zéro final compris).
 */
void gfx_fit(const char *in, int max_w, int scale, char *out, size_t size);
