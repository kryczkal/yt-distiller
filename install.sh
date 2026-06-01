#!/usr/bin/env bash
# Install the yt-distiller native-messaging host (Linux + macOS).
# Prints a plan of everything it touches and asks before doing anything.
#   ./install.sh              interactive
#   ./install.sh --dry-run    print the plan and exit, touching nothing
#   ./install.sh --yes        proceed without the prompt (CI/unattended)
#   ./install.sh --no-shim    don't add the ~/.local/bin/yt-distiller shim
#   ./install.sh --with-mcp   also register the MCP server with Claude (else: prompted)
#   ./install.sh --no-mcp     don't offer the MCP server at all
set -eu
ROOT="$(cd "$(dirname "$0")" && pwd)"
. "$ROOT/tools/lib.sh"

ASSUME_YES=0; DRY_RUN=0; NO_SHIM=0; WITH_MCP=0; NO_MCP=0
for arg in "$@"; do
  case "$arg" in
    -y|--yes)   ASSUME_YES=1 ;;
    --dry-run)  DRY_RUN=1 ;;
    --no-shim)  NO_SHIM=1 ;;
    --with-mcp) WITH_MCP=1 ;;
    --no-mcp)   NO_MCP=1 ;;
    -h|--help)  echo "usage: install.sh [--yes] [--dry-run] [--no-shim] [--with-mcp|--no-mcp]"; exit 0 ;;
    *) echo "unknown flag: $arg (try --help)" >&2; exit 2 ;;
  esac
done
[ "${YT_DISTILL_YES:-0}" = "1" ] && ASSUME_YES=1
export ASSUME_YES NO_SHIM WITH_MCP NO_MCP

case "$(os_kind)" in
  linux|macos) ;;
  *) echo "Windows isn't supported yet (planned). See the README." >&2; exit 1 ;;
esac

command -v node >/dev/null 2>&1 || { echo "✗ node ≥20 is required — https://nodejs.org" >&2; exit 1; }
command -v curl >/dev/null 2>&1 || { echo "✗ curl is required" >&2; exit 1; }

EXT_ID="$(node "$ROOT/tools/ext-id.mjs")"

print_plan "$ROOT" "$EXT_ID"
if [ "$DRY_RUN" = "1" ]; then echo "(dry run — nothing changed)"; exit 0; fi
confirm || { echo "Aborted — nothing changed."; exit 1; }

echo "→ installing…"
chmod +x "$ROOT/native-host-launcher.sh" "$ROOT/tools/yt-distiller" 2>/dev/null || true
if [ ! -d "$ROOT/backend/node_modules" ]; then
  echo "  npm install (backend)…"
  ( cd "$ROOT/backend" && npm install --silent )
fi
fetch_ytdlp "$ROOT" || true
write_manifests "$ROOT" "$EXT_ID"
install_shim "$ROOT"

# MCP server — opt-in. --with-mcp registers it; --no-mcp skips silently;
# otherwise offer it interactively (default no, and --yes does NOT auto-accept).
chmod +x "$ROOT/mcp-launcher.sh" 2>/dev/null || true
if [ "$WITH_MCP" = "1" ]; then
  register_mcp "$ROOT" || true
elif [ "$NO_MCP" = "1" ]; then
  :
elif ask_yn "Also register the MCP server with Claude (use yt-distiller from Claude Code/Desktop)?"; then
  register_mcp "$ROOT" || true
fi

echo
yt_doctor "$ROOT" || true
echo
cat <<EOF
✅ Host installed. Last step (once):
   1. open  brave://extensions   → enable Developer mode
   2. "Load unpacked" → select:  $ROOT/extension
   3. verify any time:  yt-distiller doctor
EOF
