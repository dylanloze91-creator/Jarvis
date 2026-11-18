// Pont entre le dessin de la mascotte (C++, include/jarvis_mascotte.h) et l'image de l'écran (C).
#pragma once

#include <stdint.h>

#include "display_gfx.h"

#ifdef __cplusplus
extern "C" {
#endif

/** Efface `g` et y dessine la mascotte (état 0 dort, 1 écoute, 2 réfléchit, 3 parle). */
void mascotte_render(gfx_t *g, int etat, uint32_t t_ms, int bouche, int decal_x, int decal_y);

#ifdef __cplusplus
}
#endif
