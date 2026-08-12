#!/usr/bin/env node
/* ============================================================================
 * claude-patch-26-contact-dial-pool-number.js
 * ----------------------------------------------------------------------------
 * The final piece of the number-pool fix.
 *
 * BEFORE: handleCall() fired register-pending-call, ignored the response, and
 *   always dialled the hardcoded main number. Every caller landed on the same
 *   line, so inbound-call.js had to guess which owner to ring from timing.
 *
 * AFTER: handleCall() reads dial_number from the response and dials THAT.
 *   Patch 24 reserves a pool number for this tag for 2 minutes, so the number
 *   the stranger dials identifies the tag exactly. No timing, no guessing.
 *
 * SECURITY (this file is public-facing, so every input is treated as hostile):
 *   - The returned number is validated against a strict E.164 allow-pattern
 *     (^\+[1-9][0-9]{7,14}$) before it is used. Anything else is rejected.
 *   - It is additionally checked against a hardcoded allow-list of YOUR five
 *     numbers. Even if the API were compromised or a response were tampered
 *     with in transit, the page cannot be made to dial an attacker's number
 *     (premium-rate fraud / vishing redirect). This is defence in depth.
 *   - Falls back to the known-good main number on ANY doubt: bad response,
 *     network error, malformed number, or a number not on the allow-list.
 *   - Response is read with a 6s timeout so a hung request cannot strand the
 *     stranger on a spinner.
 *   - No new endpoint, no new user input, no new attack surface. The page
 *     sends exactly what it sent before (the tag token it already had).
 *   - No innerHTML, no eval, no string-built DOM: the value only ever reaches
 *     window.location.href after passing both checks above.
 *
 * SCOPE: public/contact.html only.
 *   - Website: live on Vercel the moment you push. Strangers use the website,
 *     so the fix is fully live for them immediately.
 *   - App bundle: public/ also feeds the Capacitor apps, so this file WILL be
 *     picked up by your next `npx cap sync`. It does NOT force a rebuild now,
 *     and it does NOT touch your approved Play Store bundle. Fold the sync
 *     into your next planned app update.
 *
 * SAFE / IDEMPOTENT: timestamped backup, latin1 byte preservation (this file
 * has special characters), ASCII-only insertion, anchor must match exactly
 * once, HTML structure integrity checked, auto-restore on any failure,
 * re-running is a no-op.
 * ==========================================================================*/

'use strict';
const fs = require('fs');
const path = require('path');

const TARGET = path.join('public', 'contact.html');
const MARKER = 'TMC_PATCH26_POOL_DIAL';
const MAIN_NUMBER = '+18605158987';

// Your five Twilio numbers: 4 pool + the main line. Nothing else is dialable.
const ALLOWED = [
  '+18605158987', // main / fallback
  '+18603214391',
  '+18604487273',
  '+18607462665',
  '+18608544555'
];

function stamp() {
  const d = new Date();
  const p = n => String(n).padStart(2, '0');
  return d.getFullYear() + p(d.getMonth() + 1) + p(d.getDate()) + '-' +
         p(d.getHours()) + p(d.getMinutes()) + p(d.getSeconds());
}

let backup = null;
function die(msg, restore) {
  if (restore && backup) { try { fs.copyFileSync(backup, TARGET); } catch (e) {} }
  console.error('\n  ABORTED: ' + msg);
  console.error(restore ? '  ' + TARGET + ' restored from ' + backup + '\n'
                        : '  Nothing was changed.\n');
  process.exit(1);
}
function countOf(hay, needle) {
  let n = 0, i = 0;
  while ((i = hay.indexOf(needle, i)) !== -1) { n++; i += needle.length; }
  return n;
}

// ── Pre-flight ──────────────────────────────────────────────────────────────
if (!fs.existsSync(TARGET)) {
  die('Cannot find ' + TARGET + '. Run this from the tapmycar project root.');
}

const src = fs.readFileSync(TARGET, 'latin1');

if (src.indexOf(MARKER) !== -1) {
  console.log('\n  Already patched (' + MARKER + ' found in ' + TARGET + ').');
  console.log('  Nothing to do.\n');
  process.exit(0);
}

// ── Anchor: the whole current handleCall body ──────────────────────────────
const ANCHOR = [
  "async function handleCall(){",
  "  updateScanAction('call');",
  "  showFeedback();",
  "  // Register intent server-side so the inbound webhook knows which owner to ring.",
  "  try {",
  "    await fetch('/api/register-pending-call', {",
  "      method: 'POST',",
  "      headers: {'Content-Type':'application/json'},",
  "      body: JSON.stringify({ token: currentToken })",
  "    });",
  "  } catch(e) { /* don't block the dial on a network hiccup */ }",
  "  window.location.href = 'tel:+18605158987';",
  "}"
].join('\n');

const c = countOf(src, ANCHOR);
if (c !== 1) die('handleCall anchor matched ' + c + ' times (expected exactly 1) in ' + TARGET);

// ── Replacement ─────────────────────────────────────────────────────────────
const allowedJs = ALLOWED.map(n => "'" + n + "'").join(',');

