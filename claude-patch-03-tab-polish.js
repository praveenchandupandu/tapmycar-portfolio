#!/usr/bin/env node
/* ============================================================================
 * claude-patch-03-tab-polish.js
 * ----------------------------------------------------------------------------
 * Makes switching tabs feel smoother, WITHOUT changing the multi-page setup.
 *
 * Three changes, all reversible:
 *   1) public/tmc-redesign.css  -> add a gentle 0.18s fade-in on every page so
 *      the new tab eases in instead of snapping from a blank screen. (Loaded in
 *      <head>, so it runs from first paint. Respects prefers-reduced-motion.)
 *   2) public/tmc-redesign.js   -> on idle, prefetch the other tab pages so the
 *      next tab is already warm and loads faster (shorter blank gap). Passive,
 *      wrapped in try/catch, guarded so it runs once.
 *   3) public/*.html (+ root mirrors) -> bump the tmc-redesign asset version
 *      from ?v=2 to ?v=3. REQUIRED: editing the css/js without a new version
 *      would let the cache keep serving the old copies.
 *
 * SAFE / IDEMPOTENT:
 *   - timestamped backups before every write, UTF-8 no-BOM,
 *   - re-running is a no-op (markers + version are already in place),
 *   - the .js file is `node --check`-ed after editing; on failure it restores,
 *   - any failure restores that file; tmc-redesign.css / tmc-redesign.js are
 *     public-only (no root mirror), the HTML files mirror to root.
 * ==========================================================================*/

'use strict';
const fs = require('fs');
const path = require('path');
const os = require('os');
const { execFileSync } = require('child_process');

const VERSION = '3';

const CSS_FILE = path.join('public', 'tmc-redesign.css');
const JS_FILE = path.join('public', 'tmc-redesign.js');

const CSS_MARKER = 'TMC_TAB_POLISH';
const CSS_BLOCK = [
  '',
  '/* TMC_TAB_POLISH: gentle page fade-in to soften tab switches (claude-patch-03) */',
  '@keyframes tmcFadeIn { from { opacity: 0; } to { opacity: 1; } }',
  'body { animation: tmcFadeIn 0.18s ease-out both; }',
  '@media (prefers-reduced-motion: reduce) { body { animation: none; } }',
  ''
].join('\n');

const JS_MARKER = '__tmcTabPrefetch';
const JS_BLOCK = [
  '',
  '/* TMC_TAB_POLISH: prefetch sibling tab pages so switching is faster (claude-patch-03) */',
  ';(function(){',
  '  if (window.__tmcTabPrefetch) return;',
  '  window.__tmcTabPrefetch = true;',
  "  var tabs = ['/dashboard.html','/manage.html','/verify.html','/activity.html','/settings.html'];",
  '  function warm(){',
  '    try {',
  '      var here = location.pathname;',
  '      for (var i = 0; i < tabs.length; i++) {',
  "        var base = tabs[i].replace('.html','');",
  '        if (here.indexOf(base) !== -1) continue;',
  "        var l = document.createElement('link');",
  "        l.rel = 'prefetch';",
  '        l.href = tabs[i];',
  '        document.head.appendChild(l);',
  '      }',
  '    } catch (e) {}',
  '  }',
  "  if ('requestIdleCallback' in window) { requestIdleCallback(warm, { timeout: 2000 }); }",
  '  else { setTimeout(warm, 1200); }',
  '})();',
  ''
].join('\n');

// cache-bump regexes (same approach as patch 02)
const REF_RE = /(\b(?:href|src)\s*=\s*")([^"]*?tmc-redesign\.(?:css|js))(\?[^"]*)?(")/g;
const BARE_RE = new RegExp('tmc-redesign\\.(?:css|js)(?!\\?v=' + VERSION + '\\b)'); // non-global: stateless test

function stamp() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}
function backup(file) { const b = file + '.bak-' + stamp(); fs.copyFileSync(file, b); return b; }

