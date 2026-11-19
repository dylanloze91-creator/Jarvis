/**
 * Écran OLED de l'enceinte (idée du 12 novembre 2026, programme du 16 novembre).
 *
 * Une seule tâche parle à l'écran : environ 15 images par seconde, en priorité basse. Rien d'autre
 * n'attend l'écran : s'il est absent, débranché ou lent, l'écoute, le réveil et le son ne changent pas.
 *
 * Ce qui s'affiche :
 *  - la mascotte dessinée par l'utilisateur (include/jarvis_mascotte.h) pour la vie normale :
 *    elle dort, écoute, réfléchit, parle (src/mascotte_etat.c décide, main.c et net.c la préviennent) ;
 *  - un message court quand il faut dire ce qui ne va pas : PC injoignable ou pas de Wi-Fi,
 *    clé refusée, enceinte à installer, et « C'est moi ! » quand Jarvis demande un signe ;
 *  - une information importante envoyée par le PC (en-tête « X-Jarvis-Ecran »), le temps demandé ;
 *  - l'heure et la date quand la mascotte dort depuis DISPLAY_HEURE_APRES_MS (heure par Internet).
 * Le choix est fait par display_choose (src/display_view.c, testé sur le PC).
 */
#include "display.h"

#include <stdlib.h>
#include <string.h>
#include <time.h>

#include "cfg.h"
#include "config.h"
#include "display_gfx.h"
#include "display_mascotte.h"
#include "display_view.h"
#include "esp_log.h"
#include "esp_netif_sntp.h"
#include "freertos/semphr.h"
#include "freertos/FreeRTOS.h"
#include "freertos/task.h"
#include "mascotte_etat.h"
#include "net.h"

#if DISPLAY_ENABLED
#include "driver/i2c_master.h"

static i2c_master_bus_handle_t bus;
static i2c_master_dev_handle_t dev;
#endif

static volatile led_state_t shown_state = LED_BOOT;

// Un souci (PC injoignable, pas de Wi-Fi) ne dure que 0,6 s côté LED : trop court pour être lu.
// L'écran le garde quelques secondes, sauf si l'enceinte se remet à écouter, réfléchir ou parler.
#define DISPLAY_ERROR_HOLD_MS 6000u
static volatile uint32_t error_hold_until_ms;
static volatile bool error_hold;

void display_state(led_state_t state) {
    if (state == LED_ERROR) {
        error_hold_until_ms = mascotte_horloge_ms() + DISPLAY_ERROR_HOLD_MS;
        error_hold = true;
    } else if (state != LED_STANDBY) {
        error_hold = false;
    }
    shown_state = state;
}

// Information envoyée par le PC : écrite par la tâche réseau, lue par la tâche de l'écran.
static portMUX_TYPE info_lock = portMUX_INITIALIZER_UNLOCKED;
static char info_title[48];
static char info_line[96];
static uint32_t info_until_ms;
static bool info_on;

void display_info_header(const char *value) {
    char title[sizeof(info_title)], line[sizeof(info_line)];
    uint32_t seconds = 0;
    if (!display_info_parse(value, title, sizeof(title), line, sizeof(line), &seconds)) return;
    const uint32_t now = mascotte_horloge_ms();
    portENTER_CRITICAL(&info_lock);
    memcpy(info_title, title, sizeof(info_title));
    memcpy(info_line, line, sizeof(info_line));
    info_on = seconds > 0;
    info_until_ms = now + seconds * 1000u;
    portEXIT_CRITICAL(&info_lock);
}

/** Copie l'information si elle vaut encore ; sinon renvoie faux. */
static bool info_now(uint32_t now_ms, char *title, char *line) {
    bool on;
    portENTER_CRITICAL(&info_lock);
    on = info_on && (int32_t)(info_until_ms - now_ms) > 0;
    if (on) {
        memcpy(title, info_title, sizeof(info_title));
        memcpy(line, info_line, sizeof(info_line));
    } else {
        info_on = false;
    }
    portEXIT_CRITICAL(&info_lock);
    return on;
}

#if DISPLAY_ENABLED

static bool present;
static gfx_t frame;

bool display_present(void) { return present; }

