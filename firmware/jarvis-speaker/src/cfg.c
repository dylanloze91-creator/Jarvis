#include "cfg.h"

#include <stdio.h>
#include <stdlib.h>
#include <string.h>

#include "config.h"
#include "esp_log.h"
#include "nvs.h"
#include "nvs_flash.h"

#if __has_include("secrets.h")
#include "secrets.h"
#define CFG_HAS_SECRETS 1
#else
#define CFG_HAS_SECRETS 0
#define WIFI_SSID ""
#define WIFI_PASSWORD ""
#define JARVIS_HOST ""
#define JARVIS_PORT 53131
#define JARVIS_TOKEN ""
#define SPEAKER_NAME "Enceinte"
#endif

jarvis_cfg_t jarvis_cfg;
static bool ready;
static int auth_fails;

static void copy_clip(char *dst, size_t dst_size, const char *src) {
    if (!src) src = "";
    snprintf(dst, dst_size, "%s", src);
}

static bool looks_ipv4(const char *value) {
    int dots = 0;
    if (!value || !*value) return false;
    for (const char *p = value; *p; p++) {
        if (*p == '.') dots++;
        else if (*p < '0' || *p > '9') return false;
    }
    return dots == 3;
}

static void load_hosts(const char *packed) {
    jarvis_cfg.host_count = 0;
    if (!packed) return;
    const char *p = packed;
    while (*p && jarvis_cfg.host_count < PROV_HOSTS_MAX) {
        char one[PROV_HOST_LEN + 1];
        size_t n = 0;
        while (*p && *p != ',' && n < PROV_HOST_LEN) one[n++] = *p++;
        one[n] = 0;
        if (*p == ',') p++;
        if (n > 0) {
            memcpy(jarvis_cfg.hosts[jarvis_cfg.host_count], one, n + 1);
            jarvis_cfg.host_count++;
        }
    }
}

static void pack_hosts(char *out, size_t size) {
    size_t used = 0;
    out[0] = 0;
    for (int i = 0; i < jarvis_cfg.host_count; i++) {
        int n = snprintf(out + used, size - used, "%s%s", i ? "," : "", jarvis_cfg.hosts[i]);
        if (n < 0 || (size_t)n >= size - used) break;
        used += (size_t)n;
    }
}

void cfg_init(void) {
    if (ready) return;
    esp_err_t nvs = nvs_flash_init();
    if (nvs == ESP_ERR_NVS_NO_FREE_PAGES || nvs == ESP_ERR_NVS_NEW_VERSION_FOUND) {
        ESP_ERROR_CHECK(nvs_flash_erase());
        ESP_ERROR_CHECK(nvs_flash_init());
    }
    ready = true;
    memset(&jarvis_cfg, 0, sizeof(jarvis_cfg));
    nvs_handle_t handle;
    if (nvs_open("jarvis", NVS_READONLY, &handle) == ESP_OK) {
        char ssid[PROV_SSID_MAX + 1] = {0};
        size_t len = sizeof(ssid);
        if (nvs_get_str(handle, "ssid", ssid, &len) == ESP_OK && ssid[0]) {
            copy_clip(jarvis_cfg.ssid, sizeof(jarvis_cfg.ssid), ssid);
            len = sizeof(jarvis_cfg.pass);
            nvs_get_str(handle, "pass", jarvis_cfg.pass, &len);
            len = sizeof(jarvis_cfg.name);
            if (nvs_get_str(handle, "name", jarvis_cfg.name, &len) != ESP_OK) copy_clip(jarvis_cfg.name, sizeof(jarvis_cfg.name), "Enceinte");
            len = sizeof(jarvis_cfg.token);
            nvs_get_str(handle, "token", jarvis_cfg.token, &len);
            len = sizeof(jarvis_cfg.pc_id);
            nvs_get_str(handle, "pc_id", jarvis_cfg.pc_id, &len);
            char port[8] = {0};
            len = sizeof(port);
            if (nvs_get_str(handle, "port", port, &len) == ESP_OK) jarvis_cfg.port = atoi(port);
            if (jarvis_cfg.port <= 0) jarvis_cfg.port = 53131;
            char hosts[80] = {0};
            len = sizeof(hosts);
            if (nvs_get_str(handle, "hosts", hosts, &len) == ESP_OK) load_hosts(hosts);
            len = sizeof(jarvis_cfg.last_ok);
            nvs_get_str(handle, "last_ok", jarvis_cfg.last_ok, &len);
            jarvis_cfg.configured = true;
            jarvis_cfg.from_secrets = false;
            nvs_close(handle);
            ESP_LOGI(SERIAL_TAG, "réglages en mémoire : « %s »", jarvis_cfg.name);
            return;
        }
        nvs_close(handle);
    }
#if CFG_HAS_SECRETS
    if (WIFI_SSID[0]) {
        copy_clip(jarvis_cfg.ssid, sizeof(jarvis_cfg.ssid), WIFI_SSID);
        copy_clip(jarvis_cfg.pass, sizeof(jarvis_cfg.pass), WIFI_PASSWORD);
        copy_clip(jarvis_cfg.name, sizeof(jarvis_cfg.name), SPEAKER_NAME);
        copy_clip(jarvis_cfg.token, sizeof(jarvis_cfg.token), JARVIS_TOKEN);
        jarvis_cfg.port = JARVIS_PORT;
        if (looks_ipv4(JARVIS_HOST)) {
            copy_clip(jarvis_cfg.hosts[0], sizeof(jarvis_cfg.hosts[0]), JARVIS_HOST);
            jarvis_cfg.host_count = 1;
        }
        jarvis_cfg.configured = true;
        jarvis_cfg.from_secrets = true;
        ESP_LOGI(SERIAL_TAG, "réglages développeur (secrets.h) : « %s »", jarvis_cfg.name);
        return;
    }
#endif
    copy_clip(jarvis_cfg.name, sizeof(jarvis_cfg.name), "Enceinte");
    jarvis_cfg.port = 53131;
    ESP_LOGI(SERIAL_TAG, "aucun réglage : en attente du câble USB");
}

