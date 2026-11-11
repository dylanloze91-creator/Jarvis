#include "led.h"

#include "config.h"
#include "driver/gpio.h"
#include "esp_log.h"
#include "freertos/FreeRTOS.h"
#include "freertos/task.h"

#if LED_IS_RGB
#include "led_strip.h"
static led_strip_handle_t strip;
#endif

static volatile led_state_t current = LED_BOOT;

static void paint(led_state_t state, bool on, uint8_t breath) {
    uint8_t r = 0, g = 0, b = 0;
    switch (state) {
    case LED_STANDBY: break;
    case LED_LISTENING: g = LED_BRIGHTNESS; break;
    case LED_THINKING: b = on ? LED_BRIGHTNESS : LED_BRIGHTNESS / 8; break;
    case LED_SPEAKING: b = LED_BRIGHTNESS; break;
    case LED_ERROR: r = LED_BRIGHTNESS; break;
    case LED_BOOT: r = LED_BRIGHTNESS; g = LED_BRIGHTNESS / 3; break;
    case LED_SETUP: r = breath; b = breath; break;
    case LED_KEY: r = LED_BRIGHTNESS; b = LED_BRIGHTNESS; break;
    case LED_IDENTIFY: r = LED_BRIGHTNESS; g = LED_BRIGHTNESS; b = LED_BRIGHTNESS; break;
    }
#if LED_IS_RGB
    if (!strip) return;
    led_strip_set_pixel(strip, 0, r, g, b);
    led_strip_refresh(strip);
#else
    gpio_set_level(LED_PIN, (r || g || b) ? 1 : 0);
#endif
}

static void blink_task(void *arg) {
    (void)arg;
    bool on = false;
    int breath = 0;
    int step = 4;
    for (;;) {
        led_state_t state = current;
        on = (state == LED_THINKING) ? !on : true;
        breath += step;
        if (breath >= LED_BRIGHTNESS) {
            breath = LED_BRIGHTNESS;
            step = -4;
        } else if (breath <= 2) {
            breath = 2;
            step = 4;
        }
        paint(state, on, (uint8_t)breath);
        vTaskDelay(pdMS_TO_TICKS(state == LED_THINKING ? 250 : 80));
    }
}

void led_init(void) {
#if LED_IS_RGB
    led_strip_config_t strip_config = {
        .strip_gpio_num = LED_PIN,
        .max_leds = 1,
        .led_model = LED_MODEL_WS2812,
        .color_component_format = LED_STRIP_COLOR_COMPONENT_FMT_GRB,
        .flags = {.invert_out = false},
    };
    led_strip_rmt_config_t rmt_config = {
        .clk_src = RMT_CLK_SRC_DEFAULT,
        .resolution_hz = 10 * 1000 * 1000,
        .flags = {.with_dma = false},
    };
    if (led_strip_new_rmt_device(&strip_config, &rmt_config, &strip) != ESP_OK) {
        ESP_LOGW(SERIAL_TAG, "LED RVB introuvable sur GPIO %d (LED_PIN dans config.h)", LED_PIN);
        strip = NULL;
    }
#else
    gpio_config_t io = {
        .pin_bit_mask = 1ULL << LED_PIN,
        .mode = GPIO_MODE_OUTPUT,
    };
    gpio_config(&io);
#endif
    xTaskCreate(blink_task, "led", 2048, NULL, 1, NULL);
}

void led_set(led_state_t state) {
    current = state;
    paint(state, true, LED_BRIGHTNESS);
}
