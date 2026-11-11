// Réglages de l'enceinte : mémoire NVS « jarvis », ou secrets.h des développeurs si la mémoire est vide.
#pragma once

#include <stdbool.h>

#include "provision_proto.h"

typedef struct {
    bool configured;
    /** Vrai seulement si les valeurs viennent de secrets.h (chemin développeur). */
    bool from_secrets;
    char ssid[PROV_SSID_MAX + 1];
    char pass[PROV_PASS_MAX + 1];
    char name[PROV_NAME_MAX + 1];
    char token[PROV_TOKEN_LEN + 1];
    char pc_id[PROV_PC_ID_LEN + 1];
    int port;
    char hosts[PROV_HOSTS_MAX][PROV_HOST_LEN + 1];
    int host_count;
    char last_ok[PROV_HOST_LEN + 1];
} jarvis_cfg_t;

extern jarvis_cfg_t jarvis_cfg;

void cfg_init(void);
bool cfg_save(const prov_config_t *in);
/** Change seulement le Wi-Fi. La clé et le PC restent. */
bool cfg_set_wifi(const char *ssid, const char *pass);
void cfg_set_last_ok(const char *ip);
void cfg_rename(const char *name);
void cfg_forget(void);

/** Trois réponses 401 de suite : la clé est refusée, on attend une réinstallation. */
bool cfg_note_http(int status);
bool cfg_key_refused(void);
