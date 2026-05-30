#!/usr/bin/env bash
# Launch the yt-distill backend with subscription-safe auth.
set -euo pipefail
cd "$(dirname "$0")/backend"

# Subscription auth guard: a stray ANTHROPIC_API_KEY outranks the Claude
# subscription token in the SDK's auth precedence — i.e. it would silently bill
# you per-token. Strip it so usage draws from your Pro/Max subscription.
if [ -n "${ANTHROPIC_API_KEY:-}" ]; then
  echo "⚠️  ANTHROPIC_API_KEY was set — unsetting it so usage bills to your Claude subscription, not the API."
  unset ANTHROPIC_API_KEY
fi

# Dependency checks.
command -v node   >/dev/null || { echo "❌ node not found on PATH"; exit 1; }
command -v yt-dlp >/dev/null || { echo "❌ yt-dlp not found on PATH (needed for transcripts)"; exit 1; }
command -v claude >/dev/null || echo "⚠️  'claude' CLI not found. Subscription auth needs Claude Code logged in, or set CLAUDE_CODE_OAUTH_TOKEN (run: claude setup-token)."

[ -d node_modules ] || { echo "Installing backend deps…"; npm install; }

# Optional: reuse a browser's cookies for age-gated / region-locked transcripts.
#   export YT_DISTILL_COOKIES_FROM_BROWSER=brave
# (left unset by default — cookie-less extraction is more reliable for most videos)

echo "─────────────────────────────────────────────"
echo " yt-distill backend starting"
echo " Paste the token printed below into the extension's ⚙ settings (once)."
echo "─────────────────────────────────────────────"
exec node server.js
