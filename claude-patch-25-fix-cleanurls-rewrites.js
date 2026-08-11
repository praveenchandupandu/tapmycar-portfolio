#!/usr/bin/env node
/* ============================================================================
 * claude-patch-25-fix-cleanurls-rewrites.js
 * ----------------------------------------------------------------------------
 * PROBLEM
 *   Every tag URL (https://tapmycar.io/tag/TMC-XXXXXX) has returned Vercel's
 *   404 page since TMC_PATCH101 (July 11) added "cleanUrls": true.
 *
 *   cleanUrls runs at BUILD time and strips .html from every deployed file, so
 *   contact.html is published as /contact. The rewrites then run at the Edge
 *   and still point at /contact.html -- a path that no longer exists. Vercel
 *   404s. That is why /contact loads fine but /tag/TMC-ECCBD7 does not.
 *
 *   Vercel's docs: "If cleanUrls is set to true in your project's vercel.json,
 *   do not include the file extension in the source or destination path."
 *
 *   Three rewrites are affected:
 *     /tag/:token -> /contact.html            (all tag URLs / QR codes)
 *     /r/:code    -> /register.html?ref=:code (all referral links)
 *     /knowmore   -> /knowmore.html           (promo landing page)
 *
 *   /v/:id -> /api/v?id=:id is an API route and is NOT affected.
 *
 * FIX
 *   Drop ".html" from those three destinations only.
 *
 * DELIBERATELY UNCHANGED (verified byte-for-byte after the edit):
 *   - "cleanUrls": true stays. It is what fixed the iOS 404s in Patch 101.
 *   - Content-Security-Policy (enforcing, from TMC_PATCH_SEC3)
 *   - CORS origin locks for tapmycar.io / www / localhost / capacitor
 *     (TMC_PATCH_SEC2)
 *   - X-Content-Type-Options, X-Frame-Options, Strict-Transport-Security,
 *     Referrer-Policy (Patch 37 security headers)
 *   - crons, functions, outputDirectory, the /api/:path* rewrite
 *   The patch asserts every one of these survives, and restores the file if
 *   any of them changed.
 *
 * SCOPE: vercel.json only. Config change -- deploys via git push. Does NOT
 * touch public/, android/ or ios/. No cap sync, no APK/AAB rebuild, no new
 * Play Store review. Your approved bundle is untouched.
 *
 * SAFE / IDEMPOTENT: timestamped backup, UTF-8 no-BOM, latin1 byte
 * preservation, each anchor must match exactly once, JSON.parse validation
 * plus a deep security-key comparison before/after, auto-restore on any
 * failure, re-running is a no-op.
 * ==========================================================================*/

'use strict';
const fs = require('fs');
const path = require('path');

const TARGET = 'vercel.json';

function stamp() {
  const d = new Date();
  const p = n => String(n).padStart(2, '0');
  return d.getFullYear() + p(d.getMonth() + 1) + p(d.getDate()) + '-' +
         p(d.getHours()) + p(d.getMinutes()) + p(d.getSeconds());
}

