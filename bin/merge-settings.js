#!/usr/bin/env node
/**
 * merge-settings.js — idempotent installer/uninstaller for the
 * context-engineer hook entries in a Claude Code settings.json.
 *
 * Usage:
 *   node bin/merge-settings.js install   <REPO_ABS> [settingsPath]
 *   node bin/merge-settings.js uninstall <REPO_ABS> [settingsPath]
 *
 * - settingsPath defaults to ~/.claude/settings.json (created if missing).
 * - Our entries are identified by their stable hookId token (NOT by path), so
 *   re-installing from a new location cleanly replaces the old wiring and
 *   uninstall removes ours without disturbing other hooks.
 * - A timestamped backup of the prior settings.json is written next to it.
 *
 * No external dependencies — Node builtins only (Claude Code ships Node).
 */

'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');

// The four context-engineer hooks. `id` is the stable token embedded in the
// command line and used to find/replace/remove our entries idempotently.
function buildEntries(repoAbs) {
  const runner = path.join(repoAbs, 'scripts', 'hooks', 'run-with-flags.js');
  const cmd = (id, rel) =>
    `node "${runner}" "${id}" "${rel}" "standard,strict"`;

  return [
    {
      event: 'PreCompact',
      matcher: '*',
      id: 'pre:compact:capture',
      hook: {
        type: 'command',
        command: cmd('pre:compact:capture', 'scripts/hooks/pre-compact-capture.js'),
      },
    },
    {
      event: 'SessionStart',
      matcher: '*',
      id: 'session:start:capture-flush',
      hook: {
        type: 'command',
        command: cmd('session:start:capture-flush', 'scripts/hooks/context-capture-flush.js'),
      },
    },
    {
      event: 'SessionEnd',
      matcher: '*',
      id: 'session:end:capture',
      hook: {
        type: 'command',
        command: cmd('session:end:capture', 'scripts/hooks/session-end-capture.js'),
        timeout: 10,
        async: true,
      },
    },
    {
      event: 'PostToolUse',
      matcher: 'Bash',
      id: 'post:bash:auto-context-engineer',
      hook: {
        type: 'command',
        command: cmd('post:bash:auto-context-engineer', 'scripts/hooks/auto-context-engineer.js'),
        asyncRewake: true,
        rewakeMessage: 'AutoContextEngineer: ',
        rewakeSummary: '🧠 AutoContextEngineer: task complete detected',
      },
    },
  ];
}

const ALL_IDS = [
  'pre:compact:capture',
  'session:start:capture-flush',
  'session:end:capture',
  'post:bash:auto-context-engineer',
];

function defaultSettingsPath() {
  return path.join(os.homedir(), '.claude', 'settings.json');
}

function readSettings(p) {
  try {
    const txt = fs.readFileSync(p, 'utf8');
    const parsed = JSON.parse(txt);
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

function backup(p) {
  if (!fs.existsSync(p)) return null;
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const dest = `${p}.bak.${stamp}`;
  fs.copyFileSync(p, dest);
  return dest;
}

// Does this command string belong to one of our hooks?
function isOurCommand(command) {
  const c = String(command || '');
  return ALL_IDS.some((id) => c.includes(`"${id}"`));
}

// Remove every context-engineer hook entry from a settings object (in place).
// Returns the number of hook commands removed.
function stripOurs(settings) {
  let removed = 0;
  const hooks = settings.hooks;
  if (!hooks || typeof hooks !== 'object') return 0;

  for (const event of Object.keys(hooks)) {
    const matchers = Array.isArray(hooks[event]) ? hooks[event] : [];
    const keptMatchers = [];
    for (const m of matchers) {
      const inner = Array.isArray(m && m.hooks) ? m.hooks : [];
      const keptInner = inner.filter((h) => {
        const ours = isOurCommand(h && h.command);
        if (ours) removed += 1;
        return !ours;
      });
      // Drop a matcher group only if it became empty AND we emptied it.
      if (keptInner.length > 0) {
        keptMatchers.push({ ...m, hooks: keptInner });
      } else if (inner.length > 0 && keptInner.length === 0) {
        // was non-empty, now empty because all were ours → drop the group
      } else {
        keptMatchers.push(m);
      }
    }
    if (keptMatchers.length > 0) {
      hooks[event] = keptMatchers;
    } else {
      delete hooks[event];
    }
  }
  if (Object.keys(hooks).length === 0) delete settings.hooks;
  return removed;
}

// Insert our entries, reusing an existing matcher group for the event+matcher
// when present (so we sit alongside, not on top of, other hooks).
function addOurs(settings, repoAbs) {
  if (!settings.hooks || typeof settings.hooks !== 'object') settings.hooks = {};
  const hooks = settings.hooks;

  for (const entry of buildEntries(repoAbs)) {
    if (!Array.isArray(hooks[entry.event])) hooks[entry.event] = [];
    const groups = hooks[entry.event];
    let group = groups.find((g) => (g && g.matcher) === entry.matcher);
    if (!group) {
      group = { matcher: entry.matcher, hooks: [] };
      groups.push(group);
    }
    if (!Array.isArray(group.hooks)) group.hooks = [];
    group.hooks.push(entry.hook);
  }
}

function main() {
  const [, , action, repoArg, settingsArg] = process.argv;
  if (action !== 'install' && action !== 'uninstall') {
    process.stderr.write('usage: merge-settings.js <install|uninstall> <REPO_ABS> [settingsPath]\n');
    process.exit(2);
  }
  const repoAbs = repoArg ? path.resolve(repoArg) : process.cwd();
  const settingsPath = settingsArg ? path.resolve(settingsArg) : defaultSettingsPath();

  fs.mkdirSync(path.dirname(settingsPath), { recursive: true });
  const settings = readSettings(settingsPath);
  const backupPath = backup(settingsPath);

  // Always strip first → idempotent (re-install replaces, never duplicates).
  const removed = stripOurs(settings);
  let added = 0;
  if (action === 'install') {
    addOurs(settings, repoAbs);
    added = ALL_IDS.length;
  }

  fs.writeFileSync(settingsPath, `${JSON.stringify(settings, null, 2)}\n`);

  const verb = action === 'install' ? 'Installed' : 'Uninstalled';
  process.stdout.write(
    `${verb} context-engineer hooks → ${settingsPath}\n` +
      `  repo:    ${repoAbs}\n` +
      (backupPath ? `  backup:  ${backupPath}\n` : '  backup:  (none — settings.json did not exist)\n') +
      `  removed: ${removed} prior entr${removed === 1 ? 'y' : 'ies'}\n` +
      `  added:   ${added} entr${added === 1 ? 'y' : 'ies'}\n`,
  );
}

main();
