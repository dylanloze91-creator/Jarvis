#include "provision_proto.h"

#include <ctype.h>
#include <stdio.h>
#include <string.h>

static const char *skip_ws(const char *p) {
    while (*p == ' ' || *p == '\t' || *p == '\r') p++;
    return p;
}

static bool hex_char(char c) {
    return (c >= '0' && c <= '9') || (c >= 'a' && c <= 'f') || (c >= 'A' && c <= 'F');
}

static bool copy_json_string(const char *json, const char *key, char *out, size_t out_size, size_t *out_len) {
    char pattern[40];
    snprintf(pattern, sizeof(pattern), "\"%s\"", key);
    const char *found = strstr(json, pattern);
    if (!found) return false;
    const char *p = found + strlen(pattern);
    p = skip_ws(p);
    if (*p != ':') return false;
    p = skip_ws(p + 1);
    if (*p != '"') return false;
    p++;
    size_t n = 0;
    while (*p && *p != '"') {
        unsigned char c = (unsigned char)*p;
        if (*p == '\\' && p[1]) {
            p++;
            c = (unsigned char)*p;
            if (c == 'n' || c == 'r' || c == 't') return false;
        }
        if (c < 0x20) return false;
        if (n + 1 >= out_size) return false;
        out[n++] = (char)c;
        p++;
    }
    if (*p != '"') return false;
    out[n] = 0;
    if (out_len) *out_len = n;
    return true;
}

static bool valid_ssid(const char *value, size_t bytes) {
    if (bytes < 1 || bytes > PROV_SSID_MAX) return false;
    for (size_t i = 0; i < bytes; i++) {
        if ((unsigned char)value[i] < 0x20) return false;
    }
    return true;
}

static bool valid_pass(const char *value, size_t bytes) {
    if (bytes == 0) return true;
    if (bytes < 8 || bytes > PROV_PASS_MAX) return false;
    for (size_t i = 0; i < bytes; i++) {
        unsigned char c = (unsigned char)value[i];
        if (c < 0x20 || c > 0x7e) return false;
    }
    return true;
}

static size_t utf8_chars(const char *value, bool *ok) {
    size_t chars = 0;
    const unsigned char *p = (const unsigned char *)value;
    while (*p) {
        if (*p < 0x20) {
            *ok = false;
            return 0;
        }
        size_t need = 1;
        if ((*p & 0x80) == 0) need = 1;
        else if ((*p & 0xe0) == 0xc0) need = 2;
        else if ((*p & 0xf0) == 0xe0) need = 3;
        else if ((*p & 0xf8) == 0xf0) need = 4;
        else {
            *ok = false;
            return 0;
        }
        for (size_t i = 1; i < need; i++) {
            if ((p[i] & 0xc0) != 0x80) {
                *ok = false;
                return 0;
            }
        }
        p += need;
        chars++;
    }
    *ok = true;
    return chars;
}

static bool valid_name(const char *value) {
    bool ok = false;
    size_t chars = utf8_chars(value, &ok);
    return ok && chars >= 1 && chars <= PROV_NAME_MAX;
}

static bool valid_hex(const char *value, size_t expect) {
    size_t n = strlen(value);
    if (n != expect) return false;
    for (size_t i = 0; i < n; i++) {
        if (!hex_char(value[i])) return false;
    }
    return true;
}

static void lower_hex(char *value) {
    for (; *value; value++) {
        if (*value >= 'A' && *value <= 'F') *value = (char)(*value - 'A' + 'a');
    }
}

static bool valid_ipv4(const char *value) {
    int index = 0;
    const char *p = value;
    if (!*p) return false;
    while (index < 4) {
        if (!isdigit((unsigned char)*p)) return false;
        int n = 0;
        int digits = 0;
        while (isdigit((unsigned char)*p)) {
            n = n * 10 + (*p - '0');
            digits++;
            if (digits > 3 || n > 255) return false;
            p++;
        }
        if (digits == 0 || n > 255) return false;
        index++;
        if (index < 4) {
            if (*p != '.') return false;
            p++;
        }
    }
    return *p == 0;
}

