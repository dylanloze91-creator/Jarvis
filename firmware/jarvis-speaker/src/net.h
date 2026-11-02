// Wi-Fi de la maison (se reconnecte seul) et appels au pont de Jarvis sur le PC.
#pragma once

#include <stdbool.h>
#include <stddef.h>
#include <stdint.h>

/** Démarre le Wi-Fi et attend la première connexion (au plus `timeout_ms` ; 0 = sans limite). */
bool net_start(uint32_t timeout_ms);
bool net_connected(void);

/** Réponse du PC à `GET /api/speaker/hello`. */
typedef struct {
    bool ok;
    int status;           // 200 = jeton accepté ; 401 = jeton refusé ; 0 = PC injoignable
    uint32_t follow_up_ms; // fenêtre de suivi réglée sur le PC (0 = « Jarvis » à chaque fois)
    char version[24];
} hello_result_t;

hello_result_t net_hello(void);

/** Ce que le PC a répondu à une phrase. */
typedef enum {
    TURN_SPOKEN,       // 200 : une réponse a été jouée
    TURN_SILENT,       // 204 : rien à dire (phrase vide, pas pour Jarvis, « stop »)
    TURN_ERROR_SPOKEN, // 503 : le PC a envoyé un court message d'erreur, joué
    TURN_UNREACHABLE,  // pas de réponse du PC
    TURN_REFUSED,      // 401/403 : jeton refusé ou réseau non local
    TURN_FAILED,       // autre erreur (400, 413, 429, 5xx sans voix)
} turn_outcome_t;

typedef struct {
    turn_outcome_t outcome;
    int status;
    bool continue_listening; // en-tête X-Jarvis-Continue: 1
} turn_result_t;

/**
 * Envoie `samples` échantillons PCM 16 kHz au PC (`POST /api/speaker/turn`) et joue la réponse
 * au fil de l'eau sur le haut-parleur. `follow_up` = phrase dite dans la fenêtre de suivi.
 */
turn_result_t net_turn(const int16_t *pcm, size_t samples, bool follow_up);
