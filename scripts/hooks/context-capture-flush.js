#!/usr/bin/env node
/**
 * Context Capture Flush
 *
 * Second SessionStart hook (the existing session-start.js is left untouched).
 * Drains the deferred-capture queue for the current project — entries left by
 * session-end-capture.js (and, as a backstop, pre-compact-capture.js) — and
 * injects a silent memory-write instruction via additionalContext so the agent
 * persists the previous session's work at the start of the new one.
 *
 * Output protocol (run-with-flags.js):
 *   - { exitCode: 0, stdout: '' }       → nothing pending; no-op
 *   - { exitCode: 0, stdout: '<json>' } → additionalContext flush instruction
 */

'use strict';

const {
  isDisabled,
  queueReadAndClear,
  memoryDirFor,
  buildCapturePrompt,
} = require('../lib/context-engineer');

module.exports = {
  run(raw) {
    if (isDisabled()) return { exitCode: 0, stdout: '' };

    const cwd = process.cwd();
    const pending = queueReadAndClear(cwd);
    if (!pending.length) return { exitCode: 0, stdout: '' };

    const memoryDir = memoryDirFor(cwd);
    const triggers = [...new Set(pending.map((p) => p && p.trigger).filter(Boolean))].join(', ');
    const lastHead = pending
      .map((p) => p && p.gitHead)
      .filter(Boolean)
      .slice(-1)[0];

    const lead =
      `Bekleyen context-engineer yakalaması var (kaynak: ${triggers || 'oturum'}; ${pending.length} olay). ` +
      `Önceki oturum(lar)da yapılan kalıcı işi ŞİMDİ sessizce memory'e yaz.` +
      (lastHead
        ? ` Son commit: ${lastHead}. \`git log --oneline -10\` ve \`git diff --stat\` ile değişeni teyit et.`
        : '');

    const instruction = `${lead}\n\n${buildCapturePrompt('sessionend', memoryDir, { compactCleanup: false })}`;
    const payload = JSON.stringify({
      hookSpecificOutput: {
        hookEventName: 'SessionStart',
        additionalContext: instruction,
      },
    });
    return { exitCode: 0, stdout: payload };
  },
};
