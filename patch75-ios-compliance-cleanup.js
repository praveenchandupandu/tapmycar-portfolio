#!/usr/bin/env node
/**
 * TMC_PATCH75 — iOS compliance audit cleanup
 *
 * Three changes based on a full audit of all HTML pages:
 *
 *   1. dashboard.html — hide the "Get the TapMyCar App" download banner
 *      in iOS (it's nonsensical inside the app itself)
 *
 *   2. help.html — hide 3 pricing-containing FAQ items in iOS:
 *      "Is there a free version?", "How much does TapMyCar cost?",
 *      "Can I upgrade from Standard to Premium?"
 *
 *   3. tmc-page-guard.js — add 3 more pages to the iOS-blocked list:
 *      /activate.html, /business.html, /for-tow-companies.html
 *      AND preserve query strings + hash on redirect so activation
 *      tokens (e.g. ?token=xxx) carry through to the web flow.
 *
 * Idempotent. Backup on each change. Safe to re-run.
 *
 * Run from inside the tapmycar project folder:
 *   node patch75-ios-compliance-cleanup.js
 */

const fs = require('fs');
const path = require('path');

const now = new Date();
const pad = n => String(n).padStart(2, '0');
const stamp = [
  now.getFullYear(), pad(now.getMonth() + 1), pad(now.getDate()),
  pad(now.getHours()), pad(now.getMinutes())
].join('-');
const backupDir = 'backup-ios-compliance-' + stamp;
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
}

console.log('\n╔══════════════════════════════════════════════════╗');
console.log('║ TMC_PATCH75 — iOS compliance cleanup             ║');
console.log('╚══════════════════════════════════════════════════╝');
console.log('Backup folder: ' + backupDir);
fs.mkdirSync(backupDir, { recursive: true });

