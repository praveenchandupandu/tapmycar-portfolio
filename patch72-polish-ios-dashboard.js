#!/usr/bin/env node
/**
 * TMC_PATCH72 — Polish iOS dashboard + Apple-safer subscription banner
 * (Updated: "Account Settings" instead of "Manage Account →" to avoid 3-Manage button confusion)
 *
 * Changes:
 *   1. Replace the Patch 70 iOS-only banner in dashboard.html and manage.html
 *      with a polished, Apple-safer design (white card, icon, subtle chip button).
 *      Dashboard button: "Account Settings"  (NOT "Manage Account" — that would
 *      conflict with existing "Manage" buttons in the tag card).
 *      Manage button:    "View Plans"
 *
 *   2. Insert an iOS-only "Help & Support" tile in dashboard.html action grid
 *      to fill the empty 2x2 slot left by hiding "Place Order" in iOS.
 *
 *   3. Fallback fix: if you previously ran an older Patch 72 that used
 *      "Manage Account →", update the leftover text to "Account Settings".
 *
 * Idempotent. Backups before any change. Auto-restore on failure.
 *
 * Run from inside the tapmycar project folder:
 *   node patch72-polish-ios-dashboard.js
 */

const fs = require('fs');
const path = require('path');

// Timestamped backup folder
const now = new Date();
const pad = n => String(n).padStart(2, '0');
const stamp = [
  now.getFullYear(), pad(now.getMonth() + 1), pad(now.getDate()),
  pad(now.getHours()), pad(now.getMinutes())
].join('-');
const backupDir = 'backup-polish-ios-dashboard-' + stamp;
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

// New banner — Dashboard (Account)
const NEW_BANNER_DASHBOARD = [
  '<!-- TMC_PATCH72_IOS_BANNER -->',
  '<div class="tmc-ios-only" style="background:#fff;border:1px solid #E5E7EB;border-radius:14px;padding:16px;margin-bottom:14px;font-family:Inter,system-ui,sans-serif">',
  '  <div style="display:flex;align-items:flex-start;gap:10px;margin-bottom:10px">',
  '    <div style="flex-shrink:0;width:32px;height:32px;border-radius:8px;background:#FFF1E5;display:flex;align-items:center;justify-content:center">',
  '      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#FF6B00" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="7" r="4"/><path d="M5 21v-2a4 4 0 0 1 4-4h6a4 4 0 0 1 4 4v2"/></svg>',
  '    </div>',
  '    <div style="flex:1;min-width:0">',
  '      <div style="font-size:13px;font-weight:700;color:#111;line-height:1.3;margin-bottom:2px">Account</div>',
  '      <div style="font-size:11px;color:#6B7280;line-height:1.4">Subscription details and account settings are managed at tapmycar.io.</div>',
  '    </div>',
  '  </div>',
  '  <a href="javascript:void(0)" onclick="window.tmcOpenWeb(\'/billing\')" style="display:inline-flex;align-items:center;gap:4px;background:#F3F4F6;color:#111;font-weight:600;font-size:12px;padding:7px 14px;border-radius:8px;text-decoration:none">Account Settings</a>',
  '</div>'
].join('\n    ');

// New banner — Manage (Plans)
const NEW_BANNER_MANAGE = [
  '<!-- TMC_PATCH72_IOS_BANNER -->',
  '<div class="tmc-ios-only" style="background:#fff;border:1px solid #E5E7EB;border-radius:14px;padding:16px;margin-bottom:14px;font-family:Inter,system-ui,sans-serif">',
  '  <div style="display:flex;align-items:flex-start;gap:10px;margin-bottom:10px">',
  '    <div style="flex-shrink:0;width:32px;height:32px;border-radius:8px;background:#FFF1E5;display:flex;align-items:center;justify-content:center">',
  '      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#FF6B00" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M9 9h6v6H9z"/></svg>',
  '    </div>',
  '    <div style="flex:1;min-width:0">',
  '      <div style="font-size:13px;font-weight:700;color:#111;line-height:1.3;margin-bottom:2px">Plans</div>',
  '      <div style="font-size:11px;color:#6B7280;line-height:1.4">Compare and change plans at tapmycar.io.</div>',
  '    </div>',
  '  </div>',
  '  <a href="javascript:void(0)" onclick="window.tmcOpenWeb(\'/manage\')" style="display:inline-flex;align-items:center;gap:4px;background:#F3F4F6;color:#111;font-weight:600;font-size:12px;padding:7px 14px;border-radius:8px;text-decoration:none">View Plans</a>',
  '</div>'
].join('\n    ');

