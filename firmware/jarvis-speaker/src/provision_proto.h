// Lignes de l'installation par USB. Aucun en-tête ESP-IDF : ce fichier se compile sur le PC.
#pragma once

#include <stdbool.h>
#include <stddef.h>
#include <stdint.h>

#define PROV_SSID_MAX 32
#define PROV_PASS_MAX 63
#define PROV_NAME_MAX 24
#define PROV_TOKEN_LEN 64
#define PROV_PC_ID_LEN 8
#define PROV_HOSTS_MAX 4
#define PROV_HOST_LEN 15

typedef struct {
    char ssid[PROV_SSID_MAX + 1];
    char pass[PROV_PASS_MAX + 1];
    char name[PROV_NAME_MAX + 1];
    char token[PROV_TOKEN_LEN + 1];
    char pc_id[PROV_PC_ID_LEN + 1];
    int port;
    char hosts[PROV_HOSTS_MAX][PROV_HOST_LEN + 1];
    int host_count;
} prov_config_t;

typedef enum {
    PROV_CMD_NONE = 0,
    PROV_CMD_HELLO,
    PROV_CMD_SCAN,
    PROV_CMD_CONFIG,
    PROV_CMD_WIFI,
    PROV_CMD_TEST,
    PROV_CMD_FORGET,
    PROV_CMD_REBOOT,
    PROV_CMD_BAD,
} prov_cmd_t;

typedef struct {
    prov_cmd_t cmd;
    prov_config_t config;
    char error[32];
} prov_command_t;

/** Vrai si la ligne est une commande. Une ligne de journal renvoie faux. */
bool prov_parse_line(const char *line, prov_command_t *out);

int prov_reply(char *buf, size_t size, const char *json);

/** Remplace la valeur de `pass` par `***`. Le mot de passe ne reste pas dans `line`. */
void prov_redact(char *line);

/** Code simple, ou NULL si la raison n'est pas un échec connu. */
const char *prov_wifi_code(int reason);

/** `Salon` → `enceinte-salon` (minuscules, sans accent). */
void prov_hostname(const char *room, char *out, size_t size);

/**
 * Écrit `in` comme chaîne JSON (guillemets compris). `"` et `\` sont échappés.
 * Un caractère de contrôle, ou un tampon trop court, renvoie -1 : le nom est écarté.
 */
int prov_json_string(char *out, size_t size, const char *in);
