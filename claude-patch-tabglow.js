#!/usr/bin/env node
/* ============================================================================
 * claude-patch-tabglow.js
 * ----------------------------------------------------------------------------
 * Fixes the active-tab glow not appearing in the floating nav.
 *
 * ROOT CAUSE (confirmed): tmc-redesign.js ran setActiveNavItem() once,
 * immediately, when <body> existed but the floating nav (~700 lines down the
 * page) had NOT been parsed yet. It found zero .tmc-fnav-item elements, set
 * nothing, and never retried. So no tab ever got the "active" class, and the
 * neon glow (which already exists in tmc-redesign.css) never lit up.
 *
 * FIX: rewrite tmc-redesign.js so it:
 *   - adds the redesign class to <html> immediately (before paint),
 *   - sets the active nav on DOMContentLoaded (or now, if already loaded),
 *   - retries briefly (every 50ms, up to ~1s) in case the nav is parsed late,
 *   - re-applies on back/forward-cache restore (pageshow).
 * No CSS changes needed — the glow styling is already correct.
 *
 * SAFE: full-file overwrite with a timestamped backup, UTF-8 no-BOM,
 * `node --check` validation, and auto-restore on failure. Idempotent
 * (re-running writes identical content). Only touches the public/ copy
 * (the source of truth that ships to both web + app); also mirrors a
 * root-level copy ONLY if one already exists.
 * ==========================================================================*/

'use strict';
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

// ---- the new file contents --------------------------------------------------
const NEW_CONTENT = [
'// \u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550',
'// TAPMYCAR REDESIGN \u2014 minimal JS (v7)',
'// Adds the redesign body class and lights the active nav tab.',
'//',
'// v7: setActiveNavItem now runs reliably no matter where this script is',
'//     loaded. The previous version called it once before the floating nav',
'//     was parsed, found nothing, and never retried \u2014 so no tab ever lit up.',
'//     Now we run on DOMContentLoaded (or immediately if already loaded),',
'//     retry briefly in case the nav arrives late, and re-apply on bfcache',
'//     restore (pageshow). The neon glow itself lives in tmc-redesign.css.',
'// \u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550',
'(function () {',
'  // Apply the redesign class to <html> immediately (before paint),',
'  // and to <body> as soon as it exists.',
"  document.documentElement.classList.add('tmc-redesign');",
'',
'  function applyBodyClass() {',
"    if (document.body && !document.body.classList.contains('tmc-redesign')) {",
"      document.body.classList.add('tmc-redesign');",
'    }',
'  }',
'',
'  // Light the nav item whose data-match is contained in the URL path.',
'  // Returns true once at least one nav item is present (so we can stop retrying).',
'  function setActiveNavItem() {',
"    var items = document.querySelectorAll('.tmc-fnav-item');",
'    if (!items.length) return false;',
'    var path = window.location.pathname.toLowerCase();',
'    items.forEach(function (item) {',
"      var raw = item.getAttribute('data-match') || '';",
"      var matches = raw.split(',').map(function (m) { return m.trim().toLowerCase(); }).filter(Boolean);",
'      var isActive = matches.some(function (m) { return path.indexOf(m) !== -1; });',
"      item.classList.toggle('active', isActive);",
'    });',
'    return true;',
'  }',
'',
'  function run() {',
'    applyBodyClass();',
'    // If the nav is not in the DOM yet, retry on a short interval',
'    // (covers the case where this script runs before the nav markup is parsed).',
'    if (!setActiveNavItem()) {',
'      var tries = 0;',
'      var iv = setInterval(function () {',
'        if (setActiveNavItem() || ++tries >= 20) clearInterval(iv);',
'      }, 50);',
'    }',
'  }',
'',
"  if (document.readyState === 'loading') {",
"    document.addEventListener('DOMContentLoaded', run);",
'  } else {',
'    run();',
'  }',
'',
'  // Re-apply when the page is restored from the back/forward cache.',
"  window.addEventListener('pageshow', function () {",
'    applyBodyClass();',
'    setActiveNavItem();',
'  });',
'})();',
''
].join('\n');

// ---- helpers ----------------------------------------------------------------
function stamp() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

function patchOne(file) {
  if (!fs.existsSync(file)) return { file, status: 'skip (not found)' };

  const original = fs.readFileSync(file); // Buffer (preserve for restore)
  const backup = `${file}.bak-${stamp()}`;
  fs.writeFileSync(backup, original);

  try {
    // Write UTF-8, no BOM.
    fs.writeFileSync(file, Buffer.from(NEW_CONTENT, 'utf8'));
    // Validate.
    execFileSync(process.execPath, ['--check', file], { stdio: 'pipe' });
    return { file, backup, status: 'patched + node --check OK' };
  } catch (err) {
    // Restore on any failure.
    fs.writeFileSync(file, original);
    return { file, backup, status: 'FAILED -> restored', error: String(err.message || err) };
  }
}

// ---- run --------------------------------------------------------------------
const targets = [
  path.join('public', 'tmc-redesign.js'),      // source of truth (ships to web + app)
  'tmc-redesign.js'                            // root mirror, only if it already exists
];

let anyFailed = false;
console.log('claude-patch-tabglow.js');
console.log('-----------------------');
for (const t of targets) {
  const r = patchOne(t);
  if (r.status.startsWith('FAILED')) anyFailed = true;
  console.log(`${r.file}: ${r.status}${r.backup ? `  (backup: ${path.basename(r.backup)})` : ''}`);
  if (r.error) console.log(`   error: ${r.error}`);
}
console.log('-----------------------');
console.log(anyFailed ? 'Done WITH ERRORS (originals restored where it failed).' : 'Done. Active-tab glow fix applied.');
process.exit(anyFailed ? 1 : 0);
