// Ce que l'écran de l'enceinte montre pour chaque état. Sans matériel : testé sur le PC (host-tests).
#pragma once

#include <stdbool.h>
#include <stddef.h>
#include <stdint.h>

#include "display_gfx.h"
#include "led.h"

typedef struct {
    led_state_t state;
    bool time_ok;      // l'heure a été reçue d'Internet
    int hour, minute;  // heure locale
    int weekday;       // 0 = dimanche
    int day, month;    // 1-31, 1-12
    bool wifi_ok;
    const char *name;  // nom de l'enceinte (« chambre »)
    uint32_t tick;     // compte des rafraîchissements (4 par seconde) : animations, décalage anti-marquage
} display_view_t;

void display_render(gfx_t *g, const display_view_t *v);

/** Écran d'information envoyé par le PC (titre en grand, une ligne en dessous). */
void display_render_info(gfx_t *g, const char *title, const char *line);

/** Ce que l'écran montre à un instant donné. */
typedef enum {
    DISPLAY_SHOW_MASCOT = 0,   // la vie normale : la mascotte
    DISPLAY_SHOW_MESSAGE,      // un souci ou une étape à comprendre (erreur, clé, installation, signe)
    DISPLAY_SHOW_INFO,         // une information importante envoyée par le PC
    DISPLAY_SHOW_CLOCK,        // la mascotte dort depuis longtemps : l'heure et la date
} display_show_t;

/**
 * Choisit l'écran. Ordre : un souci d'abord, puis l'activité (écoute, réflexion, parole : la mascotte),
 * puis une information du PC encore valable, puis l'heure si la mascotte dort depuis `clock_after_ms`.
 * `mascot_sleeping` et `mascot_sleep_ms` viennent de mascotte_etat ; `speaking` = elle parle.
 */
display_show_t display_choose(led_state_t state, bool mascot_sleeping, uint32_t mascot_sleep_ms, bool speaking,
                              bool info_active, bool time_ok, uint32_t clock_after_ms);

/**
 * Lit l'en-tête « X-Jarvis-Ecran » envoyé par le PC : « titre|ligne|secondes », en UTF-8 encodé
 * pour une URL (%C3%A9 pour « é »). Les secondes sont facultatives (20 par défaut, 300 au plus).
 * Un en-tête vide, ou « - », efface l'information affichée (renvoie vrai avec `seconds` = 0).
 * Renvoie faux si l'en-tête est illisible : rien ne change alors.
 */
bool display_info_parse(const char *header, char *title, size_t title_size, char *line, size_t line_size,
                        uint32_t *seconds);
