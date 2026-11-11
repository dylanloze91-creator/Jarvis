#include "audio_io.h"

#include <math.h>
#include <string.h>

#include "config.h"
#include "mic_filter.h"
#include "driver/i2s_std.h"
#include "esp_log.h"
#include "freertos/FreeRTOS.h"
#include "freertos/task.h"

static i2s_chan_handle_t rx_chan;
static i2s_chan_handle_t tx_chan;
static uint32_t tx_rate = SAMPLE_RATE;

// Le micro envoie 32 bits par échantillon : on lit par blocs de ce format puis on réduit en 16 bits.
#define MIC_BLOCK 512
static int32_t mic_block[MIC_BLOCK];
// Moyenne glissante du micro (×256), pour retirer son décalage continu.
static mic_filter_t mic_filter;

void audio_init(void) {
    // Micro : I2S0, maître, 32 bits, un seul canal (gauche).
    i2s_chan_config_t rx_cfg = I2S_CHANNEL_DEFAULT_CONFIG(I2S_NUM_0, I2S_ROLE_MASTER);
    rx_cfg.dma_desc_num = 6;
    rx_cfg.dma_frame_num = 256;
    ESP_ERROR_CHECK(i2s_new_channel(&rx_cfg, NULL, &rx_chan));
    i2s_std_config_t rx_std = {
        .clk_cfg = I2S_STD_CLK_DEFAULT_CONFIG(SAMPLE_RATE),
        .slot_cfg = I2S_STD_PHILIPS_SLOT_DEFAULT_CONFIG(I2S_DATA_BIT_WIDTH_32BIT, I2S_SLOT_MODE_MONO),
        .gpio_cfg = {
            .mclk = I2S_GPIO_UNUSED,
            .bclk = MIC_PIN_SCK,
            .ws = MIC_PIN_WS,
            .dout = I2S_GPIO_UNUSED,
            .din = MIC_PIN_SD,
            .invert_flags = {.mclk_inv = false, .bclk_inv = false, .ws_inv = false},
        },
    };
    rx_std.slot_cfg.slot_mask = I2S_STD_SLOT_LEFT;
    ESP_ERROR_CHECK(i2s_channel_init_std_mode(rx_chan, &rx_std));
    ESP_ERROR_CHECK(i2s_channel_enable(rx_chan));

    // Haut-parleur : I2S1, maître, 16 bits, mono (le même échantillon part sur les deux canaux).
    i2s_chan_config_t tx_cfg = I2S_CHANNEL_DEFAULT_CONFIG(I2S_NUM_1, I2S_ROLE_MASTER);
    tx_cfg.dma_desc_num = 8;
    tx_cfg.dma_frame_num = 256;
    tx_cfg.auto_clear = true;
    ESP_ERROR_CHECK(i2s_new_channel(&tx_cfg, &tx_chan, NULL));
    i2s_std_config_t tx_std = {
        .clk_cfg = I2S_STD_CLK_DEFAULT_CONFIG(SAMPLE_RATE),
        .slot_cfg = I2S_STD_PHILIPS_SLOT_DEFAULT_CONFIG(I2S_DATA_BIT_WIDTH_16BIT, I2S_SLOT_MODE_MONO),
        .gpio_cfg = {
            .mclk = I2S_GPIO_UNUSED,
            .bclk = AMP_PIN_BCLK,
            .ws = AMP_PIN_LRC,
            .dout = AMP_PIN_DIN,
            .din = I2S_GPIO_UNUSED,
            .invert_flags = {.mclk_inv = false, .bclk_inv = false, .ws_inv = false},
        },
    };
    ESP_ERROR_CHECK(i2s_channel_init_std_mode(tx_chan, &tx_std));
    ESP_ERROR_CHECK(i2s_channel_enable(tx_chan));
    ESP_LOGI(SERIAL_TAG, "audio prêt : micro SCK=%d WS=%d SD=%d · ampli BCLK=%d LRC=%d DIN=%d", MIC_PIN_SCK, MIC_PIN_WS,
             MIC_PIN_SD, AMP_PIN_BCLK, AMP_PIN_LRC, AMP_PIN_DIN);
}

