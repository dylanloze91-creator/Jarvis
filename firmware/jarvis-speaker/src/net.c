#include "net.h"

#include <stdio.h>
#include <stdlib.h>
#include <string.h>

#include "audio_io.h"
#include "config.h"
#include "esp_event.h"
#include "esp_http_client.h"
#include "esp_log.h"
#include "esp_netif.h"
#include "esp_timer.h"
#include "esp_wifi.h"
#include "freertos/FreeRTOS.h"
#include "freertos/event_groups.h"
#include "freertos/task.h"
#include "mdns.h"
#include "nvs_flash.h"
#include "secrets.h"
#include "wav_stream.h"

#define WIFI_CONNECTED_BIT BIT0

static EventGroupHandle_t wifi_events;
static int retries;
static esp_timer_handle_t reconnect_timer;

// ------------------------------------------------------------------------------------------ Wi-Fi

static void reconnect_now(void *arg) {
    (void)arg;
    esp_wifi_connect();
}

static void on_wifi_event(void *arg, esp_event_base_t base, int32_t id, void *data) {
    (void)arg;
    (void)data;
    if (base == WIFI_EVENT && id == WIFI_EVENT_STA_START) {
        esp_wifi_connect();
    } else if (base == WIFI_EVENT && id == WIFI_EVENT_STA_DISCONNECTED) {
        xEventGroupClearBits(wifi_events, WIFI_CONNECTED_BIT);
        retries++;
        // Reconnexion sans fin, de plus en plus espacée (1 s → 30 s) : la box peut redémarrer.
        int wait_ms = retries < 5 ? 1000 : (retries < 20 ? 5000 : 30000);
        ESP_LOGW(SERIAL_TAG, "Wi-Fi perdu, nouvel essai dans %d s", wait_ms / 1000);
        esp_timer_stop(reconnect_timer);
        esp_timer_start_once(reconnect_timer, (uint64_t)wait_ms * 1000);
    } else if (base == IP_EVENT && id == IP_EVENT_STA_GOT_IP) {
        ip_event_got_ip_t *event = (ip_event_got_ip_t *)data;
        ESP_LOGI(SERIAL_TAG, "Wi-Fi connecté, adresse " IPSTR, IP2STR(&event->ip_info.ip));
        retries = 0;
        xEventGroupSetBits(wifi_events, WIFI_CONNECTED_BIT);
    }
}

bool net_start(uint32_t timeout_ms) {
    esp_err_t nvs = nvs_flash_init();
    if (nvs == ESP_ERR_NVS_NO_FREE_PAGES || nvs == ESP_ERR_NVS_NEW_VERSION_FOUND) {
        ESP_ERROR_CHECK(nvs_flash_erase());
        ESP_ERROR_CHECK(nvs_flash_init());
    }
    wifi_events = xEventGroupCreate();
    const esp_timer_create_args_t timer_args = {.callback = reconnect_now, .name = "wifi-reconnect"};
    ESP_ERROR_CHECK(esp_timer_create(&timer_args, &reconnect_timer));
    ESP_ERROR_CHECK(esp_netif_init());
    ESP_ERROR_CHECK(esp_event_loop_create_default());
    esp_netif_t *netif = esp_netif_create_default_wifi_sta();
    esp_netif_set_hostname(netif, "enceinte-jarvis");

    wifi_init_config_t cfg = WIFI_INIT_CONFIG_DEFAULT();
    ESP_ERROR_CHECK(esp_wifi_init(&cfg));
    ESP_ERROR_CHECK(esp_event_handler_register(WIFI_EVENT, ESP_EVENT_ANY_ID, &on_wifi_event, NULL));
    ESP_ERROR_CHECK(esp_event_handler_register(IP_EVENT, IP_EVENT_STA_GOT_IP, &on_wifi_event, NULL));

    wifi_config_t wifi_config = {0};
    strncpy((char *)wifi_config.sta.ssid, WIFI_SSID, sizeof(wifi_config.sta.ssid) - 1);
    strncpy((char *)wifi_config.sta.password, WIFI_PASSWORD, sizeof(wifi_config.sta.password) - 1);
    wifi_config.sta.threshold.authmode = strlen(WIFI_PASSWORD) ? WIFI_AUTH_WPA2_PSK : WIFI_AUTH_OPEN;
    wifi_config.sta.pmf_cfg.capable = true;
    wifi_config.sta.pmf_cfg.required = false;
    ESP_ERROR_CHECK(esp_wifi_set_mode(WIFI_MODE_STA));
    ESP_ERROR_CHECK(esp_wifi_set_config(WIFI_IF_STA, &wifi_config));
    ESP_ERROR_CHECK(esp_wifi_set_ps(WIFI_PS_NONE)); // pas d'économie d'énergie : réponses rapides
    ESP_ERROR_CHECK(esp_wifi_start());
    ESP_LOGI(SERIAL_TAG, "connexion au Wi-Fi « %s »…", WIFI_SSID);

    if (mdns_init() == ESP_OK) mdns_hostname_set("enceinte-jarvis");

    EventBits_t bits = xEventGroupWaitBits(wifi_events, WIFI_CONNECTED_BIT, pdFALSE, pdTRUE,
                                           timeout_ms ? pdMS_TO_TICKS(timeout_ms) : portMAX_DELAY);
    return (bits & WIFI_CONNECTED_BIT) != 0;
}

