#!/usr/bin/env sh
# Compile et lance sur le PC les tests du code de la carte qui ne touche pas au matériel.
# Besoin : gcc. Ne dépend pas de PlatformIO ; `pio run` ne compile pas ce dossier.
set -eu
cd "$(dirname "$0")/.."
out="${TMPDIR:-/tmp}/jarvis-speaker-host-tests"
mkdir -p "$out"
${CC:-gcc} -std=c99 -Wall -Wextra -Werror -Wconversion -O1 -fsanitize=address,undefined -I src -I include \
  host-tests/wav_stream_test.c src/wav_stream.c -o "$out/wav_stream_test"
${CC:-gcc} -std=c99 -Wall -Wextra -Werror -Wconversion -O1 -fsanitize=address,undefined -I src -I include   host-tests/mic_filter_test.c -lm -o "$out/mic_filter_test"
"$out/mic_filter_test"
"$out/wav_stream_test"
${CC:-gcc} -std=c99 -Wall -Wextra -Werror -Wconversion -O1 -fsanitize=address,undefined -I src -I include   host-tests/mic_filter_test.c -lm -o "$out/mic_filter_test"
"$out/mic_filter_test"
${CC:-gcc} -std=c99 -Wall -Wextra -Werror -Wconversion -O1 -fsanitize=address,undefined -I src -I include \
  host-tests/display_test.c src/display_gfx.c src/display_view.c -o "$out/display_test"
"$out/display_test"
