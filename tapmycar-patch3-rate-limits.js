// ============================================================================
// TapMyCar — Patch 3 of 3: Rate limit framework
//
// REQUIRES: Supabase migration for rate_limits table must be run BEFORE
// this patch. The SQL is printed at the end of this script and was given
// to you separately. If the migration is not in place, the rate-limit
// helper fails OPEN (allows the request through) so legitimate users
// are never locked out due to infrastructure issues.
//
// What this patch does:
//   3.1  Creates api/_rate-limit.js — the helper module. Exposes:
//        - getClientIp(req) -> string
//        - checkRateLimit(key, max, windowSeconds) -> Promise<{ ok, retryAfter }>
//        - rateLimit(req, res, rules) -> Promise<boolean> (convenience)
//
//   3.2  Applies rate limits to seven endpoints:
//        - send-otp.js          5/min per IP   AND  3/hour per email
//        - verify-otp.js        10/min per IP
//        - save-lead.js         3/hour per IP
//        - submit-review.js     3/day per IP   AND  1/day per user_id
//        - redeem-code.js       10/min per IP
//        - proxy-call.js        5/hour per IP  AND  3/hour per tag token
//        - notify-owner.js      10/hour per IP AND  5/hour per tag_id
//
// Properties:
//   - Idempotent: re-running is a no-op
//   - Backups: every touched file copied to backup-patch3-{timestamp}/
//   - Validates JS syntax with node --check after writing
//   - Helper fails OPEN on infrastructure errors (DB query fails,
//     table missing, etc.) so signup never breaks because of rate-limit
//     plumbing.
//
// Run:
//   Move-Item "$env:USERPROFILE\Downloads\tapmycar-patch3-rate-limits.js" `
//             "C:\Users\PRAVEEN CHANDU\Documents\tapmycar\tapmycar-patch3-rate-limits.js" -Force
//   cd "C:\Users\PRAVEEN CHANDU\Documents\tapmycar"
//   node tapmycar-patch3-rate-limits.js
// ============================================================================

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const ROOT = __dirname;
const API = path.join(ROOT, 'api');

const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 16);
const BACKUP_DIR = path.join(ROOT, `backup-patch3-${ts}`);

const log = (s) => console.log(s);
const ok = (s) => console.log('  \u2713 ' + s);
const skip = (s) => console.log('  \u00b7 ' + s + ' (already applied, skipped)');
const warn = (s) => console.log('  ! ' + s);
const err = (s) => { console.error('  \u2717 ' + s); process.exit(1); };

function readFile(p) {
  if (!fs.existsSync(p)) err('File not found: ' + p);
  return fs.readFileSync(p, 'utf8');
}
function backup(file) {
  const rel = path.relative(ROOT, file);
  const dest = path.join(BACKUP_DIR, rel);
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.copyFileSync(file, dest);
}
function writeFile(p, content) {
  if (content.charCodeAt(0) === 0xFEFF) content = content.slice(1);
  fs.writeFileSync(p, content, 'utf8');
}
function validateJs(p) {
  try {
    execSync('node --check "' + p + '"', { stdio: 'pipe' });
  } catch (e) {
    err('JS syntax error in ' + p + '\n' + e.stderr.toString());
  }
}

log('');
log('TapMyCar Patch 3 of 3 \u2014 Rate limit framework');
log('Backup directory: ' + path.relative(ROOT, BACKUP_DIR));
log('');
fs.mkdirSync(BACKUP_DIR, { recursive: true });

const MARKER_RATE_LIMIT_HELPER = 'TMC_PATCH3_RATE_LIMIT_HELPER';
const MARKER_RATE_LIMIT_USE = 'TMC_PATCH3_RATE_LIMIT';

// ===========================================================================
// 3.1  Create api/_rate-limit.js
// ===========================================================================

log('3.1  Creating api/_rate-limit.js helper module');

