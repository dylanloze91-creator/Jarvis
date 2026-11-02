#include "wake.h"

#include <string.h>

#include "audio_io.h"
#include "config.h"
#include "esp_afe_config.h"
#include "esp_afe_sr_models.h"
#include "esp_heap_caps.h"
#include "esp_log.h"
#include "esp_wn_iface.h"
#include "freertos/FreeRTOS.h"
#include "freertos/task.h"
#include "model_path.h"

static const esp_afe_sr_iface_t *afe;
static esp_afe_sr_data_t *afe_data;
static int feed_samples;
static int fetch_samples;
static volatile bool muted;
static volatile bool muted_changed;

/** Lit le micro en continu et nourrit l'AFE ; en sourdine, l'audio est lu puis jeté. */
static void feed_task(void *arg) {
    (void)arg;
    int16_t *buffer = heap_caps_malloc(feed_samples * sizeof(int16_t), MALLOC_CAP_INTERNAL | MALLOC_CAP_8BIT);
    if (!buffer) {
        ESP_LOGE(SERIAL_TAG, "pas de mémoire pour le micro");
        vTaskDelete(NULL);
        return;
    }
    for (;;) {
        size_t got = mic_read(buffer, feed_samples);
        if (got < (size_t)feed_samples) {
            vTaskDelay(pdMS_TO_TICKS(10));
            continue;
        }
        if (muted) continue;
        if (muted_changed) {
            // Retour du son : on oublie ce qui restait dans l'AFE (fin de la réponse de Jarvis).
            afe->reset_buffer(afe_data);
            muted_changed = false;
        }
        afe->feed(afe_data, buffer);
    }
}

bool wake_init(void) {
    srmodel_list_t *models = esp_srmodel_init("model");
    if (!models || models->num == 0) {
        ESP_LOGE(SERIAL_TAG, "aucun modèle dans la partition « model » : le téléversement a-t-il écrit srmodels.bin ?");
        return false;
    }
    char *wakenet = esp_srmodel_filter(models, ESP_WN_PREFIX, NULL);
    if (!wakenet) {
        ESP_LOGE(SERIAL_TAG, "pas de modèle de mot de réveil (CONFIG_SR_WN_WN9_JARVIS_TTS dans sdkconfig.defaults)");
        return false;
    }
    ESP_LOGI(SERIAL_TAG, "mot de réveil : %s", wakenet);

    // "M" : un seul micro, pas de canal de référence (l'écho est évité en coupant le micro quand la carte parle).
    afe_config_t *config = afe_config_init("M", models, AFE_TYPE_SR, AFE_MODE_LOW_COST);
    if (!config) {
        ESP_LOGE(SERIAL_TAG, "configuration AFE impossible");
        return false;
    }
    config->wakenet_init = true;
    config->wakenet_model_name = wakenet;
    config->aec_init = false;
    config->se_init = false;
    config->vad_init = false; // la fin de phrase est mesurée à l'énergie (comme sur le PC)
    config->agc_init = true;
    config->memory_alloc_mode = AFE_MEMORY_ALLOC_MORE_PSRAM;
    afe = esp_afe_handle_from_config(config);
    afe_data = afe->create_from_config(config);
    afe_config_free(config);
    if (!afe_data) {
        ESP_LOGE(SERIAL_TAG, "AFE non démarré (PSRAM présente et activée ?)");
        return false;
    }
    if (WAKE_THRESHOLD > 0.0f) afe->set_wakenet_threshold(afe_data, 1, WAKE_THRESHOLD);

    feed_samples = afe->get_feed_chunksize(afe_data);
    fetch_samples = afe->get_fetch_chunksize(afe_data);
    int channels = afe->get_feed_channel_num(afe_data);
    ESP_LOGI(SERIAL_TAG, "AFE : %d échantillons par trame micro (%d canal), %d par trame rendue", feed_samples, channels,
             fetch_samples);
    if (channels != 1) {
        ESP_LOGE(SERIAL_TAG, "l'AFE attend %d canaux, le micro en a un", channels);
        return false;
    }
    xTaskCreatePinnedToCore(feed_task, "mic-feed", 4 * 1024, NULL, 5, NULL, 0);
    return true;
}

size_t wake_frame_samples(void) {
    return (size_t)fetch_samples;
}

bool wake_fetch(wake_frame_t *out, uint32_t timeout_ms) {
    afe_fetch_result_t *result = afe->fetch_with_delay(afe_data, pdMS_TO_TICKS(timeout_ms));
    if (!result || result->ret_value == ESP_FAIL || !result->data) return false;
    out->pcm = result->data;
    out->samples = (size_t)result->data_size / sizeof(int16_t);
    out->wake_detected = result->wakeup_state == WAKENET_DETECTED;
    return true;
}

void wake_enable(bool enabled) {
    if (enabled) afe->enable_wakenet(afe_data);
    else afe->disable_wakenet(afe_data);
}

void wake_mute(bool mute) {
    if (muted == mute) return;
    muted = mute;
    if (!mute) muted_changed = true;
}
