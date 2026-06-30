#!/usr/bin/env node
/* ============================================================================
 * claude-patch-02-cache-bump.js
 * ----------------------------------------------------------------------------
 * Forces the app/site to load the FIXED tmc-redesign.js / tmc-redesign.css.
 *
 * WHY: tmc-redesign.js is correct in the repo AND in the Android assets, yet
 * the running app still shows the old behavior (no active-tab glow). When the
 * file on disk is right but the WebView runs old code, a service worker (or
 * the WebView HTTP cache) is serving a cached copy. Changing the asset URL is
 * the standard way to defeat that: a new URL is a guaranteed cache miss, so the
 * fresh file is fetched.
 *
 * WHAT: in every *.html under public/ (and the mirrored root copies), rewrite
 *   href="/tmc-redesign.css"  ->  href="/tmc-redesign.css?v=2"
 *   src="/tmc-redesign.js"    ->  src="/tmc-redesign.js?v=2"
 * Any existing ?query is replaced, so re-running is a no-op. The version "2"
 * matches this patch number; a future bump would be patch 03 -> ?v=3.
 *
 * SAFE / IDEMPOTENT:
 *   - timestamped backups, UTF-8 no-BOM,
 *   - re-running produces identical output (always sets ?v=2),
 *   - after writing, verifies every tmc-redesign.(css|js) reference carries
 *     ?v=2 (no bare reference left), else restores,
 *   - only rewrites/mirrors files that actually changed.
 * ==========================================================================*/

'use strict';
const fs = require('fs');
const path = require('path');

const VERSION = '2'; // matches patch number

// href="...tmc-redesign.css"  OR  src="...tmc-redesign.js"  (+ optional ?query)
const REF_RE = /(\b(?:href|src)\s*=\s*")([^"]*?tmc-redesign\.(?:css|js))(\?[^"]*)?(")/g;
// any reference NOT already versioned with our exact ?v=VERSION (for verification)
// NON-global on purpose: .test() must be stateless across files.
const BARE_RE = new RegExp('tmc-redesign\\.(?:css|js)(?!\\?v=' + VERSION + '\\b)');

function stamp() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

function listHtml(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir).filter((f) => /\.html$/i.test(f)).map((f) => path.join(dir, f));
}

function bumpText(text) {
  let count = 0;
  const out = text.replace(REF_RE, function (_m, pre, asset, _query, post) {
    count++;
    return pre + asset + '?v=' + VERSION + post; // function-based -> no $-substitution issues
  });
  return { out, count };
}

function processFile(file, opts) {
  opts = opts || {};
  const mirrorTo = opts.mirrorTo;
  if (!fs.existsSync(file)) return { file, status: 'skip (not found)' };

  const original = fs.readFileSync(file, 'utf8');
  const res = bumpText(original);
  const out = res.out, count = res.count;

  if (count === 0) return { file, status: 'no tmc-redesign refs (skip)' };
  if (out === original) return { file, status: 'already ?v=' + VERSION + ' (' + count + ' refs, no change)' };

  // verify nothing left unversioned
  if (BARE_RE.test(out)) {
    return { file, status: 'ABORT - a reference was left unversioned (no change)' };
  }

  const b = file + '.bak-' + stamp();
  fs.copyFileSync(file, b);
  try {
    fs.writeFileSync(file, Buffer.from(out, 'utf8')); // UTF-8, no BOM
    let extra = '';
    if (mirrorTo && fs.existsSync(mirrorTo)) {
      const mb = mirrorTo + '.bak-' + stamp();
      fs.copyFileSync(mirrorTo, mb);
      fs.copyFileSync(file, mirrorTo);
      extra = '  -> mirrored to ' + mirrorTo;
    }
    return { file, backup: b, status: 'bumped ' + count + ' ref(s) to ?v=' + VERSION + extra };
  } catch (err) {
    fs.copyFileSync(b, file); // restore
    return { file, backup: b, status: 'FAILED -> restored', error: String(err.message || err) };
  }
}

// ---- run --------------------------------------------------------------------
console.log('claude-patch-02-cache-bump.js');
console.log('-----------------------------');

const htmlFiles = listHtml('public');
if (!htmlFiles.length) {
  console.log('No public/*.html files found - nothing to do.');
  process.exit(0);
}

let failed = false;
let changed = 0;
for (const f of htmlFiles) {
  const rootMirror = path.basename(f); // e.g. dashboard.html at repo root
  const r = processFile(f, { mirrorTo: rootMirror });
  console.log(r.file + ': ' + r.status + (r.backup ? '  (backup: ' + path.basename(r.backup) + ')' : ''));
  if (r.error) console.log('   error: ' + r.error);
  if (r.status.indexOf('FAILED') === 0 || r.status.indexOf('ABORT') === 0) failed = true;
  if (r.status.indexOf('bumped') === 0) changed++;
}

console.log('-----------------------------');
console.log(changed + ' file(s) updated.');
console.log(failed ? 'Done WITH ERRORS (any failure was restored).' : 'Done. Cached assets will be forced to reload.');
process.exit(failed ? 1 : 0);