{
  const file = path.join(API, '_rate-limit.js');
  const exists = fs.existsSync(file);
  const helperBody = `// ${MARKER_RATE_LIMIT_HELPER}
// TapMyCar — fixed-window rate limiter backed by Supabase.
//
// IMPORTANT: This helper FAILS OPEN. If the rate_limits table is missing
// or the DB query errors out, every check returns "ok: true" and the
// request proceeds. The reasoning: a broken rate-limit table should
// never lock legitimate users out of signup or contact. We're protecting
// against bots, not building a strict quota system.
//
// Usage:
//   const { rateLimit } = require('./_rate-limit');
//   const allowed = await rateLimit(req, res, [
//     { key: 'send-otp:ip:' + getClientIp(req), max: 5, windowSeconds: 60 },
//     { key: 'send-otp:email:' + email, max: 3, windowSeconds: 3600 },
//   ]);
//   if (!allowed) return; // 429 already sent

const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

function getClientIp(req) {
  // Vercel forwards the real client IP in x-forwarded-for, possibly
  // followed by proxy hops. The first IP is the real client.
  const xff = req.headers['x-forwarded-for'];
  if (xff) return String(xff).split(',')[0].trim();
  const xri = req.headers['x-real-ip'];
  if (xri) return String(xri).trim();
  if (req.socket && req.socket.remoteAddress) return req.socket.remoteAddress;
  return 'unknown';
}

// Returns { ok: bool, retryAfter: seconds, count: number }
async function checkRateLimit(key, max, windowSeconds) {
  try {
    // Read existing row
    const { data: row, error: readErr } = await supabase
      .from('rate_limits')
      .select('count, window_start, window_seconds')
      .eq('key', key)
      .maybeSingle();

    // Fail-open on DB read errors
    if (readErr) {
      // Common case: table missing. Don't spam logs.
      if (!String(readErr.message || '').toLowerCase().includes('does not exist')) {
        console.error('rate_limits read error:', readErr.message);
      }
      return { ok: true, retryAfter: 0, count: 0 };
    }

    const now = Date.now();

    if (!row) {
      // First request for this key — insert a fresh window
      const { error: insErr } = await supabase
        .from('rate_limits')
        .insert({
          key,
          count: 1,
          window_start: new Date(now).toISOString(),
          window_seconds: windowSeconds
        });
      // Race condition: someone else may have inserted concurrently.
      // Fail-open in either case.
      return { ok: true, retryAfter: 0, count: 1 };
    }

    const windowStart = new Date(row.window_start).getTime();
    const windowEnd = windowStart + (row.window_seconds || windowSeconds) * 1000;

    if (now >= windowEnd) {
      // Window expired — reset
      const { error: updErr } = await supabase
        .from('rate_limits')
        .update({
          count: 1,
          window_start: new Date(now).toISOString(),
          window_seconds: windowSeconds,
          updated_at: new Date(now).toISOString()
        })
        .eq('key', key);
      return { ok: true, retryAfter: 0, count: 1 };
    }

    // Within window — increment and check
    const newCount = (row.count || 0) + 1;

    if (newCount > max) {
      const retryAfter = Math.max(1, Math.ceil((windowEnd - now) / 1000));
      return { ok: false, retryAfter, count: newCount };
    }

    await supabase
      .from('rate_limits')
      .update({ count: newCount, updated_at: new Date(now).toISOString() })
      .eq('key', key);
    return { ok: true, retryAfter: 0, count: newCount };

  } catch (e) {
    console.error('checkRateLimit fatal:', e.message);
    return { ok: true, retryAfter: 0, count: 0 };
  }
}

// Convenience: checks a list of rules, returns true if all pass,
// or sends a 429 and returns false on first violation.
async function rateLimit(req, res, rules) {
  for (const rule of rules) {
    if (!rule.key || !rule.max || !rule.windowSeconds) continue;
    const result = await checkRateLimit(rule.key, rule.max, rule.windowSeconds);
    if (!result.ok) {
      const minutes = Math.ceil(result.retryAfter / 60);
      const human = result.retryAfter < 60
        ? result.retryAfter + ' second' + (result.retryAfter === 1 ? '' : 's')
        : minutes + ' minute' + (minutes === 1 ? '' : 's');
      res.setHeader('Retry-After', String(result.retryAfter));
      res.status(429).json({
        error: 'Too many requests. Please try again in ' + human + '.',
        retry_after_seconds: result.retryAfter
      });
      return false;
    }
  }
  return true;
}

module.exports = { getClientIp, checkRateLimit, rateLimit };
`;

  if (exists) {
    const current = readFile(file);
    if (current.includes(MARKER_RATE_LIMIT_HELPER)) {
      skip('api/_rate-limit.js (already exists with marker)');
    } else {
      backup(file);
      writeFile(file, helperBody);
      validateJs(file);
      ok('api/_rate-limit.js overwritten with rate-limit helper');
    }
  } else {
    writeFile(file, helperBody);
    validateJs(file);
    ok('api/_rate-limit.js created');
  }
}

