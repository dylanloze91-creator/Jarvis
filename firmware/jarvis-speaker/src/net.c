#include "net.h"

#include <stdio.h>
#include <stdlib.h>
#include <string.h>

#include <errno.h>
#include <unistd.h>

#include "audio_io.h"
#include "cfg.h"
#include "config.h"
#include "esp_event.h"
#include "esp_http_client.h"
#include "esp_log.h"
#include "esp_mac.h"
#include "esp_netif.h"
#include "esp_system.h"
#include "esp_timer.h"
#include "esp_wifi.h"
#include "freertos/FreeRTOS.h"
#include "freertos/event_groups.h"
#include "freertos/task.h"
#include "lwip/sockets.h"
#include "mdns.h"
#include "provision_proto.h"
#include "wav_stream.h"

#define WIFI_CONNECTED_BIT BIT0

static EventGroupHandle_t wifi_events;
static int retries;
static int last_wifi_reason;
static int turn_depth;
static esp_timer_handle_t reconnect_timer;
static char active_ip[48];
static char active_via[8];
static int64_t last_lookup_us;

void net_ip(char *out, size_t size);
int net_rssi(void);
void net_mac(char *out, size_t size);

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
        wifi_event_sta_disconnected_t *disc = (wifi_event_sta_disconnected_t *)data;
        if (disc) last_wifi_reason = disc->reason;
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

static void fill_wifi(wifi_config_t *wifi_config) {
    memset(wifi_config, 0, sizeof(*wifi_config));
    strncpy((char *)wifi_config->sta.ssid, jarvis_cfg.ssid, sizeof(wifi_config->sta.ssid) - 1);
    strncpy((char *)wifi_config->sta.password, jarvis_cfg.pass, sizeof(wifi_config->sta.password) - 1);
    wifi_config->sta.threshold.authmode = jarvis_cfg.pass[0] ? WIFI_AUTH_WPA2_PSK : WIFI_AUTH_OPEN;
    wifi_config->sta.pmf_cfg.capable = true;
    wifi_config->sta.pmf_cfg.required = false;
}

static void apply_hostname(void) {
    char host[32];
    if (jarvis_cfg.from_secrets) snprintf(host, sizeof(host), "enceinte-jarvis");
    else prov_hostname(jarvis_cfg.name, host, sizeof(host));
    esp_netif_t *netif = esp_netif_get_handle_from_ifkey("WIFI_STA_DEF");
    if (netif) esp_netif_set_hostname(netif, host);
    esp_err_t mdns = mdns_init();
    if (mdns == ESP_OK || mdns == ESP_ERR_INVALID_STATE) mdns_hostname_set(host);
}

bool net_start(uint32_t timeout_ms) {
    cfg_init();
    if (!jarvis_cfg.configured) return false;
    wifi_events = xEventGroupCreate();
    const esp_timer_create_args_t timer_args = {.callback = reconnect_now, .name = "wifi-reconnect"};
    ESP_ERROR_CHECK(esp_timer_create(&timer_args, &reconnect_timer));
    ESP_ERROR_CHECK(esp_netif_init());
    ESP_ERROR_CHECK(esp_event_loop_create_default());
    esp_netif_create_default_wifi_sta();

    wifi_init_config_t cfg = WIFI_INIT_CONFIG_DEFAULT();
    ESP_ERROR_CHECK(esp_wifi_init(&cfg));
    ESP_ERROR_CHECK(esp_event_handler_register(WIFI_EVENT, ESP_EVENT_ANY_ID, &on_wifi_event, NULL));
    ESP_ERROR_CHECK(esp_event_handler_register(IP_EVENT, IP_EVENT_STA_GOT_IP, &on_wifi_event, NULL));

    wifi_config_t wifi_config;
    fill_wifi(&wifi_config);
    ESP_ERROR_CHECK(esp_wifi_set_mode(WIFI_MODE_STA));
    ESP_ERROR_CHECK(esp_wifi_set_config(WIFI_IF_STA, &wifi_config));
    ESP_ERROR_CHECK(esp_wifi_set_ps(WIFI_PS_NONE)); // pas d'économie d'énergie : réponses rapides
    ESP_ERROR_CHECK(esp_wifi_start());
    apply_hostname();
    ESP_LOGI(SERIAL_TAG, "connexion au Wi-Fi « %s »…", jarvis_cfg.ssid);

    EventBits_t bits = xEventGroupWaitBits(wifi_events, WIFI_CONNECTED_BIT, pdFALSE, pdTRUE,
                                           timeout_ms ? pdMS_TO_TICKS(timeout_ms) : portMAX_DELAY);
    return (bits & WIFI_CONNECTED_BIT) != 0;
}