try {
  const publicDir = 'public';

  // ===================================================================
  // STEP 1 — Hide App Download Banner in dashboard.html
  // ===================================================================
  logStep('Step 1: Hide App Download Banner in dashboard.html');

  const dashboardPath = path.join(publicDir, 'dashboard.html');
  if (!fs.existsSync(dashboardPath)) throw new Error('dashboard.html not found');

  let dashContent = fs.readFileSync(dashboardPath, 'utf8');
  const dashOriginal = dashContent;

  // Check if already marked
  if (/<!--\s*7\.\s*APP DOWNLOAD BANNER\s*-->\s*<div\s+class="[^"]*tmc-hide-on-ios/.test(dashContent)) {
    console.log('  ⏩ App Download Banner already has tmc-hide-on-ios');
  } else {
    // Match the comment + opening div with the unique style
    const re = /(<!--\s*7\.\s*APP DOWNLOAD BANNER\s*-->\s*<div)(\s+style="margin:0 12px 14px;background:linear-gradient\(135deg,#111 60%,#2a1500\)[^"]*")/;
    if (!re.test(dashContent)) {
      console.log('  ⚠ App Download Banner not found — skipping');
    } else {
      backup(dashboardPath);
      dashContent = dashContent.replace(re, '$1 class="tmc-hide-on-ios"$2');
      console.log('  ✓ Added tmc-hide-on-ios to App Download Banner');
    }
  }

  if (dashContent !== dashOriginal) {
    fs.writeFileSync(dashboardPath, dashContent, { encoding: 'utf8' });
    console.log('  ✓ Saved updated dashboard.html');
  }

  // ===================================================================
  // STEP 2 — Hide pricing FAQs in help.html
  // ===================================================================
  logStep('Step 2: Hide pricing FAQs in help.html');

  const helpPath = path.join(publicDir, 'help.html');
  if (!fs.existsSync(helpPath)) {
    console.log('  ⚠ help.html not found — skipping');
  } else {
    let helpContent = fs.readFileSync(helpPath, 'utf8');
    const helpOriginal = helpContent;

    // FAQ items to hide (matched by question text). The .help-item div wraps
    // each FAQ. We add tmc-hide-on-ios to the wrapper.
    const faqsToHide = [
      'Is there a free version?',
      'How much does TapMyCar cost?',
      'Can I upgrade from Standard to Premium?'
    ];

    for (const q of faqsToHide) {
      // Escape special regex chars in the question
      const qEsc = q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      // Match: <div class="help-item"...> followed by <div class="help-q">QUESTION
      const re = new RegExp(
        '(<div\\s+class=")help-item(")([^>]*>\\s*<div[^>]*class="help-q"[^>]*>' + qEsc + ')',
        ''
      );
      const alreadyDoneRe = new RegExp(
        '<div\\s+class="help-item\\s+tmc-hide-on-ios"[^>]*>\\s*<div[^>]*class="help-q"[^>]*>' + qEsc,
        ''
      );

      if (alreadyDoneRe.test(helpContent)) {
        console.log('  ⏩ FAQ "' + q + '" already hidden');
        continue;
      }

      if (!re.test(helpContent)) {
        console.log('  ⚠ FAQ "' + q + '" not found — skipping');
        continue;
      }

      if (helpContent === helpOriginal) backup(helpPath);
      helpContent = helpContent.replace(re, '$1help-item tmc-hide-on-ios$2$3');
      console.log('  ✓ Hidden FAQ: "' + q + '"');
    }

    if (helpContent !== helpOriginal) {
      fs.writeFileSync(helpPath, helpContent, { encoding: 'utf8' });
      console.log('  ✓ Saved updated help.html');
    }
  }

  // ===================================================================
  // STEP 3 — Update tmc-page-guard.js with more blocked pages + query preservation
  // ===================================================================
  logStep('Step 3: Update tmc-page-guard.js (block more pages + preserve query strings)');

  const guardPath = path.join(publicDir, 'tmc-page-guard.js');
  if (!fs.existsSync(guardPath)) {
    console.log('  ⚠ tmc-page-guard.js not found — skipping');
  } else {
    let guardContent = fs.readFileSync(guardPath, 'utf8');
    const guardOriginal = guardContent;

    // Check if already patched (marker: TMC_PATCH75)
    if (guardContent.indexOf('TMC_PATCH75') !== -1) {
      console.log('  ⏩ tmc-page-guard.js already patched');
    } else {
      backup(guardPath);

      // Replace the BLOCKED_IN_IOS object with the expanded version
      const oldBlockedRe = /var BLOCKED_IN_IOS = \{[\s\S]*?\};/;
      const newBlocked = [
        '// TMC_PATCH75 — expanded list + query/hash preservation',
        '  var BLOCKED_IN_IOS = {',
        '    \'/pricing.html\':           \'/pricing\',',
        '    \'/renew.html\':             \'/renew\',',
        '    \'/billing.html\':           \'/billing\',',
        '    \'/activate.html\':          \'/activate\',',
        '    \'/business.html\':          \'/business\',',
        '    \'/for-tow-companies.html\': \'/for-tow-companies\',',
        '    \'/pricing\':       \'/pricing\',',
        '    \'/renew\':         \'/renew\',',
        '    \'/billing\':       \'/billing\',',
        '    \'/activate\':      \'/activate\',',
        '    \'/business\':      \'/business\',',
        '    \'/for-tow-companies\': \'/for-tow-companies\'',
        '  };'
      ].join('\n  ');

      if (oldBlockedRe.test(guardContent)) {
        guardContent = guardContent.replace(oldBlockedRe, newBlocked);
        console.log('  ✓ Expanded BLOCKED_IN_IOS list with activate, business, for-tow-companies');
      } else {
        console.log('  ⚠ BLOCKED_IN_IOS not found in expected format');
      }

      // Update the redirect URL construction to preserve query string + hash
      // Old: var webUrl = 'https://tapmycar.io' + webPath;
      const oldUrlRe = /var webUrl = 'https:\/\/tapmycar\.io' \+ webPath;/;
      const newUrlLine = 'var webUrl = \'https://tapmycar.io\' + webPath + (window.location.search || \'\') + (window.location.hash || \'\');';

      if (oldUrlRe.test(guardContent)) {
        guardContent = guardContent.replace(oldUrlRe, newUrlLine);
        console.log('  ✓ Updated redirect to preserve query string + hash');
      } else {
        console.log('  ⚠ webUrl construction line not found — skipping query preservation');
      }

      if (guardContent !== guardOriginal) {
        fs.writeFileSync(guardPath, guardContent, { encoding: 'utf8' });
        console.log('  ✓ Saved updated tmc-page-guard.js');

        // Sanity check JS
        const { execSync } = require('child_process');
        try {
          execSync('node --check "' + guardPath + '"', { stdio: 'pipe' });
          console.log('  ✓ Syntax valid');
        } catch (e) {
          throw new Error('tmc-page-guard.js failed node --check: ' + e.message);
        }
      }
    }
  }

  // ===================================================================
  // STEP 4 — Mirror public/*.html → project root
  // ===================================================================
  logStep('Step 4: Sync public/*.html → project root');

  const htmlFiles = fs.readdirSync(publicDir).filter(f => f.endsWith('.html'));
  let synced = 0, skippedSync = 0;
  for (const file of htmlFiles) {
    const src = path.join(publicDir, file);
    const dest = file;
    if (!fs.existsSync(dest)) { skippedSync++; continue; }
    try { fs.copyFileSync(src, dest); synced++; }
    catch (e) { console.log('  ⚠ Could not sync ' + file + ': ' + e.message); }
  }
  console.log('  ✓ Synced ' + synced + ' HTML files to root (' + skippedSync + ' not present at root, skipped)');

  console.log('\n╔══════════════════════════════════════════════════╗');
  console.log('║ TMC_PATCH75 complete ✓                           ║');
  console.log('╚══════════════════════════════════════════════════╝');
  console.log('\nBackup folder: ' + backupDir);
  console.log('\nNext steps:');
  console.log('  1. git add -A');
  console.log('  2. git commit -m "TMC_PATCH75: iOS compliance audit cleanup"');
  console.log('  3. git push');
  console.log('  4. Wait ~60s for Vercel deploy');
  console.log('  5. Hard refresh tapmycar.io/dashboard.html (Ctrl+Shift+R)');
  console.log('  6. DevTools: document.body.classList.add("tmc-platform-ios")');
  console.log('  7. Scroll to bottom — App Download Banner should be GONE');
  console.log('  8. Visit /help.html in iOS preview — 3 pricing FAQs should be hidden');
  console.log('  9. Reply "verified" when it looks clean\n');

} catch (err) {
  console.error('\n✗ PATCH FAILED: ' + err.message);
  if (err.stack) console.error(err.stack);
  restoreAll();
  process.exit(1);
}
