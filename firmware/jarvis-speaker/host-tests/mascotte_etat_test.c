// États de la mascotte, sans carte : gcc, voir host-tests/run.sh.
#include <stdio.h>

#include "config.h"
#include "mascotte_etat.h"

static int echecs;

#define CHECK(cond)                                                                 \
    do {                                                                            \
        if (!(cond)) {                                                              \
            echecs++;                                                               \
            fprintf(stderr, "  ÉCHEC %s:%d : %s\n", __FILE__, __LINE__, #cond);     \
        }                                                                           \
    } while (0)

static mascotte_vue_t voir(uint32_t now) {
    mascotte_vue_t vue;
    mascotte_etat_voir(now, &vue);
    return vue;
}

static void broches(void) {
    CHECK(DISPLAY_PIN_SDA != DISPLAY_PIN_SCL);
    CHECK(DISPLAY_PIN_SDA != MIC_PIN_SCK && DISPLAY_PIN_SDA != MIC_PIN_WS && DISPLAY_PIN_SDA != MIC_PIN_SD);
    CHECK(DISPLAY_PIN_SCL != MIC_PIN_SCK && DISPLAY_PIN_SCL != MIC_PIN_WS && DISPLAY_PIN_SCL != MIC_PIN_SD);
    CHECK(DISPLAY_PIN_SDA != AMP_PIN_BCLK && DISPLAY_PIN_SDA != AMP_PIN_LRC && DISPLAY_PIN_SDA != AMP_PIN_DIN);
    CHECK(DISPLAY_PIN_SCL != AMP_PIN_BCLK && DISPLAY_PIN_SCL != AMP_PIN_LRC && DISPLAY_PIN_SCL != AMP_PIN_DIN);
    CHECK(DISPLAY_PIN_SDA != LED_PIN && DISPLAY_PIN_SCL != LED_PIN);
    CHECK(DISPLAY_PIN_SDA != 0 && DISPLAY_PIN_SCL != 0);
    CHECK(DISPLAY_I2C_HZ == 400000);
    CHECK(DISPLAY_CONTRAST_STANDBY < DISPLAY_CONTRAST);
    CHECK(MASCOTTE_REPOS_MS == 10000);
    CHECK(MASCOTTE_IMAGES_PAR_SECONDE == 15);
}

static void decalage(void) {
    int x = 9, y = 9;
    mascotte_decalage_sommeil(0, &x, &y);
    CHECK(x == 0 && y == 0);
    mascotte_decalage_sommeil(59999, &x, &y);
    CHECK(x == 0 && y == 0);
    mascotte_decalage_sommeil(60000, &x, &y);
    CHECK((x == 1 || x == 2 || y == 1 || y == 2) && x >= 0 && x <= 2 && y >= 0 && y <= 2);
    for (uint32_t minute = 1; minute <= 8; minute++) {
        mascotte_decalage_sommeil(minute * 60000u, &x, &y);
        CHECK(x >= 0 && x <= 2 && y >= 0 && y <= 2);
        CHECK(x + y >= 1);
    }
}

static void enchainement(void) {
    mascotte_etat_init(0);
    mascotte_vue_t vue = voir(0);
    CHECK(vue.etat == MASCOTTE_DORT && vue.t_ms == 0 && vue.bouche == -1);

    vue = voir(400);
    CHECK(vue.etat == MASCOTTE_DORT && vue.t_ms == 400);

    mascotte_etat_poser(MASCOTTE_DORT, 500);
    vue = voir(500);
    CHECK(vue.etat == MASCOTTE_DORT && vue.t_ms == 500);

    mascotte_etat_poser(MASCOTTE_ECOUTE, 1000);
    vue = voir(1000);
    CHECK(vue.etat == MASCOTTE_ECOUTE && vue.t_ms == 0);
    vue = voir(1300);
    CHECK(vue.etat == MASCOTTE_ECOUTE && vue.t_ms == 300);

    mascotte_etat_poser(MASCOTTE_ECOUTE, 1400);
    vue = voir(1500);
    CHECK(vue.etat == MASCOTTE_ECOUTE && vue.t_ms == 500);

    mascotte_etat_poser(MASCOTTE_REFLECHIT, 2000);
    vue = voir(2250);
    CHECK(vue.etat == MASCOTTE_REFLECHIT && vue.t_ms == 250 && vue.bouche == -1);

    mascotte_etat_poser(MASCOTTE_PARLE, 3000);
    mascotte_bouche_poser(4);
    vue = voir(3100);
    CHECK(vue.etat == MASCOTTE_PARLE && vue.t_ms == 100 && vue.bouche == 4);
    mascotte_etat_poser(MASCOTTE_PARLE, 3200);
    mascotte_bouche_poser(1);
    vue = voir(3400);
    CHECK(vue.etat == MASCOTTE_PARLE && vue.t_ms == 400 && vue.bouche == 1);

    mascotte_etat_poser(MASCOTTE_DORT, 4000);
    vue = voir(4000);
    CHECK(vue.etat == MASCOTTE_ECOUTE && vue.t_ms == 0 && vue.bouche == -1);
    vue = voir(4000 + MASCOTTE_REPOS_MS - 1);
    CHECK(vue.etat == MASCOTTE_ECOUTE);
    vue = voir(4000 + MASCOTTE_REPOS_MS);
    CHECK(vue.etat == MASCOTTE_DORT && vue.t_ms == 0);
    vue = voir(4000 + MASCOTTE_REPOS_MS + 250);
    CHECK(vue.etat == MASCOTTE_DORT && vue.t_ms == 250);
}

static void suite_puis_sommeil(void) {
    mascotte_etat_init(0);
    mascotte_etat_poser(MASCOTTE_PARLE, 0);
    mascotte_etat_poser(MASCOTTE_ECOUTE, 100);
    mascotte_vue_t vue = voir(100);
    CHECK(vue.etat == MASCOTTE_ECOUTE && vue.t_ms == 0);
    vue = voir(100 + MASCOTTE_REPOS_MS);
    CHECK(vue.etat == MASCOTTE_ECOUTE);
    mascotte_etat_poser(MASCOTTE_DORT, 8100);
    vue = voir(8100);
    CHECK(vue.etat == MASCOTTE_ECOUTE);
    vue = voir(100 + MASCOTTE_REPOS_MS);
    CHECK(vue.etat == MASCOTTE_DORT && vue.t_ms == 0);
}

static void reveil_pendant_la_pause(void) {
    mascotte_etat_init(0);
    mascotte_etat_poser(MASCOTTE_PARLE, 0);
    mascotte_etat_poser(MASCOTTE_DORT, 0);
    mascotte_etat_poser(MASCOTTE_ECOUTE, 2000);
    mascotte_vue_t vue = voir(2300);
    CHECK(vue.etat == MASCOTTE_ECOUTE && vue.t_ms == 300);
    mascotte_etat_poser(MASCOTTE_REFLECHIT, 3000);
    vue = voir(3000);
    CHECK(vue.etat == MASCOTTE_REFLECHIT && vue.t_ms == 0);
    mascotte_etat_poser(MASCOTTE_DORT, 3000);
    vue = voir(3000);
    CHECK(vue.etat == MASCOTTE_DORT && vue.t_ms == 0);
}

static void bouche_ignoree_hors_parole(void) {
    mascotte_etat_init(0);
    mascotte_etat_poser(MASCOTTE_ECOUTE, 0);
    mascotte_bouche_poser(5);
    mascotte_vue_t vue = voir(10);
    CHECK(vue.bouche == -1);
}

int main(void) {
    broches();
    decalage();
    enchainement();
    suite_puis_sommeil();
    reveil_pendant_la_pause();
    bouche_ignoree_hors_parole();
    if (echecs) {
        fprintf(stderr, "%d échec(s)\n", echecs);
        return 1;
    }
    printf("mascotte_etat : ok\n");
    return 0;
}