bool cfg_save(const prov_config_t *in) {
    cfg_init();
    nvs_handle_t handle;
    if (nvs_open("jarvis", NVS_READWRITE, &handle) != ESP_OK) return false;
    bool ok = nvs_set_str(handle, "ssid", in->ssid) == ESP_OK
        && nvs_set_str(handle, "pass", in->pass) == ESP_OK
        && nvs_set_str(handle, "name", in->name) == ESP_OK
        && nvs_set_str(handle, "token", in->token) == ESP_OK
        && nvs_set_str(handle, "pc_id", in->pc_id) == ESP_OK;
    char port[8];
    snprintf(port, sizeof(port), "%d", in->port);
    ok = ok && nvs_set_str(handle, "port", port) == ESP_OK;
    jarvis_cfg = (jarvis_cfg_t){0};
    copy_clip(jarvis_cfg.ssid, sizeof(jarvis_cfg.ssid), in->ssid);
    copy_clip(jarvis_cfg.pass, sizeof(jarvis_cfg.pass), in->pass);
    copy_clip(jarvis_cfg.name, sizeof(jarvis_cfg.name), in->name);
    copy_clip(jarvis_cfg.token, sizeof(jarvis_cfg.token), in->token);
    copy_clip(jarvis_cfg.pc_id, sizeof(jarvis_cfg.pc_id), in->pc_id);
    jarvis_cfg.port = in->port;
    jarvis_cfg.host_count = in->host_count;
    for (int i = 0; i < in->host_count; i++) copy_clip(jarvis_cfg.hosts[i], sizeof(jarvis_cfg.hosts[i]), in->hosts[i]);
    char hosts[80];
    pack_hosts(hosts, sizeof(hosts));
    ok = ok && nvs_set_str(handle, "hosts", hosts) == ESP_OK && nvs_commit(handle) == ESP_OK;
    nvs_close(handle);
    jarvis_cfg.configured = ok;
    jarvis_cfg.from_secrets = false;
    auth_fails = 0;
    if (ok) ESP_LOGI(SERIAL_TAG, "réglages enregistrés pour « %s » (pass=***)", jarvis_cfg.name);
    return ok;
}

bool cfg_set_wifi(const char *ssid, const char *pass) {
    cfg_init();
    if (!jarvis_cfg.configured || !ssid || !ssid[0]) return false;
    nvs_handle_t handle;
    if (nvs_open("jarvis", NVS_READWRITE, &handle) != ESP_OK) return false;
    bool ok = nvs_set_str(handle, "ssid", ssid) == ESP_OK && nvs_set_str(handle, "pass", pass ? pass : "") == ESP_OK;
    ok = ok && nvs_commit(handle) == ESP_OK;
    nvs_close(handle);
    if (!ok) return false;
    copy_clip(jarvis_cfg.ssid, sizeof(jarvis_cfg.ssid), ssid);
    copy_clip(jarvis_cfg.pass, sizeof(jarvis_cfg.pass), pass ? pass : "");
    ESP_LOGI(SERIAL_TAG, "Wi-Fi mis à jour (pass=***)");
    return true;
}

void cfg_set_last_ok(const char *ip) {
    if (!ip || !ip[0] || strcmp(ip, jarvis_cfg.last_ok) == 0) return;
    if (!looks_ipv4(ip)) return;
    copy_clip(jarvis_cfg.last_ok, sizeof(jarvis_cfg.last_ok), ip);
    nvs_handle_t handle;
    if (nvs_open("jarvis", NVS_READWRITE, &handle) != ESP_OK) return;
    if (nvs_set_str(handle, "last_ok", jarvis_cfg.last_ok) == ESP_OK) nvs_commit(handle);
    nvs_close(handle);
}

void cfg_rename(const char *name) {
    if (!name || !name[0] || strcmp(name, jarvis_cfg.name) == 0) return;
    if (strlen(name) > PROV_NAME_MAX) return;
    copy_clip(jarvis_cfg.name, sizeof(jarvis_cfg.name), name);
    nvs_handle_t handle;
    if (nvs_open("jarvis", NVS_READWRITE, &handle) != ESP_OK) return;
    if (nvs_set_str(handle, "name", jarvis_cfg.name) == ESP_OK) nvs_commit(handle);
    nvs_close(handle);
    ESP_LOGI(SERIAL_TAG, "nouveau nom : « %s »", jarvis_cfg.name);
}

void cfg_forget(void) {
    cfg_init();
    nvs_handle_t handle;
    if (nvs_open("jarvis", NVS_READWRITE, &handle) == ESP_OK) {
        nvs_erase_all(handle);
        nvs_commit(handle);
        nvs_close(handle);
    }
    memset(&jarvis_cfg, 0, sizeof(jarvis_cfg));
    jarvis_cfg.port = 53131;
    auth_fails = 0;
}

bool cfg_note_http(int status) {
    if (status == 200) {
        auth_fails = 0;
        return false;
    }
    if (status != 401) return cfg_key_refused();
    if (auth_fails < 3) auth_fails++;
    return auth_fails >= 3;
}

bool cfg_key_refused(void) {
    return auth_fails >= 3;
}
