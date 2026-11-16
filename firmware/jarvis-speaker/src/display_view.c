#include "display_view.h"

#include <stdio.h>

static const char *const DAYS[7] = {"dim.", "lun.", "mar.", "mer.", "jeu.", "ven.", "sam."};
static const char *const MONTHS[12] = {"janv.", "févr.", "mars", "avril", "mai", "juin",
                                       "juil.", "août", "sept.", "oct.", "nov.", "déc."};

/** Petit indicateur Wi-Fi en haut à gauche : trois barres, ou une croix. */
static void wifi_icon(gfx_t *g, int x, int y, bool ok) {
    if (ok) {
        gfx_fill(g, x, y + 4, 2, 2, true);
        gfx_fill(g, x + 3, y + 2, 2, 4, true);
        gfx_fill(g, x + 6, y, 2, 6, true);
    } else {
        for (int i = 0; i < 5; i++) {
            gfx_pixel(g, x + i, y + i, true);
            gfx_pixel(g, x + 4 - i, y + i, true);
        }
    }
}

/** Barres qui bougent pendant l'écoute (ce n'est pas le vrai niveau du micro, juste un signe de vie). */
static void listen_bars(gfx_t *g, int y, int h, uint32_t tick) {
    static const uint8_t pattern[] = {2, 5, 8, 6, 3, 7, 9, 4, 6, 2, 5, 8};
    int count = 11, bar = 4, gap = 3;
    int x = (g->w - (count * bar + (count - 1) * gap)) / 2;
    for (int i = 0; i < count; i++) {
        int level = pattern[(i + (int)tick) % (int)sizeof(pattern)];
        int bh = level * h / 9;
        if (bh < 1) bh = 1;
        gfx_fill(g, x + i * (bar + gap), y + (h - bh) / 2, bar, bh, true);
    }
}

/** Trois points dont un grossit à tour de rôle (réflexion). */
static void thinking_dots(gfx_t *g, int cy, uint32_t tick) {
    int active = (int)(tick % 3);
    for (int i = 0; i < 3; i++) {
        int size = i == active ? 8 : 4;
        int cx = g->w / 2 + (i - 1) * 16;
        gfx_fill(g, cx - size / 2, cy - size / 2, size, size, true);
    }
}

static void title_and_line(gfx_t *g, const char *title, const char *line, bool tall) {
    if (tall) {
        gfx_text_center(g, 16, title, 2);
        gfx_text_center(g, 40, line, 1);
    } else {
        gfx_text_center(g, 2, title, 2);
        gfx_text_center(g, 22, line, 1);
    }
}

void display_render(gfx_t *g, const display_view_t *v) {
    bool tall = g->h >= 64;
    gfx_clear(g);
    const char *name = (v->name && v->name[0]) ? v->name : "Jarvis";

    switch (v->state) {
    case LED_STANDBY: {
        // Décalage d'un ou deux points chaque minute : l'écran OLED ne marque pas.
        int shift = (int)((v->tick / 240) % 5) - 2;
        if (v->time_ok) {
            char clock[8];
            snprintf(clock, sizeof(clock), "%02d:%02d", v->hour % 24, v->minute % 60);
            if (tall) {
                int x = (g->w - gfx_text_width(clock, 3)) / 2 + shift;
                gfx_text(g, x, 12 + (shift & 1), clock, 3);
                char date[24];
                snprintf(date, sizeof(date), "%s %d %s", DAYS[v->weekday % 7], v->day, MONTHS[(v->month + 11) % 12]);
                gfx_text_center(g, 44, date, 1);
            } else {
                int x = (g->w - gfx_text_width(clock, 3)) / 2 + shift;
                gfx_text(g, x, 6 + (shift & 1), clock, 3);
            }
        } else {
            title_and_line(g, "Jarvis", "Dis : Jarvis", tall);
        }
        if (tall) {
            wifi_icon(g, 0, 0, v->wifi_ok);
            char small[24];
            gfx_fit(name, g->w - 16, 1, small, sizeof(small));
            gfx_text(g, g->w - gfx_text_width(small, 1), 0, small, 1);
        } else if (!v->wifi_ok) {
            wifi_icon(g, 0, 0, false);
        }
        break;
    }
    case LED_LISTENING:
        if (tall) {
            gfx_text_center(g, 6, "J'\xC3\xA9" "coute\xE2\x80\xA6", 2);
            listen_bars(g, 30, 26, v->tick);
        } else {
            gfx_text_center(g, 0, "J'\xC3\xA9" "coute\xE2\x80\xA6", 2);
            listen_bars(g, 18, 13, v->tick);
        }
        break;
    case LED_THINKING:
        if (tall) {
            thinking_dots(g, 22, v->tick);
            gfx_text_center(g, 42, "Je r\xC3\xA9" "fl\xC3\xA9" "chis\xE2\x80\xA6", 1);
        } else {
            thinking_dots(g, 9, v->tick);
            gfx_text_center(g, 22, "Je r\xC3\xA9" "fl\xC3\xA9" "chis\xE2\x80\xA6", 1);
        }
        break;
    case LED_SPEAKING:
        title_and_line(g, "Jarvis", "parle\xE2\x80\xA6", tall);
        break;
    case LED_ERROR:
        if (v->wifi_ok) title_and_line(g, "Oups", "PC injoignable", tall);
        else title_and_line(g, "Oups", "Pas de Wi-Fi", tall);
        if (tall && v->wifi_ok) gfx_text_center(g, 52, "Jarvis est lanc\xC3\xA9 ?", 1);
        break;
    case LED_BOOT:
        title_and_line(g, "Jarvis", "D\xC3\xA9" "marrage\xE2\x80\xA6", tall);
        break;
    case LED_SETUP:
        title_and_line(g, "Bonjour", "Branche-moi au PC", tall);
        break;
    case LED_KEY:
        title_and_line(g, "Refus\xC3\xA9" "e", "Cl\xC3\xA9 : r\xC3\xA9installe", tall);
        break;
    case LED_IDENTIFY:
        title_and_line(g, name, "C'est moi !", tall);
        break;
    }
}