// ===========================================================================
// 3.2  Apply rate limits to endpoints
// ===========================================================================

log('');
log('3.2  Applying rate limits to endpoints');

// Helper: find a safe line index to insert a new require statement.
// Walks lines, tracking paren balance, and finds the last line that's
// either a complete require/const statement or the closing `);` of a
// multi-line one. This avoids splitting multi-line createClient(...) calls.
function findSafeInsertionPoint(lines) {
  let lastSafeLine = -1;
  let openParens = 0;
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i].trim();
    for (const ch of l) {
      if (ch === '(') openParens++;
      else if (ch === ')') openParens--;
    }
    if (l === '' || l.startsWith('//') || l.startsWith('/*') || l.startsWith('*') || l.startsWith('\uFEFF') || l.startsWith('﻿')) continue;
    if (openParens !== 0) continue;
    if (l.endsWith(';') && (l.includes('require(') || /^const\s/.test(l))) {
      lastSafeLine = i;
      continue;
    }
    if (l === ');' || l.endsWith(');')) {
      // closing ); of a multi-line statement — check it's near a require/createClient
      let backIdx = i - 1;
      while (backIdx >= 0 && !/createClient|require/.test(lines[backIdx])) backIdx--;
      if (backIdx >= 0 && i - backIdx <= 8) {
        lastSafeLine = i;
        continue;
      }
    }
    if (lastSafeLine !== -1) break;
  }
  return lastSafeLine === -1 ? 0 : lastSafeLine;
}

// Helper: insert require + rate-limit gate after the method check
function applyRateLimitGate(file, requirePath, methodCheckPattern, ruleConstruction, label) {
  const content = readFile(file);
  if (content.includes(MARKER_RATE_LIMIT_USE)) {
    skip(label + ' (already gated)');
    return;
  }
  if (!content.includes(methodCheckPattern)) {
    warn(label + ' \u2014 method check pattern not found');
    return;
  }
  backup(file);

  const lines = content.split(/\r?\n/);
  const lastSafeLine = findSafeInsertionPoint(lines);

  const requireLine = "const { rateLimit, getClientIp } = require('" + requirePath + "');";
  if (!content.includes("require('" + requirePath + "')") && !content.includes('require("' + requirePath + '")')) {
    lines.splice(lastSafeLine + 1, 0, requireLine);
  }

  let updated = lines.join('\n');

  // Insert rate-limit gate right after method check
  const gate = `
  // ${MARKER_RATE_LIMIT_USE}
  ${ruleConstruction}
  if (!await rateLimit(req, res, _tmcRateRules)) return;
`;
  updated = updated.replace(methodCheckPattern, methodCheckPattern + '\n' + gate);

  writeFile(file, updated);
  validateJs(file);
  ok(label);
}

// --- send-otp.js: 5/min per IP, 3/hour per email ---
{
  const file = path.join(API, 'send-otp.js');
  const content = readFile(file);
  if (content.includes(MARKER_RATE_LIMIT_USE)) {
    skip('send-otp.js (already gated)');
  } else {
    // send-otp has two flow paths (email and phone). We rate-limit both
    // by IP, plus add a per-email limit inside the email branch.
    backup(file);

    const lines = content.split(/\r?\n/);
    const lastSafeLine = findSafeInsertionPoint(lines);
    lines.splice(lastSafeLine + 1, 0, "const { rateLimit, getClientIp } = require('./_rate-limit');");
    let updated = lines.join('\n');

    // Insert IP gate right after the method check
    const gate = `
  // ${MARKER_RATE_LIMIT_USE} (IP gate, applies to both email and phone OTP)
  const _tmcIp = getClientIp(req);
  if (!await rateLimit(req, res, [
    { key: 'send-otp:ip:' + _tmcIp, max: 5, windowSeconds: 60 }
  ])) return;
`;
    updated = updated.replace(
      "if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });",
      "if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });\n" + gate
    );

    // Insert per-email gate after the email validation check
    const emailGate = `
    // ${MARKER_RATE_LIMIT_USE} (per-email limit)
    if (!await rateLimit(req, res, [
      { key: 'send-otp:email:' + email.toLowerCase(), max: 3, windowSeconds: 3600 }
    ])) return;
`;
    const emailValidationLine = "if (!isValidEmail(email)) {\n      return res.status(400).json({ error: 'Please enter a valid email address.' });\n    }";
    if (updated.includes(emailValidationLine)) {
      updated = updated.replace(emailValidationLine, emailValidationLine + '\n' + emailGate);
    }

    writeFile(file, updated);
    validateJs(file);
    ok('send-otp.js: 5/min per IP + 3/hour per email');
  }
}