function appendBlock(file, marker, block, opts) {
  opts = opts || {};
  if (!fs.existsSync(file)) return { file, status: 'skip (not found)' };
  const original = fs.readFileSync(file, 'utf8');
  if (original.indexOf(marker) !== -1) return { file, status: 'already has polish (skip)' };

  const b = backup(file);
  try {
    const updated = original.replace(/\s*$/, '') + '\n' + block;
    fs.writeFileSync(file, Buffer.from(updated, 'utf8')); // UTF-8 no-BOM
    if (opts.nodeCheck) {
      try { execFileSync(process.execPath, ['--check', file], { stdio: 'pipe' }); }
      catch (e) { fs.copyFileSync(b, file); return { file, backup: b, status: 'FAILED node --check -> restored', error: String(e.message || e) }; }
    }
    if (original.indexOf(marker) === updated.indexOf(marker)) { /* unreachable */ }
    return { file, backup: b, status: 'polish added' };
  } catch (err) {
    fs.copyFileSync(b, file);
    return { file, backup: b, status: 'FAILED -> restored', error: String(err.message || err) };
  }
}

function bumpHtml(file, mirrorTo) {
  if (!fs.existsSync(file)) return { file, status: 'skip (not found)' };
  const original = fs.readFileSync(file, 'utf8');
  let count = 0;
  const out = original.replace(REF_RE, function (_m, pre, asset, _q, post) { count++; return pre + asset + '?v=' + VERSION + post; });
  if (count === 0) return { file, status: 'no tmc-redesign refs (skip)' };
  if (out === original) return { file, status: 'already ?v=' + VERSION + ' (' + count + ' refs, no change)' };
  if (BARE_RE.test(out)) return { file, status: 'ABORT - a ref left unversioned (no change)' };

  const b = backup(file);
  try {
    fs.writeFileSync(file, Buffer.from(out, 'utf8'));
    let extra = '';
    if (mirrorTo && fs.existsSync(mirrorTo)) { const mb = backup(mirrorTo); fs.copyFileSync(file, mirrorTo); extra = ' -> mirrored'; }
    return { file, backup: b, status: 'bumped ' + count + ' ref(s) to ?v=' + VERSION + extra };
  } catch (err) {
    fs.copyFileSync(b, file);
    return { file, backup: b, status: 'FAILED -> restored', error: String(err.message || err) };
  }
}

function listHtml(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir).filter((f) => /\.html$/i.test(f)).map((f) => path.join(dir, f));
}

// ---- run --------------------------------------------------------------------
console.log('claude-patch-03-tab-polish.js');
console.log('-----------------------------');
let failed = false;
function report(r) {
  console.log(r.file + ': ' + r.status + (r.backup ? '  (backup: ' + path.basename(r.backup) + ')' : ''));
  if (r.error) console.log('   error: ' + r.error);
  if (r.status.indexOf('FAILED') === 0 || r.status.indexOf('ABORT') === 0) failed = true;
}

// 1) fade-in CSS
report(appendBlock(CSS_FILE, CSS_MARKER, CSS_BLOCK, { nodeCheck: false }));
// 2) prefetch JS (syntax-checked)
report(appendBlock(JS_FILE, JS_MARKER, JS_BLOCK, { nodeCheck: true }));

// 3) version bump on all HTML (+ root mirror)
console.log('--- version bump (?v=' + VERSION + ') ---');
let changed = 0;
for (const f of listHtml('public')) {
  const r = bumpHtml(f, path.basename(f));
  report(r);
  if (r.status.indexOf('bumped') === 0) changed++;
}

console.log('-----------------------------');
console.log(changed + ' HTML file(s) re-versioned.');
console.log(failed ? 'Done WITH ERRORS (any failure was restored).' : 'Done. Tabs will fade in and load faster.');
process.exit(failed ? 1 : 0);
