#!/usr/bin/env node
/**
 * TMC_PATCH69 — iOS Path A enforcement (foundation)
 *
 * Goals:
 *   1. Create public/tmc-ios-mode.css — platform-targeted CSS rules
 *   2. Create public/tmc-page-guard.js — auto-redirect payment-only pages
 *      out of the iOS app to Safari (tapmycar.io equivalent)
 *   3. Inject <link rel="stylesheet" href="/tmc-ios-mode.css"> into all
 *      public/*.html files (in <head>)
 *   4. Inject <script src="/tmc-page-guard.js"></script> after the existing
 *      platform helper scripts (tmc-api-base.js, tmc-platform.js)
 *   5. Mirror public/*.html → project root
 *
 * Behavior:
 *   - Website: zero visible change (no .tmc-platform-ios class exists, guard idle)
 *   - Android app: same as web (guard does not trigger for Android)
 *   - iOS app: pricing.html, renew.html, billing.html auto-redirect to Safari
 *     opening the equivalent tapmycar.io URL, and the app returns to dashboard.
 *   - CSS framework ready for marking specific elements with:
 *       .tmc-ios-only (show only in iOS app)
 *       .tmc-hide-on-ios (hide in iOS app)
 *       .tmc-android-only, .tmc-web-only (parallel)
 *
 * Idempotent. Safe to re-run.
 *
 * Run from inside the tapmycar project folder:
 *   node patch69-ios-mode-foundation.js
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
const backupDir = 'backup-ios-mode-' + stamp;

const restoreQueue = [];

function logStep(label) { console.log('\n=== ' + label + ' ==='); }

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

function safeReplace(str, pattern, replacement) {
  if (typeof replacement === 'function') return str.replace(pattern, replacement);
  return str.replace(pattern, function () { return replacement; });
}

// -------------------------------------------------------------------
// MAIN
// -------------------------------------------------------------------
console.log('\n╔══════════════════════════════════════════════════╗');
console.log('║ TMC_PATCH69 — iOS Path A enforcement             ║');
console.log('╚══════════════════════════════════════════════════╝');
console.log('Backup folder: ' + backupDir);
fs.mkdirSync(backupDir, { recursive: true });

try {
  // ===================================================================
  // STEP 1 — Create public/tmc-ios-mode.css
  // ===================================================================
  logStep('Step 1: Create public/tmc-ios-mode.css');

  const cssPath = path.join('public', 'tmc-ios-mode.css');
  const cssContent = [
    '/* TMC_PATCH69 — Platform-targeted display rules */',
    '/*',
    ' *  Use these classes to show/hide elements per platform.',
    ' *  Body classes (.tmc-platform-ios | .tmc-platform-android | .tmc-platform-web)',
    ' *  are added by tmc-platform.js (Patch 67) on DOMContentLoaded.',
    ' */',
    '',
    '/* Hide by default — shown only in iOS app */',
    '.tmc-ios-only { display: none !important; }',
    'body.tmc-platform-ios .tmc-ios-only { display: block !important; }',
    '',
    '/* Hide by default — shown only in Android app */',
    '.tmc-android-only { display: none !important; }',
    'body.tmc-platform-android .tmc-android-only { display: block !important; }',
    '',
    '/* Hide by default — shown only in web (no Capacitor) */',
    '.tmc-web-only { display: none !important; }',
    'body.tmc-in-web .tmc-web-only { display: block !important; }',
    '',
    '/* Hide only in iOS app (visible everywhere else) */',
    'body.tmc-platform-ios .tmc-hide-on-ios { display: none !important; }',
    '',
    '/* Hide only in Android app (visible everywhere else) */',
    'body.tmc-platform-android .tmc-hide-on-android { display: none !important; }',
    '',
    '/* Hide only in native apps — visible only on web */',
    'body.tmc-in-app .tmc-hide-in-app { display: none !important; }',
    '',
    '/* Show only in native apps — hidden on web */',
    '.tmc-app-only { display: none !important; }',
    'body.tmc-in-app .tmc-app-only { display: block !important; }',
    ''
  ].join('\n');

  if (fs.existsSync(cssPath)) {
    backup(cssPath);
    console.log('  ⏩ tmc-ios-mode.css already exists — overwriting (backup saved)');
  }
  fs.writeFileSync(cssPath, cssContent, { encoding: 'utf8' });
  console.log('  ✓ Wrote ' + cssPath);

  // ===================================================================
  // STEP 2 — Create public/tmc-page-guard.js
  // ===================================================================
  logStep('Step 2: Create public/tmc-page-guard.js');

  const guardPath = path.join('public', 'tmc-page-guard.js');
  const guardContent = [
    '// TMC_PATCH69 — iOS page guard',
    '//',
    '// In iOS Path A mode, certain pages must NOT be viewable inside the app',
    '// because they display pricing/payment UI. This script auto-redirects',
    '// the iOS user to Safari (tapmycar.io equivalent) and returns the app',
    '// to the dashboard. Web and Android: no-op.',
    '',
    '(function () {',
    '  if (typeof window === \'undefined\') return;',
    '',
    '  // Pages to block in iOS mode. Map: app-page → web-page.',
    '  // Add more paths here as we identify payment-only pages.',
    '  var BLOCKED_IN_IOS = {',
    '    \'/pricing.html\':  \'/pricing\',',
    '    \'/renew.html\':    \'/renew\',',
    '    \'/billing.html\':  \'/billing\',',
    '    \'/pricing\':       \'/pricing\',',
    '    \'/renew\':         \'/renew\',',
    '    \'/billing\':       \'/billing\'',
    '  };',
    '',
    '  function isIOS() {',
    '    try {',
    '      return !!(window.Capacitor &&',
    '                typeof window.Capacitor.getPlatform === \'function\' &&',
    '                window.Capacitor.getPlatform() === \'ios\');',
    '    } catch (e) { return false; }',
    '  }',
    '',
    '  function currentPath() {',
    '    var p = window.location.pathname || \'/\';',
    '    // Normalize: strip trailing slash unless root',
    '    if (p.length > 1 && p.charAt(p.length - 1) === \'/\') p = p.slice(0, -1);',
    '    return p;',
    '  }',
    '',
    '  function check() {',
    '    if (!isIOS()) return;',
    '',
    '    var path = currentPath();',
    '    var webPath = BLOCKED_IN_IOS[path];',
    '    if (!webPath) return;',
    '',
    '    var webUrl = \'https://tapmycar.io\' + webPath;',
    '    console.log(\'[tmc-page-guard] iOS — redirecting blocked page \' + path + \' → \' + webUrl);',
    '',
    '    // Open the web equivalent in external Safari',
    '    try {',
    '      if (window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.Browser) {',
    '        window.Capacitor.Plugins.Browser.open({ url: webUrl });',
    '      }',
    '    } catch (e) { /* swallow */ }',
    '',
    '    // Send the in-app view back to dashboard so the user lands somewhere useful',
    '    setTimeout(function () {',
    '      window.location.replace(\'/dashboard.html\');',
    '    }, 100);',
    '  }',
    '',
    '  // Check as soon as the script runs (before DOM, before page render)',
    '  check();',
    '})();',
    ''
  ].join('\n');

  if (fs.existsSync(guardPath)) backup(guardPath);
  fs.writeFileSync(guardPath, guardContent, { encoding: 'utf8' });
  console.log('  ✓ Wrote ' + guardPath);

  // node --check syntax validation
  try {
    execSync('node --check "' + guardPath + '"', { stdio: 'pipe' });
    console.log('  ✓ Syntax valid');
  } catch (e) {
    throw new Error('tmc-page-guard.js failed node --check: ' + e.message);
  }

  // ===================================================================
  // STEP 3 — Inject CSS link + page guard script into all HTML files
  // ===================================================================
  logStep('Step 3: Inject CSS link + guard script into public/*.html');

  const publicDir = 'public';
  const htmlFiles = fs.readdirSync(publicDir).filter(f => f.endsWith('.html'));
  console.log('  Found ' + htmlFiles.length + ' HTML files');

  // We inject after tmc-platform.js (Patch 67) so platform detection is ready.
  // If not found, we fall back to injecting at top of <head>.
  const platformTagRe = /(<script[^>]*src="\/tmc-platform\.js"[^>]*><\/script>)(\s*\r?\n?)/i;
  const headOpenRe = /<head(\s[^>]*)?>(\s*\r?\n?)/i;

  const cssLink = '<link rel="stylesheet" href="/tmc-ios-mode.css">';
  const guardScript = '<script src="/tmc-page-guard.js"></script>';
  const blockToInject = cssLink + '\n  ' + guardScript;

  let injected = 0, skipped = 0, warned = 0;

  for (const file of htmlFiles) {
    const filePath = path.join(publicDir, file);
    const content = fs.readFileSync(filePath, 'utf8');

    // Idempotent — skip if already injected
    if (content.indexOf('tmc-ios-mode.css') !== -1 || content.indexOf('tmc-page-guard.js') !== -1) {
      console.log('  ⏩ ' + file + ' — already has iOS mode files');
      skipped++;
      continue;
    }

    backup(filePath);
    let newContent;

    if (platformTagRe.test(content)) {
      // Inject right after tmc-platform.js script tag (preferred)
      newContent = safeReplace(content, platformTagRe, function (match, tag, ws) {
        var wsPart = ws || '\n';
        return tag + wsPart + '  ' + blockToInject + '\n';
      });
    } else if (headOpenRe.test(content)) {
      // Fallback: top of head
      console.log('  ⚠ ' + file + ' — no tmc-platform.js tag found, injecting at top of <head>');
      newContent = safeReplace(content, headOpenRe, function (match, attrs, ws) {
        var attrsPart = attrs || '';
        var wsPart = ws || '\n';
        return '<head' + attrsPart + '>' + wsPart + '  ' + blockToInject + '\n';
      });
      warned++;
    } else {
      console.log('  ⚠ ' + file + ' — no <head> tag found, skipped');
      warned++;
      continue;
    }

    fs.writeFileSync(filePath, newContent, { encoding: 'utf8' });
    console.log('  ✓ ' + file);
    injected++;
  }

  console.log('\n  Summary: ' + injected + ' injected, ' + skipped + ' already done, ' + warned + ' warnings');

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
  console.log('║ TMC_PATCH69 complete ✓                           ║');
  console.log('╚══════════════════════════════════════════════════╝');
  console.log('\nBackup folder: ' + backupDir);
  console.log('\nNext steps:');
  console.log('  1. git add -A');
  console.log('  2. git commit -m "TMC_PATCH69: iOS Path A enforcement foundation"');
  console.log('  3. git push');
  console.log('  4. Wait ~60s for Vercel deploy');
  console.log('  5. Open tapmycar.io in incognito');
  console.log('  6. Visit /pricing.html, /renew.html, /billing.html — they should ALL');
  console.log('     load and behave EXACTLY as before (no redirect on web)');
  console.log('  7. Open DevTools console — should be no errors');
  console.log('  8. Optional: Type document.body.classList — should show tmc-platform-web,');
  console.log('     tmc-in-web (no iOS-related classes)');
  console.log('  9. Reply "verified" and we proceed to Patch 70\n');

} catch (err) {
  console.error('\n✗ PATCH FAILED: ' + err.message);
  if (err.stack) console.error(err.stack);
  restoreAll();
  process.exit(1);
}
