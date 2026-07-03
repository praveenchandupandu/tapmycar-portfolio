#!/usr/bin/env node
/* ============================================================================
 * claude-patch-05-nav-safe-back.js
 * ----------------------------------------------------------------------------
 * Fixes the renewal navigation trap:
 *   - renew.html and pricing.html use back = history.back(), which retraces
 *     into the Stripe checkout, creating a back-and-forth loop.
 *   - pricing.html's logo lands on the sign-in screen when there's no active
 *     session instead of a sensible home.
 *
 * FIX (no Stripe/purchase buttons touched):
 *   - Inject a tiny helper that knows a SAFE HOME: dashboard when a session
 *     token exists, the public home ("/") when it doesn't.
 *   - Back arrow -> tmcSafeBack(): go back only if the previous page was our
 *     own site and NOT checkout/pricing/renew; otherwise go to safe home.
 *   - pricing.html logo -> also routes through safe home (so a logged-out
 *     visitor gets the home page, not the sign-in dead-end).
 *
 * Applies to public/pricing.html and public/renew.html (+ root mirrors).
 *
 * SAFE / IDEMPOTENT: timestamped backups, UTF-8 no-BOM, re-running changes
 * nothing (marker + already-rewired), reports exactly what changed per file,
 * restores on failure.
 * ==========================================================================*/

'use strict';
const fs = require('fs');
const path = require('path');

const HELPER = [
'<script>',
'/* TMC_NAV_SAFE: keep back + logo from looping into checkout or dead-ending at sign-in */',
'(function(){',
'  if (window.__tmcNavSafe) return; window.__tmcNavSafe = true;',
"  function loggedIn(){ try { return !!(localStorage.getItem('tmc_session_token') || localStorage.getItem('tmc_token')); } catch(e){ return false; } }",
"  function home(){ return loggedIn() ? '/dashboard.html' : '/'; }",
'  window.tmcSafeBack = function(){',
'    try {',
"      var ref = document.referrer || '';",
'      var sameSite = ref.indexOf(window.location.origin) === 0;',
'      var bad = /\\/(renew|pricing)\\.html/.test(ref) || /stripe\\.com/.test(ref);',
'      if (sameSite && !bad && history.length > 1) { history.back(); return; }',
'    } catch(e){}',
'    window.location.href = home();',
'  };',
'  window.tmcGoHome = function(ev){ if (ev && ev.preventDefault) ev.preventDefault(); window.location.href = home(); return false; };',
'})();',
'</script>'
].join('\n');

const FILES = [
  { src: path.join('public','pricing.html'), root: 'pricing.html', logo: true },
  { src: path.join('public','renew.html'),   root: 'renew.html',   logo: false }
];

// back control on either page: class="bk" or class="back" with onclick="history.back()"
const BACK_RE = /(class="(?:bk|back)"\s+onclick=")history\.back\(\)(")/g;
// pricing logo anchor -> add safe-home onclick
const LOGO_RE = /(<a\s+href="\/dashboard\.html")(\s+aria-label="TapMyCar")/g;

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

  // 1) inject helper once
  if (s.indexOf('TMC_NAV_SAFE') === -1) {
    if (/<\/body>/i.test(s)) { s = s.replace(/<\/body>/i, function(){ return HELPER + '\n</body>'; }); did.push('helper'); }
    else { s = s + '\n' + HELPER + '\n'; did.push('helper(appended)'); }
  }

  // 2) rewire back button
  var backCount = 0;
  s = s.replace(BACK_RE, function(_m, a, b){ backCount++; return a + 'tmcSafeBack()' + b; });
  if (backCount) did.push('back x' + backCount);

  // 3) rewire logo (pricing only)
  if (entry.logo) {
    var logoCount = 0;
    s = s.replace(LOGO_RE, function(_m, a, b){ logoCount++; return a + ' onclick="return tmcGoHome(event)"' + b; });
    if (logoCount) did.push('logo x' + logoCount);
  }

  if (s === original) return { file, status: 'no change needed (already safe)' };

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

console.log('claude-patch-05-nav-safe-back.js');
console.log('--------------------------------');
let failed = false;
for (const e of FILES) {
  const r = processFile(e);
  console.log(r.file + ': ' + r.status + (r.backup ? '  (backup: ' + path.basename(r.backup) + ')' : ''));
  if (r.error) console.log('   error: ' + r.error);
  if (r.status.indexOf('FAILED') === 0) failed = true;
}
console.log('--------------------------------');
console.log(failed ? 'Done WITH ERRORS (restored).' : 'Done. Back + logo now go to a safe home; no more checkout loop.');
process.exit(failed ? 1 : 0);
