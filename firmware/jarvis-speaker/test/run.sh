#!/bin/sh
# Compile et lance les essais C du protocole, sur le PC. Sans gcc : on s'arrête sans échec.
set -eu
cd "$(dirname "$0")/.."
if ! command -v "${CC:-gcc}" >/dev/null 2>&1; then
  echo "test:firmware ignore : gcc introuvable"
  exit 0
fi
out="${TMPDIR:-/tmp}/jarvis-speaker-prov-tests"
mkdir -p "$out"
${CC:-gcc} -std=c11 -Wall -Wextra -Werror -Wconversion -O1 -fsanitize=address,undefined \
  -I src test/test_provision_proto.c src/provision_proto.c -o "$out/provision_proto"
"$out/provision_proto"
if [ -x host-tests/run.sh ]; then
  sh host-tests/run.sh
fi
