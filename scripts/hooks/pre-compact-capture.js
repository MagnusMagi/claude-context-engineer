#!/usr/bin/env node
/**
 * PreCompact Capture
 *
 * Second PreCompact hook (the existing pre-compact.js timestamp logger is left
 * untouched). Right before the context is summarized and discarded, this
 * enqueues a deferred-capture entry for this project so the memory write of the
 * session's decisions/learnings/files is not lost.
 *
 * NOTE: The harness schema does NOT support hookSpecificOutput.additionalContext
 * for the PreCompact event (only PreToolUse/UserPromptSubmit/PostToolUse/
 * PostToolBatch do), so this hook CANNOT inject an instruction directly. Instead
 * it relies purely on the queue: the SessionStart that fires after compaction
 * drains it via context-capture-flush.js and the agent writes the memory then.
 *
 * Guardrails (shared): kill-switch + 30 min cooldown. The cooldown is shared
 * with auto-context-engineer, so a recent deploy/push/commit capture suppresses
 * a redundant pre-compact enqueue of the same work.
 *
 * Output protocol (run-with-flags.js):
 *   - { exitCode: 0, stdout: '' } → always silent; the queue carries the work
 */

'use strict';

const {
  isDisabled,
  isCoolingDown,
  touchFlag,
  queuePush,
} = require('../lib/context-engineer');

module.exports = {
  run(raw) {
    if (isDisabled()) return { exitCode: 0, stdout: '' };
    if (isCoolingDown()) return { exitCode: 0, stdout: '' };
    if (!touchFlag()) return { exitCode: 0, stdout: '' };

    // Enqueue a deferred-capture entry. The SessionStart fired by compaction
    // drains it (context-capture-flush.js) and the agent writes memory then.
    // PreCompact cannot inject additionalContext (unsupported by the schema),
    // so the queue is the sole delivery path.
    const cwd = process.cwd();
    queuePush(cwd, { trigger: 'precompact', cwd, ts: Date.now() });

    return { exitCode: 0, stdout: '' };
  },
};
