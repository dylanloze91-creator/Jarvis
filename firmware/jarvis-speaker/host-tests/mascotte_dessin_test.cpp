// Le dessin fourni se compile et allume des pixels. Le fichier n'est pas modifié.
#include "jarvis_mascotte.h"

#include <stdio.h>

static int pixels[MASCOTTE_HAUTEUR][MASCOTTE_LARGEUR];
static int appels;

static void rect(int x, int y, int w, int h, bool on) {
    appels++;
    for (int yy = y; yy < y + h; yy++) {
        for (int xx = x; xx < x + w; xx++) {
            if (xx >= 0 && yy >= 0 && xx < MASCOTTE_LARGEUR && yy < MASCOTTE_HAUTEUR) pixels[yy][xx] = on ? 1 : 0;
        }
    }
}

static void effacer(void) {
    appels = 0;
    for (int y = 0; y < MASCOTTE_HAUTEUR; y++) {
        for (int x = 0; x < MASCOTTE_LARGEUR; x++) pixels[y][x] = 0;
    }
}

static int allumes(void) {
    int n = 0;
    for (int y = 0; y < MASCOTTE_HAUTEUR; y++) {
        for (int x = 0; x < MASCOTTE_LARGEUR; x++) n += pixels[y][x];
    }
    return n;
}

static int scene(JarvisEtat etat, uint32_t t, int dx, int dy) {
    effacer();
    mascotte_dessiner(etat, t, rect, dx, dy);
    return allumes();
}

int main(void) {
    if (scene(JARVIS_DORT, 0, 0, 0) < 80 || appels < 10) return 1;
    if (scene(JARVIS_ECOUTE, 400, 0, 0) < 80) return 1;
    if (scene(JARVIS_REFLECHIT, 1200, 0, 0) < 80) return 1;
    mascotte_regler_bouche(5);
    if (scene(JARVIS_PARLE, 200, 0, 0) < 80) return 1;
    mascotte_regler_bouche(-1);
    int sans = scene(JARVIS_DORT, 1000, 0, 0);
    int avec = scene(JARVIS_DORT, 1000, 2, 1);
    if (sans < 80 || avec < 80) return 1;
    if (scene(JARVIS_DORT, 0, 0, 0) == 0) return 1;
    printf("mascotte_dessin : ok\n");
    return 0;
}
