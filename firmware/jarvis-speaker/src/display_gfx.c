#include "display_gfx.h"

#include <string.h>

#include "font5x7.h"

void gfx_init(gfx_t *g, uint8_t w, uint8_t h) {
    g->w = w > GFX_MAX_W ? GFX_MAX_W : w;
    g->h = h > GFX_MAX_H ? GFX_MAX_H : h;
    gfx_clear(g);
}

void gfx_clear(gfx_t *g) { memset(g->buf, 0, sizeof(g->buf)); }

void gfx_pixel(gfx_t *g, int x, int y, bool on) {
    if (x < 0 || y < 0 || x >= g->w || y >= g->h) return;
    size_t index = (size_t)(y / 8) * g->w + (size_t)x;
    uint8_t bit = (uint8_t)(1u << (y % 8));
    if (on) g->buf[index] = (uint8_t)(g->buf[index] | bit);
    else g->buf[index] = (uint8_t)(g->buf[index] & (uint8_t)~bit);
}

bool gfx_get(const gfx_t *g, int x, int y) {
    if (x < 0 || y < 0 || x >= g->w || y >= g->h) return false;
    return ((unsigned)g->buf[(size_t)(y / 8) * g->w + (size_t)x] >> (unsigned)(y % 8)) & 1u;
}

void gfx_fill(gfx_t *g, int x, int y, int w, int h, bool on) {
    for (int j = y; j < y + h; j++)
        for (int i = x; i < x + w; i++) gfx_pixel(g, i, j, on);
}

/** Lit un point de code UTF-8 et avance `*s`. Une suite invalide donne '?'. */
static uint32_t next_code(const char **s) {
    const unsigned char *p = (const unsigned char *)*s;
    uint32_t c = p[0];
    int extra = 0;
    if (c < 0x80) extra = 0;
    else if ((c & 0xE0) == 0xC0) { c &= 0x1F; extra = 1; }
    else if ((c & 0xF0) == 0xE0) { c &= 0x0F; extra = 2; }
    else if ((c & 0xF8) == 0xF0) { c &= 0x07; extra = 3; }
    else { *s += 1; return '?'; }
    for (int i = 1; i <= extra; i++) {
        if ((p[i] & 0xC0) != 0x80) { *s += i; return '?'; }
        c = (c << 6) | (p[i] & 0x3F);
    }
    *s += 1 + extra;
    return c;
}

/** Index dans la table de la police. Accents absents : la lettre sans accent. */
static int glyph_index(uint32_t c) {
    if (c >= FONT_FIRST && c <= FONT_LAST) return (int)(c - FONT_FIRST);
    for (int i = 0; i < FONT_ACCENT_COUNT; i++)
        if (font_accents[i] == c) return (FONT_LAST - FONT_FIRST + 1) + i;
    switch (c) {
    case 0x00E4: return 'a' - FONT_FIRST; // ä
    case 0x00EB: return 'e' - FONT_FIRST; // ë
    case 0x00EF: return 'i' - FONT_FIRST; // ï
    case 0x00F6: return 'o' - FONT_FIRST; // ö
    case 0x00FC: return 'u' - FONT_FIRST; // ü
    case 0x00C0: case 0x00C2: return 'A' - FONT_FIRST;
    case 0x00C8: case 0x00CA: return 'E' - FONT_FIRST;
    case 0x00C7: return 'C' - FONT_FIRST;
    case 0x00A0: return ' ' - FONT_FIRST;      // espace insécable
    case 0x2019: return '\'' - FONT_FIRST;     // apostrophe typographique
    case 0x00AB: case 0x00BB: return '"' - FONT_FIRST;
    default: return '?' - FONT_FIRST;
    }
}

int gfx_text_width(const char *utf8, int scale) {
    int n = 0;
    const char *s = utf8;
    while (*s) { (void)next_code(&s); n++; }
    return n == 0 ? 0 : (n * 6 - 1) * scale;
}

static void draw_glyph(gfx_t *g, int x, int y, int index, int scale) {
    for (int col = 0; col < 5; col++) {
        uint8_t bits = font5x7[index][col];
        for (int row = 0; row < 7; row++)
            if (((unsigned)bits >> (unsigned)row) & 1u) gfx_fill(g, x + col * scale, y + row * scale, scale, scale, true);
    }
}

int gfx_text(gfx_t *g, int x, int y, const char *utf8, int scale) {
    int start = x;
    const char *s = utf8;
    while (*s) {
        draw_glyph(g, x, y, glyph_index(next_code(&s)), scale);
        x += 6 * scale;
    }
    return x > start ? x - start - scale : 0;
}

void gfx_fit(const char *in, int max_w, int scale, char *out, size_t size) {
    if (size == 0) return;
    if (gfx_text_width(in, scale) <= max_w) {
        strncpy(out, in, size - 1);
        out[size - 1] = '\0';
        return;
    }
    static const char ellipsis[] = "\xE2\x80\xA6"; // …
    int room = max_w / (6 * scale) - 1;             // une place pour « … »
    size_t used = 0;
    const char *s = in;
    for (int n = 0; n < room && *s; n++) {
        const char *before = s;
        (void)next_code(&s);
        size_t len = (size_t)(s - before);
        if (used + len + sizeof(ellipsis) > size) break;
        memcpy(out + used, before, len);
        used += len;
    }
    while (used > 0 && out[used - 1] == ' ') used--;
    memcpy(out + used, ellipsis, sizeof(ellipsis)); // zéro final compris
}

void gfx_text_center(gfx_t *g, int y, const char *utf8, int scale) {
    char line[96];
    gfx_fit(utf8, g->w, scale, line, sizeof(line));
    int x = (g->w - gfx_text_width(line, scale)) / 2;
    gfx_text(g, x < 0 ? 0 : x, y, line, scale);
}
