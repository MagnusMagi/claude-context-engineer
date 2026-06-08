#!/usr/bin/env bash
#
# uninstall.sh — remove the context-engineer hooks from Claude Code settings.
# Leaves all other hooks untouched. Writes a backup first.
#
# Usage:
#   ./uninstall.sh
#   CLAUDE_SETTINGS=/path/settings.json ./uninstall.sh
#
set -euo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SETTINGS="${CLAUDE_SETTINGS:-$HOME/.claude/settings.json}"

if ! command -v node >/dev/null 2>&1; then
  echo "✗ node not found on PATH." >&2
  exit 1
fi

node "$REPO/bin/merge-settings.js" uninstall "$REPO" "$SETTINGS"
echo
echo "✓ context-engineer hooks removed. Restart Claude Code to apply."
echo "  (Runtime data under ~/.claude/context-engineer/queue and project memory is left intact.)"