bool net_connected(void) {
    return wifi_events && (xEventGroupGetBits(wifi_events) & WIFI_CONNECTED_BIT);
}

// ------------------------------------------------------------------------------------- adresse PC

static char resolved_host[64];

static bool tcp_open(const char *ip, int port) {
    if (!ip || !ip[0] || port <= 0) return false;
    int sock = socket(AF_INET, SOCK_STREAM, IPPROTO_TCP);
    if (sock < 0) return false;
    struct timeval tv = {.tv_sec = 2, .tv_usec = 0};
    setsockopt(sock, SOL_SOCKET, SO_RCVTIMEO, &tv, sizeof(tv));
    setsockopt(sock, SOL_SOCKET, SO_SNDTIMEO, &tv, sizeof(tv));
    struct sockaddr_in dest = {0};
    dest.sin_family = AF_INET;
    dest.sin_port = htons((uint16_t)port);
    if (inet_pton(AF_INET, ip, &dest.sin_addr) != 1) {
        close(sock);
        return false;
    }
    int rc = connect(sock, (struct sockaddr *)&dest, sizeof(dest));
    int err = errno;
    close(sock);
    if (rc == 0) return true;
    (void)err;
    return false;
}

static bool mdns_pc(char *ip_out, size_t size) {
    mdns_result_t *results = NULL;
    if (mdns_query_ptr("_jarvis-speaker", "_tcp", 1500, 8, &results) != ESP_OK || !results) return false;
    bool found = false;
    for (mdns_result_t *item = results; item && !found; item = item->next) {
        bool pc_ok = jarvis_cfg.pc_id[0] == 0;
        for (size_t t = 0; item->txt && t < item->txt_count; t++) {
            if (item->txt[t].key && item->txt[t].value && strcmp(item->txt[t].key, "pc") == 0 &&
                strcmp(item->txt[t].value, jarvis_cfg.pc_id) == 0) {
                pc_ok = true;
            }
        }
        if (!pc_ok || !item->addr) continue;
        for (mdns_ip_addr_t *addr = item->addr; addr; addr = addr->next) {
            if (addr->addr.type == IPADDR_TYPE_V4) {
                snprintf(ip_out, size, IPSTR, IP2STR(&addr->addr.u_addr.ip4));
                found = ip_out[0] != 0;
                break;
            }
        }
    }
    mdns_query_results_free(results);
    return found;
}

#if __has_include("secrets.h")
#include "secrets.h"
#define NET_HAS_SECRETS 1
#else
#define NET_HAS_SECRETS 0
#define JARVIS_HOST ""
#endif

/** Chemin développeur : l'adresse écrite dans secrets.h, ou son nom `.local`. */
static const char *legacy_host(bool refresh) {
#if NET_HAS_SECRETS
    const char *host = JARVIS_HOST;
#else
    const char *host = jarvis_cfg.host_count ? jarvis_cfg.hosts[0] : "";
#endif
    snprintf(active_via, sizeof(active_via), "host");
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
        snprintf(active_via, sizeof(active_via), "host");
        return resolved_host;
    }
    return host;
}

static const char *jarvis_host(bool refresh) {
    if (jarvis_cfg.from_secrets) return legacy_host(refresh);
    int64_t now = esp_timer_get_time();
    if (!refresh && active_ip[0]) return active_ip;
    if (!refresh && last_lookup_us && now - last_lookup_us < 10LL * 1000 * 1000) return active_ip;
    last_lookup_us = now;
    active_ip[0] = 0;
    active_via[0] = 0;
    if (jarvis_cfg.last_ok[0] && tcp_open(jarvis_cfg.last_ok, jarvis_cfg.port)) {
        snprintf(active_ip, sizeof(active_ip), "%s", jarvis_cfg.last_ok);
        snprintf(active_via, sizeof(active_via), "last");
        return active_ip;
    }
    char found[48];
    if (mdns_pc(found, sizeof(found)) && tcp_open(found, jarvis_cfg.port)) {
        snprintf(active_ip, sizeof(active_ip), "%s", found);
        snprintf(active_via, sizeof(active_via), "mdns");
        return active_ip;
    }
    for (int i = 0; i < jarvis_cfg.host_count; i++) {
        if (tcp_open(jarvis_cfg.hosts[i], jarvis_cfg.port)) {
            snprintf(active_ip, sizeof(active_ip), "%s", jarvis_cfg.hosts[i]);
            snprintf(active_via, sizeof(active_via), "hosts");
            return active_ip;
        }
    }
    return active_ip;
}