bool net_connected(void) {
    return wifi_events && (xEventGroupGetBits(wifi_events) & WIFI_CONNECTED_BIT);
}

// ------------------------------------------------------------------------------------- adresse PC

static char resolved_host[64];

/** `pc.local` → adresse IP par mDNS (mémorisée) ; une adresse IP ou un autre nom est rendu tel quel. */
static const char *jarvis_host(bool refresh) {
    const char *host = JARVIS_HOST;
    size_t len = strlen(host);
    if (len < 7 || strcmp(host + len - 6, ".local") != 0) return host;
    if (resolved_host[0] && !refresh) return resolved_host;
    char name[64];
    size_t n = len - 6;
    if (n >= sizeof(name)) n = sizeof(name) - 1;
    memcpy(name, host, n);
    name[n] = 0;
    esp_ip4_addr_t addr = {0};
    if (mdns_query_a(name, 3000, &addr) == ESP_OK && addr.addr != 0) {
        snprintf(resolved_host, sizeof(resolved_host), IPSTR, IP2STR(&addr));
        ESP_LOGI(SERIAL_TAG, "%s → %s (mDNS)", host, resolved_host);
        return resolved_host;
    }
    ESP_LOGW(SERIAL_TAG, "%s introuvable par mDNS ; essai du nom tel quel", host);
    return host;
}

static void build_url(char *out, size_t size, const char *path, bool refresh) {
    snprintf(out, size, "http://%s:%d%s", jarvis_host(refresh), JARVIS_PORT, path);
}

// ----------------------------------------------------------------------------------------- hello

typedef struct {
    char body[256];
    size_t body_len;
    bool continue_listening;
    bool is_wav;
} response_ctx_t;

static esp_err_t on_http_event(esp_http_client_event_t *evt) {
    response_ctx_t *ctx = (response_ctx_t *)evt->user_data;
    if (!ctx) return ESP_OK;
    if (evt->event_id == HTTP_EVENT_ON_HEADER && evt->header_key && evt->header_value) {
        if (strcasecmp(evt->header_key, "X-Jarvis-Continue") == 0) ctx->continue_listening = evt->header_value[0] == '1';
        if (strcasecmp(evt->header_key, "Content-Type") == 0) ctx->is_wav = strncasecmp(evt->header_value, "audio/wav", 9) == 0;
    }
    return ESP_OK;
}

