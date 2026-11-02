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
