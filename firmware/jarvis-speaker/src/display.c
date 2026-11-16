/**
 * Écran OLED de l'enceinte (idée du 12 novembre 2026, programme du 16 novembre).
 *
 * Une seule tâche parle à l'écran : elle redessine 4 fois par seconde ce que montre l'état de
 * l'enceinte (display_view.c) et envoie l'image par I2C. Rien d'autre n'attend l'écran : s'il est
 * absent, débranché ou lent, l'écoute, le réveil et le son ne changent pas.
 *
 * L'heure vient d'Internet (SNTP) une fois le Wi-Fi connecté, à l'heure de Paris (DISPLAY_TZ).
 */
#include "display.h"

#include <stdlib.h>
#include <string.h>
#include <sys/time.h>
#include <time.h>

#include "cfg.h"
#include "config.h"
#include "display_gfx.h"
#include "display_view.h"
#include "esp_log.h"
#include "esp_netif_sntp.h"
#include "freertos/FreeRTOS.h"
#include "freertos/task.h"
#include "net.h"

#if DISPLAY_ENABLED
#include "driver/i2c_master.h"

static i2c_master_bus_handle_t bus;
static i2c_master_dev_handle_t dev;
#endif

static volatile led_state_t shown_state = LED_BOOT;

void display_state(led_state_t state) { shown_state = state; }

#if DISPLAY_ENABLED

static bool present;
static gfx_t frame;

bool display_present(void) { return present; }

#define DISPLAY_IS_SH1106 (DISPLAY_TYPE == DISPLAY_SH1106_128X64)
#define DISPLAY_H ((DISPLAY_TYPE == DISPLAY_SSD1306_128X32) ? 32 : 64)
/** La SH1106 a 132 colonnes : l'image commence à la colonne 2. */
#define COLUMN_OFFSET (DISPLAY_IS_SH1106 ? 2 : 0)

static esp_err_t send_commands(const uint8_t *cmds, size_t count) {
    uint8_t buf[32];
    if (count + 1 > sizeof(buf)) return ESP_ERR_INVALID_SIZE;
    buf[0] = 0x00; // la suite est faite de commandes
    memcpy(buf + 1, cmds, count);
    return i2c_master_transmit(dev, buf, count + 1, 50);
}

static esp_err_t panel_init(void) {
    const uint8_t mux = (uint8_t)(DISPLAY_H - 1);
    const uint8_t pins = DISPLAY_H == 32 ? 0x02 : 0x12;
#if DISPLAY_IS_SH1106
    const uint8_t cmds[] = {0xAE, 0xD5, 0x80, 0xA8, mux, 0xD3, 0x00, 0x40, 0xAD, 0x8B, 0xA1, 0xC8,
                            0xDA, pins, 0x81, DISPLAY_CONTRAST, 0xD9, 0x22, 0xDB, 0x35, 0xA4, 0xA6};
#else
    const uint8_t cmds[] = {0xAE, 0xD5, 0x80, 0xA8, mux, 0xD3, 0x00, 0x40, 0x8D, 0x14, 0x20, 0x02,
                            0xA1, 0xC8, 0xDA, pins, 0x81, DISPLAY_CONTRAST, 0xD9, 0xF1, 0xDB, 0x40, 0xA4, 0xA6};
#endif
    esp_err_t err = send_commands(cmds, sizeof(cmds));
    if (err != ESP_OK) return err;
    gfx_clear(&frame);
    const uint8_t on[] = {0xAF};
    return send_commands(on, sizeof(on));
}

/** Envoie l'image page par page (mode « page », commun aux deux puces). */
static esp_err_t panel_flush(void) {
    uint8_t line[1 + GFX_MAX_W];
    line[0] = 0x40; // la suite est faite de points
    for (uint8_t page = 0; page < DISPLAY_H / 8; page++) {
        const uint8_t col = COLUMN_OFFSET;
        const uint8_t where[] = {(uint8_t)(0xB0 | page), (uint8_t)(0x00 | (col & 0x0F)), (uint8_t)(0x10 | (col >> 4))};
        esp_err_t err = send_commands(where, sizeof(where));
        if (err != ESP_OK) return err;
        memcpy(line + 1, frame.buf + (size_t)page * frame.w, frame.w);
        err = i2c_master_transmit(dev, line, (size_t)frame.w + 1, 50);
        if (err != ESP_OK) return err;
    }
    return ESP_OK;
}