// Ce que le démarrage a trouvé, pour la commande « hello » du câble USB (le journal série n'y passe pas).
static char found[24] = "pas cherche";
static char report[64];
static volatile unsigned flush_failures;
static volatile int status_byte = -1;
const char *display_report(void) {
    snprintf(report, sizeof(report), "%s etat=%d echecs=%u", found, status_byte, flush_failures);
    return report;
}

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
    // 0x8D 0x14 allume la pompe de charge d'un SSD1306 : beaucoup d'écrans 1,3 pouce vendus « SH1106 »
    // sont des SSD1306, et sans elle ils répondent mais restent noirs. Un vrai SH1106 n'en fait rien.
    const uint8_t cmds[] = {0xAE, 0xD5, 0x80, 0xA8, mux, 0xD3, 0x00, 0x40, 0x8D, 0x14, 0xAD, 0x8B, 0xA1, 0xC8,
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
    int failures = 0;
    uint8_t contrast = 0;
    const TickType_t period = pdMS_TO_TICKS(1000 / MASCOTTE_IMAGES_PAR_SECONDE);
    TickType_t last = xTaskGetTickCount();
    for (;;) {
        const uint32_t now_ms = mascotte_horloge_ms();
        led_state_t state = shown_state;
        if (state == LED_STANDBY && error_hold) {
            if ((int32_t)(error_hold_until_ms - now_ms) > 0) state = LED_ERROR;
            else error_hold = false;
        }
        start_clock_once();
        mascotte_vue_t vue;
        mascotte_etat_voir(now_ms, &vue);
        char title[sizeof(info_title)], line[sizeof(info_line)];
        const bool info = info_now(now_ms, title, line);
        display_view_t view = {.state = state, .wifi_ok = net_connected(), .name = jarvis_cfg.name,
                               .tick = now_ms / 250};
        const time_t now = time(NULL);
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
        const bool sleeping = vue.etat == MASCOTTE_DORT;
        uint8_t wanted = (uint8_t)DISPLAY_CONTRAST;
        switch (display_choose(state, sleeping, vue.t_ms, vue.etat == MASCOTTE_PARLE, info, view.time_ok,
                               DISPLAY_HEURE_APRES_MS)) {
        case DISPLAY_SHOW_MESSAGE:
            display_render(&frame, &view);
            break;
        case DISPLAY_SHOW_INFO:
            display_render_info(&frame, title, line);
            break;
        case DISPLAY_SHOW_CLOCK:
            view.state = LED_STANDBY; // l'écran « heure et date »
            display_render(&frame, &view);
            wanted = (uint8_t)DISPLAY_CONTRAST_STANDBY;
            break;
        case DISPLAY_SHOW_MASCOT:
        default: {
            int dx = 0, dy = 0;
            if (sleeping) {
                mascotte_decalage_sommeil(vue.t_ms, &dx, &dy); // l'OLED ne marque pas
                wanted = (uint8_t)DISPLAY_CONTRAST_STANDBY;    // il dort : la chambre reste sombre
            }
            mascotte_render(&frame, (int)vue.etat, vue.t_ms, vue.bouche, dx, dy);
            break;
        }
        }
        if (wanted != contrast) {
            set_contrast(wanted);
            contrast = wanted;
        }
        flush_failures = failures;
        if (panel_flush() != ESP_OK) {
            if (++failures == 3) ESP_LOGW(SERIAL_TAG, "écran : plus de réponse (fils SDA/SCL ?)");
            if (failures >= 3 && failures % 150 == 0) (void)panel_init(); // un faux contact se rattrape
        } else {
            if (failures >= 3) ESP_LOGI(SERIAL_TAG, "écran : de nouveau là");
            failures = 0;
        }
        vTaskDelayUntil(&last, period);
    }
}

void display_init(void) {
    mascotte_etat_init(mascotte_horloge_ms());
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
        snprintf(found, sizeof(found), "bus indisponible");
        return;
    }
    uint8_t address = DISPLAY_ADDRESS;
    if (i2c_master_probe(bus, address, 50) != ESP_OK) {
        address = address == 0x3C ? 0x3D : 0x3C; // certaines cartes sont réglées sur l'autre adresse
        if (i2c_master_probe(bus, address, 50) != ESP_OK) {
            ESP_LOGI(SERIAL_TAG, "écran : aucun écran trouvé (normal s'il n'est pas branché)");
            // Autre chose répond-il sur ces deux fils ? Utile pour distinguer « rien de branché » d'une autre adresse.
            int n = snprintf(found, sizeof(found), "aucun");
            for (uint8_t a = 0x08; a < 0x78 && n < (int)sizeof(found) - 6; a++) {
                if (i2c_master_probe(bus, a, 20) == ESP_OK) n += snprintf(found + n, sizeof(found) - (size_t)n, " 0x%02X", a);
            }
            i2c_del_master_bus(bus);
            bus = NULL;
            return;
        }
    }
    i2c_device_config_t dev_config = {
        .dev_addr_length = I2C_ADDR_BIT_LEN_7,
        .device_address = address,
        .scl_speed_hz = DISPLAY_I2C_HZ,
    };
    if (i2c_master_bus_add_device(bus, &dev_config, &dev) != ESP_OK) return;
    gfx_init(&frame, 128, DISPLAY_H);
    if (panel_init() != ESP_OK) {
        ESP_LOGW(SERIAL_TAG, "écran : trouvé à 0x%02X mais il ne répond pas aux réglages", address);
        snprintf(found, sizeof(found), "0x%02X muet", address);
        return;
    }
    {
        uint8_t st = 0;
        if (i2c_master_receive(dev, &st, 1, 50) == ESP_OK) status_byte = st; // octet d'état de la puce, pour « hello »
    }
    present = true;
    snprintf(found, sizeof(found), "0x%02X", address);
    ESP_LOGI(SERIAL_TAG, "écran : %s trouvé à 0x%02X", DISPLAY_IS_SH1106 ? "SH1106 128x64" : (DISPLAY_H == 32 ? "SSD1306 128x32" : "SSD1306 128x64"), address);
    xTaskCreatePinnedToCore(display_task, "ecran", 8192, NULL, 1, NULL, 0); // le son tourne sur l'autre cœur
}

#else

void display_init(void) { mascotte_etat_init(mascotte_horloge_ms()); }
bool display_present(void) { return false; }
const char *display_report(void) { return "coupe"; }

#endif
