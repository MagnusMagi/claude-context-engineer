'use strict';

/**
 * Context Engineer — shared core
 *
 * Common building blocks for the automatic context-engineering hooks
 * (auto-context-engineer.js, pre-compact-capture.js, session-end-capture.js,
 * context-capture-flush.js). Centralizes the kill-switch / cooldown / memory-dir
 * conventions and the single agent instruction (`buildCapturePrompt`) so every
 * trigger produces a consistent, guard-railed memory write.
 *
 * Guardrails (shared with the original auto-context-engineer):
 *   - Kill switch:  ~/.claude/.auto-context-disabled
 *   - 30 min cooldown flag: ~/.claude/.auto-context-last-trigger
 *
 * Deferred-capture queue (SessionEnd → next SessionStart flush):
 *   ~/.claude/context-engineer/queue/<cwd-slug>.json
 */

const fs = require('fs');
const path = require('path');
const os = require('os');

const HOME = os.homedir();
const CLAUDE_DIR = path.join(HOME, '.claude');
const COOLDOWN_MS = 30 * 60 * 1000;
const FLAG_PATH = path.join(CLAUDE_DIR, '.auto-context-last-trigger');
const KILL_SWITCH = path.join(CLAUDE_DIR, '.auto-context-disabled');
const QUEUE_DIR = path.join(CLAUDE_DIR, 'context-engineer', 'queue');
const QUEUE_CAP = 20;

// Match Claude Code's project slug convention: every non-alphanumeric
// character becomes "-" (so "/Users/.../MägiBot" → "-Users-...-M-giBot").
// NOTE: a naive "/"-only replacement leaves non-ASCII letters (ä, ö, …) intact
// and writes to an orphan dir the harness never loads — must mirror the harness.
function cwdSlug(cwd) {
  return String(cwd || '').replace(/[^a-zA-Z0-9]/g, '-');
}

function memoryDirFor(cwd) {
  return path.join(CLAUDE_DIR, 'projects', cwdSlug(cwd), 'memory');
}

function isDisabled() {
  try {
    return fs.existsSync(KILL_SWITCH);
  } catch {
    return false;
  }
}

