/**
 * Enceinte Jarvis (5.0.64) — le programme de la carte ESP32-S3.
 *
 * Le cerveau reste sur le PC. La carte :
 *   1. veille : écoute « Jarvis » localement (ESP-SR, WakeNet `wn9_jarvis_tts`) ; rien ne part ;
 *   2. écoute : bip, LED verte, enregistre la phrase jusqu'à ~650 ms de silence (15 s au plus) ;
 *   3. réflexion : LED bleue qui clignote, envoie le WAV au pont du PC (POST /api/speaker/turn) ;
 *   4. réponse : joue le WAV reçu, micro coupé pendant ce temps (pas d'écho) ;
 *   5. suivi : si le PC dit « X-Jarvis-Continue: 1 », écoute `followUpMs` sans mot de réveil ;
 *      une phrase part avec « X-Jarvis-Follow-Up: 1 » ; sinon retour en veille.
 * Wi-Fi perdu : il se reconnecte seul. PC injoignable : un court son d'erreur, puis veille.
 */
#include <stdio.h>
#include <string.h>

#include "audio_io.h"
#include "cfg.h"
#include "config.h"
#include "esp_heap_caps.h"
#include "esp_log.h"
#include "esp_timer.h"
#include "freertos/FreeRTOS.h"
#include "freertos/task.h"
#include "led.h"
#include "link.h"
#include "net.h"
#include "wake.h"

#define MAX_PHRASE_SAMPLES ((size_t)SAMPLE_RATE * MAX_PHRASE_SECONDS)
#define PRE_ROLL_SAMPLES ((size_t)SAMPLE_RATE * PRE_ROLL_MS / 1000)
/** Parole minimale (ms) pour dire que la phrase a commencé (COMMAND_STARTED_SPEECH_MS sur le PC). */
#define SPEECH_STARTED_MS 150
/** Faute de réponse du PC au démarrage, fenêtre de suivi par défaut (DEFAULT_FOLLOW_UP_SECONDS). */
#define DEFAULT_FOLLOW_UP_MS 8000

static int16_t *phrase;        // la phrase en cours (PSRAM)
static int16_t *pre_roll;      // les derniers PRE_ROLL_MS avant le réveil (anneau)
static size_t pre_roll_pos;
static bool pre_roll_full;
static uint32_t follow_up_ms = DEFAULT_FOLLOW_UP_MS;
static int64_t down_since;

static void note_link(bool up) {
    if (up) down_since = 0;
    else if (!down_since) down_since = esp_timer_get_time();
}

static bool down_long(void) {
    return down_since && esp_timer_get_time() - down_since > 5LL * 60 * 1000000;
}

static void pre_roll_push(const int16_t *pcm, size_t samples) {
    for (size_t i = 0; i < samples; i++) {
        pre_roll[pre_roll_pos] = pcm[i];
        pre_roll_pos = (pre_roll_pos + 1) % PRE_ROLL_SAMPLES;
        if (pre_roll_pos == 0) pre_roll_full = true;
    }
}

static size_t pre_roll_copy(int16_t *out) {
    size_t count = pre_roll_full ? PRE_ROLL_SAMPLES : pre_roll_pos;
    size_t start = pre_roll_full ? pre_roll_pos : 0;
    for (size_t i = 0; i < count; i++) out[i] = pre_roll[(start + i) % PRE_ROLL_SAMPLES];
    pre_roll_pos = 0;
    pre_roll_full = false;
    return count;
}

typedef enum { PHRASE_SENT, PHRASE_NOTHING, PHRASE_MIC_LOST } phrase_result_t;

/**
 * Enregistre une phrase à partir des trames du micro, puis l'envoie. `wait_ms` : silence toléré
 * avant que la phrase commence (1,5 s après « Jarvis », la fenêtre de suivi sinon).
 * Le temps est celui de l'audio, pas de l'horloge.
 */
