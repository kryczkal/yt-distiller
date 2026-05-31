# Shared install helpers, sourced by install.sh and the yt-distiller shim.
# POSIX-ish bash (no bash-4 features) so it runs on macOS's bash 3.2 too.

HOST_NAME="com.yt_distill.host"
REPO_SLUG="kryczkal/yt-distiller"

yt_home() { printf '%s\n' "${YT_DISTILL_HOME:-$HOME/.yt-distiller}"; }

# Honor YT_DISTILL_OS for tests; otherwise detect. -> linux | macos | other
os_kind() {
  if [ -n "${YT_DISTILL_OS:-}" ]; then printf '%s\n' "$YT_DISTILL_OS"; return; fi
  case "$(uname -s)" in
    Linux)  printf 'linux\n' ;;
    Darwin) printf 'macos\n' ;;
    *)      printf 'other\n' ;;
  esac
}

# Candidate NativeMessagingHosts dirs for the OS, one per line (may contain spaces).
nmh_dirs() {
  case "$(os_kind)" in
    linux)
      printf '%s\n' \
        "$HOME/.config/BraveSoftware/Brave-Browser/NativeMessagingHosts" \
        "$HOME/.config/google-chrome/NativeMessagingHosts" \
        "$HOME/.config/chromium/NativeMessagingHosts" \
        "$HOME/.config/microsoft-edge/NativeMessagingHosts"
      ;;
    macos)
      printf '%s\n' \
        "$HOME/Library/Application Support/BraveSoftware/Brave-Browser/NativeMessagingHosts" \
        "$HOME/Library/Application Support/Google/Chrome/NativeMessagingHosts" \
        "$HOME/Library/Application Support/Chromium/NativeMessagingHosts" \
        "$HOME/Library/Application Support/Microsoft Edge/NativeMessagingHosts"
      ;;
  esac
}

# Only the dirs whose parent (the browser's profile root) exists = browser installed.
target_dirs() {
  nmh_dirs | while IFS= read -r d; do
    if [ -d "$(dirname "$d")" ]; then printf '%s\n' "$d"; fi
  done
}

manifest_json() {
  # $1 launcher path, $2 extension id
  cat <<EOF
{
  "name": "$HOST_NAME",
  "description": "YouTube Distiller native host",
  "path": "$1",
  "type": "stdio",
  "allowed_origins": ["chrome-extension://$2/"]
}
EOF
}

# yt-dlp release asset for this OS/arch (empty = no prebuilt -> rely on system).
ytdlp_asset() {
  case "$(os_kind)" in
    macos) printf 'yt-dlp_macos\n' ;;
    linux)
      case "$(uname -m)" in
        x86_64|amd64)  printf 'yt-dlp_linux\n' ;;
        aarch64|arm64) printf 'yt-dlp_linux_aarch64\n' ;;
        armv7l)        printf 'yt-dlp_linux_armv7l\n' ;;
        *)             printf '\n' ;;
      esac ;;
    *) printf '\n' ;;
  esac
}

# Ensure a usable yt-dlp. 0 = bundled binary ready; 1 = falling back to system.
# Hard-exits the process if neither a download nor a system copy is available.
fetch_ytdlp() {
  root="$1"; bin="$root/bin/yt-dlp"
  if [ -x "$bin" ] && "$bin" --version >/dev/null 2>&1; then
    echo "  yt-dlp: already bundled"; return 0
  fi
  asset="$(ytdlp_asset)"
  url="${YT_DISTILL_YTDLP_URL:-https://github.com/yt-dlp/yt-dlp/releases/latest/download/$asset}"
  if [ -n "$asset" ] || [ -n "${YT_DISTILL_YTDLP_URL:-}" ]; then
    tmp="$(mktemp "${TMPDIR:-/tmp}/ytdlp.XXXXXX")"
    if curl -fsSL -o "$tmp" "$url" 2>/dev/null && chmod +x "$tmp" && "$tmp" --version >/dev/null 2>&1; then
      mkdir -p "$root/bin"; mv "$tmp" "$bin"
      echo "  yt-dlp: downloaded -> $bin"; return 0
    fi
    rm -f "$tmp"
    echo "  yt-dlp: download failed, checking PATH..." >&2
  fi
  if command -v yt-dlp >/dev/null 2>&1; then
    echo "  yt-dlp: using system $(command -v yt-dlp)"; return 1
  fi
  echo "✗ yt-dlp unavailable: the download failed and none is on your PATH." >&2
  echo "  Install it once, then re-run: https://github.com/yt-dlp/yt-dlp#installation" >&2
  exit 1
}

write_manifests() {
  root="$1"; ext_id="$2"; launcher="$root/native-host-launcher.sh"; count=0
  while IFS= read -r dir; do
    [ -n "$dir" ] || continue
    mkdir -p "$dir"
    manifest_json "$launcher" "$ext_id" > "$dir/$HOST_NAME.json"
    echo "  host: $dir/$HOST_NAME.json"
    count=$((count + 1))
  done <<EOF
$(target_dirs)
EOF
  [ "$count" -gt 0 ] || echo "  (no Brave/Chrome/Chromium profile found — open one, then re-run)" >&2
}

