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

    // Choix de l'écran : souci d'abord, puis activité, puis information, puis l'heure.
    assert(display_choose(LED_ERROR, true, 999999, false, true, true, 120000) == DISPLAY_SHOW_MESSAGE);
    assert(display_choose(LED_KEY, false, 0, false, false, false, 120000) == DISPLAY_SHOW_MESSAGE);
    assert(display_choose(LED_LISTENING, false, 0, false, true, true, 120000) == DISPLAY_SHOW_MASCOT);
    assert(display_choose(LED_THINKING, false, 0, false, true, true, 120000) == DISPLAY_SHOW_MASCOT);
    assert(display_choose(LED_STANDBY, false, 0, true, true, true, 120000) == DISPLAY_SHOW_MASCOT); // il parle
    assert(display_choose(LED_STANDBY, true, 5000, false, true, true, 120000) == DISPLAY_SHOW_INFO);
    assert(display_choose(LED_STANDBY, true, 5000, false, false, true, 120000) == DISPLAY_SHOW_MASCOT);
    assert(display_choose(LED_STANDBY, true, 120000, false, false, true, 120000) == DISPLAY_SHOW_CLOCK);
    assert(display_choose(LED_STANDBY, true, 999999, false, false, false, 120000) == DISPLAY_SHOW_MASCOT); // pas d'heure
    assert(display_choose(LED_STANDBY, false, 999999, false, false, true, 120000) == DISPLAY_SHOW_MASCOT); // écoute encore

    // En-tête d'information du PC.
    char t[48], l[96];
    uint32_t secs = 99;
    assert(display_info_parse("Imprimante|Impression%20termin%C3%A9e|30", t, sizeof(t), l, sizeof(l), &secs));
    assert(strcmp(t, "Imprimante") == 0 && strcmp(l, "Impression termin\xC3\xA9" "e") == 0 && secs == 30);
    assert(display_info_parse("Minuteur", t, sizeof(t), l, sizeof(l), &secs) && secs == 20 && l[0] == '\0');
    assert(display_info_parse("A|b|9999", t, sizeof(t), l, sizeof(l), &secs) && secs == 300);
    assert(display_info_parse("-", t, sizeof(t), l, sizeof(l), &secs) && secs == 0);
    assert(display_info_parse("", t, sizeof(t), l, sizeof(l), &secs) && secs == 0);
    assert(!display_info_parse("%ZZ|x", t, sizeof(t), l, sizeof(l), &secs));     // illisible
    assert(!display_info_parse("a%0Ab|x", t, sizeof(t), l, sizeof(l), &secs));   // retour à la ligne refusé
    assert(!display_info_parse("|ligne", t, sizeof(t), l, sizeof(l), &secs));    // pas de titre
    assert(!display_info_parse("A|b|12x", t, sizeof(t), l, sizeof(l), &secs));   // secondes illisibles
    char small[6];
    assert(display_info_parse("%C3%A9%C3%A9%C3%A9", small, sizeof(small), l, sizeof(l), &secs));
    assert(strcmp(small, "\xC3\xA9\xC3\xA9") == 0); // coupé sans casser une lettre
    // Une lettre accentuée entière en fin de texte est gardée (elle disparaissait : « Terminé » → « Termin »).
    assert(display_info_parse("Termin%C3%A9|pr%C3%AAt%20%E2%82%AC", t, sizeof(t), l, sizeof(l), &secs));
    assert(strcmp(t, "Termin\xC3\xA9") == 0 && strcmp(l, "pr\xC3\xAAt \xE2\x82\xAC") == 0);
    char five[5]; // 4 octets utiles : « éé » tient en entier
    assert(display_info_parse("%C3%A9%C3%A9", five, sizeof(five), l, sizeof(l), &secs));
    assert(strcmp(five, "\xC3\xA9\xC3\xA9") == 0);
    char four[4]; // 3 octets utiles : « € » tient en entier, « é€ » est coupé après « é »
    assert(display_info_parse("%E2%82%AC", four, sizeof(four), l, sizeof(l), &secs) && strcmp(four, "\xE2\x82\xAC") == 0);
    assert(display_info_parse("%C3%A9%E2%82%AC", four, sizeof(four), l, sizeof(l), &secs) && strcmp(four, "\xC3\xA9") == 0);

    // Écran d'information : tient dans l'écran, même avec un titre long.
    gfx_init(&g, 128, 64);
    display_render_info(&g, "Imprimante", "Impression termin\xC3\xA9" "e");
    assert(lit(&g) > 20);
    save(&g, dir, "info-64");
    display_render_info(&g, "Un titre beaucoup trop long pour tenir en grand", "et une ligne qui d\xC3\xA9" "passe largement la largeur");
    assert(lit(&g) > 20);
    save(&g, dir, "info-long-64");

    printf("display_test : OK\n");
    return 0;
}