static void build_url(char *out, size_t size, const char *path, bool refresh) {
    const char *host = jarvis_host(refresh);
    if (!host || !host[0]) host = "0.0.0.0";
    snprintf(out, size, "http://%s:%d%s", host, jarvis_cfg.port > 0 ? jarvis_cfg.port : 53131, path);
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
    char auth[8 + PROV_TOKEN_LEN + 1];
    snprintf(auth, sizeof(auth), "Bearer %s", jarvis_cfg.token);
    esp_http_client_set_header(client, "Authorization", auth);
    char agent[48];
    snprintf(agent, sizeof(agent), "enceinte-jarvis/%s", jarvis_cfg.name);
    esp_http_client_set_header(client, "User-Agent", agent);
    return client;
}

static void add_life_headers(esp_http_client_handle_t client) {
    esp_http_client_set_header(client, "X-Jarvis-Fw", JARVIS_FW_VERSION);
    char rssi[16];
    snprintf(rssi, sizeof(rssi), "%d", net_rssi());
    esp_http_client_set_header(client, "X-Jarvis-Rssi", rssi);
    char ip[16];
    net_ip(ip, sizeof(ip));
    esp_http_client_set_header(client, "X-Jarvis-Ip", ip[0] ? ip : "0.0.0.0");
    char mac[18];
    net_mac(mac, sizeof(mac));
    esp_http_client_set_header(client, "X-Jarvis-Mac", mac);
    char up[24];
    snprintf(up, sizeof(up), "%lld", (long long)(esp_timer_get_time() / 1000000));
    esp_http_client_set_header(client, "X-Jarvis-Uptime", up);
    char reset[8];
    snprintf(reset, sizeof(reset), "%d", (int)esp_reset_reason());
    esp_http_client_set_header(client, "X-Jarvis-Reset", reset);
}

hello_result_t net_hello(void) {
    hello_result_t result = {0};
    if (!net_connected()) return result;
    response_ctx_t ctx = {0};
    esp_http_client_handle_t client = open_client("/api/speaker/hello", HTTP_METHOD_GET, &ctx, true);
    if (!client) return result;
    add_life_headers(client);
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
        result.identify = strstr(ctx.body, "\"identify\"") != NULL;
        const char *rename = strstr(ctx.body, "\"rename\":\"");
        if (rename) {
            rename += 10;
            size_t i = 0;
            while (rename[i] && rename[i] != '"' && i < sizeof(result.rename) - 1) {
                result.rename[i] = rename[i];
                i++;
            }
            result.rename[i] = 0;
        }
        snprintf(result.via, sizeof(result.via), "%s", active_via);
        if (active_ip[0]) cfg_set_last_ok(active_ip);
        else if (resolved_host[0]) cfg_set_last_ok(resolved_host);
    }
    cfg_note_http(result.status);
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
    turn_depth++;
    response_ctx_t ctx = {0};
    esp_http_client_handle_t client = open_client("/api/speaker/turn", HTTP_METHOD_POST, &ctx, false);
    if (!client) {
        turn_depth--;
        return result;
    }
    esp_http_client_set_header(client, "Content-Type", "audio/wav");
    if (follow_up) esp_http_client_set_header(client, "X-Jarvis-Follow-Up", "1");

    uint32_t pcm_bytes = (uint32_t)(samples * sizeof(int16_t));
    uint8_t header[44];
    wav_header(header, pcm_bytes);
    if (esp_http_client_open(client, (int)(sizeof(header) + pcm_bytes)) != ESP_OK) {
        ESP_LOGW(SERIAL_TAG, "PC injoignable (%s:%d)", active_ip[0] ? active_ip : "?", jarvis_cfg.port);
        active_ip[0] = 0;
        resolved_host[0] = 0;
        last_lookup_us = esp_timer_get_time();
        esp_http_client_cleanup(client);
        turn_depth--;
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
        turn_depth--;
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
    cfg_note_http(result.status);
    turn_depth--;
    return result;
}

bool net_busy(void) {
    return turn_depth > 0;
}

int net_last_wifi_reason(void) {
    return last_wifi_reason;
}

void net_ip(char *out, size_t size) {
    if (!out || size == 0) return;
    out[0] = 0;
    esp_netif_t *netif = esp_netif_get_handle_from_ifkey("WIFI_STA_DEF");
    esp_netif_ip_info_t info;
    if (!netif || esp_netif_get_ip_info(netif, &info) != ESP_OK || info.ip.addr == 0) return;
    snprintf(out, size, IPSTR, IP2STR(&info.ip));
}