function isCoolingDown() {
  try {
    const stat = fs.statSync(FLAG_PATH);
    return Date.now() - stat.mtimeMs < COOLDOWN_MS;
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

function queuePathFor(cwd) {
  return path.join(QUEUE_DIR, `${cwdSlug(cwd)}.json`);
}

function readQueue(cwd) {
  try {
    const parsed = JSON.parse(fs.readFileSync(queuePathFor(cwd), 'utf8'));
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

// Append a deferred-capture entry for `cwd`. Best-effort; bounded to QUEUE_CAP.
function queuePush(cwd, entry) {
  try {
    fs.mkdirSync(QUEUE_DIR, { recursive: true });
    let list = readQueue(cwd);
    list.push(entry);
    if (list.length > QUEUE_CAP) list = list.slice(-QUEUE_CAP);
    fs.writeFileSync(queuePathFor(cwd), JSON.stringify(list, null, 2));
    return true;
  } catch {
    return false;
  }
}

// Read and remove all pending entries for `cwd`.
function queueReadAndClear(cwd) {
  const list = readQueue(cwd);
  try {
    fs.unlinkSync(queuePathFor(cwd));
  } catch {
    // missing file is fine
  }
  return list;
}

const TRIGGER_LABELS = {
  deploy: 'deploy başarısı',
  push: 'git push başarısı',
  commit: 'git commit başarısı',
  precompact: 'context compaction (özet öncesi)',
  sessionend: 'önceki oturum sonu',
};

/**
 * The single agent instruction shared by every trigger. Silent by design — the
 * agent writes memory without asking for confirmation. `compactCleanup` appends
 * the post-task /compact suggestion (used by the PostToolUse deploy/push/commit
 * path; omitted for precompact, which is already compacting, and for the
 * deferred sessionend flush).
 */
function buildCapturePrompt(triggerKind, memoryDir, options = {}) {
  const { compactCleanup = false } = options;
  const label = TRIGGER_LABELS[triggerKind] || triggerKind;

  const lines = [
    `Context-engineer tick (tetikleyici: ${label}). Bu adımları SESSİZCE yap; kullanıcıdan onay isteme, ana akışı bölme.`,
    '',
    `1. KARARLAR — Son task'ta alınan teknik/mimari kararları özetle:`,
    `   Dosya: ${memoryDir}/decisions_<task-slug>.md (frontmatter type: project)`,
    `   Biçim: 3-7 madde — "Seçildi: X / Alternatif: Y / Neden: trade-off / Etki: dosya:satır"`,
    `   Atla: Trivial değişiklik (typo, tek satır rename) ise yazma.`,
    '',
    `2. ÖĞRENMELER — Kullanıcının düzelttiği VEYA non-obvious onayladığı tercihler:`,
    `   Dosya: ${memoryDir}/learnings_<task-slug>.md (frontmatter type: feedback)`,
    `   Biçim: "## <Kural>\\n**Why:** ...\\n**How to apply:** ..."`,
    `   Atla: Non-obvious feedback yoksa yazma.`,
    '',
    `3. DOSYA INDEX — Değişen kritik dosya:satır listesi (max 10):`,
    `   Dosya: ${memoryDir}/files_<task-slug>.md (frontmatter type: project)`,
    `   Biçim: "- \`path:fonksiyon\` — bir cümlelik amaç"`,
    `   Kaynak: \`git diff --stat HEAD~1 HEAD\` ve son commit mesajı.`,
    '',
    `4. INDEX — ${memoryDir}/MEMORY.md'ye her oluşturulan dosya için 1 satır ekle:`,
    `   "- [Title](filename.md) — one-line hook"`,
  ];

  if (compactCleanup) {
    lines.push(
      '',
      `5. CLEANUP — Yukarıdaki adımlar bittikten sonra ScheduleWakeup tool'unu tek seferlik çağır:`,
      `   delaySeconds: 300`,
      `   reason: "auto-context-engineer post-task compact suggestion"`,
      `   prompt: "[AUTO-CONTEXT-ENGINEER follow-up] Memory yazıldı. Context'i temizlemek için /compact öner."`,
    );
  }

  lines.push(
    '',
    `KISITLAR:`,
    `- Asla secret/token/API key/JWT/OAuth/parola değeri yazma.`,
    `- Asla email/telefon/PII yazma.`,
    `- Aynı task-slug'lı dosya varsa "-2", "-3" suffix ekle.`,
    `- Mevcut bir memory dosyası aynı konuyu kapsıyorsa kopya oluşturma, onu güncelle.`,
    '',
  );

  if (compactCleanup) {
    lines.push(
      `Trivial task'ta 1-4'ü atla ama 5'i (ScheduleWakeup) yine de yap; sonra tek satır: "🧠 Trivial — memory'e yazılacak kalıcı bilgi yok, cleanup zamanlandı."`,
    );
  } else {
    lines.push(
      `Trivial task'ta hiçbir dosya yazma; tek satır: "🧠 Trivial — memory'e yazılacak kalıcı bilgi yok."`,
    );
  }

  lines.push(
    `RAPOR (bittiğinde tek satır): "🧠 Memory güncellendi: <oluşturulan/güncellenen dosyalar virgülle>"`,
  );

  return lines.join('\n');
}

module.exports = {
  CLAUDE_DIR,
  KILL_SWITCH,
  FLAG_PATH,
  COOLDOWN_MS,
  cwdSlug,
  memoryDirFor,
  isDisabled,
  isCoolingDown,
  touchFlag,
  queuePathFor,
  queuePush,
  queueReadAndClear,
  buildCapturePrompt,
};
