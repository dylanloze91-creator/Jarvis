// Tests du dessin de l'écran (sans matériel). Avec un dossier en argument, écrit aussi chaque écran en PGM
// pour le regarder : ./display_test /tmp/ecrans
#include <assert.h>
#include <stdio.h>
#include <string.h>

#include "display_gfx.h"
#include "display_view.h"

static int lit(const gfx_t *g) {
    int n = 0;
    for (int y = 0; y < g->h; y++)
        for (int x = 0; x < g->w; x++) n += gfx_get(g, x, y);
    return n;
}

static void save(const gfx_t *g, const char *dir, const char *name) {
    if (!dir) return;
    char path[256];
    snprintf(path, sizeof(path), "%s/%s.pgm", dir, name);
    FILE *f = fopen(path, "wb");
    assert(f);
    fprintf(f, "P5\n%d %d\n255\n", g->w, g->h);
    for (int y = 0; y < g->h; y++)
        for (int x = 0; x < g->w; x++) fputc(gfx_get(g, x, y) ? 255 : 0, f);
    fclose(f);
}

int main(int argc, char **argv) {
    const char *dir = argc > 1 ? argv[1] : NULL;
    gfx_t g;

    // Points et bords.
    gfx_init(&g, 128, 64);
    gfx_pixel(&g, 0, 0, true);
    gfx_pixel(&g, 127, 63, true);
    gfx_pixel(&g, 128, 64, true); // hors écran : ignoré
    gfx_pixel(&g, -1, 3, true);
    assert(lit(&g) == 2 && gfx_get(&g, 127, 63));
    assert(g.buf[0] == 0x01 && g.buf[1023] == 0x80);

    // Largeurs : 6 points par lettre moins l'espace final ; un accent compte pour une lettre.
    assert(gfx_text_width("A", 1) == 5);
    assert(gfx_text_width("12:34", 3) == (5 * 6 - 1) * 3);
    assert(gfx_text_width("\xC3\xA9t\xC3\xA9", 1) == gfx_text_width("ete", 1));
    assert(gfx_text_width("", 2) == 0);

    // Un texte trop long est coupé avec « … » et tient dans l'écran.
    char out[64];
    gfx_fit("Je reflechis tres longtemps a ta question", 128, 1, out, sizeof(out));
    assert(gfx_text_width(out, 1) <= 128);
    assert(strstr(out, "\xE2\x80\xA6") != NULL);
    gfx_fit("court", 128, 1, out, sizeof(out));
    assert(strcmp(out, "court") == 0);
    // UTF-8 abîmé : pas de plantage, un « ? ».
    gfx_clear(&g);
    assert(gfx_text(&g, 0, 0, "\xC3", 1) == 5);

    // Chaque état dessine quelque chose, en 128 x 64 et en 128 x 32, sans sortir de l'écran.
    const led_state_t states[] = {LED_STANDBY, LED_LISTENING, LED_THINKING, LED_SPEAKING, LED_ERROR,
                                  LED_BOOT, LED_SETUP, LED_KEY, LED_IDENTIFY};
    const char *names[] = {"veille", "ecoute", "reflexion", "parle", "erreur", "demarrage", "installation", "cle", "identifier"};
    const uint8_t heights[] = {64, 32};
    for (size_t hi = 0; hi < 2; hi++) {
        for (size_t i = 0; i < sizeof(states) / sizeof(states[0]); i++) {
            display_view_t v = {.state = states[i], .time_ok = true, .hour = 7, .minute = 5, .weekday = 1,
                                .day = 16, .month = 11, .wifi_ok = true, .name = "chambre", .tick = 3};
            gfx_init(&g, 128, heights[hi]);
            display_render(&g, &v);
            assert(lit(&g) > 20);
            char file[48];
            snprintf(file, sizeof(file), "%s-%d", names[i], heights[hi]);
            save(&g, dir, file);
        }
    }
    // Veille sans heure, et erreur sans Wi-Fi.
    display_view_t v = {.state = LED_STANDBY, .time_ok = false, .wifi_ok = false, .name = "chambre"};
    gfx_init(&g, 128, 64);
    display_render(&g, &v);
    assert(lit(&g) > 20);
    save(&g, dir, "veille-sans-heure-64");
    v.state = LED_ERROR;
    display_render(&g, &v);
    save(&g, dir, "erreur-sans-wifi-64");

    // Décalage anti-marquage : l'heure ne reste pas au même endroit d'une minute à l'autre.
    display_view_t a = {.state = LED_STANDBY, .time_ok = true, .hour = 12, .minute = 0, .wifi_ok = true, .tick = 0};
    display_view_t b = a;
    b.tick = 240;
    gfx_t ga, gb;
    gfx_init(&ga, 128, 64);
    gfx_init(&gb, 128, 64);
    display_render(&ga, &a);
    display_render(&gb, &b);
    assert(memcmp(ga.buf, gb.buf, sizeof(ga.buf)) != 0);

    printf("display_test : OK\n");
    return 0;
}
