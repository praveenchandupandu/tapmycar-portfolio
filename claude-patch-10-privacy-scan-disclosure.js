#!/usr/bin/env node
/* ============================================================================
 * claude-patch-10-privacy-scan-disclosure.js
 * ----------------------------------------------------------------------------
 * Makes the privacy policy match the Data Safety form.
 *
 * Your code stores, on each scan: latitude/longitude (precise if the scanner's
 * device shares it, else approximate by IP), plus an optional photo, voice
 * message, and text message the scanner can leave for the owner. The current
 * privacy policy only mentions "approximate location (based on IP)... and
 * whether they placed a call" - it omits precise location and the photo/voice/
 * text notes. Google flags Data-Safety-vs-policy mismatches.
 *
 * FIX: expand the "Scan data" bullet to cover precise/approximate location, and
 * add a bullet disclosing the optional photo / voice note / text message.
 *
 * SCOPE: public/privacy.html (mirrored to the root copy if present). Static ->
 * git push redeploys. No cap sync / rebuild / ?v bump.
 *
 * SAFE / IDEMPOTENT: backup, UTF-8 no-BOM, skips if already patched, anchor must
 * match exactly once else aborts with no change.
 * ==========================================================================*/

'use strict';
const fs = require('fs');
const path = require('path');

const PUB = path.join('public', 'privacy.html');
const ROOT = 'privacy.html';
const MARKER = 'Messages left by a scanner';

// matches the existing Scan data <li> ... </li>
const ANCHOR = /<li><b>Scan data:<\/b>[\s\S]*?placed a call\.<\/li>/;

const REPLACEMENT =
  '<li><b>Scan data:</b> when someone scans your tag, we log the time, location, device type, and whether they placed a call. ' +
  'If the person scanning allows their device to share its location we may store a precise location; otherwise we store an approximate location based on their IP address.</li>' +
  '\n        <li><b>Messages left by a scanner:</b> a person who scans your tag may choose to leave you a short text message, a photo, and/or a voice message. ' +
  'If they do, we store it and show it to you on your activity page. These are optional and are provided by the person scanning, not collected from your device.</li>';

function stamp() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

function patchFile(file) {
  if (!fs.existsSync(file)) return { file, status: 'skip (not found)' };
  const original = fs.readFileSync(file, 'utf8');
  if (original.indexOf(MARKER) !== -1) return { file, status: 'already patched (skip)' };
  const cnt = (original.match(new RegExp(ANCHOR, 'g')) || []).length;
  if (cnt !== 1) return { file, status: 'ABORT - Scan data bullet matched ' + cnt + ' (expected 1); no change' };
  const b = file + '.bak-' + stamp();
  fs.copyFileSync(file, b);
  try {
    const updated = original.replace(ANCHOR, function () { return REPLACEMENT; });
    if (updated.indexOf(MARKER) === -1) throw new Error('post-edit marker missing');
    fs.writeFileSync(file, Buffer.from(updated, 'utf8')); // UTF-8, no BOM
    return { file, backup: b, status: 'disclosure expanded' };
  } catch (e) {
    fs.copyFileSync(b, file);
    return { file, backup: b, status: 'FAILED -> restored (' + String(e.message || e) + ')' };
  }
}

console.log('claude-patch-10-privacy-scan-disclosure.js');
console.log('------------------------------------------');
let failed = false;
const r = patchFile(PUB);
console.log(r.file + ': ' + r.status + (r.backup ? '  (backup: ' + path.basename(r.backup) + ')' : ''));
if (r.status.indexOf('ABORT') === 0 || r.status.indexOf('FAILED') === 0) failed = true;

if (!failed && fs.existsSync(PUB)) {
  if (fs.existsSync(ROOT)) {
    const rb = ROOT + '.bak-' + stamp();
    fs.copyFileSync(ROOT, rb);
    fs.copyFileSync(PUB, ROOT);
    console.log(ROOT + ': mirrored from public  (backup: ' + path.basename(rb) + ')');
  } else {
    console.log(ROOT + ': no root copy (nothing to mirror)');
  }
}

console.log('------------------------------------------');
console.log(failed ? 'Done WITH ERRORS.' : 'Done. git add/commit/push -> Vercel redeploys.');
process.exit(failed ? 1 : 0);