static void set_contrast(uint8_t value) {
    const uint8_t cmds[] = {0x81, value};
    (void)send_commands(cmds, sizeof(cmds));
}

static void start_clock_once(void) {
    static bool started;
    if (started || !net_connected()) return;
    esp_sntp_config_t config = ESP_NETIF_SNTP_DEFAULT_CONFIG(DISPLAY_NTP_SERVER);
    if (esp_netif_sntp_init(&config) == ESP_OK) {
        started = true;
        ESP_LOGI(SERIAL_TAG, "écran : heure demandée à %s", DISPLAY_NTP_SERVER);
    }
}

static void display_task(void *arg) {
    (void)arg;
    uint32_t tick = 0;
    int failures = 0;
    led_state_t last_state = LED_BOOT;
    for (;;) {
        start_clock_once();
        display_view_t view = {.state = shown_state, .wifi_ok = net_connected(), .name = jarvis_cfg.name, .tick = tick};
        time_t now = time(NULL);
        struct tm local;
        localtime_r(&now, &local);
        if (local.tm_year >= 2024 - 1900) {
            view.time_ok = true;
            view.hour = local.tm_hour;
            view.minute = local.tm_min;
            view.weekday = local.tm_wday;
            view.day = local.tm_mday;
            view.month = local.tm_mon + 1;
        }
        // En veille, l'écran baisse : il éclaire moins la chambre et s'use moins.
        if (view.state != last_state) {
            set_contrast(view.state == LED_STANDBY ? DISPLAY_CONTRAST_STANDBY : DISPLAY_CONTRAST);
            last_state = view.state;
        }
        display_render(&frame, &view);
        if (panel_flush() != ESP_OK) {
            if (++failures == 3) ESP_LOGW(SERIAL_TAG, "écran : plus de réponse (fils SDA/SCL ?)");
            if (failures >= 3 && failures % 40 == 0) (void)panel_init(); // un faux contact se rattrape
        } else {
            if (failures >= 3) ESP_LOGI(SERIAL_TAG, "écran : de nouveau là");
            failures = 0;
        }
        tick++;
        vTaskDelay(pdMS_TO_TICKS(250));
    }
}

void display_init(void) {
    setenv("TZ", DISPLAY_TZ, 1);
    tzset();
    i2c_master_bus_config_t bus_config = {
        .i2c_port = -1, // le premier libre
        .sda_io_num = DISPLAY_PIN_SDA,
        .scl_io_num = DISPLAY_PIN_SCL,
        .clk_source = I2C_CLK_SRC_DEFAULT,
        .glitch_ignore_cnt = 7,
        .flags = {.enable_internal_pullup = true},
    };
    if (i2c_new_master_bus(&bus_config, &bus) != ESP_OK) {
        ESP_LOGW(SERIAL_TAG, "écran : bus I2C indisponible (broches %d et %d)", DISPLAY_PIN_SDA, DISPLAY_PIN_SCL);
        return;
    }
    uint8_t address = DISPLAY_ADDRESS;
    if (i2c_master_probe(bus, address, 50) != ESP_OK) {
        address = address == 0x3C ? 0x3D : 0x3C; // certaines cartes sont réglées sur l'autre adresse
        if (i2c_master_probe(bus, address, 50) != ESP_OK) {
            ESP_LOGI(SERIAL_TAG, "écran : aucun écran trouvé (normal s'il n'est pas branché)");
            i2c_del_master_bus(bus);
            bus = NULL;
            return;
        }
    }
    i2c_device_config_t dev_config = {
        .dev_addr_length = I2C_ADDR_BIT_LEN_7,
        .device_address = address,
        .scl_speed_hz = 400000,
    };
    if (i2c_master_bus_add_device(bus, &dev_config, &dev) != ESP_OK) return;
    gfx_init(&frame, 128, DISPLAY_H);
    if (panel_init() != ESP_OK) {
        ESP_LOGW(SERIAL_TAG, "écran : trouvé à 0x%02X mais il ne répond pas aux réglages", address);
        return;
    }
    present = true;
    ESP_LOGI(SERIAL_TAG, "écran : %s trouvé à 0x%02X", DISPLAY_IS_SH1106 ? "SH1106 128x64" : (DISPLAY_H == 32 ? "SSD1306 128x32" : "SSD1306 128x64"), address);
    xTaskCreate(display_task, "ecran", 4096, NULL, 1, NULL);
}

#else

void display_init(void) {}
bool display_present(void) { return false; }

#endif