size_t mic_read(int16_t *out, size_t samples) {
    size_t done = 0;
    while (done < samples) {
        size_t want = samples - done;
        if (want > MIC_BLOCK) want = MIC_BLOCK;
        size_t bytes = 0;
        if (i2s_channel_read(rx_chan, mic_block, want * sizeof(int32_t), &bytes, pdMS_TO_TICKS(1000)) != ESP_OK) break;
        size_t got = bytes / sizeof(int32_t);
        for (size_t i = 0; i < got; i++) {
            // Offset retiré puis passe-haut à ~100 Hz (mic_filter.h) : la dérive lente du micro, qui
            // faisait durer chaque phrase 15 s, ne passe plus ; la voix passe.
            out[done + i] = mic_filter_sample(&mic_filter, mic_block[i] >> MIC_SHIFT);
        }
        done += got;
        if (got == 0) break;
    }
    return done;
}

void speaker_set_rate(uint32_t sample_rate) {
    if (sample_rate == 0 || sample_rate == tx_rate) return;
    i2s_std_clk_config_t clk = I2S_STD_CLK_DEFAULT_CONFIG(sample_rate);
    i2s_channel_disable(tx_chan);
    if (i2s_channel_reconfig_std_clock(tx_chan, &clk) == ESP_OK) tx_rate = sample_rate;
    i2s_channel_enable(tx_chan);
}

#define PLAY_BLOCK 512
static int16_t play_block[PLAY_BLOCK];

void speaker_play(const int16_t *pcm, size_t samples) {
    size_t done = 0;
    while (done < samples) {
        size_t n = samples - done;
        if (n > PLAY_BLOCK) n = PLAY_BLOCK;
        for (size_t i = 0; i < n; i++) play_block[i] = (int16_t)(((int32_t)pcm[done + i] * VOLUME) / 100);
        size_t written = 0;
        i2s_channel_write(tx_chan, play_block, n * sizeof(int16_t), &written, pdMS_TO_TICKS(2000));
        done += n;
    }
}

void speaker_flush(void) {
    memset(play_block, 0, sizeof(play_block));
    size_t written = 0;
    for (int i = 0; i < 4; i++) i2s_channel_write(tx_chan, play_block, sizeof(play_block), &written, pdMS_TO_TICKS(500));
    // Le DMA vide ses tampons (≈ 8 × 256 trames à 16 kHz = 128 ms).
    vTaskDelay(pdMS_TO_TICKS(150));
}

static void play_note(float hz, int ms, float amplitude) {
    speaker_set_rate(SAMPLE_RATE);
    size_t total = (size_t)SAMPLE_RATE * ms / 1000;
    static int16_t note[PLAY_BLOCK];
    size_t done = 0;
    while (done < total) {
        size_t n = total - done;
        if (n > PLAY_BLOCK) n = PLAY_BLOCK;
        for (size_t i = 0; i < n; i++) {
            size_t t = done + i;
            // Attaque et chute de 10 ms pour éviter les clics.
            float env = 1.0f;
            size_t edge = SAMPLE_RATE / 100;
            if (t < edge) env = (float)t / edge;
            else if (total - t < edge) env = (float)(total - t) / edge;
            note[i] = (int16_t)(sinf(2.0f * (float)M_PI * hz * t / SAMPLE_RATE) * amplitude * env * 32767.0f);
        }
        speaker_play(note, n);
        done += n;
    }
}

void tone_wake(void) {
    // ≈ 120 ms en tout, sans vidage bloquant : le micro n'est pas coupé pendant ce bip.
    play_note(660.0f, 50, 0.3f);
    play_note(990.0f, 70, 0.3f);
    memset(play_block, 0, sizeof(play_block));
    size_t written = 0;
    i2s_channel_write(tx_chan, play_block, 64 * sizeof(int16_t), &written, pdMS_TO_TICKS(100));
}

void tone_error(void) {
    play_note(440.0f, 140, 0.35f);
    play_note(294.0f, 220, 0.35f);
    speaker_flush();
}

int32_t pcm_rms(const int16_t *pcm, size_t samples) {
    if (samples == 0) return 0;
    uint64_t sum = 0;
    for (size_t i = 0; i < samples; i++) sum += (int64_t)pcm[i] * pcm[i];
    return (int32_t)sqrt((double)sum / samples);
}
