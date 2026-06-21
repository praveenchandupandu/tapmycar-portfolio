#!/usr/bin/env node
/**
 * TMC_PATCH79 — Smart entry point routing for native app
 *
 * Problem:
 *   When the app opens, it loads index.html (marketing landing page).
 *   This shows "Get the App Free →" button which is nonsensical in-app,
 *   and makes signed-in users think they've been signed out.
 *
 * Solution:
 *   Add inline script at the top of index.html that runs ONLY when
 *   inside Capacitor (iOS or Android). The script checks for a stored
 *   session token and routes:
 *     - Token exists  → /dashboard.html (user is signed in)
 *     - No token     → /signin.html  (user needs to sign in)
 *   Web users (no Capacitor) → unchanged, landing page renders normally.
 *
 * Uses location.replace() so the landing page never enters history.
 * Hides the body with CSS until redirect happens (no flash of content).
 *
 * Works on iOS AND Android (same code, since both run Capacitor).
 *
 * Idempotent. Safe to re-run.
 *
 * Run from inside the tapmycar project folder:
 *   node patch79-app-entry-redirect.js
 */

const fs = require('fs');
const path = require('path');

const now = new Date();
const pad = n => String(n).padStart(2, '0');
const stamp = [
  now.getFullYear(), pad(now.getMonth() + 1), pad(now.getDate()),
  pad(now.getHours()), pad(now.getMinutes())
].join('-');
const backupDir = 'backup-app-entry-redirect-' + stamp;

function backup(filePath) {
  if (!fs.existsSync(filePath)) return;
  const dest = path.join(backupDir, filePath);
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.copyFileSync(filePath, dest);
}

console.log('\n╔══════════════════════════════════════════════════╗');
console.log('║ TMC_PATCH79 — Smart app entry point routing      ║');
console.log('╚══════════════════════════════════════════════════╝');
fs.mkdirSync(backupDir, { recursive: true });

const ENTRY_SCRIPT = [
  '<script>',
  '  // TMC_PATCH79_ENTRY_REDIRECT — skip landing page when running inside the app.',
  '  // Web users (no Capacitor) see the landing page normally.',
  '  (function () {',
  '    try {',
  '      var inApp = !!(window.Capacitor &&',
  '                     typeof window.Capacitor.isNativePlatform === "function" &&',
  '                     window.Capacitor.isNativePlatform());',
  '      if (!inApp) return;',
  '      // Hide body immediately to prevent flash of landing page content',
  '      var styleEl = document.createElement("style");',
  '      styleEl.textContent = "body{visibility:hidden!important;background:#FF6B00!important}";',
  '      (document.head || document.documentElement).appendChild(styleEl);',
  '      var token = localStorage.getItem("tmc_token") ||',
  '                  localStorage.getItem("tmc_session_token");',
  '      var dest = token ? "/dashboard.html" : "/signin.html";',
  '      window.location.replace(dest);',
  '    } catch (e) { /* fall through to normal rendering */ }',
  '  })();',
  '</script>'
].join('\n');

try {
  const indexPath = path.join('public', 'index.html');
  if (!fs.existsSync(indexPath)) throw new Error('public/index.html not found');

  let content = fs.readFileSync(indexPath, 'utf8');
  const original = content;

  // Idempotence
  if (content.indexOf('TMC_PATCH79_ENTRY_REDIRECT') !== -1) {
    console.log('\n  ⏩ Entry redirect already installed in index.html');
  } else {
    backup(indexPath);

    // Insert the script right after the opening <head> tag,
    // but AFTER any existing tmc-api-base.js / tmc-platform.js scripts
    // (because we need window.Capacitor to be available).
    //
    // The right place: after the platform helper scripts that set up
    // Capacitor detection. Looking for the platform.js script tag.
    const platformScriptRe = /(<script\s+src="\/tmc-platform\.js"\s*><\/script>)/;
    const apiBaseScriptRe = /(<script\s+src="\/tmc-api-base\.js"\s*><\/script>)/;
    const headOpenRe = /(<head[^>]*>)/i;

    if (platformScriptRe.test(content)) {
      content = content.replace(platformScriptRe, '$1\n  ' + ENTRY_SCRIPT);
      console.log('\n  ✓ Injected entry redirect after tmc-platform.js script');
    } else if (apiBaseScriptRe.test(content)) {
      content = content.replace(apiBaseScriptRe, '$1\n  ' + ENTRY_SCRIPT);
      console.log('\n  ✓ Injected entry redirect after tmc-api-base.js script');
    } else if (headOpenRe.test(content)) {
      content = content.replace(headOpenRe, '$1\n  ' + ENTRY_SCRIPT);
      console.log('\n  ✓ Injected entry redirect after <head> opening tag');
    } else {
      throw new Error('Could not find a place to inject the entry redirect script');
    }

    fs.writeFileSync(indexPath, content, { encoding: 'utf8' });
    console.log('  ✓ Saved updated index.html');
  }

  // Sync to root
  if (fs.existsSync('index.html')) {
    fs.copyFileSync(indexPath, 'index.html');
    console.log('  ✓ Synced index.html to project root');
  }

  console.log('\n╔══════════════════════════════════════════════════╗');
  console.log('║ TMC_PATCH79 complete ✓                           ║');
  console.log('╚══════════════════════════════════════════════════╝');
  console.log('\nIMPORTANT — Next steps:');
  console.log('  1. npx cap sync android');
  console.log('  2. git add -A && git commit -m "TMC_PATCH79: Smart app entry point routing" && git push');
  console.log('  3. Emulator: uninstall app, then Android Studio Build > Clean Project > ▶ Run');
  console.log('  4. App should now open DIRECTLY to /dashboard.html (you should still be signed in!)');
  console.log('     OR /signin.html if you were signed out');
  console.log('  5. The orange "Get the App Free →" landing page should NEVER appear in the app');
  console.log('  6. Web users at tapmycar.io still see the landing page normally\n');

} catch (err) {
  console.error('\n✗ PATCH FAILED: ' + err.message);
  if (err.stack) console.error(err.stack);
  process.exit(1);
}
