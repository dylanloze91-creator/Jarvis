// La mascotte passe bien par l'image de l'écran (display_gfx) : chaque état allume des points,
// la bouche imposée change l'image, et le décalage anti-marquage la déplace.
// Avec un dossier en argument, écrit chaque image en PGM pour la regarder.
#include <cstdio>
#include <cstring>

extern "C" {
#include "display_gfx.h"
#include "display_mascotte.h"
}

static int lit(const gfx_t &g) {
    int n = 0;
    for (int y = 0; y < g.h; y++)
        for (int x = 0; x < g.w; x++) n += gfx_get(&g, x, y);
    return n;
}

static void save(const gfx_t &g, const char *dir, const char *name) {
    if (!dir) return;
    char path[256];
    std::snprintf(path, sizeof(path), "%s/%s.pgm", dir, name);
    FILE *f = std::fopen(path, "wb");
    if (!f) return;
    std::fprintf(f, "P5\n%d %d\n255\n", g.w, g.h);
    for (int y = 0; y < g.h; y++)
        for (int x = 0; x < g.w; x++) std::fputc(gfx_get(&g, x, y) ? 255 : 0, f);
    std::fclose(f);
}

int main(int argc, char **argv) {
    const char *dir = argc > 1 ? argv[1] : nullptr;
    gfx_t g;
    gfx_init(&g, 128, 64);
    const char *names[] = {"dort", "ecoute", "reflechit", "parle"};
    for (int etat = 0; etat < 4; etat++) {
        for (unsigned t = 0; t < 4000; t += 500) {
            mascotte_render(&g, etat, t, -1, 0, 0);
            if (lit(g) < 80) { std::printf("état %d à %u ms : presque rien\n", etat, t); return 1; }
            char file[48];
            std::snprintf(file, sizeof(file), "%s-%04u", names[etat], t);
            save(g, dir, file);
        }
    }
    gfx_t a, b;
    gfx_init(&a, 128, 64);
    gfx_init(&b, 128, 64);
    mascotte_render(&a, 3, 200, 0, 0, 0);
    mascotte_render(&b, 3, 200, 5, 0, 0);
    if (std::memcmp(a.buf, b.buf, sizeof(a.buf)) == 0) { std::puts("la bouche ne bouge pas"); return 1; }
    mascotte_render(&a, 0, 1000, -1, 0, 0);
    mascotte_render(&b, 0, 1000, -1, 2, 1);
    if (std::memcmp(a.buf, b.buf, sizeof(a.buf)) == 0) { std::puts("le décalage ne déplace rien"); return 1; }
    std::puts("display_mascotte : OK");
    return 0;
}
