#include "wav_stream.h"

#include <string.h>

#define WAV_PLAY_BLOCK 512

static uint16_t rd16(const uint8_t *p) {
    return (uint16_t)(p[0] | (p[1] << 8));
}

static uint32_t rd32(const uint8_t *p) {
    return (uint32_t)p[0] | ((uint32_t)p[1] << 8) | ((uint32_t)p[2] << 16) | ((uint32_t)p[3] << 24);
}

void wav_stream_init(wav_stream_t *s, const wav_sink_t *sink) {
    memset(s, 0, sizeof(*s));
    s->sink = *sink;
    s->state = WAV_STREAM_HEAD;
}

static void refuse(wav_stream_t *s, const char *why) {
    s->state = WAV_STREAM_BAD;
    s->error = why;
}

/**
 * Lit l'entête accumulé. Rend `true` avec `*data_offset` posé quand le bloc `data` commence ;
 * `false` s'il manque encore des octets (ou si l'entête est refusé : `state` passe à BAD).
 */
static bool parse_head(wav_stream_t *s, size_t *data_offset) {
    if (s->head_len < 12) return false;
    if (memcmp(s->head, "RIFF", 4) != 0 || memcmp(s->head + 8, "WAVE", 4) != 0) {
        refuse(s, "pas un fichier WAV");
        return false;
    }
    bool fmt_seen = false;
    size_t pos = 12;
    while (pos + 8 <= s->head_len) {
        const uint8_t *chunk = s->head + pos;
        uint32_t size = rd32(chunk + 4);
        if (memcmp(chunk, "fmt ", 4) == 0) {
            if (size < 16) {
                refuse(s, "bloc fmt trop court");
                return false;
            }
            if (pos + 8 + 16 > s->head_len) return false; // pas encore complet
            uint16_t format = rd16(chunk + 8);
            uint16_t channels = rd16(chunk + 10);
            uint32_t rate = rd32(chunk + 12);
            uint16_t bits = rd16(chunk + 22);
            if (format != 1) {
                refuse(s, "WAV non PCM");
                return false;
            }
            if (channels != 1) {
                refuse(s, "WAV pas mono");
                return false;
            }
            if (bits != 16) {
                refuse(s, "WAV pas en 16 bits");
                return false;
            }
            if (rate < WAV_STREAM_RATE_MIN || rate > WAV_STREAM_RATE_MAX) {
                refuse(s, "cadence WAV hors limites");
                return false;
            }
            s->rate = rate;
            fmt_seen = true;
        } else if (memcmp(chunk, "data", 4) == 0) {
            if (!fmt_seen) {
                refuse(s, "bloc data avant fmt");
                return false;
            }
            // Taille inconnue (0 ou tout à 1) : WAV produit en flux, on joue jusqu'à la fin de la réponse.
            s->unbounded = size == 0 || size >= 0xFFFFFFF0u;
            s->data_left = s->unbounded ? 0 : size;
            *data_offset = pos + 8;
            return true;
        }
        // Un autre bloc (LIST, fact…) doit tenir dans l'entête : sinon on refuse plutôt que de déborder.
        uint32_t skip = size + (size & 1u);
        if (skip < size || skip > WAV_STREAM_HEAD_MAX) {
            refuse(s, "entête WAV trop long");
            return false;
        }
        pos += 8 + (size_t)skip;
    }
    if (s->head_len >= WAV_STREAM_HEAD_MAX) refuse(s, "entête WAV trop long");
    return false;
}

static void play_bytes(wav_stream_t *s, const uint8_t *bytes, size_t len) {
    if (s->state != WAV_STREAM_DATA) return;
    if (!s->unbounded) {
        if (len > s->data_left) len = s->data_left;
        s->data_left -= (uint32_t)len;
    }
    int16_t pcm[WAV_PLAY_BLOCK];
    size_t count = 0;
    size_t pos = 0;
    if (s->has_carry && len > 0) {
        pcm[count++] = (int16_t)(s->carry | (bytes[0] << 8));
        s->has_carry = false;
        pos = 1;
    }
    while (pos + 2 <= len) {
        pcm[count++] = (int16_t)rd16(bytes + pos);
        pos += 2;
        if (count == WAV_PLAY_BLOCK) {
            s->sink.play(pcm, count, s->sink.user);
            s->played += count;
            count = 0;
        }
    }
    if (count) {
        s->sink.play(pcm, count, s->sink.user);
        s->played += count;
    }
    if (pos < len) {
        s->carry = bytes[pos];
        s->has_carry = true;
    }
    if (!s->unbounded && s->data_left == 0) s->state = WAV_STREAM_DONE;
}

void wav_stream_feed(wav_stream_t *s, const uint8_t *bytes, size_t len) {
    if (s->state == WAV_STREAM_DATA) {
        play_bytes(s, bytes, len);
        return;
    }
    if (s->state != WAV_STREAM_HEAD) return;
    size_t room = WAV_STREAM_HEAD_MAX - s->head_len;
    size_t take = len < room ? len : room;
    memcpy(s->head + s->head_len, bytes, take);
    s->head_len += take;
    size_t data_offset = 0;
    if (!parse_head(s, &data_offset)) return;
    s->state = WAV_STREAM_DATA;
    s->sink.set_rate(s->rate, s->sink.user);
    // Ce qui dépasse l'entête dans le tampon est déjà du PCM, puis le reste du paquet.
    if (s->head_len > data_offset) play_bytes(s, s->head + data_offset, s->head_len - data_offset);
    if (take < len) play_bytes(s, bytes + take, len - take);
}
