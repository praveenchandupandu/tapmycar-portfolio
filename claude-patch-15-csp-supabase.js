#!/usr/bin/env node
/* ============================================================================
 * claude-patch-15-csp-supabase.js
 * ----------------------------------------------------------------------------
 * Fixes the Content-Security-Policy in vercel.json so the admin video uploader
 * (and video playback / previews) works.
 *
 * ROOT CAUSE: connect-src 'self' blocks the browser's direct upload to Supabase
 * storage ("Network error"); no media-src + no blob: allowance blocks the
 * blob: video/thumbnail previews.
 *
 * CHANGE (adds only trusted sources, removes nothing):
 *   - connect-src : add  https://*.supabase.co
 *   - media-src   : add  'self' blob: https://*.supabase.co   (was unset)
 *   - img-src     : add  blob:   (for local thumbnail previews)
 *
 * SCOPE: vercel.json only -> git push triggers a Vercel redeploy (site-wide CSP).
 * SAFE: validates JSON parses after edit, idempotent, each anchor must match
 * exactly once or it aborts with no change, timestamped backup.
 * ==========================================================================*/

'use strict';
const fs = require('fs');
const path = require('path');

const FILE = 'vercel.json';

const EDITS = [
  { label: 'img-src + blob:',
    from: "img-src 'self' data: https:;",
    to:   "img-src 'self' data: blob: https:;" },
  { label: 'connect-src + supabase, add media-src',
    from: "connect-src 'self';",
    to:   "connect-src 'self' https://*.supabase.co; media-src 'self' blob: https://*.supabase.co;" }
];

const DONE_MARK = 'supabase.co';

function stamp() {
  const d = new Date(); const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth()+1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

console.log('claude-patch-15-csp-supabase.js');
console.log('-------------------------------');
if (!fs.existsSync(FILE)) { console.log('ABORT - ' + FILE + ' not found.'); process.exit(1); }

let text = fs.readFileSync(FILE, 'utf8');

// sanity: it must currently be valid JSON
try { JSON.parse(text); } catch (e) { console.log('ABORT - ' + FILE + ' is not valid JSON to begin with. No change.'); process.exit(1); }

if (text.indexOf(DONE_MARK) !== -1) { console.log(FILE + ': CSP already allows supabase (skip).'); process.exit(0); }

// verify every anchor appears exactly once
for (const e of EDITS) {
  const n = text.split(e.from).length - 1;
  if (n !== 1) { console.log('ABORT - "' + e.label + '" anchor matched ' + n + ' (expected 1). No change.'); process.exit(1); }
}

const b = FILE + '.bak-' + stamp();
fs.copyFileSync(FILE, b);
try {
  for (const e of EDITS) text = text.replace(e.from, e.to);
  JSON.parse(text); // must still be valid JSON
  if (text.indexOf(DONE_MARK) === -1) throw new Error('post-edit marker missing');
  fs.writeFileSync(FILE, Buffer.from(text, 'utf8'));
  console.log(FILE + ': CSP updated (connect-src + media-src + img-src). JSON valid.');
  console.log('   (backup: ' + path.basename(b) + ')');
} catch (e) {
  fs.copyFileSync(b, FILE);
  console.log(FILE + ': FAILED -> restored (' + String(e.message || e) + ').');
  process.exit(1);
}
console.log('-------------------------------');
console.log('Deploy: git add -A && commit && push (~60s Vercel redeploy). Then HARD-REFRESH admin (Ctrl+Shift+R) and retry upload.');
process.exit(0);