const REPLACEMENT = [
  "/* " + MARKER + ": dial the pool number reserved for THIS tag. */",
  "// Only these numbers can ever be dialled. Belt and braces: even a",
  "// compromised or tampered API response cannot redirect a caller to an",
  "// attacker-controlled line (premium-rate fraud / vishing).",
  "var TMC_MAIN_NUMBER = '" + MAIN_NUMBER + "';",
  "var TMC_ALLOWED_NUMBERS = [" + allowedJs + "];",
  "function tmcSafeDialNumber(n){",
  "  if (typeof n !== 'string') return TMC_MAIN_NUMBER;",
  "  var t = n.trim();",
  "  if (!/^\\+[1-9][0-9]{7,14}$/.test(t)) return TMC_MAIN_NUMBER; // strict E.164",
  "  if (TMC_ALLOWED_NUMBERS.indexOf(t) === -1) return TMC_MAIN_NUMBER; // not ours",
  "  return t;",
  "}",
  "async function handleCall(){",
  "  updateScanAction('call');",
  "  showFeedback();",
  "  // Reserve a pool number for this tag. The number we dial identifies the",
  "  // tag exactly, so the inbound webhook never has to guess which owner.",
  "  var dial = TMC_MAIN_NUMBER;",
  "  try {",
  "    var ctrl = (typeof AbortController !== 'undefined') ? new AbortController() : null;",
  "    var timer = ctrl ? setTimeout(function(){ ctrl.abort(); }, 6000) : null;",
  "    var resp = await fetch('/api/register-pending-call', {",
  "      method: 'POST',",
  "      headers: {'Content-Type':'application/json'},",
  "      body: JSON.stringify({ token: currentToken }),",
  "      signal: ctrl ? ctrl.signal : undefined",
  "    });",
  "    if (timer) clearTimeout(timer);",
  "    if (resp && resp.ok) {",
  "      var data = await resp.json();",
  "      if (data && data.dial_number) dial = tmcSafeDialNumber(data.dial_number);",
  "    }",
  "  } catch(e) { /* don't block the dial on a network hiccup - use main line */ }",
  "  window.location.href = 'tel:' + dial;",
  "}"
].join('\n');

// ── Guard: inserted text must be pure ASCII ────────────────────────────────
// contact.html contains multi-byte characters; latin1 round-trips those
// perfectly, but new non-ASCII text would be flattened. Assert instead.
if (/[^\x00-\x7F]/.test(REPLACEMENT)) {
  die('internal error: patch tried to insert non-ASCII text.');
}

// ── Apply ───────────────────────────────────────────────────────────────────
backup = TARGET + '.tmcbak-' + stamp();
fs.copyFileSync(TARGET, backup);

const out = src.replace(ANCHOR, function () { return REPLACEMENT; });
fs.writeFileSync(TARGET, out, 'latin1');

// ── Verify ──────────────────────────────────────────────────────────────────
const chk = fs.readFileSync(TARGET, 'latin1');

// 1. Our code is present, the old hardcoded dial is gone.
const musts = [
  MARKER,
  'tmcSafeDialNumber',
  "window.location.href = 'tel:' + dial;",
  'TMC_ALLOWED_NUMBERS'
];
for (const m of musts) {
  if (chk.indexOf(m) === -1) die('verification failed: "' + m + '" not found.', true);
}
if (chk.indexOf("window.location.href = 'tel:+18605158987';") !== -1) {
  die('verification failed: old hardcoded dial still present.', true);
}

// 2. The extracted script is syntactically valid JavaScript.
try {
  const start = chk.indexOf('/* ' + MARKER);
  const end = chk.indexOf("window.location.href = 'tel:' + dial;\n}", start);
  const snippet = chk.slice(start, end + "window.location.href = 'tel:' + dial;\n}".length);
  new Function('updateScanAction', 'showFeedback', 'currentToken', 'fetch',
               'AbortController', 'setTimeout', 'clearTimeout', 'window', snippet);
} catch (e) {
  die('inserted JavaScript does not parse: ' + e.message, true);
}

// 3. HTML structure untouched: same number of script/body/html tags as before.
for (const tag of ['<script', '</script>', '<body', '</body>', '</html>']) {
  if (countOf(src, tag) !== countOf(chk, tag)) {
    die('HTML structure changed (' + tag + ' count differs).', true);
  }
}

// 4. File grew only by roughly our insertion (no truncation, no duplication).
const delta = chk.length - src.length;
if (delta < 500 || delta > 3000) {
  die('unexpected size change of ' + delta + ' bytes.', true);
}

// 5. No stray non-ASCII corruption introduced by the round-trip.
const nonAsciiBefore = (src.match(/[^\x00-\x7F]/g) || []).length;
const nonAsciiAfter  = (chk.match(/[^\x00-\x7F]/g) || []).length;
if (nonAsciiBefore !== nonAsciiAfter) {
  die('special characters changed (' + nonAsciiBefore + ' -> ' + nonAsciiAfter + ').', true);
}

console.log('\n  OK  ' + TARGET + ' patched.');
console.log('      backup: ' + backup);
console.log('');
console.log('      handleCall() now dials the pool number reserved for the tag.');
console.log('      Call routing is EXACT once this is deployed alongside patch 24.');
console.log('');
console.log('      Security: dialled number must match strict E.164 AND be one');
console.log('      of your 5 Twilio numbers, else it falls back to the main');
console.log('      line. A tampered API response cannot redirect a caller.');
console.log('      Special characters preserved (' + nonAsciiAfter + ' unchanged).');
console.log('');
console.log('      Website: live on push. App bundle: picked up at your next');
console.log('      cap sync - no rebuild forced, Play Store bundle untouched.\n');
