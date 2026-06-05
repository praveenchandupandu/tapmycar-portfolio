/* tapmycar-patch70-claim-response-fix.js
 *
 * BUG (why physical activation shows "Activation failed (status 200)" even
 * though the tag IS claimed in the database):
 *
 *   In api/get-tag.js the claim update reads its result back with .single():
 *       .update(updates).eq('token', cleanToken).select().single()
 *   so `data` is a SINGLE OBJECT. But the response line indexes it as an array:
 *       return res.json({ success: true, tag: data ? data[0] : null, gift: giftApplied });
 *   data[0] on an object is undefined, so the API returns tag:null. The
 *   physical-activation screen checks for `.tag`, sees nothing, and reports a
 *   false failure. (eTag/gift paths check `.success`, so they were unaffected —
 *   which is why this stayed hidden until activation could reach this step.)
 *
 * FIX (one line, surgical):
 *   Return the object directly:  tag: data || null
 *   Only the claim-path line (the one carrying `gift: giftApplied`) is touched.
 *   The status_override line above uses .select() WITHOUT .single(), so its
 *   data[0] is correct and is left exactly as-is.
 *
 * Safe + idempotent:
 *   - Timestamped backup of get-tag.js.
 *   - Function-based replacement; must match exactly once or it aborts.
 *   - Re-running is a no-op (the fixed form is detected and skipped).
 *   - node --check validates the file; a syntax error reverts the change.
 */

'use strict';

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const ROOT = process.cwd();
const STAMP = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
const BACKUP_DIR = path.join(ROOT, 'backup-patch70-' + STAMP);
const REL = path.join('api', 'get-tag.js');
const target = path.join(ROOT, REL);

if (!fs.existsSync(target)) {
  throw new Error('Missing ' + REL + ' — are you in the tapmycar folder?');
}

let src = fs.readFileSync(target, 'utf8');

const FIXED = 'tag: data || null, gift: giftApplied';
if (src.indexOf(FIXED) !== -1) {
  console.log(REL + ': already patched (skip).');
  process.exit(0);
}

/* Match ONLY the claim-path response (the one with gift: giftApplied).
 * The near-identical status_override line has no gift suffix and is correct,
 * so it is deliberately not matched. */
const find = /tag: data \? data\[0\] : null, gift: giftApplied/;

const matches = src.match(new RegExp(find.source, 'g'));
const count = matches ? matches.length : 0;
if (count !== 1) {
  throw new Error('Expected exactly 1 match for the claim response line, found ' +
    count + ' — get-tag.js is not in the expected state. Aborting WITHOUT changes.');
}

const out = src.replace(find, function () { return FIXED; });

if (out === src) {
  throw new Error('Replacement produced no change — aborting.');
}

fs.mkdirSync(path.join(BACKUP_DIR, 'api'), { recursive: true });
fs.copyFileSync(target, path.join(BACKUP_DIR, REL));
fs.writeFileSync(target, out, 'utf8');

try {
  execSync('node --check "' + target + '"', { stdio: 'pipe' });
} catch (e) {
  fs.writeFileSync(target, src, 'utf8'); // revert on syntax error
  throw new Error('node --check FAILED — change reverted.\n' +
    (e.stderr ? e.stderr.toString() : e.message));
}

console.log('OK    ' + REL + ' patched (tag: data[0] -> data).');
console.log('Backup: ' + path.basename(BACKUP_DIR));
