# Spec — Painless, cross-platform install

> Status: ready to implement · Date: 2026-05-31 · Topic: one-command install for Linux + macOS

## Goal

Collapse install to a **single command** for the Claude-Code/subscription audience: `curl … | sh` registers the native host, bundles `yt-dlp`, and leaves exactly one manual step (load the unpacked extension). Works first-try on **Linux and macOS**; Windows is refused with a clear "planned" message.

**Out of scope:** Chrome Web Store publishing, a bundled GUI/binary installer, BYO-API-key auth, non-terminal users, Windows (registry + `.cmd` launcher — deferred), a live post-install distillation smoke test.

## Why this shape

The subscription wedge needs local `claude` creds + Node, so a zero-step civilian install is architecturally impossible without losing the wedge. The realistic floor for a native-messaging app is **one command for the host + one unpacked-extension load** — that's the target. Every decision below serves "least pain *for someone who already runs Claude Code*."

## Architecture

```
INSTALL (one-time)
  curl -fsSL raw.githubusercontent.com/kryczkal/yt-distiller/main/bootstrap.sh | sh
        │
        ▼
  bootstrap.sh ── uname ─┬─ Linux/Darwin ─► download branch tarball ─► $HOME/.yt-distiller/
        │                │                                                   │
        └─ Win/other ────┴─► "not supported yet (planned)" → exit 1          ▼
                                                                      install.sh  (runs in the home)
        ┌──────────────┬──────────────────┬───────────────┬──────────────────┴───────────┐
        ▼              ▼                  ▼               ▼                                ▼
  npm i backend   fetch yt-dlp →    derive ext-id    write host manifest →        lightweight checks
   deps            home/bin          (tools/          per-OS browser dirs          (node/yt-dlp/claude
                   (else system      ext-id.mjs)      (Brave/Chrome/Chromium)       /login, API-key warn)
                   yt-dlp, else fail)                                                      │
                                                                                          ▼
                                                            print "Load unpacked → <home>/extension"
                                                            install `yt-distiller` shim (update/doctor/uninstall)

RUNTIME (per distill — unchanged)
  right-click ─► background.js ─► sidePanel ─► connectNative("com.yt_distill.host")
                                                     │
                                native-host-launcher.sh  (PATH += home/bin, /opt/homebrew/bin;
                                                     │     exports YT_DISTILL_YTDLP if bundled)
                                          backend/native-host.mjs
                                          │                     │
                                    yt-dlp (home/bin)      Claude Agent SDK (subscription)
                                          └──► transcript ──► distill ──► NDJSON ─► panel
```

## Changes

| File | Change |
|------|--------|
| `bootstrap.sh` | **NEW.** curl-target. `uname` → Linux/Darwin only (else "planned" + exit 1). Downloads the branch tarball into `$YT_DISTILL_HOME` (default `$HOME/.yt-distiller`), then execs `install.sh` there. Idempotent (overwrite). |
| `install.sh` | **REWRITE, cross-platform.** Operates on its own `ROOT`. npm-installs backend; fetches the standalone `yt-dlp` binary → `ROOT/bin` (fallback: system `yt-dlp`; else hard-fail with a one-line instruction); derives the ext-id via `tools/ext-id.mjs`; writes the host manifest into the **OS-correct** browser `NativeMessagingHosts` dirs; runs lightweight checks; prints the exact load-unpacked path; installs the `yt-distiller` CLI shim. |
| `native-host-launcher.sh` | **EDIT.** Prepend `$DIR/bin` and `/opt/homebrew/bin` (Apple-Silicon Homebrew) to `PATH`; `export YT_DISTILL_YTDLP="$DIR/bin/yt-dlp"` when the bundled binary exists. |
| `backend/lib/transcript.js` | **EDIT.** Spawn `process.env.YT_DISTILL_YTDLP || "yt-dlp"` instead of hardcoded `"yt-dlp"`; ENOENT message points at re-running the installer. |
| `tools/yt-distiller` | **NEW.** CLI shim installed to `~/.local/bin`: `update` (re-run bootstrap), `doctor` (re-run lightweight checks + report), `uninstall` (remove host manifests + home + shim), `help`. |
| `backend/server.js` | **DELETE.** Dead HTTP path. |
| `start.sh` | **DELETE.** Dead HTTP launcher. |
| `extension/util.js` | **EDIT.** Remove `DEFAULT_BACKEND`. |
| `.env.example` | **EDIT.** Drop the HTTP-only vars (`YT_DISTILL_PORT`, `YT_DISTILL_TOKEN`); keep `GEMINI_*`, model, cookies, and the `ANTHROPIC_API_KEY` warning. |
| `README.md` | **EDIT.** Install = the one-line curl; Linux + macOS (Windows planned); the single load-unpacked step; `yt-distiller update/doctor/uninstall`; remove all `start.sh`/token mentions. |
| `e2e/install-test.mjs` | **NEW (offline).** Drives `install.sh` against a temp `$HOME`; asserts correct manifest dir/contents, id match, idempotency, yt-dlp fallback, Windows refusal. |

