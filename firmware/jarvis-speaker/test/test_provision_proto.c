// Essais du protocole d'installation, sans carte et sans ESP-IDF.
#include "provision_proto.h"

#include <stdio.h>
#include <string.h>

static int failures = 0;

static void expect(int cond, const char *name) {
    if (cond) {
        printf("ok  %s\n", name);
        return;
    }
    printf("ECHEC  %s\n", name);
    failures++;
}

static const char *token(void) {
    return "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
}

static void test_noise(void) {
    prov_command_t cmd;
    expect(!prov_parse_line("I (123) jarvis: pret", &cmd), "journal ignore");
    expect(!prov_parse_line("", &cmd), "ligne vide");
    expect(prov_parse_line("hello\n", &cmd) && cmd.cmd == PROV_CMD_HELLO, "hello");
    expect(prov_parse_line("  SCAN  ", &cmd) && cmd.cmd == PROV_CMD_SCAN, "scan");
    expect(prov_parse_line("test", &cmd) && cmd.cmd == PROV_CMD_TEST, "test");
    expect(prov_parse_line("forget", &cmd) && cmd.cmd == PROV_CMD_FORGET, "forget");
    expect(prov_parse_line("reboot", &cmd) && cmd.cmd == PROV_CMD_REBOOT, "reboot");
}

static void test_config_ok(void) {
    char line[512];
    snprintf(line, sizeof(line),
             "config {\"ssid\":\"synthetique-test\",\"pass\":\"motdepasse\",\"name\":\"Salon\","
             "\"token\":\"%s\",\"pc_id\":\"AB12CD34\",\"port\":53131,"
             "\"hosts\":[\"192.168.1.20\",\"10.0.0.2\"]}",
             token());
    prov_command_t cmd;
    expect(prov_parse_line(line, &cmd) && cmd.cmd == PROV_CMD_CONFIG && cmd.error[0] == 0, "config accepte");
    expect(strcmp(cmd.config.ssid, "synthetique-test") == 0, "ssid");
    expect(strcmp(cmd.config.pass, "motdepasse") == 0, "pass");
    expect(strcmp(cmd.config.name, "Salon") == 0, "nom");
    expect(strcmp(cmd.config.pc_id, "ab12cd34") == 0, "pc_id minuscules");
    expect(cmd.config.port == 53131, "port");
    expect(cmd.config.host_count == 2, "deux adresses");
    expect(strcmp(cmd.config.hosts[0], "192.168.1.20") == 0, "premiere adresse");
}

static void test_refusals(void) {
    const char *cases[][2] = {
        {"config {\"ssid\":\"\",\"pass\":\"motdepasse\",\"name\":\"Salon\",\"token\":\"%s\",\"pc_id\":\"ab12cd34\",\"port\":53131,\"hosts\":[]}", "ssid"},
        {"config {\"ssid\":\"synthetique-test\",\"pass\":\"court\",\"name\":\"Salon\",\"token\":\"%s\",\"pc_id\":\"ab12cd34\",\"port\":53131,\"hosts\":[]}", "pass"},
        {"config {\"ssid\":\"synthetique-test\",\"pass\":\"\",\"name\":\"\",\"token\":\"%s\",\"pc_id\":\"ab12cd34\",\"port\":53131,\"hosts\":[]}", "name"},
        {"config {\"ssid\":\"synthetique-test\",\"pass\":\"motdepasse\",\"name\":\"Salon\",\"token\":\"zzzz\",\"pc_id\":\"ab12cd34\",\"port\":53131,\"hosts\":[]}", "token"},
        {"config {\"ssid\":\"synthetique-test\",\"pass\":\"motdepasse\",\"name\":\"Salon\",\"token\":\"%s\",\"pc_id\":\"court\",\"port\":53131,\"hosts\":[]}", "pc_id"},
        {"config {\"ssid\":\"synthetique-test\",\"pass\":\"motdepasse\",\"name\":\"Salon\",\"token\":\"%s\",\"pc_id\":\"ab12cd34\",\"port\":0,\"hosts\":[]}", "port"},
        {"config {\"ssid\":\"synthetique-test\",\"pass\":\"motdepasse\",\"name\":\"Salon\",\"token\":\"%s\",\"pc_id\":\"ab12cd34\",\"port\":53131,\"hosts\":[\"256.1.1.1\"]}", "hosts"},
        {"config {\"ssid\":\"synthetique-test\",\"pass\":\"motdepasse\",\"name\":\"Salon\",\"token\":\"%s\",\"pc_id\":\"ab12cd34\",\"port\":53131,\"hosts\":[\"192.168.0.1\",\"192.168.0.2\",\"192.168.0.3\",\"192.168.0.4\",\"192.168.0.5\"]}", "hosts"},
    };
    for (size_t i = 0; i < sizeof(cases) / sizeof(cases[0]); i++) {
        char line[640];
        snprintf(line, sizeof(line), cases[i][0], token());
        prov_command_t cmd;
        int ok = prov_parse_line(line, &cmd) && cmd.cmd == PROV_CMD_CONFIG && strcmp(cmd.error, cases[i][1]) == 0;
        expect(ok, cases[i][1]);
    }
}

static void test_redact(void) {
    char line[256];
    snprintf(line, sizeof(line), "config {\"ssid\":\"synthetique-test\",\"pass\":\"motdepasse\",\"name\":\"Salon\"}");
    prov_redact(line);
    expect(strstr(line, "motdepasse") == NULL, "mot de passe absent du journal");
    expect(strstr(line, "\"pass\":\"***\"") != NULL, "mot de passe masque");
    expect(strstr(line, "synthetique-test") != NULL, "ssid encore lisible");
}

static void test_wifi_and_name(void) {
    expect(strcmp(prov_wifi_code(202), "wrong_password") == 0, "auth fail");
    expect(strcmp(prov_wifi_code(15), "wrong_password") == 0, "4way");
    expect(strcmp(prov_wifi_code(204), "wrong_password") == 0, "handshake");
    expect(strcmp(prov_wifi_code(201), "not_found") == 0, "pas de reseau");
    expect(prov_wifi_code(8) == NULL, "raison inconnue");
    char host[32];
    prov_hostname("Salon", host, sizeof(host));
    expect(strcmp(host, "enceinte-salon") == 0, "salon");
    prov_hostname("Chambre d'amis", host, sizeof(host));
    expect(strcmp(host, "enceinte-chambre-damis") == 0, "accents et apostrophe");
    char reply[64];
    expect(prov_reply(reply, sizeof(reply), "{\"ok\":true}") > 0, "reponse");
    expect(strcmp(reply, "JARVIS> {\"ok\":true}\n") == 0, "ligne JARVIS");
}

int main(void) {
    test_noise();
    test_config_ok();
    test_refusals();
    test_redact();
    test_wifi_and_name();
    if (failures) {
        printf("%d echec(s)\n", failures);
        return 1;
    }
    printf("provision_proto : tout passe\n");
    return 0;
}
