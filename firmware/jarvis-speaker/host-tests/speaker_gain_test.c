// Tests du volume de sortie (speaker_gain.h), compilés sur le PC par run.sh.
#include <assert.h>
#include <stdio.h>
#include <stdlib.h>

#include "speaker_gain.h"

int main(void) {
    // Sous le genou : gain simple.
    assert(speaker_gain_sample(1000, 100) == 1000);
    assert(speaker_gain_sample(1000, 250) == 2500);
    assert(speaker_gain_sample(-1000, 250) == -2500);
    assert(speaker_gain_sample(0, 250) == 0);
    // Ancien réglage (70 %) inchangé pour un son faible.
    assert(speaker_gain_sample(1000, 70) == 700);
    // Jamais de débordement, symétrique, et toujours croissant.
    int16_t prev = speaker_gain_sample(-32768, 250);
    for (int x = -32767; x <= 32767; x++) {
        int16_t y = speaker_gain_sample((int16_t)x, 250);
        assert(y >= -32767);
        assert(y >= prev);
        assert(y == -speaker_gain_sample((int16_t)-x, 250));
        prev = y;
    }
    // Une crête pleine échelle reste sous la pleine échelle (arrondie, pas coupée).
    assert(speaker_gain_sample(32767, 250) < 32767);
    assert(speaker_gain_sample(32767, 250) > 30000);
    printf("speaker_gain_test : ok\n");
    return 0;
}