## User-confirmed decisions

| # | Decision | Choice |
|---|----------|--------|
| 1 | Install target | **One command, Claude-Code crowd** — keep the subscription wedge |
| 2 | Platform scope | **Linux + macOS first** (shared file-based host path); Windows stubbed with a clear "planned" message |
| 3 | Extension distribution | **Keep unpacked, smooth it** — no store; mark-watched stays; installer prints the exact load path |
| 4 | Transcripts / yt-dlp | **Auto-download the standalone yt-dlp binary** into the home; **fall back to system `yt-dlp`**, else hard-fail with instructions |
| 5 | Entry point | **`curl … | sh`** — no npm publish; installs to a stable home so moving/deleting never breaks the host |
| 6 | Dead HTTP path | **Delete** `server.js`, `start.sh`, token logic, `DEFAULT_BACKEND`, HTTP-only `.env` vars |
| 7 | Auth | `claude`-login primary; `CLAUDE_CODE_OAUTH_TOKEN` documented as the headless escape hatch; BYO-key rejected |
| 8 | Install verification | **Lightweight checks only** — presence of node/yt-dlp/claude, claude-login best-effort, host manifest written, **warn if `ANTHROPIC_API_KEY` is set**; no quota-spending distill |
| 9 | Updates | **Idempotent re-run + `yt-distiller update` helper**; user reloads the unpacked extension after extension-file changes |
| 10 | yt-dlp fetch failure | **Fall back to system `yt-dlp`** on PATH; else fail with a one-line manual-install instruction |

## Technical decisions (Claude's call — 3 orthogonal options each)

**TD1 — Installer architecture.**
(a) **Pure-bash `install.sh` + thin `bootstrap.sh`, shelling out to existing node helpers** ✅ · (b) bash bootstrap → full `node install.mjs` · (c) npm package via `npx`.
**Pick (a).** The chosen entry is `curl|sh` and the scope is Linux+macOS (bash is everywhere); the only per-OS difference is *which* `NativeMessagingHosts` directory — trivial in bash. Node is reused only for the fiddly bit it already owns (`tools/ext-id.mjs`). Least indirection, nothing to publish. *(b) wins only once Windows lands (a Node installer extends to the registry cleanly) — revisit then with a separate `install.ps1`. (c) was explicitly declined (no npm).* 

**TD2 — Project delivery into the home.**
(a) **branch tarball via `curl | tar xz`** ✅ · (b) `git clone --depth 1` · (c) per-file curl.
**Pick (a).** `curl` is already required; no git dependency; overwrite-on-re-run *is* the idempotent update path the user chose. Strip the `-main` top-level dir on extract.

**TD3 — yt-dlp sourcing.** (locked by user) (a) **download standalone binary → `ROOT/bin`, fallback to PATH** ✅ · (b) pure-JS innertube · (c) require system. Standalone yt-dlp ships per-OS PyInstaller binaries (no Python). `yt-dlp` (Linux), `yt-dlp_macos` (Darwin).

**TD4 — Stable home location.**
(a) **`$HOME/.yt-distiller`, override `YT_DISTILL_HOME`** ✅ · (b) XDG `~/.local/share` + mac `~/Library/Application Support` · (c) in-place clone only.
**Pick (a).** One predictable path on both OSes; uninstall is `rm -rf ~/.yt-distiller`; an env override covers power users. Running `install.sh` from inside an existing clone uses that clone in place (dev mode) — `ROOT` = the script's own dir.

