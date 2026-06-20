#!/usr/bin/env node
/**
 * TMC_PATCH74 — Finalize manage.html iOS view
 *
 * Hides the remaining payment/upgrade UI on manage.html in iOS mode.
 * After this patch, iOS users on manage.html see only:
 *   - Tag details (the page's main function)
 *   - "Plans" iOS-only banner (Patch 72)
 *   - FREE DIGITAL OPTION card (free product, Apple-allowed)
 *   - Share TapMyCar card (referral, no payment)
 *
 * Adds class="tmc-hide-on-ios" to three elements:
 *   1. #upgraded-section — the green "You are on Standard plan / Upgrade..." notice
 *   2. [data-available-plans-heading] — "Available Plans" header (redundant in iOS)
 *   3. "Need a tag for another car?" container div (matched by style + content,
 *      since it has no ID)
 *
 * Idempotent. Safe to re-run. Backup on each change.
 *
 * Run from inside the tapmycar project folder:
 *   node patch74-finalize-manage-ios.js
 */

const fs = require('fs');
const path = require('path');

const now = new Date();
const pad = n => String(n).padStart(2, '0');
const stamp = [
  now.getFullYear(), pad(now.getMonth() + 1), pad(now.getDate()),
  pad(now.getHours()), pad(now.getMinutes())
].join('-');
const backupDir = 'backup-finalize-manage-ios-' + stamp;
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

