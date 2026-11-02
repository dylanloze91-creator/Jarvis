// Lecteur WAV au fil de l'eau, sans dépendance ESP-IDF (testable sur le PC, voir host-tests/).
//
// La réponse du PC est un WAV PCM 16 bits mono (16 kHz en général, 24 kHz possible avec OpenAI),
// parfois « en flux » : taille du bloc `data` à 0 ou 0xFFFFFFFF. Tout le reste est refusé net :
// stéréo, 8 ou 24 bits, cadence farfelue, entête de plus de 256 octets, tailles de blocs qui
// débordent. Rien ne boucle sans fin, rien n'écrit hors d'un tampon.
#pragma once

#include <stdbool.h>
#include <stddef.h>
#include <stdint.h>

#define WAV_STREAM_HEAD_MAX 256
#define WAV_STREAM_RATE_MIN 8000
#define WAV_STREAM_RATE_MAX 48000

typedef struct {
    /** Appelé une fois, quand l'entête est lu, avant le premier `play`. */
    void (*set_rate)(uint32_t sample_rate, void *user);
    /** Échantillons PCM 16 bits mono, prêts à jouer. */
    void (*play)(const int16_t *pcm, size_t samples, void *user);
    void *user;
} wav_sink_t;

typedef enum {
    WAV_STREAM_HEAD, // on accumule l'entête
    WAV_STREAM_DATA, // on joue
    WAV_STREAM_DONE, // bloc `data` fini : le reste est ignoré
    WAV_STREAM_BAD,  // refusé : `error` dit pourquoi, plus rien n'est joué
} wav_stream_state_t;

typedef struct {
    wav_sink_t sink;
    wav_stream_state_t state;
    uint8_t head[WAV_STREAM_HEAD_MAX];
    size_t head_len;
    uint32_t rate;
    /** Octets de `data` encore à jouer ; sans objet si `unbounded`. */
    uint32_t data_left;
    bool unbounded;
    /** Octet impair en attente du suivant (les paquets réseau coupent les échantillons). */
    uint8_t carry;
    bool has_carry;
    size_t played;
    const char *error;
} wav_stream_t;

void wav_stream_init(wav_stream_t *s, const wav_sink_t *sink);

/** Donne les octets reçus, dans l'ordre, par paquets de n'importe quelle taille. */
void wav_stream_feed(wav_stream_t *s, const uint8_t *bytes, size_t len);
