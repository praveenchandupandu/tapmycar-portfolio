#!/usr/bin/env node
/* ============================================================================
 * claude-patch-13-review-bypass-envgate.js
 * ----------------------------------------------------------------------------
 * Puts the patch-12 reviewer login behind a Vercel env-var kill switch.
 *
 * BEFORE (patch 12): the bypass fired whenever email+code matched — always live.
 * AFTER  (this):      it fires ONLY when process.env.REVIEW_BYPASS === 'on'.
 *   - Env var unset / not 'on'  -> block is inert; the exact-match condition is
 *     never even reached; login behaves 100% normally.
 *   - You flip it on in Vercel for review, then off after approval — no code
 *     push, no redeploy, instant kill.
 *
 * Idempotent, byte-preserving (latin1 + ASCII-only edit), node --check + restore.
 * Serverless: git push redeploys. NO cap sync / rebuild.
 * ==========================================================================*/

'use strict';
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const FILE = path.join('api', 'verify-otp.js');

// the exact opening line of the patch-12 guard
const FROM = "      if (String(email).trim().toLowerCase() === _TMC_REVIEW_EMAIL &&";
// gated version: add the env check as the first condition
const TO   = "      if (process.env.REVIEW_BYPASS === 'on' &&\n          String(email).trim().toLowerCase() === _TMC_REVIEW_EMAIL &&";

const DONE_MARK = "process.env.REVIEW_BYPASS === 'on'";

function stamp() {
  const d = new Date(); const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth()+1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

console.log('claude-patch-13-review-bypass-envgate.js');
console.log('----------------------------------------');
if (!fs.existsSync(FILE)) { console.log('ABORT - ' + FILE + ' not found.'); process.exit(1); }

const original = fs.readFileSync(FILE, 'latin1');

if (original.indexOf("TMC_PATCH_REVIEW_LOGIN") === -1) {
  console.log('ABORT - patch-12 review block not found. Nothing to gate. (Is patch 12 pushed?)');
  process.exit(1);
}
if (original.indexOf(DONE_MARK) !== -1) { console.log(FILE + ': already gated by REVIEW_BYPASS (skip).'); process.exit(0); }

const idx = original.indexOf(FROM), last = original.lastIndexOf(FROM);
if (idx === -1) { console.log('ABORT - guard opening line not found (unexpected shape). No change.'); process.exit(1); }
if (idx !== last) { console.log('ABORT - guard opening line found more than once. No change.'); process.exit(1); }

const b = FILE + '.bak-' + stamp();
fs.copyFileSync(FILE, b);
try {
  const updated = original.replace(FROM, TO);
  if (updated.indexOf(DONE_MARK) === -1) throw new Error('post-edit marker missing');
  fs.writeFileSync(FILE, Buffer.from(updated, 'latin1'));
  execFileSync(process.execPath, ['--check', FILE], { stdio: 'pipe' });
  console.log(FILE + ': reviewer bypass now gated by REVIEW_BYPASS + node --check OK.');
  console.log('   (backup: ' + path.basename(b) + ')');
} catch (e) {
  fs.copyFileSync(b, FILE);
  console.log(FILE + ': FAILED -> restored (' + String(e.message || e) + ').');
  process.exit(1);
}
console.log('----------------------------------------');
console.log('Deploy: git add -A && commit && push. Then in Vercel set REVIEW_BYPASS=on for review, off after approval.');
process.exit(0);
