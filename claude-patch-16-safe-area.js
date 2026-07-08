#!/usr/bin/env node
/* ============================================================================
 * claude-patch-16-safe-area.js
 * ----------------------------------------------------------------------------
 * Fixes Android 15 / notch edge-to-edge: the top nav/header is drawn under the
 * status bar, covering the back button. Applies to every app page.
 *
 * Per public/*.html page (except splash.html / index.html):
 *   1) add viewport-fit=cover to the viewport meta (so env() insets are live)
 *   2) inject a small <style>:
 *        - pages WITH a .nav  -> .nav gets top padding = 12px + safe-area-top
 *          (the nav's own background fills the status-bar area)
 *        - pages WITHOUT .nav -> body gets top padding = safe-area-top
 *          (content shifts below the status bar; padding shows the body's bg)
 *
 * Self-contained inline style per page => works regardless of which CSS a page
 * loads, overrides linked styles, and cannot miss a page.
 *
 * WEB-ASSET change: after this, git push + `npx cap sync android` + rebuild +
 * generate a FRESH signed AAB (the fixed layout must be in the submitted bundle).
 *
 * SAFE: byte-preserving (latin1 + ASCII inserts), idempotent (skips pages that
 * already have the marker), per-file backups.
 * ==========================================================================*/

'use strict';
const fs = require('fs');
const path = require('path');

const DIR = 'public';
const EXCLUDE = new Set(['splash.html', 'index.html']);
const MARKER = 'TMC_SAFEAREA';

const NAV_RULE  = ".nav{padding-top:calc(12px + env(safe-area-inset-top)) !important;}";
const BODY_RULE = "body{padding-top:env(safe-area-inset-top) !important;}";

const VP_RE = /(<meta[^>]*name=["']viewport["'][^>]*content=["'])([^"']*)(["'])/i;

function stamp() {
  const d = new Date(); const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth()+1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

if (!fs.existsSync(DIR)) { console.log('ABORT - public/ not found.'); process.exit(1); }

console.log('claude-patch-16-safe-area.js');
console.log('---------------------------');
const files = fs.readdirSync(DIR).filter((f) => f.toLowerCase().endsWith('.html') && !EXCLUDE.has(f));
const st = stamp();
let done = 0, skipped = 0, failed = 0;

for (const f of files) {
  const p = path.join(DIR, f);
  let s;
  try { s = fs.readFileSync(p, 'latin1'); } catch (e) { console.log('  ' + f + ': read error (skip)'); failed++; continue; }

  if (s.indexOf(MARKER) !== -1) { skipped++; continue; }
  if (!/<\/head>/i.test(s)) { console.log('  ' + f + ': no </head> (skip)'); skipped++; continue; }

  const before = s;

  // 1) viewport-fit=cover
  s = s.replace(VP_RE, function (m, a, content, q) {
    if (/viewport-fit/i.test(content)) return m;
    return a + content + ', viewport-fit=cover' + q;
  });

  // 2) inject safe-area style before </head>
  var hasNav = false;
  { var _cre = /class=["\']([^"\']*)["\']/g, _m; while ((_m = _cre.exec(s))) { if (_m[1].split(/\s+/).indexOf('nav') !== -1) { hasNav = true; break; } } }
  const rule = hasNav ? NAV_RULE : BODY_RULE;
  const block = '<style>/* ' + MARKER + ' edge-to-edge fix */ ' + rule + '</style>\n</head>';
  s = s.replace(/<\/head>/i, block);

  if (s === before || s.indexOf(MARKER) === -1) { console.log('  ' + f + ': no change (unexpected)'); failed++; continue; }

  try {
    fs.copyFileSync(p, p + '.bak-' + st);
    fs.writeFileSync(p, Buffer.from(s, 'latin1'));
    console.log('  ' + f + ': fixed (' + (hasNav ? 'nav' : 'body') + ')');
    done++;
  } catch (e) { console.log('  ' + f + ': write FAILED (' + String(e.message || e) + ')'); failed++; }
}

console.log('---------------------------');
console.log('Fixed ' + done + ', skipped ' + skipped + ', failed ' + failed + '.');
console.log('NEXT: git add -A && commit && push  ->  npx cap sync android  ->  rebuild + FRESH signed AAB.');
process.exit(failed ? 1 : 0);