static phrase_result_t record_and_send(uint32_t wait_ms, bool follow_up, turn_result_t *turn) {
    size_t length = follow_up ? 0 : pre_roll_copy(phrase);
    uint32_t speech_ms = 0, silence_ms = 0, total_ms = 0;
    bool started = false;
    const uint32_t frame_ms = (uint32_t)(wake_frame_samples() * 1000 / SAMPLE_RATE);

    for (;;) {
        wake_frame_t frame;
        if (!wake_fetch(&frame, 2000)) return PHRASE_MIC_LOST;
        size_t room = MAX_PHRASE_SAMPLES - length;
        size_t take = frame.samples < room ? frame.samples : room;
        memcpy(phrase + length, frame.pcm, take * sizeof(int16_t));
        length += take;
        total_ms += frame_ms;

        bool loud = pcm_rms(frame.pcm, frame.samples) >= SPEECH_RMS;
        if (loud) {
            speech_ms += frame_ms;
            silence_ms = 0;
            if (speech_ms >= SPEECH_STARTED_MS) started = true;
        } else {
            silence_ms += frame_ms;
        }

        if (started && silence_ms >= SILENCE_AFTER_MS) break;
        if (!started && silence_ms >= wait_ms && speech_ms < SPEECH_STARTED_MS) {
            if (follow_up) ESP_LOGI(SERIAL_TAG, "suivi : personne ne parle, retour en veille");
            else ESP_LOGI(SERIAL_TAG, "rien dit après « Jarvis »");
            return PHRASE_NOTHING;
        }
        if (!started && total_ms >= wait_ms + 2000) return PHRASE_NOTHING;
        if (length >= MAX_PHRASE_SAMPLES) {
            ESP_LOGI(SERIAL_TAG, "phrase de %d s : on envoie", MAX_PHRASE_SECONDS);
            break;
        }
    }

    led_set(LED_THINKING);
    wake_mute(true); // la carte va parler : le micro n'écoute pas
    ESP_LOGI(SERIAL_TAG, "envoi de %.1f s%s…", (double)length / SAMPLE_RATE, follow_up ? " (suivi)" : "");
    *turn = net_turn(phrase, length, follow_up);
    return PHRASE_SENT;
}

static void speak_error(void) {
    led_set(LED_ERROR);
    wake_mute(true);
    tone_error();
    vTaskDelay(pdMS_TO_TICKS(600));
}

static void brain_task(void *arg) {
    (void)arg;
    for (;;) {
        if (cfg_key_refused()) {
            led_set(LED_KEY);
            wake_mute(true);
            vTaskDelay(pdMS_TO_TICKS(1000));
            continue;
        }
        // ---- veille : on attend « Jarvis » -----------------------------------------------------
        if (net_connected()) note_link(true);
        else note_link(false);
        led_set(down_long() ? LED_ERROR : LED_STANDBY);
        wake_mute(false);
        wake_enable(true);
        wake_frame_t frame;
        bool woke = false;
        while (!woke) {
            if (!wake_fetch(&frame, 5000)) continue;
            pre_roll_push(frame.pcm, frame.samples);
            woke = frame.wake_detected;
        }
        ESP_LOGI(SERIAL_TAG, "« Jarvis » entendu");
        wake_enable(false);
        if (!net_connected()) {
            ESP_LOGW(SERIAL_TAG, "pas de Wi-Fi : on ne peut pas joindre le PC");
            speak_error();
            continue;
        }
        led_set(LED_LISTENING);
#if WAKE_BEEP
        // Bip très court, micro **toujours ouvert** : « Jarvis quelle heure est-il » dit d'une traite
        // n'est pas coupé. Le bip s'entend un peu dans la phrase envoyée ; Whisper n'en fait rien.
        tone_wake();
#endif

        // ---- écoute, envoi, réponse, puis suivi tant que le PC le propose ------------------------
        bool follow_up = false;
        for (;;) {
            turn_result_t turn;
            phrase_result_t got = record_and_send(follow_up ? follow_up_ms : SILENCE_BEFORE_MS, follow_up, &turn);
            if (got != PHRASE_SENT) break;

            switch (turn.outcome) {
            case TURN_SPOKEN:
                ESP_LOGI(SERIAL_TAG, "réponse jouée%s", turn.continue_listening ? ", suivi ouvert" : "");
                break;
            case TURN_SILENT:
                ESP_LOGI(SERIAL_TAG, "rien à dire (204)");
                break;
            case TURN_ERROR_SPOKEN:
                ESP_LOGW(SERIAL_TAG, "le PC n'a pas pu écouter (503)");
                break;
            case TURN_REFUSED:
                ESP_LOGE(SERIAL_TAG, "jeton refusé (%d) : dans Jarvis, retire l'enceinte ou réinstalle-la par USB",
                         turn.status);
                speak_error();
                break;
            case TURN_UNREACHABLE:
                ESP_LOGW(SERIAL_TAG, "PC injoignable : Jarvis est-il ouvert, Enceintes activées ?");
                speak_error();
                break;
            case TURN_FAILED:
            default:
                speak_error();
                break;
            }
            if (turn.outcome != TURN_SPOKEN || !turn.continue_listening || follow_up_ms == 0) break;

            // Fenêtre de suivi : on écoute sans « Jarvis ».
            follow_up = true;
            led_set(LED_LISTENING);
            wake_mute(false);
        }
    }
}

