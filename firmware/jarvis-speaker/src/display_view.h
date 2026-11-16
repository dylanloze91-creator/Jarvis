// Ce que l'écran de l'enceinte montre pour chaque état. Sans matériel : testé sur le PC (host-tests).
#pragma once

#include <stdbool.h>
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
