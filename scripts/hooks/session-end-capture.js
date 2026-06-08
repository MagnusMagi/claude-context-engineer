#!/usr/bin/env node
/**
 * SessionEnd Capture
 *
 * Second SessionEnd hook (the existing session-end-marker.js is left untouched).
 * The agent is already gone at SessionEnd, so we cannot write quality memory
 * here. Instead we enqueue a deferred-capture entry for this project; the next
 * SessionStart in the same project flushes it via additionalContext, letting the
 * agent write the memory with full intelligence (see context-capture-flush.js).
 *
 * Output protocol (run-with-flags.js):
 *   - { exitCode: 0, stdout: '' } → silent no-op
 */

'use strict';

const { spawnSync } = require('child_process');
const { isDisabled, queuePush } = require('../lib/context-engineer');

function gitHead(cwd) {
  try {
    const r = spawnSync('git', ['rev-parse', '--short', 'HEAD'], {
      cwd,
      encoding: 'utf8',
      timeout: 3000,
    });
    if (r.status === 0) return String(r.stdout || '').trim() || null;
  } catch {
    // not a git repo / git unavailable
  }
  return null;
}

module.exports = {
  run(raw) {
    if (isDisabled()) return { exitCode: 0, stdout: '' };

    let payload = {};
    try {
      payload = JSON.parse(raw) || {};
    } catch {
      payload = {};
    }

    const cwd = process.cwd();
    queuePush(cwd, {
      trigger: 'sessionend',
      cwd,
      gitHead: gitHead(cwd),
      sessionId: payload.session_id || process.env.CLAUDE_SESSION_ID || null,
      transcript: payload.transcript_path || null,
      ts: Date.now(),
    });

    return { exitCode: 0, stdout: '' };
  },
};