static bool parse_hosts(const char *json, prov_config_t *cfg) {
    const char *found = strstr(json, "\"hosts\"");
    if (!found) {
        cfg->host_count = 0;
        return true;
    }
    const char *p = strchr(found, '[');
    if (!p) return false;
    p++;
    cfg->host_count = 0;
    for (;;) {
        p = skip_ws(p);
        if (*p == ']') return true;
        if (*p != '"') return false;
        p++;
        char host[PROV_HOST_LEN + 1];
        size_t n = 0;
        while (*p && *p != '"') {
            if (n >= PROV_HOST_LEN) return false;
            host[n++] = *p++;
        }
        if (*p != '"') return false;
        host[n] = 0;
        p++;
        if (!valid_ipv4(host)) return false;
        if (cfg->host_count >= PROV_HOSTS_MAX) return false;
        memcpy(cfg->hosts[cfg->host_count], host, n + 1);
        cfg->host_count++;
        p = skip_ws(p);
        if (*p == ',') {
            p++;
            continue;
        }
        if (*p == ']') return true;
        return false;
    }
}

static bool parse_port(const char *json, int *port) {
    const char *found = strstr(json, "\"port\"");
    if (!found) return false;
    const char *p = strchr(found, ':');
    if (!p) return false;
    p = skip_ws(p + 1);
    if (!isdigit((unsigned char)*p)) return false;
    int n = 0;
    int digits = 0;
    while (isdigit((unsigned char)*p)) {
        n = n * 10 + (*p - '0');
        digits++;
        if (digits > 5 || n > 65535) return false;
        p++;
    }
    if (digits == 0 || n < 1) return false;
    *port = n;
    return true;
}

static void clear_config(prov_config_t *cfg) {
    memset(cfg, 0, sizeof(*cfg));
}

bool prov_parse_line(const char *line, prov_command_t *out) {
    memset(out, 0, sizeof(*out));
    if (!line) return false;
    const char *p = skip_ws(line);
    if (*p == 0 || *p == '\n') return false;
    char word[16];
    size_t n = 0;
    while (*p && *p != ' ' && *p != '\t' && *p != '\r' && *p != '\n' && n + 1 < sizeof(word)) {
        word[n++] = (char)tolower((unsigned char)*p);
        p++;
    }
    word[n] = 0;
    if (strcmp(word, "hello") == 0) {
        out->cmd = PROV_CMD_HELLO;
        return true;
    }
    if (strcmp(word, "scan") == 0) {
        out->cmd = PROV_CMD_SCAN;
        return true;
    }
    if (strcmp(word, "test") == 0) {
        out->cmd = PROV_CMD_TEST;
        return true;
    }
    if (strcmp(word, "forget") == 0) {
        out->cmd = PROV_CMD_FORGET;
        return true;
    }
    if (strcmp(word, "reboot") == 0) {
        out->cmd = PROV_CMD_REBOOT;
        return true;
    }
    if (strcmp(word, "config") != 0) return false;
    out->cmd = PROV_CMD_CONFIG;
    p = skip_ws(p);
    if (*p != '{') {
        snprintf(out->error, sizeof(out->error), "json");
        return true;
    }
    prov_config_t cfg;
    clear_config(&cfg);
    size_t len = 0;
    if (!copy_json_string(p, "ssid", cfg.ssid, sizeof(cfg.ssid), &len) || !valid_ssid(cfg.ssid, len)) {
        snprintf(out->error, sizeof(out->error), "ssid");
        return true;
    }
    len = 0;
    if (!copy_json_string(p, "pass", cfg.pass, sizeof(cfg.pass), &len) || !valid_pass(cfg.pass, len)) {
        snprintf(out->error, sizeof(out->error), "pass");
        return true;
    }
    if (!copy_json_string(p, "name", cfg.name, sizeof(cfg.name), NULL) || !valid_name(cfg.name)) {
        snprintf(out->error, sizeof(out->error), "name");
        return true;
    }
    if (!copy_json_string(p, "token", cfg.token, sizeof(cfg.token), NULL) || !valid_hex(cfg.token, PROV_TOKEN_LEN)) {
        snprintf(out->error, sizeof(out->error), "token");
        return true;
    }
    lower_hex(cfg.token);
    if (!copy_json_string(p, "pc_id", cfg.pc_id, sizeof(cfg.pc_id), NULL) || !valid_hex(cfg.pc_id, PROV_PC_ID_LEN)) {
        snprintf(out->error, sizeof(out->error), "pc_id");
        return true;
    }
    lower_hex(cfg.pc_id);
    if (!parse_port(p, &cfg.port)) {
        snprintf(out->error, sizeof(out->error), "port");
        return true;
    }
    if (!parse_hosts(p, &cfg)) {
        snprintf(out->error, sizeof(out->error), "hosts");
        return true;
    }
    out->config = cfg;
    return true;
}