int net_rssi(void) {
    wifi_ap_record_t ap;
    if (esp_wifi_sta_get_ap_info(&ap) != ESP_OK) return 0;
    return ap.rssi;
}

void net_mac(char *out, size_t size) {
    uint8_t mac[6] = {0};
    esp_read_mac(mac, ESP_MAC_WIFI_STA);
    snprintf(out, size, "%02x:%02x:%02x:%02x:%02x:%02x", mac[0], mac[1], mac[2], mac[3], mac[4], mac[5]);
}

bool net_radio(void) {
    if (wifi_events) return true;
    cfg_init();
    bool was = jarvis_cfg.configured;
    char saved_ssid[sizeof(jarvis_cfg.ssid)];
    memcpy(saved_ssid, jarvis_cfg.ssid, sizeof(saved_ssid));
    if (!was) {
        jarvis_cfg.configured = true;
        snprintf(jarvis_cfg.ssid, sizeof(jarvis_cfg.ssid), "synthetique-scan");
    }
    net_start(1);
    if (!was) {
        jarvis_cfg.configured = false;
        memcpy(jarvis_cfg.ssid, saved_ssid, sizeof(saved_ssid));
    }
    return wifi_events != NULL;
}

bool net_ensure(uint32_t timeout_ms) {
    cfg_init();
    if (!jarvis_cfg.configured) return false;
    if (!wifi_events) return net_start(timeout_ms);
    wifi_config_t wifi_config;
    fill_wifi(&wifi_config);
    last_wifi_reason = 0;
    xEventGroupClearBits(wifi_events, WIFI_CONNECTED_BIT);
    esp_wifi_disconnect();
    esp_wifi_set_config(WIFI_IF_STA, &wifi_config);
    apply_hostname();
    esp_wifi_connect();
    EventBits_t bits = xEventGroupWaitBits(wifi_events, WIFI_CONNECTED_BIT, pdFALSE, pdTRUE,
                                           timeout_ms ? pdMS_TO_TICKS(timeout_ms) : portMAX_DELAY);
    return (bits & WIFI_CONNECTED_BIT) != 0;
}

net_wifi_try_t net_test_wifi(uint32_t timeout_ms) {
    net_wifi_try_t result = {0};
    last_wifi_reason = 0;
    bool up = net_ensure(timeout_ms ? timeout_ms : 20000);
    net_ip(result.ip, sizeof(result.ip));
    result.rssi = net_rssi();
    if (up && result.ip[0]) {
        result.ok = true;
        return result;
    }
    const char *code = prov_wifi_code(last_wifi_reason);
    snprintf(result.error, sizeof(result.error), "%s", code ? code : (up ? "no_ip" : "timeout"));
    return result;
}

net_pc_try_t net_test_pc(void) {
    net_pc_try_t result = {0};
    active_ip[0] = 0;
    last_lookup_us = 0;
    const char *host = jarvis_host(true);
    if (host && host[0]) {
        result.ok = true;
        snprintf(result.host, sizeof(result.host), "%s", host);
        snprintf(result.via, sizeof(result.via), "%s", active_via[0] ? active_via : "hosts");
        return result;
    }
    snprintf(result.error, sizeof(result.error), "pc_not_found");
    return result;
}

int net_test_bridge(void) {
    hello_result_t hello = net_hello();
    return hello.status;
}

static bool play_wav_body(esp_http_client_handle_t client) {
    static wav_stream_t player;
    const wav_sink_t sink = {.set_rate = sink_set_rate, .play = sink_play, .user = NULL};
    wav_stream_init(&player, &sink);
    static uint8_t buffer[4096];
    for (;;) {
        int n = esp_http_client_read(client, (char *)buffer, sizeof(buffer));
        if (n <= 0) break;
        wav_stream_feed(&player, buffer, (size_t)n);
        if (player.state == WAV_STREAM_BAD || player.state == WAV_STREAM_DONE) break;
    }
    speaker_flush();
    return player.state != WAV_STREAM_BAD && player.played > 0;
}

bool net_play_greeting(void) {
    if (!net_connected()) return false;
    response_ctx_t ctx = {0};
    esp_http_client_handle_t client = open_client("/api/speaker/greeting", HTTP_METHOD_GET, &ctx, false);
    if (!client) return false;
    if (esp_http_client_open(client, 0) != ESP_OK) {
        esp_http_client_cleanup(client);
        return false;
    }
    esp_http_client_fetch_headers(client);
    int status = esp_http_client_get_status_code(client);
    bool played = status == 200 && play_wav_body(client);
    esp_http_client_close(client);
    esp_http_client_cleanup(client);
    return played;
}