// Add class to element identified by id. Idempotent.
function addClassToElementById(html, id, newClass) {
  const re = new RegExp('<([a-zA-Z][a-zA-Z0-9]*)([^>]*\\bid=["\']' + id + '["\'][^>]*)>', 'g');
  let matched = false;
  const out = html.replace(re, function (full, tagName, attrs) {
    matched = true;
    const classMatch = attrs.match(/\bclass=(["'])([^"']*)\1/);
    if (classMatch) {
      const existing = classMatch[2].split(/\s+/).filter(Boolean);
      if (existing.indexOf(newClass) !== -1) return full;
      const newAttrs = attrs.replace(classMatch[0],
        'class=' + classMatch[1] + existing.concat(newClass).join(' ') + classMatch[1]);
      return '<' + tagName + newAttrs + '>';
    }
    return '<' + tagName + ' class="' + newClass + '"' + attrs + '>';
  });
  return { html: out, matched: matched };
}

// Add class to element matched by a data attribute (e.g. data-available-plans-heading). Idempotent.
function addClassToElementByDataAttr(html, dataAttr, newClass) {
  const re = new RegExp('<([a-zA-Z][a-zA-Z0-9]*)([^>]*\\b' + dataAttr + '\\b[^>]*)>', 'g');
  let matched = false;
  const out = html.replace(re, function (full, tagName, attrs) {
    matched = true;
    const classMatch = attrs.match(/\bclass=(["'])([^"']*)\1/);
    if (classMatch) {
      const existing = classMatch[2].split(/\s+/).filter(Boolean);
      if (existing.indexOf(newClass) !== -1) return full;
      const newAttrs = attrs.replace(classMatch[0],
        'class=' + classMatch[1] + existing.concat(newClass).join(' ') + classMatch[1]);
      return '<' + tagName + newAttrs + '>';
    }
    return '<' + tagName + ' class="' + newClass + '"' + attrs + '>';
  });
  return { html: out, matched: matched };
}

console.log('\n╔══════════════════════════════════════════════════╗');
console.log('║ TMC_PATCH74 — Finalize manage.html iOS view      ║');
console.log('╚══════════════════════════════════════════════════╝');
console.log('Backup folder: ' + backupDir);
fs.mkdirSync(backupDir, { recursive: true });

try {
  const managePath = path.join('public', 'manage.html');
  if (!fs.existsSync(managePath)) throw new Error('public/manage.html not found');

  let manageContent = fs.readFileSync(managePath, 'utf8');
  const manageOriginal = manageContent;

  // ===================================================================
  // STEP 1 — Hide #upgraded-section (green Standard plan notice)
  // ===================================================================
  logStep('Step 1: Hide #upgraded-section in iOS');

  const upgradedResult = addClassToElementById(manageContent, 'upgraded-section', 'tmc-hide-on-ios');
  if (!upgradedResult.matched) {
    console.log('  ⚠ #upgraded-section not found — skipping');
  } else if (upgradedResult.html === manageContent) {
    console.log('  ⏩ #upgraded-section already has tmc-hide-on-ios');
  } else {
    console.log('  ✓ Added tmc-hide-on-ios to #upgraded-section');
    manageContent = upgradedResult.html;
  }

  // ===================================================================
  // STEP 2 — Hide "Available Plans" heading
  // ===================================================================
  logStep('Step 2: Hide [data-available-plans-heading] in iOS');

  const headingResult = addClassToElementByDataAttr(manageContent, 'data-available-plans-heading', 'tmc-hide-on-ios');
  if (!headingResult.matched) {
    console.log('  ⚠ Available Plans heading not found — skipping');
  } else if (headingResult.html === manageContent) {
    console.log('  ⏩ Available Plans heading already has tmc-hide-on-ios');
  } else {
    console.log('  ✓ Added tmc-hide-on-ios to Available Plans heading');
    manageContent = headingResult.html;
  }

  // ===================================================================
  // STEP 3 — Hide "Need a tag for another car?" container
  // ===================================================================
  logStep('Step 3: Hide "Need a tag for another car?" container in iOS');

  // Idempotence — check if the container already has the class
  const needTagDiv = /<div(\s+class="[^"]*tmc-hide-on-ios[^"]*"\s+style="margin-bottom:14px;background:var\(--gbl\);border-radius:14px;padding:16px;border:\.5px solid var\(--bd\)"\s*>\s*<div[^>]*>Need a tag for another car\?)/;
  if (needTagDiv.test(manageContent)) {
    console.log('  ⏩ "Need a tag" container already has tmc-hide-on-ios');
  } else {
    // Match the opening div (without class) right before the "Need a tag" inner div
    const re = /(<div)(\s+style="margin-bottom:14px;background:var\(--gbl\);border-radius:14px;padding:16px;border:\.5px solid var\(--bd\)"\s*>\s*<div[^>]*>Need a tag for another car\?)/;
    if (!re.test(manageContent)) {
      console.log('  ⚠ "Need a tag" container not found — skipping');
    } else {
      manageContent = manageContent.replace(re, function (m, tagOpen, rest) {
        return tagOpen + ' class="tmc-hide-on-ios"' + rest;
      });
      console.log('  ✓ Added tmc-hide-on-ios to "Need a tag" container');
    }
  }

  // ===================================================================
  // Save changes
  // ===================================================================
  if (manageContent !== manageOriginal) {
    backup(managePath);
    fs.writeFileSync(managePath, manageContent, { encoding: 'utf8' });
    console.log('\n  ✓ Saved updated manage.html');
  } else {
    console.log('\n  ⏩ No changes needed to manage.html');
  }

  // ===================================================================
  // STEP 4 — Mirror public/*.html → project root
  // ===================================================================
  logStep('Step 4: Sync public/*.html → project root');

  const publicDir = 'public';
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
  console.log('║ TMC_PATCH74 complete ✓                           ║');
  console.log('╚══════════════════════════════════════════════════╝');
  console.log('\nBackup folder: ' + backupDir);
  console.log('\nNext steps:');
  console.log('  1. git add -A');
  console.log('  2. git commit -m "TMC_PATCH74: Finalize manage.html iOS view"');
  console.log('  3. git push');
  console.log('  4. Wait ~60s for Vercel deploy');
  console.log('  5. Hard refresh tapmycar.io/manage.html (Ctrl+Shift+R)');
  console.log('  6. DevTools console: document.body.classList.add("tmc-platform-ios")');
  console.log('  7. Should now see ONLY:');
  console.log('     - Tag details card (SUBARU IMPREZA)');
  console.log('     - "Plans" iOS banner (white card, View Plans button on right)');
  console.log('     - "FREE DIGITAL OPTION" card');
  console.log('     - "Share TapMyCar" card');
  console.log('  8. Should NOT see:');
  console.log('     - "You are on Standard plan" green notice');
  console.log('     - "Available Plans" header');
  console.log('     - "Need a tag for another car?" section');
  console.log('  9. Reply "verified" — next is Patch 75 (Capgo OTA)\n');

} catch (err) {
  console.error('\n✗ PATCH FAILED: ' + err.message);
  if (err.stack) console.error(err.stack);
  restoreAll();
  process.exit(1);
}
