#!/usr/bin/env sh
# Compile et lance sur le PC les tests du code de la carte qui ne touche pas au matériel.
# Besoin : gcc. Ne dépend pas de PlatformIO ; `pio run` ne compile pas ce dossier.
set -eu
cd "$(dirname "$0")/.."
out="${TMPDIR:-/tmp}/jarvis-speaker-host-tests"
mkdir -p "$out"
${CC:-gcc} -std=c99 -Wall -Wextra -Werror -Wconversion -O1 -fsanitize=address,undefined -I src -I include \
  host-tests/wav_stream_test.c src/wav_stream.c -o "$out/wav_stream_test"
"$out/wav_stream_test"
${CC:-gcc} -std=c99 -Wall -Wextra -Werror -Wconversion -O1 -fsanitize=address,undefined -I src -I include   host-tests/mic_filter_test.c -lm -o "$out/mic_filter_test"
"$out/mic_filter_test"
${CC:-gcc} -std=c99 -Wall -Wextra -Werror -Wconversion -O1 -fsanitize=address,undefined -I src -I include \
  host-tests/display_test.c src/display_gfx.c src/display_view.c -o "$out/display_test"
"$out/display_test"
${CC:-gcc} -std=c99 -Wall -Wextra -Werror -Wconversion -O1 -fsanitize=address,undefined -I src -I include \
  host-tests/mascotte_etat_test.c src/mascotte_etat.c -o "$out/mascotte_etat_test"
"$out/mascotte_etat_test"
${CXX:-g++} -std=c++17 -Wall -Wextra -Werror -O1 -fsanitize=address,undefined -I include \
  host-tests/mascotte_dessin_test.cpp -lm -o "$out/mascotte_dessin_test"
"$out/mascotte_dessin_test"
${CC:-gcc} -std=c99 -Wall -Wextra -Werror -Wconversion -O1 -fsanitize=address,undefined -I src -I include \
  -c src/display_gfx.c -o "$out/display_gfx.o"
${CXX:-g++} -std=c++17 -Wall -Wextra -Werror -O1 -fsanitize=address,undefined -I src -I include \
  host-tests/display_mascotte_test.cpp src/display_mascotte.cpp "$out/display_gfx.o" -lm -o "$out/display_mascotte_test"
"$out/display_mascotte_test"