install_shim() {
  root="$1"
  if [ "${NO_SHIM:-0}" = "1" ]; then echo "  shim: skipped (--no-shim)"; return 0; fi
  bindir="$HOME/.local/bin"; target="$bindir/yt-distiller"
  mkdir -p "$bindir"
  ln -sf "$root/tools/yt-distiller" "$target"
  echo "  shim: $target"
  case ":$PATH:" in
    *":$bindir:"*) : ;;
    *) printf '  NOTE: %s is not on your PATH. Add this to your shell rc:\n    export PATH="%s:$PATH"\n' "$bindir" "$bindir" ;;
  esac
}

print_plan() {
  root="$1"; ext_id="$2"
  echo "yt-distiller installer — this will (no sudo, all under your user):"
  echo
  echo "  • install location        $root"
  echo "  • download yt-dlp ->       $root/bin/yt-dlp   (NOT added to PATH; only the host runs it)"
  echo "  • npm install backend deps $root/backend"
  echo "  • register the browser host (extension id $ext_id):"
  target_dirs | while IFS= read -r d; do echo "        $d/$HOST_NAME.json"; done
  if [ "${NO_SHIM:-0}" = "1" ]; then
    echo "  • CLI shim:                skipped (--no-shim)"
  else
    echo "  • add CLI shim ->          $HOME/.local/bin/yt-distiller   (on your PATH)"
  fi
  echo
  echo "It will NOT: use sudo · write outside your home · edit your shell rc ·"
  echo "             touch ANTHROPIC_API_KEY or your Claude login."
  echo "Network: github.com (project + yt-dlp), npm registry (deps). Nothing else."
  echo
}

# Ask before mutating. Reads /dev/tty so it works under \`curl ... | sh\`.
confirm() {
  [ "${ASSUME_YES:-0}" = "1" ] && return 0
  if [ "${YT_DISTILL_NO_TTY:-0}" != "1" ] && { exec 3</dev/tty; } 2>/dev/null; then
    printf 'Proceed? [y/N] ' >/dev/tty
    IFS= read -r _ans <&3 || _ans=""
    exec 3<&- 2>/dev/null || true
    case "$_ans" in [yY]|[yY][eE][sS]) return 0 ;; *) return 1 ;; esac
  fi
  echo "No terminal available for confirmation. Re-run with --yes (or set YT_DISTILL_YES=1)." >&2
  exit 1
}

yt_doctor() {
  root="$1"; rc=0
  echo "yt-distiller doctor:"
  if command -v node >/dev/null 2>&1; then
    echo "  ✓ node $(node -p 'process.versions.node' 2>/dev/null)"
  else echo "  ✗ node not found (need ≥20)"; rc=1; fi
  if [ -x "$root/bin/yt-dlp" ] && "$root/bin/yt-dlp" --version >/dev/null 2>&1; then
    echo "  ✓ yt-dlp (bundled, $("$root/bin/yt-dlp" --version 2>/dev/null))"
  elif command -v yt-dlp >/dev/null 2>&1; then
    echo "  ✓ yt-dlp (system, $(yt-dlp --version 2>/dev/null))"
  else echo "  ✗ yt-dlp not found"; rc=1; fi
  if command -v claude >/dev/null 2>&1; then
    if [ -f "$HOME/.claude/.credentials.json" ] || [ -n "${CLAUDE_CODE_OAUTH_TOKEN:-}" ]; then
      echo "  ✓ claude CLI (logged in / token set)"
    else
      echo "  • claude CLI found — make sure you're logged into Pro/Max (run: claude)"
    fi
  else echo "  ✗ claude not found — install Claude Code and log in (Pro/Max)"; rc=1; fi
  if [ -n "${ANTHROPIC_API_KEY:-}" ]; then
    echo "  ⚠ ANTHROPIC_API_KEY is set — it bills per-token and overrides your subscription."
    echo "    The host strips it, but unset it in your shell to be safe."
  fi
  found=0
  while IFS= read -r d; do
    if [ -f "$d/$HOST_NAME.json" ]; then found=$((found + 1)); fi
  done <<EOF
$(nmh_dirs)
EOF
  if [ "$found" -gt 0 ]; then echo "  ✓ native host registered ($found browser(s))"
  else echo "  ✗ native host not registered — run the installer"; rc=1; fi
  return $rc
}

do_uninstall() {
  root="$1"; home="$(yt_home)"
  echo "yt-distiller uninstall — will remove:"
  while IFS= read -r d; do
    if [ -f "$d/$HOST_NAME.json" ]; then echo "  $d/$HOST_NAME.json"; fi
  done <<EOF
$(nmh_dirs)
EOF
  if [ -L "$HOME/.local/bin/yt-distiller" ] || [ -f "$HOME/.local/bin/yt-distiller" ]; then echo "  $HOME/.local/bin/yt-distiller"; fi
  if [ -d "$home" ]; then echo "  $home  (whole directory)"; fi
  echo
  confirm || { echo "Aborted — nothing removed."; return 1; }
  while IFS= read -r d; do rm -f "$d/$HOST_NAME.json"; done <<EOF
$(nmh_dirs)
EOF
  rm -f "$HOME/.local/bin/yt-distiller"
  if [ -d "$home" ]; then rm -rf "$home"; fi
  echo "Removed. (Also remove the unpacked extension at brave://extensions.)"
}
