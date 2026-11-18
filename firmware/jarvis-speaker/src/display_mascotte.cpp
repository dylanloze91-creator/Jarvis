// Dessin de l'utilisateur (include/jarvis_mascotte.h, non modifié) posé dans l'image de l'écran.
#include "display_mascotte.h"

#include "jarvis_mascotte.h"

static gfx_t *cible = nullptr;

static void rect(int x, int y, int w, int h, bool allume) {
    if (cible) gfx_fill(cible, x, y, w, h, allume);
}

static void dessiner(gfx_t *g, int etat, uint32_t t_ms, int bouche, int decal_x, int decal_y) {
    cible = g;
    gfx_clear(g);
    mascotte_regler_bouche(bouche);
    mascotte_dessiner(static_cast<JarvisEtat>(etat), t_ms, rect, decal_x, decal_y);
    cible = nullptr;
}

extern "C" void mascotte_render(gfx_t *g, int etat, uint32_t t_ms, int bouche, int decal_x, int decal_y) {
    if (g->h >= MASCOTTE_HAUTEUR) {
        dessiner(g, etat, t_ms, bouche, decal_x, decal_y);
        return;
    }
    // Petit écran (128 x 32) : le dessin est fait en 128 x 64, puis réduit de moitié et centré.
    // Un point est allumé si au moins deux des quatre points d'origine le sont.
    static gfx_t grand; // une seule tâche dessine (celle de l'écran)
    gfx_init(&grand, MASCOTTE_LARGEUR, MASCOTTE_HAUTEUR);
    dessiner(&grand, etat, t_ms, bouche, decal_x, decal_y);
    gfx_clear(g);
    const int gauche = (g->w - MASCOTTE_LARGEUR / 2) / 2;
    const int haut = (g->h - MASCOTTE_HAUTEUR / 2) / 2;
    for (int y = 0; y < MASCOTTE_HAUTEUR / 2; y++) {
        for (int x = 0; x < MASCOTTE_LARGEUR / 2; x++) {
            const int n = gfx_get(&grand, 2 * x, 2 * y) + gfx_get(&grand, 2 * x + 1, 2 * y) +
                          gfx_get(&grand, 2 * x, 2 * y + 1) + gfx_get(&grand, 2 * x + 1, 2 * y + 1);
            if (n >= 2) gfx_pixel(g, gauche + x, haut + y, true);
        }
    }
}