static esp_http_client_handle_t open_client(const char *path, esp_http_client_method_t method, response_ctx_t *ctx,
                                            bool refresh_host) {
    char url[160];
    build_url(url, sizeof(url), path, refresh_host);
    esp_http_client_config_t config = {
        .url = url,
        .method = method,
        .timeout_ms = HTTP_TIMEOUT_MS,
        .buffer_size = 4096,
        .buffer_size_tx = 1024,
        .event_handler = on_http_event,
        .user_data = ctx,
        .keep_alive_enable = false,
    };
    esp_http_client_handle_t client = esp_http_client_init(&config);
    if (!client) return NULL;
    esp_http_client_set_header(client, "Authorization", "Bearer " JARVIS_TOKEN);
    esp_http_client_set_header(client, "User-Agent", "enceinte-jarvis/" SPEAKER_NAME);
    return client;
}

hello_result_t net_hello(void) {
    hello_result_t result = {0};
    if (!net_connected()) return result;
    response_ctx_t ctx = {0};
    esp_http_client_handle_t client = open_client("/api/speaker/hello", HTTP_METHOD_GET, &ctx, true);
    if (!client) return result;
    if (esp_http_client_open(client, 0) != ESP_OK) {
        esp_http_client_cleanup(client);
        return result;
    }
    esp_http_client_fetch_headers(client);
    result.status = esp_http_client_get_status_code(client);
    int n = esp_http_client_read(client, ctx.body, sizeof(ctx.body) - 1);
    if (n > 0) ctx.body[n] = 0;
    esp_http_client_close(client);
    esp_http_client_cleanup(client);
    if (result.status == 200) {
        result.ok = true;
        // JSON minuscule et connu : { "name": "...", "version": "...", "followUpMs": 8000 }.
        const char *follow = strstr(ctx.body, "\"followUpMs\":");
        if (follow) result.follow_up_ms = (uint32_t)strtoul(follow + 13, NULL, 10);
        const char *version = strstr(ctx.body, "\"version\":\"");
        if (version) {
            version += 11;
            size_t i = 0;
            while (version[i] && version[i] != '"' && i < sizeof(result.version) - 1) {
                result.version[i] = version[i];
                i++;
            }
            result.version[i] = 0;
        }
    }
    return result;
}

// ------------------------------------------------------------------------------------------- turn

/** Entête WAV minimal (44 octets) : PCM 16 bits, mono, 16 kHz. */
static void wav_header(uint8_t *h, uint32_t pcm_bytes) {
    uint32_t byte_rate = SAMPLE_RATE * 2;
    memcpy(h, "RIFF", 4);
    uint32_t riff = 36 + pcm_bytes;
    memcpy(h + 4, &riff, 4);
    memcpy(h + 8, "WAVEfmt ", 8);
    uint32_t fmt_len = 16;
    memcpy(h + 16, &fmt_len, 4);
    uint16_t format = 1, channels = 1, block_align = 2, bits = 16;
    uint32_t rate = SAMPLE_RATE;
    memcpy(h + 20, &format, 2);
    memcpy(h + 22, &channels, 2);
    memcpy(h + 24, &rate, 4);
    memcpy(h + 28, &byte_rate, 4);
    memcpy(h + 32, &block_align, 2);
    memcpy(h + 34, &bits, 2);
    memcpy(h + 36, "data", 4);
    memcpy(h + 40, &pcm_bytes, 4);
}

/** Le lecteur WAV (wav_stream.c, testé sur PC) pousse le son vers le haut-parleur. */
static void sink_set_rate(uint32_t sample_rate, void *user) {
    (void)user;
    speaker_set_rate(sample_rate);
}

static void sink_play(const int16_t *pcm, size_t samples, void *user) {
    (void)user;
    speaker_play(pcm, samples);
}

