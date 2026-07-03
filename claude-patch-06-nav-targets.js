#!/usr/bin/env node
/* ============================================================================
 * claude-patch-06-nav-targets.js
 * ----------------------------------------------------------------------------
 * Per request, set fixed destinations on the renewal/pricing pages:
 *   - Back arrow  -> /dashboard.html
 *   - Logo (pricing) -> /settings.html
 *
 * Works whether the back button currently calls tmcSafeBack() (from patch 05)
 * or the original history.back(); and whether the logo has the patch-05
 * onclick or not. The leftover tmcSafeBack/tmcGoHome helper from patch 05 is
 * harmless and left in place.
 *
 * Applies to public/pricing.html and public/renew.html (+ root mirrors).
 * Purchase / Stripe buttons are not touched.
 *
 * SAFE / IDEMPOTENT: timestamped backups, UTF-8 no-BOM, re-running changes
 * nothing, reports what changed, restores on failure.
 * ==========================================================================*/

'use strict';
const fs = require('fs');
const path = require('path');

// back control (class="bk" or class="back") calling tmcSafeBack() or history.back()
const BACK_RE = /(class="(?:bk|back)"\s+onclick=")(?:tmcSafeBack\(\)|history\.back\(\))(")/g;
// pricing logo anchor -> settings, dropping any patch-05 onclick
const LOGO_RE = /<a(\s+)href="\/dashboard\.html"(\s+onclick="return tmcGoHome\(event\)")?(\s+aria-label="TapMyCar")/g;

const FILES = [
  { src: path.join('public','pricing.html'), root: 'pricing.html', logo: true },
  { src: path.join('public','renew.html'),   root: 'renew.html',   logo: false }
];

function stamp() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

function processFile(entry) {
  const file = entry.src;
  if (!fs.existsSync(file)) return { file, status: 'skip (not found)' };
  const original = fs.readFileSync(file, 'utf8');
  let s = original;
  const did = [];

  let backCount = 0;
  s = s.replace(BACK_RE, function(_m, a, b){ backCount++; return a + "window.location.href='/dashboard.html'" + b; });
  if (backCount) did.push('back->dashboard x' + backCount);

  if (entry.logo) {
    let logoCount = 0;
    s = s.replace(LOGO_RE, function(_m, sp1, _onclick, aria){ logoCount++; return '<a' + sp1 + 'href="/settings.html"' + aria; });
    if (logoCount) did.push('logo->settings x' + logoCount);
  }

  if (s === original) return { file, status: 'no change needed (already set)' };

  const b = file + '.bak-' + stamp();
  fs.copyFileSync(file, b);
  try {
    fs.writeFileSync(file, Buffer.from(s, 'utf8')); // UTF-8 no-BOM
    let extra = '';
    if (entry.root && fs.existsSync(entry.root)) {
      const mb = entry.root + '.bak-' + stamp();
      fs.copyFileSync(entry.root, mb);
      fs.copyFileSync(file, entry.root);
      extra = ' -> mirrored to ' + entry.root;
    }
    return { file, backup: b, status: 'patched [' + did.join(', ') + ']' + extra };
  } catch (err) {
    fs.copyFileSync(b, file);
    return { file, backup: b, status: 'FAILED -> restored', error: String(err.message || err) };
  }
}

console.log('claude-patch-06-nav-targets.js');
console.log('------------------------------');
let failed = false;
for (const e of FILES) {
  const r = processFile(e);
  console.log(r.file + ': ' + r.status + (r.backup ? '  (backup: ' + path.basename(r.backup) + ')' : ''));
  if (r.error) console.log('   error: ' + r.error);
  if (r.status.indexOf('FAILED') === 0) failed = true;
}
console.log('------------------------------');
console.log(failed ? 'Done WITH ERRORS (restored).' : 'Done. Back -> dashboard, logo -> settings.');
process.exit(failed ? 1 : 0);
