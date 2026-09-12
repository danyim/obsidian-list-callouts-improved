#!/usr/bin/env bash
#
# Runs the given command under a virtual display with a window manager,
# matching what CI's "Set up virtual graphics" step does. A bare Xvfb has no
# window manager to size or maximize windows, so Obsidian's Electron window
# opens at some undersized default -- fine for tests that don't care about
# window size, but it silently breaks anything that measures rendered content
# against the viewport (see npm run screenshots).
#
# No-ops if DISPLAY is already set, so this is safe to wrap around a command
# that already has a real display (a desktop session) or an existing virtual
# one (CI sets DISPLAY itself before calling into npm scripts).
set -euo pipefail

# Only Linux needs a virtual display; macOS and Windows runners have a real
# (or already-virtualized) one.
if [ -n "${DISPLAY:-}" ] || [ "$(uname -s)" != "Linux" ]; then
  exec "$@"
fi

for bin in Xvfb herbstluftwm; do
  if ! command -v "$bin" >/dev/null 2>&1; then
    echo "xvfb-wm.sh: '$bin' not found. Install it with:" >&2
    echo "  sudo apt-get install xvfb herbstluftwm" >&2
    exit 1
  fi
done

DISPLAY_NUM=$(( (RANDOM % 89) + 10 ))
export DISPLAY=":$DISPLAY_NUM"

Xvfb "$DISPLAY" -screen 0 1280x1024x24 +extension GLX -noreset &
xvfb_pid=$!

wm_pid=""
cleanup() {
  [ -n "$wm_pid" ] && kill "$wm_pid" 2>/dev/null || true
  kill "$xvfb_pid" 2>/dev/null || true
}
trap cleanup EXIT

sleep 1
herbstluftwm &
wm_pid=$!
sleep 1

"$@"