let backup = null;
function die(msg, restore) {
  if (restore && backup) {
    try { fs.copyFileSync(backup, TARGET); } catch (e) {}
  }
  console.error('\n  ABORTED: ' + msg);
  console.error(restore ? '  vercel.json restored from ' + backup + '\n'
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
  die('Cannot find vercel.json. Run this from the tapmycar project root.');
}

const src = fs.readFileSync(TARGET, 'latin1');

// BOM would break Vercel's parser (this bit you once before -- commit 74cb0df).
if (src.charCodeAt(0) === 0xEF || src.charCodeAt(0) === 0xFEFF) {
  die('vercel.json starts with a BOM. Fix the encoding first.');
}

let before;
try {
  before = JSON.parse(src);
} catch (e) {
  die('vercel.json is not valid JSON right now: ' + e.message);
}

// ── Already patched? ────────────────────────────────────────────────────────
const rw = Array.isArray(before.rewrites) ? before.rewrites : [];
const findDest = s => { const r = rw.find(x => x.source === s); return r ? r.destination : null; };

if (findDest('/tag/:token') === '/contact' &&
    findDest('/r/:code') === '/register?ref=:code' &&
    findDest('/knowmore') === '/knowmore') {
  console.log('\n  Already patched (all three destinations already clean).');
  console.log('  Nothing to do.\n');
  process.exit(0);
}

// ── Sanity: cleanUrls must actually be on, or this fix is wrong ────────────
if (before.cleanUrls !== true) {
  die('cleanUrls is not true in vercel.json. This patch only applies when\n' +
      '  cleanUrls is enabled -- with it off, the .html destinations are correct.');
}

// ── Anchors (exact strings from the current file) ──────────────────────────
const EDITS = [
  ['"destination": "/contact.html"',            '"destination": "/contact"',            '/tag/:token'],
  ['"destination": "/register.html?ref=:code"', '"destination": "/register?ref=:code"', '/r/:code'],
  ['"destination": "/knowmore.html"',           '"destination": "/knowmore"',           '/knowmore']
];

for (const [oldStr, , label] of EDITS) {
  const c = countOf(src, oldStr);
  if (c !== 1) die('anchor for ' + label + ' matched ' + c + ' times (expected exactly 1)');
}

// ── Apply ───────────────────────────────────────────────────────────────────
backup = TARGET + '.tmcbak-' + stamp();
fs.copyFileSync(TARGET, backup);

let out = src;
for (const [oldStr, newStr] of EDITS) {
  out = out.replace(oldStr, function () { return newStr; });
}

// latin1 out = byte-identical round-trip for everything untouched, no BOM.
fs.writeFileSync(TARGET, out, 'latin1');

// ── Verify: valid JSON ──────────────────────────────────────────────────────
let after;
try {
  after = JSON.parse(fs.readFileSync(TARGET, 'utf8'));
} catch (e) {
  die('patched vercel.json is not valid JSON: ' + e.message, true);
}

// ── Verify: the three destinations are fixed ───────────────────────────────
const rw2 = Array.isArray(after.rewrites) ? after.rewrites : [];
const findDest2 = s => { const r = rw2.find(x => x.source === s); return r ? r.destination : null; };
const expect = [
  ['/tag/:token', '/contact'],
  ['/r/:code',    '/register?ref=:code'],
  ['/knowmore',   '/knowmore']
];
for (const [s, d] of expect) {
  if (findDest2(s) !== d) die('rewrite ' + s + ' did not end up as ' + d, true);
}

// ── Verify: NOTHING security-related changed ───────────────────────────────
// Deep-compare every key except rewrites. Any drift = restore.
const J = v => JSON.stringify(v);
const guarded = ['headers', 'crons', 'functions', 'outputDirectory', 'version', 'cleanUrls', 'trailingSlash'];
for (const k of guarded) {
  if (J(before[k]) !== J(after[k])) {
    die('SECURITY GUARD: "' + k + '" changed unexpectedly. Nothing else should move.', true);
  }
}
// No key added or removed at the top level.
if (J(Object.keys(before).sort()) !== J(Object.keys(after).sort())) {
  die('SECURITY GUARD: top-level keys changed.', true);
}
// Rewrites: same count, same sources, in the same order. Only 3 destinations move.
if (rw.length !== rw2.length) die('SECURITY GUARD: rewrite count changed.', true);
for (let i = 0; i < rw.length; i++) {
  if (rw[i].source !== rw2[i].source) die('SECURITY GUARD: rewrite order/source changed.', true);
}
const changed = rw.filter((r, i) => r.destination !== rw2[i].destination).length;
if (changed !== 3) die('SECURITY GUARD: expected exactly 3 destination changes, saw ' + changed, true);

// Explicit spot-checks on the things that matter most.
const hdrText = J(after.headers);
const mustKeep = [
  'Content-Security-Policy',
  'Strict-Transport-Security',
  'X-Content-Type-Options',
  'X-Frame-Options',
  'Referrer-Policy',
  'https://www.tapmycar.io',
  'https://tapmycar.io',
  'capacitor://localhost',
  "frame-ancestors 'self'",
  "form-action 'self' https://checkout.stripe.com"
];
for (const m of mustKeep) {
  if (hdrText.indexOf(m) === -1) die('SECURITY GUARD: "' + m + '" missing after patch.', true);
}
if (after.cleanUrls !== true) die('SECURITY GUARD: cleanUrls was turned off.', true);
if (findDest2('/api/:path*') !== '/api/:path*') die('SECURITY GUARD: api rewrite changed.', true);
if (findDest2('/v/:id') !== '/api/v?id=:id') die('SECURITY GUARD: /v/:id rewrite changed.', true);

console.log('\n  OK  vercel.json patched.');
console.log('      backup: ' + backup);
console.log('');
console.log('      /tag/:token -> /contact              (tag URLs + QR codes)');
console.log('      /r/:code    -> /register?ref=:code   (referral links)');
console.log('      /knowmore   -> /knowmore             (promo page)');
console.log('');
console.log('      cleanUrls stays ON. CSP, CORS locks, HSTS and all security');
console.log('      headers verified byte-for-byte unchanged.');
console.log('      Config only -- no public/, no cap sync, no rebuild.\n');
