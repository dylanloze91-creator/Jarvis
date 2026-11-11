// LED de la carte : un état = une couleur. « Réflexion » clignote toute seule.
#pragma once

typedef enum {
    LED_STANDBY,    // éteinte : Jarvis attend son nom
    LED_LISTENING,  // vert : il écoute ta phrase
    LED_THINKING,   // bleu qui clignote : la phrase est partie au PC
    LED_SPEAKING,   // bleu fixe : il répond
    LED_ERROR,      // rouge : quelque chose ne va pas (Wi-Fi, PC, jeton)
    LED_BOOT,       // orange : démarrage, pas encore prêt
    LED_SETUP,      // violet qui respire : en attente d'installation
    LED_KEY,        // violet fixe : la clé a été refusée trois fois
    LED_IDENTIFY,   // blanc : l'enceinte se fait reconnaître
} led_state_t;

void led_init(void);
void led_set(led_state_t state);
