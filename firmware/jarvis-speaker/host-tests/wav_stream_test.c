// Test sur PC du lecteur WAV de la carte (pas besoin d'ESP32) : `./host-tests/run.sh`.
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

#include "wav_stream.h"

static int failures;

#define CHECK(cond)                                                                       \
    do {                                                                                  \
        if (!(cond)) {                                                                    \
            failures++;                                                                   \
            fprintf(stderr, "  ÉCHEC %s:%d : %s\n", __FILE__, __LINE__, #cond);          \
        }                                                                                 \
    } while (0)

typedef struct {
    uint32_t rate;
    int rate_calls;
    int16_t samples[4096];
    size_t count;
} capture_t;

static void cap_rate(uint32_t rate, void *user) {
    capture_t *c = (capture_t *)user;
    c->rate = rate;
    c->rate_calls++;
}

static void cap_play(const int16_t *pcm, size_t n, void *user) {
    capture_t *c = (capture_t *)user;
    for (size_t i = 0; i < n && c->count < 4096; i++) c->samples[c->count++] = pcm[i];
}

static void put16(uint8_t *p, uint16_t v) {
    p[0] = (uint8_t)v;
    p[1] = (uint8_t)(v >> 8);
}

static void put32(uint8_t *p, uint32_t v) {
    p[0] = (uint8_t)v;
    p[1] = (uint8_t)(v >> 8);
    p[2] = (uint8_t)(v >> 16);
    p[3] = (uint8_t)(v >> 24);
}

/** Entête de 44 octets, paramétrable pour fabriquer les mauvais cas. */
static size_t header(uint8_t *out, uint16_t format, uint16_t channels, uint32_t rate, uint16_t bits, uint32_t data_size) {
    memcpy(out, "RIFF", 4);
    put32(out + 4, 36 + data_size);
    memcpy(out + 8, "WAVEfmt ", 8);
    put32(out + 16, 16);
    put16(out + 20, format);
    put16(out + 22, channels);
    put32(out + 24, rate);
    put32(out + 28, rate * channels * bits / 8);
    put16(out + 32, (uint16_t)(channels * bits / 8));
    put16(out + 34, bits);
    memcpy(out + 36, "data", 4);
    put32(out + 40, data_size);
    return 44;
}

static size_t pcm_ramp(uint8_t *out, size_t samples) {
    for (size_t i = 0; i < samples; i++) put16(out + 2 * i, (uint16_t)(int16_t)(i * 7 - 300));
    return samples * 2;
}

static void feed_in_pieces(wav_stream_t *s, const uint8_t *bytes, size_t len, size_t piece) {
    for (size_t pos = 0; pos < len; pos += piece) {
        size_t n = len - pos < piece ? len - pos : piece;
        wav_stream_feed(s, bytes + pos, n);
    }
}

static int ramp_ok(const capture_t *c, size_t samples) {
    if (c->count != samples) return 0;
    for (size_t i = 0; i < samples; i++)
        if (c->samples[i] != (int16_t)(i * 7 - 300)) return 0;
    return 1;
}

static void test_normal_in_any_pieces(void) {
    printf("WAV mono 16 bits : joué entier, en un paquet, par 1, 3 ou 7 octets\n");
    uint8_t file[44 + 2 * 1000];
    size_t len = header(file, 1, 1, 16000, 16, 2000);
    len += pcm_ramp(file + len, 1000);
    size_t pieces[] = {len, 1, 3, 7, 1024};
    for (size_t k = 0; k < sizeof(pieces) / sizeof(pieces[0]); k++) {
        capture_t cap = {0};
        wav_stream_t s;
        wav_sink_t sink = {cap_rate, cap_play, &cap};
        wav_stream_init(&s, &sink);
        feed_in_pieces(&s, file, len, pieces[k]);
        CHECK(s.state == WAV_STREAM_DONE);
        CHECK(cap.rate == 16000 && cap.rate_calls == 1);
        CHECK(ramp_ok(&cap, 1000));
        CHECK(s.played == 1000);
    }
}

static void test_streamed_unknown_size(void) {
    printf("WAV en flux (taille data 0xFFFFFFFF ou 0) : joué jusqu'à la fin de la réponse\n");
    uint32_t sizes[] = {0xFFFFFFFFu, 0};
    for (size_t k = 0; k < 2; k++) {
        uint8_t file[44 + 2 * 500];
        size_t len = header(file, 1, 1, 24000, 16, sizes[k]);
        len += pcm_ramp(file + len, 500);
        capture_t cap = {0};
        wav_stream_t s;
        wav_sink_t sink = {cap_rate, cap_play, &cap};
        wav_stream_init(&s, &sink);
        feed_in_pieces(&s, file, len, 100);
        CHECK(s.state == WAV_STREAM_DATA);
        CHECK(s.unbounded);
        CHECK(cap.rate == 24000);
        CHECK(ramp_ok(&cap, 500));
    }
}

static void test_bounded_data_ignores_trailer(void) {
    printf("bloc data borné : ce qui suit (bloc LIST) n'est pas joué\n");
    uint8_t file[44 + 2 * 10 + 64];
    size_t len = header(file, 1, 1, 16000, 16, 20);
    len += pcm_ramp(file + len, 10);
    memcpy(file + len, "LIST", 4);
    put32(file + len + 4, 56);
    memset(file + len + 8, 0x55, 56);
    len += 64;
    capture_t cap = {0};
    wav_stream_t s;
    wav_sink_t sink = {cap_rate, cap_play, &cap};
    wav_stream_init(&s, &sink);
    wav_stream_feed(&s, file, len);
    CHECK(s.state == WAV_STREAM_DONE);
    CHECK(ramp_ok(&cap, 10));
    wav_stream_feed(&s, file, len); // encore des octets : ignorés
    CHECK(cap.count == 10);
}

static void test_refused_formats(void) {
    printf("stéréo, 8 bits, 24 bits, non PCM, cadence folle : refusés sans rien jouer\n");
    struct {
        uint16_t format, channels, bits;
        uint32_t rate;
        const char *error;
    } cases[] = {
        {1, 2, 16, 16000, "WAV pas mono"},
        {1, 1, 8, 16000, "WAV pas en 16 bits"},
        {1, 1, 24, 16000, "WAV pas en 16 bits"},
        {3, 1, 16, 16000, "WAV non PCM"},
        {1, 1, 16, 4000, "cadence WAV hors limites"},
        {1, 1, 16, 192000, "cadence WAV hors limites"},
        {1, 0, 16, 16000, "WAV pas mono"},
        {1, 100, 16, 16000, "WAV pas mono"},
    };
    for (size_t k = 0; k < sizeof(cases) / sizeof(cases[0]); k++) {
        uint8_t file[44 + 2 * 100];
        size_t len = header(file, cases[k].format, cases[k].channels, cases[k].rate, cases[k].bits, 200);
        len += pcm_ramp(file + len, 100);
        capture_t cap = {0};
        wav_stream_t s;
        wav_sink_t sink = {cap_rate, cap_play, &cap};
        wav_stream_init(&s, &sink);
        feed_in_pieces(&s, file, len, 5);
        CHECK(s.state == WAV_STREAM_BAD);
        CHECK(s.error && strcmp(s.error, cases[k].error) == 0);
        CHECK(cap.count == 0 && cap.rate_calls == 0);
    }
}

static void test_huge_chunk_sizes_do_not_loop(void) {
    printf("taille de bloc énorme (0xFFFFFFF8, 0xFFFFFFFF) avant data : refusé, pas de boucle sans fin\n");
    uint32_t sizes[] = {0xFFFFFFF8u, 0xFFFFFFFFu, 0x7FFFFFFFu, 300};
    for (size_t k = 0; k < 4; k++) {
        uint8_t file[64 + 300];
        memcpy(file, "RIFF", 4);
        put32(file + 4, 0xFFFFFFFFu);
        memcpy(file + 8, "WAVEfmt ", 8);
        put32(file + 16, 16);
        put16(file + 20, 1);
        put16(file + 22, 1);
        put32(file + 24, 16000);
        put32(file + 28, 32000);
        put16(file + 32, 2);
        put16(file + 34, 16);
        memcpy(file + 36, "LIST", 4);
        put32(file + 40, sizes[k]);
        memset(file + 44, 0, sizeof(file) - 44);
        capture_t cap = {0};
        wav_stream_t s;
        wav_sink_t sink = {cap_rate, cap_play, &cap};
        wav_stream_init(&s, &sink);
        feed_in_pieces(&s, file, sizeof(file), 16);
        CHECK(s.state == WAV_STREAM_BAD);
        CHECK(s.error && strcmp(s.error, "entête WAV trop long") == 0);
        CHECK(cap.count == 0);
    }
    printf("bloc fmt de taille folle : refusé aussi\n");
    uint8_t file[44 + 20];
    header(file, 1, 1, 16000, 16, 20);
    put32(file + 16, 0xFFFFFFF0u);
    capture_t cap = {0};
    wav_stream_t s;
    wav_sink_t sink = {cap_rate, cap_play, &cap};
    wav_stream_init(&s, &sink);
    wav_stream_feed(&s, file, sizeof(file));
    CHECK(s.state == WAV_STREAM_BAD);
    CHECK(cap.count == 0);
}

static void test_not_wav_and_data_before_fmt(void) {
    printf("pas un WAV ; data avant fmt ; entête de plus de 256 octets : refusés\n");
    capture_t cap = {0};
    wav_stream_t s;
    wav_sink_t sink = {cap_rate, cap_play, &cap};

    wav_stream_init(&s, &sink);
    const uint8_t json[] = "{\"error\":\"Jarvis a mis trop longtemps\"}";
    wav_stream_feed(&s, json, sizeof(json) - 1);
    CHECK(s.state == WAV_STREAM_BAD && strcmp(s.error, "pas un fichier WAV") == 0);

    uint8_t file[44];
    header(file, 1, 1, 16000, 16, 0);
    memcpy(file + 12, "data", 4);
    put32(file + 16, 0);
    wav_stream_init(&s, &sink);
    wav_stream_feed(&s, file, 20);
    CHECK(s.state == WAV_STREAM_BAD && strcmp(s.error, "bloc data avant fmt") == 0);

    // Deux blocs LIST de 200 octets chacun avant data : l'entête dépasse 256 octets.
    uint8_t big[12 + 24 + (8 + 200) * 2 + 8];
    memcpy(big, "RIFF\0\0\0\0WAVEfmt ", 16);
    put32(big + 16, 16);
    put16(big + 20, 1);
    put16(big + 22, 1);
    put32(big + 24, 16000);
    put32(big + 28, 32000);
    put16(big + 32, 2);
    put16(big + 34, 16);
    size_t pos = 36;
    for (int i = 0; i < 2; i++) {
        memcpy(big + pos, "LIST", 4);
        put32(big + pos + 4, 200);
        memset(big + pos + 8, 'x', 200);
        pos += 208;
    }
    memcpy(big + pos, "data", 4);
    put32(big + pos + 4, 0);
    wav_stream_init(&s, &sink);
    feed_in_pieces(&s, big, sizeof(big), 50);
    CHECK(s.state == WAV_STREAM_BAD && strcmp(s.error, "entête WAV trop long") == 0);
    CHECK(cap.count == 0);
}

static void test_fmt_with_extension_and_list_before_data(void) {
    printf("bloc fmt de 18 octets et petit bloc LIST avant data (sorties courantes d'encodeurs) : acceptés\n");
    uint8_t file[12 + 26 + 8 + 26 + 8 + 2 * 50];
    size_t pos = 0;
    memcpy(file, "RIFF\0\0\0\0WAVEfmt ", 16);
    put32(file + 16, 18);
    put16(file + 20, 1);
    put16(file + 22, 1);
    put32(file + 24, 16000);
    put32(file + 28, 32000);
    put16(file + 32, 2);
    put16(file + 34, 16);
    put16(file + 36, 0);
    pos = 38;
    memcpy(file + pos, "LIST", 4);
    put32(file + pos + 4, 26);
    memset(file + pos + 8, 'I', 26);
    pos += 8 + 26;
    memcpy(file + pos, "data", 4);
    put32(file + pos + 4, 100);
    pos += 8;
    pos += pcm_ramp(file + pos, 50);
    capture_t cap = {0};
    wav_stream_t s;
    wav_sink_t sink = {cap_rate, cap_play, &cap};
    wav_stream_init(&s, &sink);
    feed_in_pieces(&s, file, pos, 9);
    CHECK(s.state == WAV_STREAM_DONE);
    CHECK(ramp_ok(&cap, 50));
}

int main(void) {
    test_normal_in_any_pieces();
    test_streamed_unknown_size();
    test_bounded_data_ignores_trailer();
    test_refused_formats();
    test_huge_chunk_sizes_do_not_loop();
    test_not_wav_and_data_before_fmt();
    test_fmt_with_extension_and_list_before_data();
    if (failures) {
        fprintf(stderr, "%d vérification(s) en échec\n", failures);
        return 1;
    }
    printf("lecteur WAV : tout est bon\n");
    return 0;
}
