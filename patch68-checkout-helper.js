#!/usr/bin/env node
/**
 * TMC_PATCH68 — Platform-aware Stripe checkout
 *
 * Goals:
 *   1. Append window.tmcStartCheckout(url) helper to public/tmc-platform.js
 *   2. Replace `window.location.href = data.url` patterns in HTML files
 *      with `await window.tmcStartCheckout(data.url);`
 *   3. Mirror public/*.html → project root
 *
 * Behavior:
 *   - Website: window.location.href = url (identical to today)
 *   - In app: opens URL via @capacitor/browser (external Safari/Chrome)
 *   - Falls back to window.location.href if Browser plugin unavailable
 *   - Backward compatible. Idempotent. Safe to re-run.
 *
 * Run from inside the tapmycar project folder:
 *   node patch68-checkout-helper.js
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
const backupDir = 'backup-checkout-helper-' + stamp;

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

function safeReplace(str, pattern, replacement) {
  if (typeof replacement === 'function') return str.replace(pattern, replacement);
  return str.replace(pattern, function () { return replacement; });
}

// -------------------------------------------------------------------
// MAIN
// -------------------------------------------------------------------
console.log('\n╔══════════════════════════════════════════════════╗');
console.log('║ TMC_PATCH68 — Platform-aware Stripe checkout     ║');
console.log('╚══════════════════════════════════════════════════╝');
console.log('Backup folder: ' + backupDir);
fs.mkdirSync(backupDir, { recursive: true });

try {
  // ===================================================================
  // STEP 1 — Append tmcStartCheckout helper to public/tmc-platform.js
  // ===================================================================
  logStep('Step 1: Append tmcStartCheckout helper to public/tmc-platform.js');

  const platformJsPath = path.join('public', 'tmc-platform.js');
  if (!fs.existsSync(platformJsPath)) {
    throw new Error('public/tmc-platform.js not found. Did Patch 67 run successfully?');
  }

  let platformJs = fs.readFileSync(platformJsPath, 'utf8');

  // Idempotent — skip if marker already present
  if (platformJs.indexOf('TMC_PATCH68') !== -1) {
    console.log('  ⏩ tmcStartCheckout already present in tmc-platform.js');
  } else {
    backup(platformJsPath);

    const checkoutHelper = [
      '',
      '// TMC_PATCH68 — Platform-aware Stripe checkout helper',
      '//',
      '// Use this anywhere you would have done window.location.href = stripeUrl.',
      '// On web: identical behavior (window.location.href = url).',
      '// In app: opens URL in external browser via @capacitor/browser plugin.',
      '// Falls back to window.location.href if Browser plugin not available.',
      '',
      '(function () {',
      '  if (typeof window === \'undefined\') return;',
      '',
      '  window.tmcStartCheckout = async function (checkoutUrl) {',
      '    if (!checkoutUrl || typeof checkoutUrl !== \'string\') {',
      '      console.error(\'tmcStartCheckout: invalid url\', checkoutUrl);',
      '      return;',
      '    }',
      '',
      '    // On web: normal redirect',
      '    if (!window.tmcIsInApp) {',
      '      window.location.href = checkoutUrl;',
      '      return;',
      '    }',
      '',
      '    // In app: open in external browser (Safari/Chrome)',
      '    try {',
      '      if (window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.Browser) {',
      '        await window.Capacitor.Plugins.Browser.open({ url: checkoutUrl });',
      '        return;',
      '      }',
      '    } catch (e) {',
      '      console.error(\'Browser plugin failed, falling back:\', e);',
      '    }',
      '',
      '    // Fallback if Browser plugin unavailable',
      '    window.location.href = checkoutUrl;',
      '  };',
      '})();',
      ''
    ].join('\n');

    if (!platformJs.endsWith('\n')) platformJs += '\n';
    platformJs += checkoutHelper;
    fs.writeFileSync(platformJsPath, platformJs, { encoding: 'utf8' });
    console.log('  ✓ Appended tmcStartCheckout helper');

    // Validate
    try {
      execSync('node --check "' + platformJsPath + '"', { stdio: 'pipe' });
      console.log('  ✓ Syntax valid');
    } catch (e) {
      throw new Error('tmc-platform.js failed node --check after append: ' + e.message);
    }
  }

  // ===================================================================
  // STEP 2 — Replace window.location.href = data.url in HTML files
  // ===================================================================
  logStep('Step 2: Replace Stripe checkout redirects in HTML files');

  const publicDir = 'public';
  const htmlFiles = fs.readdirSync(publicDir).filter(f => f.endsWith('.html'));
  console.log('  Scanning ' + htmlFiles.length + ' HTML files');

  // Match: window.location.href = data.url; (with various whitespace, optional semicolon)
  const pattern = /window\.location\.href\s*=\s*data\.url\s*;?/g;
  const replacement = 'await window.tmcStartCheckout(data.url);';

  let modified = 0, skipped = 0, noMatch = 0;

  for (const file of htmlFiles) {
    const filePath = path.join(publicDir, file);
    const content = fs.readFileSync(filePath, 'utf8');

    // Idempotent — skip if already using the helper
    if (content.indexOf('tmcStartCheckout') !== -1) {
      console.log('  ⏩ ' + file + ' — already uses tmcStartCheckout');
      skipped++;
      continue;
    }

    // Check if pattern exists
    if (!pattern.test(content)) {
      noMatch++;
      continue;
    }
    pattern.lastIndex = 0; // reset regex

    backup(filePath);
    const newContent = content.replace(pattern, replacement);
    const matchCount = (content.match(pattern) || []).length;

    fs.writeFileSync(filePath, newContent, { encoding: 'utf8' });
    console.log('  ✓ ' + file + ' — replaced ' + matchCount + ' occurrence(s)');
    modified++;
  }

  console.log('\n  Summary: ' + modified + ' files modified, ' + skipped + ' already done, ' + noMatch + ' had no Stripe redirect pattern');

  if (modified === 0 && skipped === 0) {
    console.log('  ⚠ No Stripe checkout redirects found anywhere — verify this is expected.');
  }

  // ===================================================================
  // STEP 3 — Mirror public/*.html → project root
  // ===================================================================
  logStep('Step 3: Sync public/*.html → project root');

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
  console.log('║ TMC_PATCH68 complete ✓                           ║');
  console.log('╚══════════════════════════════════════════════════╝');
  console.log('\nBackup folder: ' + backupDir);
  console.log('\nNext steps:');
  console.log('  1. git add -A');
  console.log('  2. git commit -m "TMC_PATCH68: Platform-aware Stripe checkout"');
  console.log('  3. git push');
  console.log('  4. Wait ~60s for Vercel deploy');
  console.log('  5. Open tapmycar.io in incognito');
  console.log('  6. Open DevTools console, type:  typeof tmcStartCheckout');
  console.log('     Should print: "function"');
  console.log('  7. Test the actual Stripe checkout: log in, try to upgrade/renew');
  console.log('     The redirect to Stripe should work IDENTICALLY to before');
  console.log('  8. Reply "verified" and we proceed to Patch 69\n');

} catch (err) {
  console.error('\n✗ PATCH FAILED: ' + err.message);
  if (err.stack) console.error(err.stack);
  restoreAll();
  process.exit(1);
}