turn_result_t net_turn(const int16_t *pcm, size_t samples, bool follow_up) {
    turn_result_t result = {.outcome = TURN_UNREACHABLE, .status = 0, .continue_listening = false};
    if (!net_connected()) return result;
    response_ctx_t ctx = {0};
    esp_http_client_handle_t client = open_client("/api/speaker/turn", HTTP_METHOD_POST, &ctx, false);
    if (!client) return result;
    esp_http_client_set_header(client, "Content-Type", "audio/wav");
    if (follow_up) esp_http_client_set_header(client, "X-Jarvis-Follow-Up", "1");

    uint32_t pcm_bytes = (uint32_t)(samples * sizeof(int16_t));
    uint8_t header[44];
    wav_header(header, pcm_bytes);
    if (esp_http_client_open(client, (int)(sizeof(header) + pcm_bytes)) != ESP_OK) {
        ESP_LOGW(SERIAL_TAG, "PC injoignable (%s:%d)", JARVIS_HOST, JARVIS_PORT);
        resolved_host[0] = 0; // l'adresse mDNS a peut-être changé : on la redemandera
        esp_http_client_cleanup(client);
        return result;
    }
    bool sent = esp_http_client_write(client, (const char *)header, sizeof(header)) == (int)sizeof(header);
    const uint8_t *body = (const uint8_t *)pcm;
    size_t offset = 0;
    while (sent && offset < pcm_bytes) {
        size_t chunk = pcm_bytes - offset;
        if (chunk > 4096) chunk = 4096;
        int written = esp_http_client_write(client, (const char *)body + offset, (int)chunk);
        if (written <= 0) sent = false;
        else offset += (size_t)written;
    }
    if (!sent) {
        ESP_LOGW(SERIAL_TAG, "envoi interrompu");
        esp_http_client_close(client);
        esp_http_client_cleanup(client);
        return result;
    }

    int64_t content_length = esp_http_client_fetch_headers(client);
    result.status = esp_http_client_get_status_code(client);
    result.continue_listening = ctx.continue_listening;
    ESP_LOGI(SERIAL_TAG, "réponse %d%s (%lld octets)", result.status, ctx.is_wav ? " audio" : "", (long long)content_length);

    if (result.status == 200 || (result.status == 503 && ctx.is_wav)) {
        static wav_stream_t player;
        const wav_sink_t sink = {.set_rate = sink_set_rate, .play = sink_play, .user = NULL};
        wav_stream_init(&player, &sink);
        static uint8_t buffer[4096];
        for (;;) {
            int n = esp_http_client_read(client, (char *)buffer, sizeof(buffer));
            if (n <= 0) break;
            wav_stream_feed(&player, buffer, (size_t)n);
            // Refusé ou bloc `data` fini : inutile de télécharger la suite.
            if (player.state == WAV_STREAM_BAD || player.state == WAV_STREAM_DONE) break;
        }
        speaker_flush();
        if (player.state == WAV_STREAM_BAD) {
            ESP_LOGW(SERIAL_TAG, "réponse refusée : %s", player.error);
            result.outcome = TURN_FAILED;
        } else if (player.played == 0) {
            ESP_LOGW(SERIAL_TAG, "réponse sans son lisible");
            result.outcome = TURN_FAILED;
        } else {
            result.outcome = result.status == 200 ? TURN_SPOKEN : TURN_ERROR_SPOKEN;
        }
    } else if (result.status == 204) {
        result.outcome = TURN_SILENT;
    } else if (result.status == 401 || result.status == 403) {
        result.outcome = TURN_REFUSED;
    } else {
        char text[160] = {0};
        int n = esp_http_client_read(client, text, sizeof(text) - 1);
        if (n > 0) ESP_LOGW(SERIAL_TAG, "le PC répond %d : %s", result.status, text);
        result.outcome = result.status > 0 ? TURN_FAILED : TURN_UNREACHABLE;
    }
    esp_http_client_close(client);
    esp_http_client_cleanup(client);
    return result;
}
