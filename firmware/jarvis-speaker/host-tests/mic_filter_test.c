// Test sur PC du filtre du micro (pas besoin d'ESP32) : `./host-tests/run.sh`.
#include <math.h>
#include <stdio.h>
#include <stdlib.h>

#include "mic_filter.h"

static int failures;

#define CHECK(cond)                                                                       \
    do {                                                                                  \
        if (!(cond)) {                                                                    \
            failures++;                                                                   \
            fprintf(stderr, "  ÉCHEC %s:%d : %s\n", __FILE__, __LINE__, #cond);          \
        }                                                                                 \
    } while (0)

#define RATE 16000
#define N (RATE * 4)
#define PI 3.14159265358979323846

static double rms_last_second(const int16_t *x) {
    double s = 0;
    for (int i = N - RATE; i < N; i++) s += (double)x[i] * (double)x[i];
    return sqrt(s / RATE);
}

/* Signal : offset + dérive lente (2 Hz, ±15 000, comme mesuré) + voix (400 Hz, RMS 1 000). */
static void run(double drift_amp, double tone_hz, double tone_rms, int16_t *out) {
    mic_filter_t f;
    mic_filter_reset(&f);
    for (int i = 0; i < N; i++) {
        double t = (double)i / RATE;
        double raw = 3000.0 + drift_amp * sin(2 * PI * 2.0 * t) + tone_rms * sqrt(2.0) * sin(2 * PI * tone_hz * t);
        out[i] = mic_filter_sample(&f, (int32_t)lround(raw));
    }
}

int main(void) {
    int16_t *out = malloc(sizeof(int16_t) * N);
    if (!out) return 2;

    // 1. Offset et dérive seuls : il ne reste presque rien (le silence redevient un silence).
    run(15000.0, 400.0, 0.0, out);
    double floor_rms = rms_last_second(out);
    printf("dérive ±15000 à 2 Hz seule → RMS %.0f (seuil de parole 393)\n", floor_rms);
    CHECK(floor_rms < 60.0);

    // 2. Voix seule à 400 Hz : elle passe presque entière (perte < 1 dB).
    run(0.0, 400.0, 1000.0, out);
    double tone_rms = rms_last_second(out);
    printf("ton 400 Hz RMS 1000 → RMS %.0f\n", tone_rms);
    CHECK(tone_rms > 850.0 && tone_rms < 1050.0);

    // 3. Grave de la voix à 150 Hz (fondamentale d'une voix d'homme) : gardé à plus de 80 %.
    run(0.0, 150.0, 1000.0, out);
    double low_rms = rms_last_second(out);
    printf("ton 150 Hz RMS 1000 → RMS %.0f\n", low_rms);
    CHECK(low_rms > 800.0 && low_rms < 1000.0);

    // 4. Les deux ensemble : la voix domine, la dérive ne la cache plus.
    run(15000.0, 400.0, 1000.0, out);
    double both = rms_last_second(out);
    printf("dérive + ton 400 Hz → RMS %.0f\n", both);
    CHECK(both > 850.0 && both < 1100.0);

    // 5. Bornes : un signal au-delà de 16 bits ne déborde pas.
    mic_filter_t f;
    mic_filter_reset(&f);
    int16_t top = 0, bottom = 0;
    for (int i = 0; i < 2000; i++) {
        int16_t v = mic_filter_sample(&f, (i % 2) ? 200000 : -200000);
        if (v > top) top = v;
        if (v < bottom) bottom = v;
    }
    CHECK(top == 32767 && bottom == -32768);

    free(out);
    if (failures) {
        fprintf(stderr, "%d échec(s)\n", failures);
        return 1;
    }
    printf("mic_filter : OK\n");
    return 0;
}