// --- verify-otp.js: 10/min per IP ---
applyRateLimitGate(
  path.join(API, 'verify-otp.js'),
  './_rate-limit',
  "if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });",
  `const _tmcIp = getClientIp(req);
  const _tmcRateRules = [
    { key: 'verify-otp:ip:' + _tmcIp, max: 10, windowSeconds: 60 }
  ];`,
  'verify-otp.js: 10/min per IP'
);

// --- save-lead.js: 3/hour per IP ---
applyRateLimitGate(
  path.join(API, 'save-lead.js'),
  './_rate-limit',
  'if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });',
  `const _tmcIp = getClientIp(req);
  const _tmcRateRules = [
    { key: 'save-lead:ip:' + _tmcIp, max: 3, windowSeconds: 3600 }
  ];`,
  'save-lead.js: 3/hour per IP'
);

// --- submit-review.js: 3/day per IP, 1/day per user_id ---
{
  const file = path.join(API, 'submit-review.js');
  const content = readFile(file);
  if (content.includes(MARKER_RATE_LIMIT_USE)) {
    skip('submit-review.js (already gated)');
  } else {
    backup(file);
    const lines = content.split(/\r?\n/);
    const lastSafeLine = findSafeInsertionPoint(lines);
    lines.splice(lastSafeLine + 1, 0, "const { rateLimit, getClientIp } = require('./_rate-limit');");
    let updated = lines.join('\n');

    // IP gate after method check
    const gate1 = `
  // ${MARKER_RATE_LIMIT_USE} (IP gate, applied first)
  const _tmcIp = getClientIp(req);
  if (!await rateLimit(req, res, [
    { key: 'submit-review:ip:' + _tmcIp, max: 3, windowSeconds: 86400 }
  ])) return;
`;
    updated = updated.replace(
      "if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });",
      "if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });\n" + gate1
    );

    // Per-user gate after user_id check
    const gate2 = `
  // ${MARKER_RATE_LIMIT_USE} (per-user limit)
  if (!await rateLimit(req, res, [
    { key: 'submit-review:user:' + user_id, max: 1, windowSeconds: 86400 }
  ])) return;
`;
    const userIdCheck = "if (!user_id) return res.status(400).json({ error: 'user_id required' });";
    if (updated.includes(userIdCheck)) {
      updated = updated.replace(userIdCheck, userIdCheck + '\n' + gate2);
    }

    writeFile(file, updated);
    validateJs(file);
    ok('submit-review.js: 3/day per IP + 1/day per user_id');
  }
}

// --- redeem-code.js: 10/min per IP ---
applyRateLimitGate(
  path.join(API, 'redeem-code.js'),
  './_rate-limit',
  "if (req.method !== 'POST') {\n    return res.status(405).json({ error: 'Method not allowed' });\n  }",
  `const _tmcIp = getClientIp(req);
  const _tmcRateRules = [
    { key: 'redeem-code:ip:' + _tmcIp, max: 10, windowSeconds: 60 }
  ];`,
  'redeem-code.js: 10/min per IP'
);

// --- proxy-call.js: 5/hour per IP, 3/hour per token ---
{
  const file = path.join(API, 'proxy-call.js');
  const content = readFile(file);
  if (content.includes(MARKER_RATE_LIMIT_USE)) {
    skip('proxy-call.js (already gated)');
  } else {
    backup(file);
    const lines = content.split(/\r?\n/);
    const lastSafeLine = findSafeInsertionPoint(lines);
    lines.splice(lastSafeLine + 1, 0, "const { rateLimit, getClientIp } = require('./_rate-limit');");
    let updated = lines.join('\n');

    const gate1 = `
  // ${MARKER_RATE_LIMIT_USE} (IP gate)
  const _tmcIp = getClientIp(req);
  if (!await rateLimit(req, res, [
    { key: 'proxy-call:ip:' + _tmcIp, max: 5, windowSeconds: 3600 }
  ])) return;
`;
    updated = updated.replace(
      "if (req.method !== 'POST') {\n    return res.status(405).json({ error: 'Method not allowed' });\n  }",
      "if (req.method !== 'POST') {\n    return res.status(405).json({ error: 'Method not allowed' });\n  }\n" + gate1
    );

    // Per-token gate after the token validation
    const gate2 = `
  // ${MARKER_RATE_LIMIT_USE} (per-token limit)
  if (!await rateLimit(req, res, [
    { key: 'proxy-call:token:' + token, max: 3, windowSeconds: 3600 }
  ])) return;
`;
    const tokenCheck = "if (!token || !caller_number) {\n    return res.status(400).json({ error: 'token and caller_number required' });\n  }";
    if (updated.includes(tokenCheck)) {
      updated = updated.replace(tokenCheck, tokenCheck + '\n' + gate2);
    }

    writeFile(file, updated);
    validateJs(file);
    ok('proxy-call.js: 5/hour per IP + 3/hour per token');
  }
}

