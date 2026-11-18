// Petit écran OLED I2C de l'enceinte (SSD1306 ou SH1106). Absent ou mal branché : l'enceinte marche comme avant.
#pragma once

#include <stdbool.h>

#include "led.h"

/** Cherche l'écran et démarre sa tâche. Ne bloque pas ; sans écran, ne fait rien. */
void display_init(void);
/** Appelé par led_set : l'écran suit l'état de l'enceinte. */
void display_state(led_state_t state);
bool display_present(void);
// Résultat de la recherche au démarrage : « 0x3C », « aucun », « aucun 0x27 », « 0x3C muet »…
const char *display_report(void);
/**
 * En-tête « X-Jarvis-Ecran » reçu du PC (voir display_info_parse) : une information importante
 * à afficher un moment. Appelé depuis la tâche réseau ; ne bloque pas.
 */
void display_info_header(const char *value);
