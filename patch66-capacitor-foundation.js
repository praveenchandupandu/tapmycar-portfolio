#!/usr/bin/env node
/**
 * TMC_PATCH66 — Capacitor Foundation
 *
 * Goals:
 *  1. Create public/tmc-api-base.js — global fetch + XHR interceptor
 *     that rewrites /api/* calls to https://tapmycar.io/api/* when
 *     running inside Capacitor (window.Capacitor present).
 *  2. Inject <script src="/tmc-api-base.js"></script> as FIRST script
 *     in <head> of every HTML file in public/.
 *  3. Add CORS headers to vercel.json for capacitor://localhost and
 *     https://localhost origins (so the native app can call the live API).
 *  4. Mirror updated public/*.html to project root (sync convention).
 *
 * Behavior:
 *  - Website (no Capacitor): interceptor is a no-op → zero behavior change.
 *  - Native app (Capacitor present): /api/* gets rewritten to tapmycar.io/api/*.
 *  - Backward compatible: every existing fetch('/api/...') keeps working.
 *  - Idempotent: re-running skips already-injected files.
 *
 * Safety:
 *  - Timestamped backup folder created before any change.
 *  - node --check validates the new JS file.
 *  - Auto-restore from backup on any failure.
 *  - UTF-8 without BOM. EOL-tolerant (\r?\n handles CRLF and LF).
 *
 * Run from inside the tapmycar project folder:
 *   node patch66-capacitor-foundation.js
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

// -------------------------------------------------------------------
// Backup folder
// -------------------------------------------------------------------
const now = new Date();
const pad = n => String(n).padStart(2, '0');
const stamp = [
  now.getFullYear(),
  pad(now.getMonth() + 1),
  pad(now.getDate()),
  pad(now.getHours()),
  pad(now.getMinutes()),
].join('-');
const backupDir = 'backup-capacitor-foundation-' + stamp;

const restoreQueue = [];

function logStep(label) {
  console.log('\n=== ' + label + ' ===');
}

function backup(filePath) {
  if (!fs.existsSync(filePath)) return;
  const dest = path.join(backupDir, filePath);
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.copyFileSync(filePath, dest);
  restoreQueue.push({ orig: filePath, copy: dest });
}

function restoreAll() {
  console.error('\n⚠ Restoring all files from backup...');
  for (const { orig, copy } of restoreQueue) {
    try { fs.copyFileSync(copy, orig); }
    catch (e) { console.error('  Failed to restore ' + orig + ': ' + e.message); }
  }
  console.error('Restore complete. Backup folder kept at: ' + backupDir);
}

// safeReplace — function-based avoids PowerShell/JS $& $1 corruption
function safeReplace(str, pattern, replacement) {
  if (typeof replacement === 'function') return str.replace(pattern, replacement);
  return str.replace(pattern, function () { return replacement; });
}

// -------------------------------------------------------------------
// MAIN
// -------------------------------------------------------------------
console.log('\n╔══════════════════════════════════════════════════╗');
console.log('║ TMC_PATCH66 — Capacitor Foundation               ║');
console.log('╚══════════════════════════════════════════════════╝');
console.log('Backup folder: ' + backupDir);
fs.mkdirSync(backupDir, { recursive: true });

try {
  // ===================================================================
  // STEP 1 — Create public/tmc-api-base.js
  // ===================================================================
  logStep('Step 1: Create public/tmc-api-base.js');

  const apiBasePath = path.join('public', 'tmc-api-base.js');
  const apiBaseContent = [
    '// TMC_PATCH66 — Capacitor API base interceptor',
    '//',
    '// In native app (window.Capacitor.isNativePlatform() === true):',
    '//   rewrites /api/* calls to https://tapmycar.io/api/*',
    '// In browser (no Capacitor): no-op, existing behavior unchanged.',
    '',
    '(function () {',
    '  if (typeof window === "undefined") return;',
    '',
    '  function isCapacitor() {',
    '    try {',
    '      return !!(window.Capacitor &&',
    '                typeof window.Capacitor.isNativePlatform === "function" &&',
    '                window.Capacitor.isNativePlatform());',
    '    } catch (e) { return false; }',
    '  }',
    '',
    '  if (!isCapacitor()) return; // browser path: do nothing',
    '',
    '  var API_BASE = "https://tapmycar.io";',
    '',
    '  function rewrite(url) {',
    '    if (typeof url !== "string") return url;',
    '    if (url.indexOf("/api/") === 0) return API_BASE + url;',
    '    return url;',
    '  }',
    '',
    '  // Patch window.fetch',
    '  if (typeof window.fetch === "function") {',
    '    var origFetch = window.fetch.bind(window);',
    '    window.fetch = function (input, init) {',
    '      try {',
    '        if (typeof input === "string") {',
    '          input = rewrite(input);',
    '        } else if (input && typeof input.url === "string" &&',
    '                   input.url.indexOf("/api/") === 0) {',
    '          input = new Request(rewrite(input.url), input);',
    '        }',
    '      } catch (e) { /* fall through to original */ }',
    '      return origFetch(input, init);',
    '    };',
    '  }',
    '',
    '  // Patch XMLHttpRequest.open',
    '  if (typeof XMLHttpRequest !== "undefined" && XMLHttpRequest.prototype) {',
    '    var origOpen = XMLHttpRequest.prototype.open;',
    '    XMLHttpRequest.prototype.open = function (method, url) {',
    '      try {',
    '        if (typeof url === "string") {',
    '          arguments[1] = rewrite(url);',
    '        }',
    '      } catch (e) { /* fall through */ }',
    '      return origOpen.apply(this, arguments);',
    '    };',
    '  }',
    '',
    '  // expose for debugging',
    '  window.__TMC_API_BASE__ = API_BASE;',
    '})();',
    ''
  ].join('\n');

  if (fs.existsSync(apiBasePath)) backup(apiBasePath);
  fs.writeFileSync(apiBasePath, apiBaseContent, { encoding: 'utf8' });
  console.log('  ✓ Wrote ' + apiBasePath);

  // node --check syntax validation
  try {
    execSync('node --check "' + apiBasePath + '"', { stdio: 'pipe' });
    console.log('  ✓ Syntax valid');
  } catch (e) {
    throw new Error('tmc-api-base.js failed node --check: ' + e.message);
  }

  // ===================================================================
  // STEP 2 — Inject script tag into all HTML files in public/
  // ===================================================================
  logStep('Step 2: Inject script tag into public/*.html');

  const publicDir = 'public';
  if (!fs.existsSync(publicDir)) throw new Error('public/ directory not found');

  const htmlFiles = fs.readdirSync(publicDir).filter(f => f.endsWith('.html'));
  console.log('  Found ' + htmlFiles.length + ' HTML files');

  // EOL-tolerant match for <head ...> opening tag and following whitespace
  const headOpenRe = /<head(\s[^>]*)?>(\s*\r?\n?)/i;
  const scriptTag = '<script src="/tmc-api-base.js"></script>';

  let injected = 0, skipped = 0, warned = 0;

  for (const file of htmlFiles) {
    const filePath = path.join(publicDir, file);
    const content = fs.readFileSync(filePath, 'utf8');

    // Idempotent
    if (content.indexOf('tmc-api-base.js') !== -1) {
      console.log('  ⏩ ' + file + ' — already has interceptor');
      skipped++;
      continue;
    }

    if (!headOpenRe.test(content)) {
      console.log('  ⚠ ' + file + ' — no <head> tag found, skipped');
      warned++;
      continue;
    }

    backup(filePath);

    const newContent = safeReplace(content, headOpenRe, function (match, attrs, ws) {
      var attrsPart = attrs || '';
      var wsPart = ws || '\n';
      return '<head' + attrsPart + '>' + wsPart + '  ' + scriptTag + '\n';
    });

    fs.writeFileSync(filePath, newContent, { encoding: 'utf8' });
    console.log('  ✓ ' + file);
    injected++;
  }

  console.log('\n  Summary: ' + injected + ' injected, ' + skipped + ' already done, ' + warned + ' warnings');

  // ===================================================================
  // STEP 3 — Add CORS headers to vercel.json
  // ===================================================================
  logStep('Step 3: Add CORS headers to vercel.json');

  const vercelPath = 'vercel.json';
  if (!fs.existsSync(vercelPath)) throw new Error('vercel.json not found');

  backup(vercelPath);
  const vercelRaw = fs.readFileSync(vercelPath, 'utf8');
  let vercelConfig;
  try { vercelConfig = JSON.parse(vercelRaw); }
  catch (e) { throw new Error('vercel.json is not valid JSON: ' + e.message); }

  if (!Array.isArray(vercelConfig.headers)) vercelConfig.headers = [];

  const corsRuleExists = vercelConfig.headers.some(function (h) {
    return h && h.source === '/api/(.*)' && Array.isArray(h.headers) &&
           h.headers.some(function (hh) { return hh && hh.key === 'Access-Control-Allow-Origin'; });
  });

  if (corsRuleExists) {
    console.log('  ⏩ CORS rule already present in vercel.json');
  } else {
    vercelConfig.headers.push({
      source: '/api/(.*)',
      headers: [
        { key: 'Access-Control-Allow-Origin', value: '*' },
        { key: 'Access-Control-Allow-Methods', value: 'GET, POST, PUT, DELETE, OPTIONS, PATCH' },
        { key: 'Access-Control-Allow-Headers', value: 'Content-Type, Authorization, X-Requested-With' },
        { key: 'Access-Control-Max-Age', value: '86400' }
      ]
    });
    fs.writeFileSync(vercelPath, JSON.stringify(vercelConfig, null, 2) + '\n', { encoding: 'utf8' });
    console.log('  ✓ CORS rule added for /api/*');
  }

  // ===================================================================
  // STEP 4 — Mirror public/*.html → project root
  // ===================================================================
  logStep('Step 4: Sync public/*.html → project root');

  let synced = 0, skippedSync = 0;
  for (const file of htmlFiles) {
    const src = path.join(publicDir, file);
    const dest = file;
    if (!fs.existsSync(dest)) { skippedSync++; continue; }
    try { fs.copyFileSync(src, dest); synced++; }
    catch (e) { console.log('  ⚠ Could not sync ' + file + ': ' + e.message); }
  }
  console.log('  ✓ Synced ' + synced + ' HTML files to root (' + skippedSync + ' not present at root, skipped)');

  // ===================================================================
  // SUCCESS
  // ===================================================================
  console.log('\n╔══════════════════════════════════════════════════╗');
  console.log('║ TMC_PATCH66 complete ✓                           ║');
  console.log('╚══════════════════════════════════════════════════╝');
  console.log('\nBackup folder: ' + backupDir);
  console.log('To revert: copy files from backup folder back over current files.');
  console.log('\nNext steps:');
  console.log('  1. git add -A');
  console.log('  2. git commit -m "TMC_PATCH66: Capacitor foundation (api interceptor + CORS)"');
  console.log('  3. git push');
  console.log('  4. Wait ~60s for Vercel deploy');
  console.log('  5. Open tapmycar.io in incognito (fresh, cache cleared)');
  console.log('  6. Verify the site behaves exactly as before');
  console.log('     (DevTools Network tab: /api/* calls should still go to /api/* on tapmycar.io)');
  console.log('  7. Reply with "verified" — I will write Patch 67 (Capacitor install)\n');

} catch (err) {
  console.error('\n✗ PATCH FAILED: ' + err.message);
  if (err.stack) console.error(err.stack);
  restoreAll();
  process.exit(1);
}
