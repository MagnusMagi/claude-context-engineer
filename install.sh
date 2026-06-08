#!/usr/bin/env bash
#
# install.sh — wire the context-engineer hooks into Claude Code.
#
# Idempotent: safe to re-run (replaces prior wiring, never duplicates).
# Writes a timestamped backup of settings.json before touching it.
#
# Usage:
#   ./install.sh                      # target ~/.claude/settings.json
#   CLAUDE_SETTINGS=/path/settings.json ./install.sh   # custom target
#
set -euo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SETTINGS="${CLAUDE_SETTINGS:-$HOME/.claude/settings.json}"

if ! command -v node >/dev/null 2>&1; then
  echo "✗ node not found on PATH — Claude Code requires Node; install it first." >&2
  exit 1
fi

echo "Installing context-engineer from: $REPO"
node "$REPO/bin/merge-settings.js" install "$REPO" "$SETTINGS"

cat <<EOF

✓ Done. The four hooks are wired:
    PreCompact     → pre-compact-capture
    SessionStart   → context-capture-flush
    SessionEnd     → session-end-capture
    PostToolUse    → auto-context-engineer (asyncRewake)

Restart Claude Code (or start a new session) for the hooks to load.

Controls:
  touch ~/.claude/.auto-context-disabled   # kill-switch (off)
  rm    ~/.claude/.auto-context-disabled    # re-enable
  ECC_HOOK_PROFILE=minimal                  # disable all (env)
  ./uninstall.sh                            # remove wiring
EOF
