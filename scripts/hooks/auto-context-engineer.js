#!/usr/bin/env node
/**
 * Auto Context Engineer
 *
 * PostToolUse Bash hook. When a "task complete" signal is detected
 * (vercel --prod success, git push to main/master success, or a successful
 * git commit), it queues an asyncRewake message that instructs the agent to:
 *   1. Write decisions, learnings, file refs to project memory
 *   2. Update MEMORY.md index
 *   3. Schedule a 5-minute ScheduleWakeup with /compact suggestion
 *
 * Guardrails:
 *   - 30 min cooldown (flag file mtime)
 *   - Kill switch: ~/.claude/.auto-context-disabled
 *   - Only fires when bash exit_code == 0 AND output contains success markers
 *
 * Output protocol (consumed by run-with-flags.js):
 *   - { exitCode: 0 }                → no-op (no rewake)
 *   - { exitCode: 2, stdout: "..." } → rewake message body forwarded to agent
 *
 * Settings.json hook entry must include:
 *   "asyncRewake": true,
 *   "rewakeMessage": "AutoContextEngineer: ",
 *   "rewakeSummary": "🧠 AutoContextEngineer: task complete"
 */

'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');
const { buildCapturePrompt } = require('../lib/context-engineer');

const HOME = os.homedir();
const COOLDOWN_MS = 30 * 60 * 1000;
const FLAG_PATH = path.join(HOME, '.claude', '.auto-context-last-trigger');
const KILL_SWITCH = path.join(HOME, '.claude', '.auto-context-disabled');

const TRIGGER_DEPLOY_CMD = /vercel\s+(?:[^|;&\n]*\s)?(?:--prod\b|--production\b)/i;
const TRIGGER_DEPLOY_OUT = /(?:Production|Aliased):\s*https?:\/\//i;
const TRIGGER_PUSH_CMD = /\bgit\s+push\b(?:\s+[^|;&\n]*)?(?:\s+origin)?\s+(?:main|master)\b/i;
const TRIGGER_PUSH_OUT = /(?:->|\.\.|new branch|main\s*->|master\s*->|Everything up-to-date)/i;
const TRIGGER_COMMIT_CMD = /\bgit\s+commit\b/i;
// `[branch hash] subject` line, or porcelain "N file(s) changed" summary.
const TRIGGER_COMMIT_OUT = /\[[^\]\n]+\s[0-9a-f]{7,}\]|\d+\s+files?\s+changed/i;

function detectTrigger(cmd, allOut) {
  if (TRIGGER_DEPLOY_CMD.test(cmd) && TRIGGER_DEPLOY_OUT.test(allOut)) {
    return 'deploy';
  }
  if (TRIGGER_PUSH_CMD.test(cmd) && TRIGGER_PUSH_OUT.test(allOut)) {
    return 'push';
  }
  // Push wins over commit when both appear (e.g. `git commit && git push`).
  if (TRIGGER_COMMIT_CMD.test(cmd) && TRIGGER_COMMIT_OUT.test(allOut)) {
    return 'commit';
  }
  return null;
}

function isCoolingDown() {
  try {
    const stat = fs.statSync(FLAG_PATH);
    return Date.now() - stat.mtimeMs < COOLDOWN_MS;
  } catch {
    return false;
  }
}

function isDisabled() {
  try {
    return fs.existsSync(KILL_SWITCH);
  } catch {
    return false;
  }
}

function touchFlag() {
  try {
    fs.mkdirSync(path.dirname(FLAG_PATH), { recursive: true });
    fs.writeFileSync(FLAG_PATH, '');
    return true;
  } catch {
    return false;
  }
}

function memoryDirFor(cwd) {
  // Match Claude Code project slug convention: replace / with -
  const slug = cwd.replace(/\//g, '-');
  return path.join(HOME, '.claude', 'projects', slug, 'memory');
}

module.exports = {
  run(raw) {
    let payload;
    try {
      payload = JSON.parse(raw);
    } catch {
      return { exitCode: 0 };
    }

    if (payload?.tool_name !== 'Bash') return { exitCode: 0 };

    const exit =
      payload.tool_response?.exit_code ??
      payload.tool_response?.exitCode ??
      payload.tool_output?.exit_code ??
      0;
    if (exit !== 0) return { exitCode: 0 };

    const cmd = String(payload.tool_input?.command || '');
    const stdout = String(
      payload.tool_response?.stdout ?? payload.tool_output?.output ?? '',
    );
    const stderr = String(payload.tool_response?.stderr ?? '');
    const allOut = `${stdout}\n${stderr}`;

    const trigger = detectTrigger(cmd, allOut);
    if (!trigger) return { exitCode: 0 };

    if (isDisabled()) return { exitCode: 0 };
    if (isCoolingDown()) return { exitCode: 0 };
    if (!touchFlag()) return { exitCode: 0 };

    const cwd = process.cwd();
    const memoryDir = memoryDirFor(cwd);
    try {
      fs.mkdirSync(memoryDir, { recursive: true });
    } catch {
      // best-effort; agent will fail loudly if dir missing
    }

    const prompt = buildCapturePrompt(trigger, memoryDir, { compactCleanup: true });
    return {
      exitCode: 2,
      stdout: prompt,
      stderr: `🧠 AutoContextEngineer: ${trigger} detected → memory write queued, cleanup in 5min`,
    };
  },
};
