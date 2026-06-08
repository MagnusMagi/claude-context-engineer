# claude-context-engineer

Automatic, **silent** context-engineering for [Claude Code](https://claude.com/claude-code).

Hook-triggered memory writes: before context is lost (compaction, session end,
or right after a commit/push/deploy), the agent is instructed to dump that
session's **decisions / learnings / changed files** into per-project memory at
`~/.claude/projects/<cwd-slug>/memory/` and update its `MEMORY.md` index — no
prompt, no interruption to your main flow.

This is a self-contained, server-installable extraction of the ECC
"context-engineer" subsystem. It carries the **exact ECC behavior** (hook
profiles via `run-with-flags.js`, `asyncRewake` instant capture) but lives in
one repo you can clone anywhere — the hooks resolve their own paths and write
only into `~/.claude`.

---

## What it does

| Moment | Hook | Event | Mechanism |
|---|---|---|---|
| `git commit` / `git push main\|master` / `vercel --prod` succeeds | `auto-context-engineer.js` | PostToolUse (Bash) | `asyncRewake` → agent writes memory immediately |
| Just before `/compact` | `pre-compact-capture.js` | PreCompact | enqueue → flushed at next SessionStart¹ |
| Session ends | `session-end-capture.js` | SessionEnd | enqueue → flushed at next SessionStart |
| Session starts | `context-capture-flush.js` | SessionStart | drains the queue via `additionalContext` |

All four share one guard-railed instruction builder (`scripts/lib/context-engineer.js` →
`buildCapturePrompt()`) which **forbids writing secrets/PII** and tells the agent
to skip trivial changes.

¹ PreCompact cannot inject `additionalContext` (harness schema), so it relies on
the deferred queue rather than writing inline.

## Requirements

- Claude Code installed (provides the hooks runtime + Node.js).
- Node ≥ 18 on `PATH`.
- `asyncRewake` (the instant commit/push/deploy trigger) is an ECC-harness
  feature. On a vanilla Claude Code without it, the other three paths still work
  — captures just land at the **next session start** instead of instantly.

## Install

```bash
git clone <your-server-remote> claude-context-engineer
cd claude-context-engineer
./install.sh
```

`install.sh` merges four hook entries into `~/.claude/settings.json`
(idempotently — re-running replaces, never duplicates) and writes a timestamped
backup first. Restart Claude Code (or open a new session) to load them.

Custom settings location:

```bash
CLAUDE_SETTINGS=/etc/claude/settings.json ./install.sh
```

Verify:

```bash
node bin/doctor.js          # checks files, wiring, kill-switch, queue
```

## Uninstall

```bash
./uninstall.sh              # removes only our four entries; backs up first
```

Runtime data (the queue and your project memory) is left intact.

## Controls

| Goal | Action |
|---|---|
| Kill-switch (disable all capture) | `touch ~/.claude/.auto-context-disabled` |
| Re-enable | `rm ~/.claude/.auto-context-disabled` |
| Disable everything via env | `ECC_HOOK_PROFILE=minimal` |
| Disable specific hooks | `ECC_DISABLED_HOOKS=pre:compact:capture,session:end:capture,session:start:capture-flush,post:bash:auto-context-engineer` |
| Cooldown between instant captures | 30 min (`~/.claude/.auto-context-last-trigger` mtime) |

The instant triggers share the cooldown flag, so a recent capture suppresses a
redundant one. The SessionStart flush ignores the cooldown — it always drains
deferred work.

## Layout

```
claude-context-engineer/
├── install.sh / uninstall.sh        # idempotent settings.json wiring (+ backup)
├── bin/
│   ├── merge-settings.js            # the install/uninstall JSON merger (no deps)
│   └── doctor.js                    # read-only health check
└── scripts/
    ├── hooks/
    │   ├── run-with-flags.js        # ECC hook runner (profile gate + asyncRewake)
    │   ├── auto-context-engineer.js # PostToolUse instant trigger
    │   ├── pre-compact-capture.js   # PreCompact enqueue
    │   ├── session-end-capture.js   # SessionEnd enqueue
    │   └── context-capture-flush.js # SessionStart flush
    └── lib/
        ├── context-engineer.js      # core: kill-switch, cooldown, queue, prompt builder
        └── hook-flags.js            # ECC_HOOK_PROFILE / ECC_DISABLED_HOOKS gate
```

### Runtime files (created under `~/.claude`, not in the repo)

- `~/.claude/context-engineer/queue/<cwd-slug>.json` — deferred captures (≤20 per project).
- `~/.claude/projects/<cwd-slug>/memory/` — where the agent writes `decisions_*`,
  `learnings_*`, `files_*` and the `MEMORY.md` index.
- `~/.claude/.auto-context-disabled` / `.auto-context-last-trigger` — control flags.

## How a capture is structured

Each trigger asks the agent to produce (skipping any that are trivial/empty):

1. `decisions_<task-slug>.md` — *Chosen / Alternative / Why / Impact (file:line)*.
2. `learnings_<task-slug>.md` — corrections or non-obvious confirmed preferences, with *Why* + *How to apply*.
3. `files_<task-slug>.md` — up to 10 changed `path:symbol — purpose` lines, sourced from `git diff --stat HEAD~1 HEAD`.
4. A one-line entry appended to `MEMORY.md`.

Hard constraints baked into the prompt: never write secrets/tokens/keys/PII;
suffix `-2`/`-3` on slug collisions; update an existing file rather than
duplicating its topic.

## License

MIT — see [LICENSE](LICENSE).
