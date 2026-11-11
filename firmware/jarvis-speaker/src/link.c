// Commandes texte sur l'UART (prise COM) et sur l'USB natif. Le mot de passe n'est jamais journalisé.
#include "link.h"

#include <stdio.h>
#include <string.h>

#include "audio_io.h"
#include "cfg.h"
#include "config.h"
#include "driver/gpio.h"
#include "driver/usb_serial_jtag.h"
#include "esp_heap_caps.h"
#include "esp_log.h"
#include "esp_system.h"
#include "esp_wifi.h"
#include "freertos/FreeRTOS.h"
#include "freertos/task.h"
#include "led.h"
#include "net.h"
#include "provision_proto.h"

static bool usb_ready;

static void say(const char *json) {
    char line[700];
    if (prov_reply(line, sizeof(line), json) < 0) return;
    fputs(line, stdout);
    fflush(stdout);
    if (usb_ready) usb_serial_jtag_write_bytes(line, strlen(line), pdMS_TO_TICKS(200));
}

static void reply_error(const char *code) {
    char json[64];
    snprintf(json, sizeof(json), "{\"ok\":false,\"error\":\"%s\"}", code ? code : "erreur");
    say(json);
}

static void handle_line(char *line) {
    char logged[512];
    snprintf(logged, sizeof(logged), "%s", line);
    prov_redact(logged);
    prov_command_t cmd;
    if (!prov_parse_line(line, &cmd)) return;
    if (cmd.cmd != PROV_CMD_CONFIG) ESP_LOGI(SERIAL_TAG, "commande : %s", logged);
    else ESP_LOGI(SERIAL_TAG, "commande : %s", logged);

    if (cmd.cmd == PROV_CMD_HELLO) {
        char mac[18];
        net_mac(mac, sizeof(mac));
        int psram = (int)(heap_caps_get_total_size(MALLOC_CAP_SPIRAM) / (1024 * 1024));
        const char *state = "setup";
        if (cfg_key_refused()) state = "key";
        else if (jarvis_cfg.configured) state = "ready";
        char json[192];
        snprintf(json, sizeof(json),
                 "{\"fw\":\"%s\",\"chip\":\"ESP32-S3\",\"mac\":\"%s\",\"psram_mb\":%d,\"state\":\"%s\",\"configured\":%s}",
                 JARVIS_FW_VERSION, mac, psram, state, jarvis_cfg.configured ? "true" : "false");
        say(json);
        return;
    }
    if (cmd.cmd == PROV_CMD_SCAN) {
        if (!net_radio()) {
            reply_error("scan");
            return;
        }
        wifi_scan_config_t scan = {.show_hidden = false};
        if (esp_wifi_scan_start(&scan, true) != ESP_OK) {
            reply_error("scan");
            return;
        }
        uint16_t count = 16;
        wifi_ap_record_t found[16];
        if (esp_wifi_scan_get_ap_records(&count, found) != ESP_OK) {
            reply_error("scan");
            return;
        }
        for (uint16_t i = 0; i < count; i++) {
            for (uint16_t j = i + 1; j < count; j++) {
                if (found[j].rssi > found[i].rssi) {
                    wifi_ap_record_t swap = found[i];
                    found[i] = found[j];
                    found[j] = swap;
                }
            }
        }
        char json[640];
        size_t used = 0;
        int n = snprintf(json, sizeof(json), "{\"networks\":[");
        if (n > 0) used = (size_t)n;
        int written = 0;
        for (uint16_t i = 0; i < count && written < 8; i++) {
            if (found[i].ssid[0] == 0) continue;
            bool dup = false;
            for (uint16_t j = 0; j < i; j++) {
                if (strcmp((char *)found[j].ssid, (char *)found[i].ssid) == 0) dup = true;
            }
            if (dup) continue;
            char name[80];
            if (prov_json_string(name, sizeof(name), (const char *)found[i].ssid) < 0) continue;
            n = snprintf(json + used, sizeof(json) - used, "%s{\"ssid\":%s,\"rssi\":%d,\"secure\":%s}",
                         written ? "," : "", name, found[i].rssi, found[i].authmode == WIFI_AUTH_OPEN ? "false" : "true");
            if (n < 0 || (size_t)n >= sizeof(json) - used) break;
            used += (size_t)n;
            written++;
        }
        snprintf(json + used, sizeof(json) - used, "]}");
        say(json);
        return;
    }
    if (cmd.cmd == PROV_CMD_CONFIG) {
        if (cmd.error[0]) {
            reply_error(cmd.error);
            return;
        }
        if (!cfg_save(&cmd.config)) {
            reply_error("memoire");
            return;
        }
        say("{\"ok\":true}");
        return;
    }
    if (cmd.cmd == PROV_CMD_TEST) {
        if (!jarvis_cfg.configured) {
            reply_error("config");
            return;
        }
        net_wifi_try_t wifi = net_test_wifi(20000);
        if (!wifi.ok) {
            char json[96];
            snprintf(json, sizeof(json), "{\"step\":\"wifi\",\"ok\":false,\"error\":\"%s\"}", wifi.error);
            say(json);
            return;
        }
        char json[160];
        snprintf(json, sizeof(json), "{\"step\":\"wifi\",\"ok\":true,\"ip\":\"%s\",\"rssi\":%d}", wifi.ip, wifi.rssi);
        say(json);
        net_pc_try_t pc = net_test_pc();
        if (!pc.ok) {
            snprintf(json, sizeof(json), "{\"step\":\"pc\",\"ok\":false,\"error\":\"%s\"}", pc.error[0] ? pc.error : "pc_not_found");
            say(json);
            return;
        }
        snprintf(json, sizeof(json), "{\"step\":\"pc\",\"ok\":true,\"host\":\"%s\",\"via\":\"%s\"}", pc.host, pc.via);
        say(json);
        int status = net_test_bridge();
        if (status != 200) {
            const char *error = status == 401 ? "bad_key" : status == 403 ? "not_private" : status == 404 ? "old_bridge" : "timeout";
            snprintf(json, sizeof(json), "{\"step\":\"bridge\",\"ok\":false,\"error\":\"%s\"}", error);
            say(json);
            return;
        }
        say("{\"step\":\"bridge\",\"ok\":true}");
        bool voice = net_play_greeting();
        if (!voice) {
            say("{\"step\":\"voice\",\"ok\":false,\"error\":\"timeout\"}");
            return;
        }
        say("{\"step\":\"voice\",\"ok\":true}");
        fflush(stdout);
        vTaskDelay(pdMS_TO_TICKS(400));
        esp_restart();
        return;
    }
    if (cmd.cmd == PROV_CMD_FORGET) {
        cfg_forget();
        say("{\"ok\":true}");
        fflush(stdout);
        vTaskDelay(pdMS_TO_TICKS(200));
        esp_restart();
        return;
    }
    if (cmd.cmd == PROV_CMD_REBOOT) {
        say("{\"ok\":true}");
        fflush(stdout);
        vTaskDelay(pdMS_TO_TICKS(200));
        esp_restart();
        return;
    }
    if (cmd.cmd == PROV_CMD_BAD) reply_error("commande");
}

