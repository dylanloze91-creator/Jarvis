#include "display_view.h"

#include <stdio.h>
#include <string.h>

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

void display_render_info(gfx_t *g, const char *title, const char *line) {
    gfx_clear(g);
    bool tall = g->h >= 64;
    // Petit cadre en haut : c'est une information, pas un message de l'enceinte.
    if (tall) {
        gfx_fill(g, 0, 0, g->w, 1, true);
        gfx_fill(g, 0, g->h - 1, g->w, 1, true);
    }
    char title_fit[64];
    gfx_fit(title, g->w, 2, title_fit, sizeof(title_fit));
    if (gfx_text_width(title, 2) > g->w) {
        // Titre trop long pour l'échelle 2 : en petit, sur la première ligne.
        gfx_text_center(g, tall ? 12 : 2, title, 1);
    } else {
        gfx_text_center(g, tall ? 10 : 0, title_fit, 2);
    }
    if (line && line[0]) gfx_text_center(g, tall ? 38 : 22, line, 1);
}

display_show_t display_choose(led_state_t state, bool mascot_sleeping, uint32_t mascot_sleep_ms, bool speaking,
                              bool info_active, bool time_ok, uint32_t clock_after_ms) {
    if (state == LED_ERROR || state == LED_SETUP || state == LED_KEY || state == LED_IDENTIFY)
        return DISPLAY_SHOW_MESSAGE;
    if (state == LED_LISTENING || state == LED_THINKING || speaking) return DISPLAY_SHOW_MASCOT;
    if (info_active) return DISPLAY_SHOW_INFO;
    if (mascot_sleeping && time_ok && mascot_sleep_ms >= clock_after_ms) return DISPLAY_SHOW_CLOCK;
    return DISPLAY_SHOW_MASCOT;
}

static int hex_value(char c) {
    if (c >= '0' && c <= '9') return c - '0';
    if (c >= 'a' && c <= 'f') return c - 'a' + 10;
    if (c >= 'A' && c <= 'F') return c - 'A' + 10;
    return -1;
}

/** Copie un morceau [from, to) en décodant %XX et '+' ; refuse les caractères de contrôle. */
static bool decode_part(const char *from, const char *to, char *out, size_t size) {
    size_t n = 0;
    for (const char *p = from; p < to; p++) {
        int c = (unsigned char)*p;
        if (c == '%') {
            if (to - p < 3) return false;
            int hi = hex_value(p[1]), lo = hex_value(p[2]);
            if (hi < 0 || lo < 0) return false;
            c = hi * 16 + lo;
            p += 2;
        } else if (c == '+') {
            c = ' ';
        }
        if (c < 0x20 || c == 0x7F) return false;
        if (n + 1 >= size) break; // trop long : coupé, l'écran ajoutera « … »
        out[n++] = (char)c;
    }
    // Ne pas couper une lettre accentuée en deux.
    while (n > 0 && ((unsigned char)out[n - 1] & 0xC0) == 0x80) n--;
    if (n > 0 && ((unsigned char)out[n - 1] & 0xC0) == 0xC0) n--;
    out[n] = '\0';
    return true;
}

bool display_info_parse(const char *header, char *title, size_t title_size, char *line, size_t line_size,
                        uint32_t *seconds) {
    if (!header || !title || !line || !seconds || title_size == 0 || line_size == 0) return false;
    title[0] = '\0';
    line[0] = '\0';
    *seconds = 0;
    while (*header == ' ') header++;
    if (header[0] == '\0' || strcmp(header, "-") == 0) return true; // effacer
    const char *end = header + strlen(header);
    const char *bar1 = memchr(header, '|', (size_t)(end - header));
    const char *title_end = bar1 ? bar1 : end;
    if (!decode_part(header, title_end, title, title_size) || title[0] == '\0') return false;
    uint32_t secs = 20;
    if (bar1) {
        const char *bar2 = memchr(bar1 + 1, '|', (size_t)(end - bar1 - 1));
        const char *line_end = bar2 ? bar2 : end;
        if (!decode_part(bar1 + 1, line_end, line, line_size)) return false;
        if (bar2) {
            uint32_t v = 0;
            const char *p = bar2 + 1;
            if (*p == '\0') return false;
            for (; *p; p++) {
                if (*p < '0' || *p > '9') return false;
                v = v * 10u + (uint32_t)(*p - '0');
                if (v > 100000u) break;
            }
            secs = v;
        }
    }
    if (secs == 0) secs = 20;
    if (secs > 300) secs = 300;
    *seconds = secs;
    return true;
}
