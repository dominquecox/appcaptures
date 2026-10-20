#!/usr/bin/env bash
# sim-capture — snag screenshots from a local iOS Simulator or Android
# emulator straight into captures/ for the studio Upload slots.
# No framework, no deps beyond Xcode (iOS) and platform-tools (Android).
#
# Usage:
#   tools/capture/sim-capture.sh ios [filename]              # booted sim (auto-boots newest iPhone)
#   tools/capture/sim-capture.sh android [serial] [filename] # adb device (defaults when exactly one)
#   tools/capture/sim-capture.sh list                        # show booted sims + adb devices
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
OUT_DIR="$ROOT/captures"
mkdir -p "$OUT_DIR"

stamp() { date +"%Y%m%d-%H%M%S"; }
usage() {
  echo "usage: sim-capture.sh ios [filename] | android [serial] [filename] | list" >&2
  exit 2
}

cmd_list() {
  echo "--- iOS simulators (booted) ---"
  if command -v xcrun >/dev/null 2>&1; then
    out=$(xcrun simctl list devices -j 2>/dev/null | python3 -c "
import json,sys
try: d=json.load(sys.stdin)['devices']
except Exception: d={}
for rt,devs in d.items():
  for x in devs:
    if x['state']=='Booted': print(x['udid'],x['name'])
" 2>/dev/null) || out=""
    if [[ -z "$out" ]]; then echo "(none booted)"; else printf '%s\n' "$out"; fi
  else
    echo "(Xcode not installed)"
  fi
  echo "--- Android (adb) ---"
  if command -v adb >/dev/null 2>&1; then
    adb devices -l 2>/dev/null | awk 'NR>1 && $2=="device"{print $1, $3, $4}' || true
  else
    echo "(platform-tools not installed — brew install android-platform-tools)"
  fi
}

cmd_ios() {
  command -v xcrun >/dev/null 2>&1 || { echo "error: Xcode not installed" >&2; exit 1; }
  local out="${1:-ios-$(stamp).png}"
  [[ "$out" != *.png ]] && out="$out.png"
  local booted
  booted=$(xcrun simctl list devices -j 2>/dev/null | python3 -c "
import json,sys
try: d=json.load(sys.stdin)['devices']
except Exception: d={}
b=[x['udid'] for devs in d.values() for x in devs if x['state']=='Booted']
print(b[0] if b else '')
" 2>/dev/null) || booted=""
  if [[ -z "$booted" ]]; then
    echo "no booted simulator — booting newest iPhone…"
    local newest
    newest=$(xcrun simctl list devices -j 2>/dev/null | python3 -c "
import json,sys
try: d=json.load(sys.stdin)['devices']
except Exception: d={}
best=''
for rt,devs in d.items():
  if 'iPhone' not in rt: continue
  for x in devs:
    if x.get('isAvailable') and x['name']>best: best=x['udid']
print(best)
" 2>/dev/null) || newest=""
    [[ -z "$newest" ]] && { echo "error: no available iPhone simulator runtime" >&2; exit 1; }
    xcrun simctl boot "$newest" 2>/dev/null || true
    xcrun simctl bootstatus "$newest" -b >/dev/null 2>&1 || true
    booted="$newest"
  fi
  xcrun simctl io "$booted" screenshot "$OUT_DIR/$out"
  echo "saved captures/$out — pick it via any Upload slot in the studio"
}

cmd_android() {
  command -v adb >/dev/null 2>&1 || { echo "error: adb not installed (brew install android-platform-tools)" >&2; exit 1; }
  local serial="" name=""
  case $# in
    1) if [[ "$1" == *.png ]]; then name="$1"; else serial="$1"; fi ;;
    2) serial="$1"; name="$2" ;;
  esac
  if [[ -z "$serial" ]]; then
    mapfile -t devs < <(adb devices 2>/dev/null | awk 'NR>1 && $2=="device"{print $1}')
    [[ "${#devs[@]}" -eq 0 ]] && { echo "error: no emulator running (open Android Studio → Device Manager → Run)" >&2; exit 1; }
    [[ "${#devs[@]}" -gt 1 ]] && { echo "error: multiple devices — pass a serial: ${devs[*]}" >&2; exit 1; }
    serial="${devs[0]}"
  fi
  local out="${name:-android-$(stamp).png}"
  [[ "$out" != *.png ]] && out="$out.png"
  adb -s "$serial" exec-out screencap -p > "$OUT_DIR/$out"
  echo "saved captures/$out — pick it via any Upload slot in the studio"
}

case "${1:-}" in
  list) cmd_list ;;
  ios) cmd_ios "${2:-}" ;;
  android) cmd_android "${2:-}" "${3:-}" ;;
  *) usage ;;
esac