// iOS-only Help & Support tile
const IOS_HELP_TILE = [
  '<!-- TMC_PATCH72_IOS_HELP_TILE -->',
  '<div class="tmc-ios-only" style="background:#F3F4F6;border-radius:14px;padding:14px;cursor:pointer" onclick="window.location.href=\'/help.html\'">',
  '  <div style="display:flex;align-items:center;gap:7px;margin-bottom:4px">',
  '    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#374151" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>',
  '    <div style="font-size:12px;font-weight:700;color:#111">Help &amp; Support</div>',
  '  </div>',
  '  <div style="font-size:10px;color:#6B7280;line-height:1.4">Get help, FAQ, contact us</div>',
  '</div>'
].join('\n      ');

console.log('\n╔══════════════════════════════════════════════════╗');
console.log('║ TMC_PATCH72 — Polish iOS dashboard               ║');
console.log('╚══════════════════════════════════════════════════╝');
console.log('Backup folder: ' + backupDir);
fs.mkdirSync(backupDir, { recursive: true });

try {
  const dashboardPath = path.join('public', 'dashboard.html');
  if (!fs.existsSync(dashboardPath)) throw new Error('public/dashboard.html not found');

  let dashContent = fs.readFileSync(dashboardPath, 'utf8');
  const dashOriginal = dashContent;

  // ===================================================================
  // STEP 1 — Fallback: replace any leftover "Manage Account →" text
  // ===================================================================
  logStep('Step 1: Fallback — replace leftover "Manage Account →" if present');
  if (dashContent.indexOf('Manage Account →') !== -1) {
    if (dashContent === dashOriginal) backup(dashboardPath);
    dashContent = dashContent.split('Manage Account →').join('Account Settings');
    console.log('  ✓ Replaced leftover "Manage Account →" with "Account Settings"');
  } else if (dashContent.indexOf('View Account →') !== -1) {
    if (dashContent === dashOriginal) backup(dashboardPath);
    dashContent = dashContent.split('View Account →').join('Account Settings');
    console.log('  ✓ Replaced leftover "View Account →" with "Account Settings"');
  } else {
    console.log('  ⏩ No leftover Account button text needs fixing');
  }

  // ===================================================================
  // STEP 2 — Replace Patch 70 iOS banner with new design (if present)
  // ===================================================================
  logStep('Step 2: Replace iOS banner in dashboard.html');
  if (dashContent.indexOf('TMC_PATCH72_IOS_BANNER') !== -1) {
    console.log('  ⏩ dashboard.html — new banner already present');
  } else {
    const oldBannerRe = /<!--\s*TMC_PATCH70_IOS_BANNER\s*-->[\s\S]*?Open tapmycar\.io →<\/button>\s*<\/div>/;
    if (!oldBannerRe.test(dashContent)) {
      console.log('  ⚠ dashboard.html — Patch 70 banner not found, cannot replace');
    } else {
      if (dashContent === dashOriginal) backup(dashboardPath);
      dashContent = dashContent.replace(oldBannerRe, NEW_BANNER_DASHBOARD);
      console.log('  ✓ Replaced Patch 70 banner with new Account banner');
    }
  }

  // ===================================================================
  // STEP 3 — Insert iOS-only Help & Support tile
  // ===================================================================
  logStep('Step 3: Insert iOS-only Help & Support tile');
  if (dashContent.indexOf('TMC_PATCH72_IOS_HELP_TILE') !== -1) {
    console.log('  ⏩ dashboard.html — Help tile already inserted');
  } else {
    const insertAfterRe = /(Get discounts when friends buy a plan!<\/div>\s*<\/div>)/;
    if (!insertAfterRe.test(dashContent)) {
      console.log('  ⚠ dashboard.html — Invite a Friend tile not found, cannot insert Help tile');
    } else {
      if (dashContent === dashOriginal) backup(dashboardPath);
      dashContent = dashContent.replace(insertAfterRe, function (m, captured) {
        return captured + '\n      ' + IOS_HELP_TILE;
      });
      console.log('  ✓ Inserted iOS-only Help & Support tile');
    }
  }

  if (dashContent !== dashOriginal) {
    fs.writeFileSync(dashboardPath, dashContent, { encoding: 'utf8' });
    console.log('\n  ✓ Saved updated dashboard.html');
  }

  // ===================================================================
  // STEP 4 — Replace iOS banner in manage.html
  // ===================================================================
  logStep('Step 4: Replace iOS banner in manage.html');
  const managePath = path.join('public', 'manage.html');
  if (!fs.existsSync(managePath)) {
    console.log('  ⚠ manage.html not found, skipping');
  } else {
    let manageContent = fs.readFileSync(managePath, 'utf8');
    const manageOriginal = manageContent;

    // Fallback for older Patch 72 — remove arrow from "View Plans →"
    if (manageContent.indexOf('View Plans →') !== -1) {
      backup(managePath);
      manageContent = manageContent.split('View Plans →').join('View Plans');
      console.log('  ✓ Removed arrow from leftover "View Plans →" → "View Plans"');
    }
    if (manageContent.indexOf('TMC_PATCH72_IOS_BANNER') !== -1) {
      console.log('  ⏩ manage.html — new banner already present');
    } else {
      const oldBannerRe = /<!--\s*TMC_PATCH70_IOS_BANNER\s*-->[\s\S]*?Open tapmycar\.io →<\/button>\s*<\/div>/;
      if (!oldBannerRe.test(manageContent)) {
        console.log('  ⚠ manage.html — Patch 70 banner not found, cannot replace');
      } else {
        backup(managePath);
        manageContent = manageContent.replace(oldBannerRe, NEW_BANNER_MANAGE);
        console.log('  ✓ Replaced Patch 70 banner with new Plans banner');
      }
    }
    if (manageContent !== manageOriginal) {
      fs.writeFileSync(managePath, manageContent, { encoding: 'utf8' });
      console.log('  ✓ Saved updated manage.html');
    }
  }

  // ===================================================================
  // STEP 5 — Mirror public/*.html → project root
  // ===================================================================
  logStep('Step 5: Sync public/*.html → project root');
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
  console.log('║ TMC_PATCH72 complete ✓                           ║');
  console.log('╚══════════════════════════════════════════════════╝');
  console.log('\nBackup folder: ' + backupDir);
  console.log('\nNext steps:');
  console.log('  1. git add -A');
  console.log('  2. git commit -m "TMC_PATCH72: Polish iOS dashboard + distinct button labels"');
  console.log('  3. git push');
  console.log('  4. Wait ~60s for Vercel deploy');
  console.log('  5. Hard refresh tapmycar.io/dashboard.html (Ctrl+Shift+R)');
  console.log('  6. In DevTools console: document.body.classList.add("tmc-platform-ios")');
  console.log('  7. You should see THREE DIFFERENT button verbs now:');
  console.log('     - Top card:       "Manage →"      (active tag)');
  console.log('     - Account banner: "Account Settings" (NEW)');
  console.log('     - QR card:        "Manage Tag"    (specific tag)');
  console.log('  8. 2x2 grid is now filled: Demo | Pause / Invite | Help & Support');
  console.log('  9. Reply "verified" and we go to Patch 73 (Capgo OTA)\n');

} catch (err) {
  console.error('\n✗ PATCH FAILED: ' + err.message);
  if (err.stack) console.error(err.stack);
  restoreAll();
  process.exit(1);
}
