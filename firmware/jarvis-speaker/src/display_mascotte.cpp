// Dessin de l'utilisateur (include/jarvis_mascotte.h, non modifié) posé dans l'image de l'écran.
#include "display_mascotte.h"

#include "jarvis_mascotte.h"

static gfx_t *cible = nullptr;

static void rect(int x, int y, int w, int h, bool allume) {
    if (cible) gfx_fill(cible, x, y, w, h, allume);
}

extern "C" void mascotte_render(gfx_t *g, int etat, uint32_t t_ms, int bouche, int decal_x, int decal_y) {
    cible = g;
    gfx_clear(g);
    mascotte_regler_bouche(bouche);
    mascotte_dessiner(static_cast<JarvisEtat>(etat), t_ms, rect, decal_x, decal_y);
    cible = nullptr;
}
