#!/usr/bin/env node
/**
 * doctor.js — health check for a context-engineer install.
 * Verifies: node present, hook files exist, settings.json wiring, kill-switch
 * state, and queue contents. Read-only; mutates nothing.
 *
 *   node bin/doctor.js [settingsPath]
 */

'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');

const REPO = path.resolve(__dirname, '..');
const settingsPath = process.argv[2]
  ? path.resolve(process.argv[2])
  : path.join(os.homedir(), '.claude', 'settings.json');

const IDS = [
  'pre:compact:capture',
  'session:start:capture-flush',
  'session:end:capture',
  'post:bash:auto-context-engineer',
];
const FILES = [
  'scripts/hooks/run-with-flags.js',
  'scripts/hooks/pre-compact-capture.js',
  'scripts/hooks/context-capture-flush.js',
  'scripts/hooks/session-end-capture.js',
  'scripts/hooks/auto-context-engineer.js',
  'scripts/lib/context-engineer.js',
  'scripts/lib/hook-flags.js',
];

let ok = true;
const line = (good, msg) => {
  if (!good) ok = false;
  console.log(`${good ? '✓' : '✗'} ${msg}`);
};

console.log(`context-engineer doctor\n  repo:     ${REPO}\n  settings: ${settingsPath}\n`);

line(typeof process.versions.node === 'string', `node ${process.versions.node}`);

for (const f of FILES) line(fs.existsSync(path.join(REPO, f)), `file ${f}`);

let settings = {};
try {
  settings = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
} catch {
  line(false, `settings.json readable/valid JSON`);
}

const wiredIds = new Set();
const hooks = (settings && settings.hooks) || {};
for (const ev of Object.keys(hooks)) {
  for (const m of hooks[ev] || []) {
    for (const h of (m && m.hooks) || []) {
      for (const id of IDS) if (String(h.command || '').includes(`"${id}"`)) wiredIds.add(id);
    }
  }
}
for (const id of IDS) line(wiredIds.has(id), `wired ${id}`);

const killSwitch = path.join(os.homedir(), '.claude', '.auto-context-disabled');
console.log(
  fs.existsSync(killSwitch)
    ? '• kill-switch ON  (~/.claude/.auto-context-disabled present — capture disabled)'
    : '• kill-switch off (capture active)',
);

const queueDir = path.join(os.homedir(), '.claude', 'context-engineer', 'queue');
let pending = 0;
try {
  pending = fs.readdirSync(queueDir).filter((f) => f.endsWith('.json')).length;
} catch {
  /* no queue yet */
}
console.log(`• queued projects awaiting flush: ${pending}`);

console.log(`\n${ok ? '✓ healthy' : '✗ problems found (see above)'}`);
process.exit(ok ? 0 : 1);