**TD5 — How the backend finds bundled yt-dlp.**
(a) **`YT_DISTILL_YTDLP` env from the launcher + PATH prepend** ✅ · (b) hardcode `ROOT/bin` in `transcript.js` · (c) PATH-only.
**Pick (a).** Explicit and testable; no absolute paths baked into JS; unset env falls through to system `yt-dlp` on PATH — which *is* the fallback behavior decision #10 requires.

## Per-OS native-messaging host directories

Detect `uname`: `Linux` → first base, `Darwin` → second. Write `com.yt_distill.host.json` into every listed dir whose **parent** exists.

| Browser | Linux | macOS |
|---|---|---|
| Brave | `~/.config/BraveSoftware/Brave-Browser/NativeMessagingHosts/` | `~/Library/Application Support/BraveSoftware/Brave-Browser/NativeMessagingHosts/` |
| Chrome | `~/.config/google-chrome/NativeMessagingHosts/` | `~/Library/Application Support/Google/Chrome/NativeMessagingHosts/` |
| Chromium | `~/.config/chromium/NativeMessagingHosts/` | `~/Library/Application Support/Chromium/NativeMessagingHosts/` |

Manifest `path` → `ROOT/native-host-launcher.sh` (absolute); `allowed_origins` → `chrome-extension://<derived-id>/`.

## The one irreducible manual step

Unpacked extensions cannot be auto-loaded from the shell (browsers block external navigation to `brave://extensions`, and `--load-extension` carries warnings). The installer therefore prints — clearly, with the exact absolute path:

```
✅ Host installed. Last step (once):
   1. open  brave://extensions   → enable Developer mode
   2. "Load unpacked" → select:  /home/<you>/.yt-distiller/extension
   3. verify any time:  yt-distiller doctor
```

After an update that changed extension files, the same page → **Reload**. `yt-distiller update` reminds them.

## Lightweight checks (decision #8) + `yt-distiller doctor`

Same routine, run at end-of-install and on demand:
- `node` ≥ 20 present; `yt-dlp` resolvable (bundled or PATH) via `--version`; `claude` on PATH.
- **`claude` login**: best-effort (PATH + known creds presence). Cannot *prove* subscription billing without a real query (smoke test declined) — say so honestly if indeterminate.
- **`ANTHROPIC_API_KEY` set** → warn loudly: it outranks the subscription token and bills per-token; the launcher strips it, but unset it in your shell.
- Host manifest present in ≥1 browser dir.
Report a compact green/red checklist; never hard-fail on a login warning (login can follow install).

## Tests

1. **Fresh Linux install** (temp `$HOME`, Brave parent present): manifest written to Brave dir; valid JSON; `path`→launcher; `allowed_origins` id == `node tools/ext-id.mjs`.
2. **macOS layout** (simulate `Darwin`): manifest lands under `~/Library/Application Support/.../NativeMessagingHosts/`, not `~/.config`.
3. **Idempotent re-run**: run twice → no duplicate/garbage, manifests still valid, bundled yt-dlp not re-downloaded if present, exit 0.
4. **yt-dlp fallback**: binary download disabled + system `yt-dlp` on PATH → install completes; `doctor` reports yt-dlp OK (via PATH); `YT_DISTILL_YTDLP` unset.
5. **yt-dlp hard-fail**: download disabled + no system yt-dlp → abort *before* declaring success, nonzero exit, one-line install instruction shown.
6. **Windows refusal**: `uname` reports `MINGW*`/`MSYS*` → "not supported yet (planned)" + exit 1; nothing written.
7. **`ANTHROPIC_API_KEY` warning**: var set → checks warn about per-token billing; install still completes.
8. **claude-not-logged-in**: best-effort detection → warning + "run `claude` / log in"; install completes (no hard-fail).
9. **`yt-distiller doctor`** on a healthy install: node/yt-dlp/claude/login/host-manifest all green, exit 0.
10. **`yt-distiller uninstall`**: removes host manifests from all browser dirs + `~/.yt-distiller` + the shim; a subsequent `connectNative` would fail (host gone).
11. **Runtime regression**: existing `e2e/native-host-test.mjs` still streams a distillation, now resolving yt-dlp via `YT_DISTILL_YTDLP`.
12. **Dead-path removal**: `server.js` + `start.sh` gone; `grep DEFAULT_BACKEND extension/` empty; extension still loads and distills.