// --- notify-owner.js: 10/hour per IP, 5/hour per tag_id ---
{
  const file = path.join(API, 'notify-owner.js');
  const content = readFile(file);
  if (content.includes(MARKER_RATE_LIMIT_USE)) {
    skip('notify-owner.js (already gated)');
  } else {
    backup(file);
    const lines = content.split(/\r?\n/);
    const lastSafeLine = findSafeInsertionPoint(lines);
    lines.splice(lastSafeLine + 1, 0, "const { rateLimit, getClientIp } = require('./_rate-limit');");
    let updated = lines.join('\n');

    const gate1 = `
  // ${MARKER_RATE_LIMIT_USE} (IP gate)
  const _tmcIp = getClientIp(req);
  if (!await rateLimit(req, res, [
    { key: 'notify-owner:ip:' + _tmcIp, max: 10, windowSeconds: 3600 }
  ])) return;
`;
    updated = updated.replace(
      "if (req.method !== 'POST') {\n    return res.status(405).json({ error: 'Method not allowed' });\n  }",
      "if (req.method !== 'POST') {\n    return res.status(405).json({ error: 'Method not allowed' });\n  }\n" + gate1
    );

    const gate2 = `
  // ${MARKER_RATE_LIMIT_USE} (per-tag limit)
  if (!await rateLimit(req, res, [
    { key: 'notify-owner:tag:' + tag_id, max: 5, windowSeconds: 3600 }
  ])) return;
`;
    const tagCheck = "if (!tag_id) return res.status(400).json({ error: 'tag_id required' });";
    if (updated.includes(tagCheck)) {
      updated = updated.replace(tagCheck, tagCheck + '\n' + gate2);
    }

    writeFile(file, updated);
    validateJs(file);
    ok('notify-owner.js: 10/hour per IP + 5/hour per tag_id');
  }
}

// ===========================================================================
// Done
// ===========================================================================

log('');
log('==============================================================');
log('Patch 3 complete.');
log('Backup folder: ' + path.relative(ROOT, BACKUP_DIR));
log('');
log('REMINDER: Before deploying, verify the rate_limits SQL migration');
log('was run in Supabase. The SQL is at the bottom of this output.');
log('Without the table, the helper FAILS OPEN (no protection but');
log('also no breakage).');
log('');
log('Next steps:');
log('  1. Run SQL migration in Supabase if not already done (see below)');
log('  2. git add -A');
log('  3. git commit -m "Patch 3: rate limit framework"');
log('  4. git push');
log('  5. Wait ~60 seconds for Vercel deploy.');
log('');
log('Test in fresh incognito:');
log('  - Sign up flow still works (one OTP request, type code, lands on dashboard)');
log('  - Hit /api/save-lead 4 times rapidly with curl/Postman -> 4th should be 429');
log('  - Settings: submit a review, try to submit a 2nd one same day -> 429');
log('  - Admin: leads/orders still work (admin endpoints not rate-limited)');
log('');
log('==============================================================');
log('SUPABASE MIGRATION (run in SQL editor BEFORE deploying):');
log('');
log('CREATE TABLE IF NOT EXISTS public.rate_limits (');
log('  key TEXT PRIMARY KEY,');
log('  count INTEGER DEFAULT 1 NOT NULL,');
log('  window_start TIMESTAMPTZ DEFAULT NOW() NOT NULL,');
log('  window_seconds INTEGER NOT NULL,');
log('  updated_at TIMESTAMPTZ DEFAULT NOW() NOT NULL');
log(');');
log('');
log('CREATE INDEX IF NOT EXISTS rate_limits_window_start_idx');
log('  ON public.rate_limits(window_start);');
log('==============================================================');
