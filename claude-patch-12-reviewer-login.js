#!/usr/bin/env node
/* ============================================================================
 * claude-patch-12-reviewer-login.js
 * ----------------------------------------------------------------------------
 * Adds a FIXED-CODE demo login for Google Play review only, in api/verify-otp.js.
 *
 * A guarded early-return is inserted at the very top of the EMAIL branch. It
 * fires ONLY when:
 *     email === 'review@tapmycar.io'  AND  code === '284619'
 * Any other email — or that email with any other code — skips the block and
 * runs your normal OTP flow completely unchanged. Real users, phone OTP,
 * lockouts, everything else: untouched.
 *
 * The demo account is created on first login (and gets a free eTag so the
 * dashboard has something to show). Returns the same session shape as a normal
 * login. Safe to remove after the app is approved.
 *
 * SERVERLESS: git push redeploys. NO cap sync / rebuild — the already-built AAB
 * calls this live endpoint, so the reviewer login works without a new bundle.
 *
 * SAFE: preserves every existing byte (latin1 round-trip, ASCII-only insert),
 * idempotent (skips if already applied), anchor must match exactly once,
 * node --check with auto-restore on failure.
 * ==========================================================================*/

'use strict';
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const FILE = path.join('api', 'verify-otp.js');
const MARKER = 'TMC_PATCH_REVIEW_LOGIN';
const ANCHOR = "if (!email || !code) return res.status(400).json({ error: 'Email and code required' });";

const BLOCK = [
  "",
  "",
  "    /* TMC_PATCH_REVIEW_LOGIN: fixed-code demo login for app-store review ONLY.",
  "       Fires only for the exact review email AND the exact review code below.",
  "       Any other email - or this email with any other code - falls straight",
  "       through to the normal OTP flow untouched. Remove after approval. */",
  "    {",
  "      const _TMC_REVIEW_EMAIL = 'review@tapmycar.io';",
  "      const _TMC_REVIEW_CODE  = '284619';",
  "      if (String(email).trim().toLowerCase() === _TMC_REVIEW_EMAIL &&",
  "          String(code).trim() === _TMC_REVIEW_CODE) {",
  "        let { data: rUser } = await supabase.from('users').select('*').eq('email', _TMC_REVIEW_EMAIL).single();",
  "        let rNew = false;",
  "        if (!rUser) {",
  "          const { data: created } = await supabase.from('users')",
  "            .insert({ email: _TMC_REVIEW_EMAIL, name: 'App Reviewer' })",
  "            .select().single();",
  "          rUser = created;",
  "          rNew = true;",
  "        }",
  "        if (rNew && rUser) { try { await assignFreeTag(rUser.id); } catch (e) {} }",
  "        if (!rUser) return res.status(500).json({ error: 'Account error. Please try again.' });",
  "        return res.json({",
  "          token: rUser.id,",
  "          session_token: _tmcSafeSign(rUser.id),",
  "          name: rUser.name,",
  "          email: rUser.email,",
  "          phone: rUser.phone || '',",
  "          isNewUser: rNew",
  "        });",
  "      }",
  "    }"
].join('\n');

function stamp() {
  const d = new Date(); const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth()+1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

console.log('claude-patch-12-reviewer-login.js');
console.log('---------------------------------');
if (!fs.existsSync(FILE)) { console.log('ABORT - ' + FILE + ' not found.'); process.exit(1); }

// latin1 = exact byte preservation; our anchor + insert are pure ASCII
const original = fs.readFileSync(FILE, 'latin1');

if (original.indexOf(MARKER) !== -1) { console.log(FILE + ': reviewer login already present (skip).'); process.exit(0); }

const idx = original.indexOf(ANCHOR);
const last = original.lastIndexOf(ANCHOR);
if (idx === -1) { console.log('ABORT - email-code anchor not found. No change.'); process.exit(1); }
if (idx !== last) { console.log('ABORT - anchor found more than once. No change.'); process.exit(1); }

const b = FILE + '.bak-' + stamp();
fs.copyFileSync(FILE, b);
try {
  const updated = original.replace(ANCHOR, ANCHOR + BLOCK);
  if (updated.indexOf(MARKER) === -1) throw new Error('post-edit marker missing');
  fs.writeFileSync(FILE, Buffer.from(updated, 'latin1'));
  execFileSync(process.execPath, ['--check', FILE], { stdio: 'pipe' });
  console.log(FILE + ': reviewer demo login added + node --check OK.');
  console.log('   (backup: ' + path.basename(b) + ')');
} catch (e) {
  fs.copyFileSync(b, FILE);
  console.log(FILE + ': FAILED -> restored original (' + String(e.message || e) + ').');
  process.exit(1);
}
console.log('---------------------------------');
console.log('Deploy: git add -A && commit && push  (NO cap sync / rebuild needed).');
process.exit(0);
