#include "mascotte_etat.h"

#ifdef ESP_PLATFORM
#include "esp_timer.h"
#include "freertos/FreeRTOS.h"
#include "freertos/portmacro.h"
static portMUX_TYPE verrou = portMUX_INITIALIZER_UNLOCKED;
static void prendre(void) { portENTER_CRITICAL(&verrou); }
static void rendre(void) { portEXIT_CRITICAL(&verrou); }
#else
static void prendre(void) {}
static void rendre(void) {}
#endif

static int pret;
static mascotte_etat_id_t demande;
static mascotte_etat_id_t affiche;
static uint32_t depuis_ms;
static int repos;
static uint32_t parle_fini_ms;
static int bouche;

uint32_t mascotte_horloge_ms(void) {
#ifdef ESP_PLATFORM
    return (uint32_t)(esp_timer_get_time() / 1000);
#else
    return 0;
#endif
}

static void assurer(uint32_t now_ms) {
    if (pret) return;
    demande = MASCOTTE_DORT;
    affiche = MASCOTTE_DORT;
    depuis_ms = now_ms;
    repos = 0;
    parle_fini_ms = now_ms;
    bouche = -1;
    pret = 1;
}

static void passer(mascotte_etat_id_t etat, uint32_t now_ms) {
    if (affiche == etat) return;
    affiche = etat;
    depuis_ms = now_ms;
}

void mascotte_etat_init(uint32_t now_ms) {
    prendre();
    demande = MASCOTTE_DORT;
    affiche = MASCOTTE_DORT;
    depuis_ms = now_ms;
    repos = 0;
    parle_fini_ms = now_ms;
    bouche = -1;
    pret = 1;
    rendre();
}

void mascotte_etat_poser(mascotte_etat_id_t etat, uint32_t now_ms) {
    prendre();
    assurer(now_ms);

    if (etat == MASCOTTE_PARLE) {
        repos = 0;
        demande = MASCOTTE_PARLE;
        passer(MASCOTTE_PARLE, now_ms);
        rendre();
        return;
    }

    if (etat == MASCOTTE_REFLECHIT) {
        repos = 0;
        bouche = -1;
        demande = MASCOTTE_REFLECHIT;
        passer(MASCOTTE_REFLECHIT, now_ms);
        rendre();
        return;
    }

    if (etat == MASCOTTE_ECOUTE) {
        int nouveau = demande != MASCOTTE_ECOUTE || affiche != MASCOTTE_ECOUTE;
        if (affiche == MASCOTTE_PARLE || demande == MASCOTTE_PARLE) {
            repos = 1;
            parle_fini_ms = now_ms;
            nouveau = 1;
        }
        bouche = -1;
        demande = MASCOTTE_ECOUTE;
        if (nouveau) {
            affiche = MASCOTTE_ECOUTE;
            depuis_ms = now_ms;
        }
        rendre();
        return;
    }

    bouche = -1;
    demande = MASCOTTE_DORT;
    if (affiche == MASCOTTE_PARLE) {
        repos = 1;
        parle_fini_ms = now_ms;
        passer(MASCOTTE_ECOUTE, now_ms);
        rendre();
        return;
    }
    if (repos) {
        if (now_ms - parle_fini_ms >= MASCOTTE_REPOS_MS) {
            repos = 0;
            passer(MASCOTTE_DORT, now_ms);
        } else {
            passer(MASCOTTE_ECOUTE, now_ms);
        }
        rendre();
        return;
    }
    passer(MASCOTTE_DORT, now_ms);
    rendre();
}

void mascotte_bouche_poser(int ouverture) {
    if (ouverture < -1) ouverture = -1;
    if (ouverture > 5) ouverture = 5;
    prendre();
    if (affiche == MASCOTTE_PARLE || demande == MASCOTTE_PARLE) bouche = ouverture;
    rendre();
}

void mascotte_etat_voir(uint32_t now_ms, mascotte_vue_t *vue) {
    prendre();
    assurer(now_ms);
    if (repos && demande == MASCOTTE_DORT) {
        if (now_ms - parle_fini_ms >= MASCOTTE_REPOS_MS) {
            repos = 0;
            if (affiche != MASCOTTE_DORT) {
                affiche = MASCOTTE_DORT;
                depuis_ms = now_ms;
            }
        } else if (affiche != MASCOTTE_ECOUTE) {
            affiche = MASCOTTE_ECOUTE;
            depuis_ms = now_ms;
        }
    }
    vue->etat = affiche;
    vue->t_ms = now_ms - depuis_ms;
    vue->bouche = affiche == MASCOTTE_PARLE ? bouche : -1;
    rendre();
}

void mascotte_decalage_sommeil(uint32_t t_ms, int *x, int *y) {
    static const int ox[8] = {1, 2, 1, 2, 0, 1, 2, 1};
    static const int oy[8] = {0, 0, 1, 1, 2, 2, 2, 1};
    uint32_t minute = t_ms / 60000u;
    if (minute == 0) {
        *x = 0;
        *y = 0;
        return;
    }
    *x = ox[(minute - 1u) % 8u];
    *y = oy[(minute - 1u) % 8u];
}