int prov_reply(char *buf, size_t size, const char *json) {
    int n = snprintf(buf, size, "JARVIS> %s\n", json ? json : "{}");
    if (n < 0 || (size_t)n >= size) return -1;
    return n;
}

void prov_redact(char *line) {
    if (!line) return;
    char *found = strstr(line, "\"pass\"");
    if (!found) return;
    char *colon = strchr(found, ':');
    if (!colon) return;
    char *quote = strchr(colon, '"');
    if (!quote) return;
    char *end = strchr(quote + 1, '"');
    if (!end) return;
    size_t keep = strlen(end);
    memmove(quote + 1 + 3, end, keep + 1);
    memcpy(quote + 1, "***", 3);
}

const char *prov_wifi_code(int reason) {
    switch (reason) {
    case 202: /* WIFI_REASON_AUTH_FAIL */
    case 15:  /* WIFI_REASON_4WAY_HANDSHAKE_TIMEOUT */
    case 204: /* WIFI_REASON_HANDSHAKE_TIMEOUT */
    case 2:   /* WIFI_REASON_AUTH_EXPIRE */
    case 14:  /* WIFI_REASON_802_1X_AUTH_FAILED */
        return "wrong_password";
    case 201: /* WIFI_REASON_NO_AP_FOUND */
    case 210: /* NO_AP_FOUND_W_COMPATIBLE_SECURITY */
    case 211: /* NO_AP_FOUND_IN_AUTHMODE_THRESHOLD */
    case 212: /* NO_AP_FOUND_IN_RSSI_THRESHOLD */
        return "not_found";
    default:
        return NULL;
    }
}

static char fold_char(unsigned int cp) {
    switch (cp) {
    case 0xe0:
    case 0xe2:
    case 0xe4: return 'a';
    case 0xe7: return 'c';
    case 0xe8:
    case 0xe9:
    case 0xea:
    case 0xeb: return 'e';
    case 0xee:
    case 0xef: return 'i';
    case 0xf4:
    case 0xf6: return 'o';
    case 0xf9:
    case 0xfb:
    case 0xfc: return 'u';
    case 0xff: return 'y';
    default: return 0;
    }
}

void prov_hostname(const char *room, char *out, size_t size) {
    if (!out || size < 10) return;
    size_t n = 0;
    const char *prefix = "enceinte-";
    while (*prefix && n + 1 < size) out[n++] = *prefix++;
    const unsigned char *p = (const unsigned char *)(room ? room : "");
    bool last_dash = true;
    while (*p && n + 1 < size) {
        unsigned int cp = *p;
        size_t need = 1;
        if ((*p & 0x80) == 0) {
            cp = *p;
            need = 1;
        } else if ((*p & 0xe0) == 0xc0 && (p[1] & 0xc0) == 0x80) {
            cp = ((*p & 0x1f) << 6) | (p[1] & 0x3f);
            need = 2;
        } else {
            p++;
            continue;
        }
        p += need;
        char c = 0;
        if (cp < 128) {
            c = (char)tolower((unsigned char)cp);
            if (c == ' ' || c == '_' || c == '-') c = '-';
            else if (!((c >= 'a' && c <= 'z') || (c >= '0' && c <= '9'))) c = 0;
        } else if (cp < 256) {
            c = fold_char(cp);
        }
        if (!c) continue;
        if (c == '-' && last_dash) continue;
        out[n++] = c;
        last_dash = c == '-';
    }
    while (n > 8 && out[n - 1] == '-') n--;
    if (n == 8) {
        const char *fallback = "piece";
        while (*fallback && n + 1 < size) out[n++] = *fallback++;
    }
    out[n] = 0;
}