static void feed(char *buf, size_t *len, const uint8_t *data, size_t n) {
    for (size_t i = 0; i < n; i++) {
        char c = (char)data[i];
        if (c == '\r') continue;
        if (c == '\n') {
            buf[*len] = 0;
            if (*len) handle_line(buf);
            *len = 0;
            continue;
        }
        if (*len + 1 < 512) buf[(*len)++] = c;
    }
}

static void stdin_task(void *arg) {
    (void)arg;
    char line[512];
    for (;;) {
        if (!fgets(line, sizeof(line), stdin)) {
            vTaskDelay(pdMS_TO_TICKS(200));
            continue;
        }
        handle_line(line);
    }
}

static void usb_task(void *arg) {
    (void)arg;
    char buf[512];
    size_t len = 0;
    uint8_t chunk[64];
    for (;;) {
        int n = usb_serial_jtag_read_bytes(chunk, sizeof(chunk), pdMS_TO_TICKS(200));
        if (n > 0) feed(buf, &len, chunk, (size_t)n);
    }
}

static void boot_task(void *arg) {
    (void)arg;
    gpio_config_t io = {
        .pin_bit_mask = 1ULL << GPIO_NUM_0,
        .mode = GPIO_MODE_INPUT,
        .pull_up_en = GPIO_PULLUP_ENABLE,
        .pull_down_en = GPIO_PULLDOWN_DISABLE,
    };
    gpio_config(&io);
    for (;;) {
        if (gpio_get_level(GPIO_NUM_0) != 0) {
            vTaskDelay(pdMS_TO_TICKS(50));
            continue;
        }
        int held = 0;
        while (gpio_get_level(GPIO_NUM_0) == 0 && held < 10000) {
            vTaskDelay(pdMS_TO_TICKS(100));
            held += 100;
            if (held >= 7000) led_set((held / 200) % 2 ? LED_IDENTIFY : LED_STANDBY);
        }
        if (held >= 10000) {
            ESP_LOGI(SERIAL_TAG, "bouton BOOT tenu 10 s : oubli des réglages");
            cfg_forget();
            esp_restart();
        }
    }
}

void link_start(void) {
    usb_serial_jtag_driver_config_t usb = {
        .tx_buffer_size = 256,
        .rx_buffer_size = 256,
    };
    usb_ready = usb_serial_jtag_driver_install(&usb) == ESP_OK;
    xTaskCreate(stdin_task, "link-uart", 6144, NULL, 4, NULL);
    if (usb_ready) xTaskCreate(usb_task, "link-usb", 6144, NULL, 4, NULL);
    xTaskCreate(boot_task, "boot", 3072, NULL, 3, NULL);
}
