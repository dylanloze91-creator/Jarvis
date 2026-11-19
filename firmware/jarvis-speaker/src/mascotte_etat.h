// Un seul endroit pour « que fait l'enceinte » vu par la mascotte.
// Les valeurs sont les mêmes que JarvisEtat dans jarvis_mascotte.h.
#pragma once

#include <stdint.h>

#include "config.h"

typedef enum {
    MASCOTTE_DORT = 0,
    MASCOTTE_ECOUTE = 1,
    MASCOTTE_REFLECHIT = 2,
    MASCOTTE_PARLE = 3,
} mascotte_etat_id_t;

typedef struct {
    mascotte_etat_id_t etat;
    uint32_t t_ms; // temps depuis l'entrée dans cet état
    int bouche;    // -1 = animation automatique, 0 à 5 = ouverture imposée
} mascotte_vue_t;

/** Horloge de la carte, en millisecondes. Sur PC (tests), vaut 0. */
uint32_t mascotte_horloge_ms(void);

/** Remet l'état à « il dort », compteur à zéro. */
void mascotte_etat_init(uint32_t now_ms);

/**
 * Change l'état. `t_ms` repart de 0 seulement quand l'état affiché change.
 * Demander DORT juste après PARLE laisse ECOUTE pendant MASCOTTE_REPOS_MS.
 */
void mascotte_etat_poser(mascotte_etat_id_t etat, uint32_t now_ms);

/** 0 à 5 pendant PARLE. Ignoré le reste du temps. -1 revient à l'animation automatique. */
void mascotte_bouche_poser(int ouverture);

/** État à dessiner maintenant, en appliquant la pause avant le sommeil. */
void mascotte_etat_voir(uint32_t now_ms, mascotte_vue_t *vue);

/**
 * Décalage anti-marquage pendant DORT : 0 avant une minute, puis 1 ou 2 pixels.
 * `t_ms` est le temps déjà passé dans DORT.
 */
void mascotte_decalage_sommeil(uint32_t t_ms, int *x, int *y);
