#!/usr/bin/env sh
# One-line installer target:
#   curl -fsSL https://raw.githubusercontent.com/kryczkal/yt-distiller/main/bootstrap.sh | sh
# Downloads the project into a stable home, then runs the (consent-gated) installer.
# Flags pass straight through:  ... | sh -s -- --dry-run | --yes | --no-shim
set -eu

case "$(uname -s)" in
  Linux|Darwin) ;;
  *) echo "Windows isn't supported yet (planned). See https://github.com/kryczkal/yt-distiller" >&2; exit 1 ;;
esac

command -v curl >/dev/null 2>&1 || { echo "curl is required" >&2; exit 1; }
command -v tar  >/dev/null 2>&1 || { echo "tar is required"  >&2; exit 1; }

HOME_DIR="${YT_DISTILL_HOME:-$HOME/.yt-distiller}"
REPO="kryczkal/yt-distiller"
BRANCH="main"

echo "Downloading yt-distiller → $HOME_DIR …"
mkdir -p "$HOME_DIR"
curl -fsSL "https://github.com/$REPO/archive/refs/heads/$BRANCH.tar.gz" \
  | tar xz -C "$HOME_DIR" --strip-components=1

chmod +x "$HOME_DIR/install.sh" "$HOME_DIR/native-host-launcher.sh" "$HOME_DIR/tools/yt-distiller" 2>/dev/null || true
exec "$HOME_DIR/install.sh" "$@"