/**
 * Mesure le bruit de fond de la pièce au démarrage (une demi-seconde) et l'écrit dans le journal :
 * c'est le chiffre qui sert à régler SPEECH_RMS et MIC_SHIFT dans config.h. Utilise `phrase` comme
 * brouillon (encore vide à ce moment-là).
 */
static void probe_room_noise(void) {
    mic_read(phrase, SAMPLE_RATE / 4);  // le micro se stabilise, on jette
    size_t got = mic_read(phrase, SAMPLE_RATE / 2);
    int32_t noise = pcm_rms(phrase, got);
    ESP_LOGI(SERIAL_TAG, "micro : bruit de fond %ld (seuil de parole SPEECH_RMS = %d)", (long)noise, SPEECH_RMS);
    if (got == 0 || noise < 2) {
        ESP_LOGW(SERIAL_TAG, "micro muet : vérifie VDD sur 3V3, L/R sur GND et les fils SCK/WS/SD (config.h)");
    } else if (noise * 10 >= SPEECH_RMS * 7) {
        ESP_LOGW(SERIAL_TAG, "pièce bruyante pour ce réglage : monte SPEECH_RMS (≈ %ld) ou MIC_SHIFT à 14",
                 (long)(noise * 2));
    }
}

static void life_task(void *arg) {
    (void)arg;
    for (;;) {
        vTaskDelay(pdMS_TO_TICKS(30000));
        if (net_busy() || !jarvis_cfg.configured) continue;
        hello_result_t hello = net_hello();
        if (hello.ok) {
            note_link(true);
            if (hello.follow_up_ms) follow_up_ms = hello.follow_up_ms;
            if (hello.rename[0]) cfg_rename(hello.rename);
            if (hello.identify && !net_busy()) {
                led_set(LED_IDENTIFY);
                tone_wake();
                net_play_greeting();
                vTaskDelay(pdMS_TO_TICKS(3000));
            }
        } else if (hello.status == 0 || !net_connected()) {
            note_link(false);
        }
    }
}

void app_main(void) {
    cfg_init();
    led_init();
    link_start();
    if (!jarvis_cfg.configured) {
        led_set(LED_SETUP);
        audio_init();
        ESP_LOGI(SERIAL_TAG, "Enceinte Jarvis %s — en attente d'installation (USB)", JARVIS_FW_VERSION);
        for (;;) vTaskDelay(pdMS_TO_TICKS(1000));
    }
    led_set(LED_BOOT);
    ESP_LOGI(SERIAL_TAG, "Enceinte Jarvis « %s » %s — démarrage", jarvis_cfg.name, JARVIS_FW_VERSION);

    phrase = heap_caps_malloc(MAX_PHRASE_SAMPLES * sizeof(int16_t), MALLOC_CAP_SPIRAM | MALLOC_CAP_8BIT);
    pre_roll = heap_caps_malloc(PRE_ROLL_SAMPLES * sizeof(int16_t), MALLOC_CAP_SPIRAM | MALLOC_CAP_8BIT);
    if (!phrase || !pre_roll) {
        ESP_LOGE(SERIAL_TAG, "PSRAM absente ou trop petite : vérifie la carte (N8R8 ou N16R8) et sdkconfig.defaults");
        led_set(LED_ERROR);
        return;
    }

    audio_init();
    probe_room_noise();
    if (!wake_init()) {
        led_set(LED_ERROR);
        return;
    }

    if (!net_start(20000)) ESP_LOGW(SERIAL_TAG, "Wi-Fi pas encore connecté : on continue, il réessaie seul");

    hello_result_t hello = net_hello();
    if (hello.ok) {
        follow_up_ms = hello.follow_up_ms;
        ESP_LOGI(SERIAL_TAG, "PC trouvé : Jarvis %s, suivi %lu ms", hello.version, (unsigned long)follow_up_ms);
    } else if (hello.status == 401) {
        ESP_LOGE(SERIAL_TAG, "le PC refuse le jeton : réinstalle l'enceinte par USB dans Jarvis");
        speak_error();
    } else {
        ESP_LOGW(SERIAL_TAG, "PC pas encore joignable (port %d) ; on réessaiera à la première phrase", jarvis_cfg.port);
    }

    ESP_LOGI(SERIAL_TAG, "prêt : dis « Jarvis »");
    xTaskCreatePinnedToCore(life_task, "life", 6 * 1024, NULL, 3, NULL, 0);
    xTaskCreatePinnedToCore(brain_task, "brain", 8 * 1024, NULL, 5, NULL, 1);
}
