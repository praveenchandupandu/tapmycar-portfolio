#!/usr/bin/env node
/* ============================================================================
 * claude-patch-21-privacy-call-log.js
 * ----------------------------------------------------------------------------
 * Updates the masked-call paragraph in the privacy policy so it honestly
 * reflects that call records (both numbers + time + duration, not audio) are
 * STORED, and reassures users those numbers are never exposed to the other
 * party, other users, or the public.
 *
 * Replaces the existing "connect the call" sentence (which implied numbers are
 * only used transiently) with a fuller, accurate version.
 *
 * SCOPE: public/privacy.html (mirrored to root if present). Static -> git push.
 * Does NOT touch the in-review Android bundle.
 *
 * SAFE / IDEMPOTENT: backup, UTF-8 no-BOM, skips if already patched, anchor must
 * match exactly once else aborts with no change.
 * ==========================================================================*/

'use strict';
const fs = require('fs');
const path = require('path');

const PUB = path.join('public', 'privacy.html');
const ROOT = 'privacy.html';
const MARKER = 'respond to lawful requests';

// existing paragraph (the <p>...</p> about masked calls)
const ANCHOR = /<p>When someone places a masked call through your tag,[\s\S]*?do not record the audio content of masked calls\.<\/p>/;

const REPLACEMENT =
  '<p>When someone places a masked call through your tag, our telephony provider connects both your phone number and the caller\'s number so the call goes through \u2014 but neither party ever sees or learns the other\'s real number, and no one who scans your tag is ever shown your number. ' +
  'We keep a record of each masked call (the two phone numbers, plus the date, time, and duration \u2014 never the audio content) to operate the service, prevent abuse, and respond to lawful requests from authorities. ' +
  'These call records are kept private and are never shared with the other caller, with other users, or with the public.</p>';

function stamp() {
  const d = new Date(); const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth()+1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

function patchFile(file) {
  if (!fs.existsSync(file)) return { file, status: 'skip (not found)' };
  const original = fs.readFileSync(file, 'utf8');
  if (original.indexOf(MARKER) !== -1) return { file, status: 'already patched (skip)' };
  const cnt = (original.match(new RegExp(ANCHOR, 'g')) || []).length;
  if (cnt !== 1) return { file, status: 'ABORT - masked-call paragraph matched ' + cnt + ' (expected 1); no change' };
  const b = file + '.bak-' + stamp();
  fs.copyFileSync(file, b);
  try {
    const updated = original.replace(ANCHOR, function () { return REPLACEMENT; });
    if (updated.indexOf(MARKER) === -1) throw new Error('post-edit marker missing');
    fs.writeFileSync(file, Buffer.from(updated, 'utf8'));
    return { file, backup: b, status: 'call-log disclosure added' };
  } catch (e) {
    fs.copyFileSync(b, file);
    return { file, backup: b, status: 'FAILED -> restored (' + String(e.message||e) + ')' };
  }
}

console.log('claude-patch-21-privacy-call-log.js');
console.log('-----------------------------------');
let failed = false;
const r = patchFile(PUB);
console.log(r.file + ': ' + r.status + (r.backup ? '  (backup: ' + path.basename(r.backup) + ')' : ''));
if (r.status.indexOf('ABORT') === 0 || r.status.indexOf('FAILED') === 0) failed = true;

if (!failed && fs.existsSync(PUB)) {
  if (fs.existsSync(ROOT)) {
    const rb = ROOT + '.bak-' + stamp();
    fs.copyFileSync(ROOT, rb); fs.copyFileSync(PUB, ROOT);
    console.log(ROOT + ': mirrored from public  (backup: ' + path.basename(rb) + ')');
  } else { console.log(ROOT + ': no root copy (nothing to mirror)'); }
}
console.log('-----------------------------------');
console.log(failed ? 'Done WITH ERRORS.' : 'Done. git add/commit/push -> Vercel redeploys.');
process.exit(failed ? 1 : 0);
