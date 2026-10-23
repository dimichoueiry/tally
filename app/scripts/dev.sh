#!/bin/zsh
# Runs Tally from the terminal with the stdin dev-control channel.
# Usage: scripts/dev.sh < commands.txt   (or pipe commands in; see src/main/index.js devControl)
cd "$(dirname "$0")/.."
TALLY_DEV_CONTROL=1 exec ./node_modules/.bin/electron . "$@"
