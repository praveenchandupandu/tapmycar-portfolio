#!/usr/bin/env node
/**
 * TMC_PATCH72 — Polish iOS dashboard + Apple-safer subscription banner
 *
 * Two changes:
 *   1. Replace existing iOS-only banner (from Patch 70) in dashboard.html and
 *      manage.html with a more polished, more Apple-compliant design:
 *        - White card, less aggressive than the prior dark banner
 *        - Icon + label + subtle description + small "Manage" chip-style button
 *        - Informational language ("Subscription details are managed at...")
 *        - Removes purchase-flavored words ("renewals", "payment methods")
 *
 *   2. Insert an iOS-only "Help & Support" tile in dashboard.html action grid
 *      to fill the empty slot where the "Place Order" tile used to be (hidden
 *      in iOS by Patch 71). Result: 2x2 grid stays symmetric in iOS.
 *
 * Idempotent. Re-runs safely. Backups before any change. Auto-restore on failure.
 *
 * Run from inside the tapmycar project folder:
 *   node patch72-polish-ios-dashboard.js
 */

const fs = require('fs');
const path = require('path');

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
  console.error('Restore complete. Backup folder kept at: ' + backupDir);
}

// -------------------------------------------------------------------
// New iOS-only banner — DASHBOARD context ("Account")
// -------------------------------------------------------------------
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
  '  <a href="javascript:void(0)" onclick="window.tmcOpenWeb(\'/billing\')" style="display:inline-flex;align-items:center;gap:4px;background:#F3F4F6;color:#111;font-weight:600;font-size:12px;padding:7px 14px;border-radius:8px;text-decoration:none">Manage Account →</a>',
  '</div>'
].join('\n    ');

// -------------------------------------------------------------------
// New iOS-only banner — MANAGE.HTML context ("Plans")
// -------------------------------------------------------------------
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
  '  <a href="javascript:void(0)" onclick="window.tmcOpenWeb(\'/manage\')" style="display:inline-flex;align-items:center;gap:4px;background:#F3F4F6;color:#111;font-weight:600;font-size:12px;padding:7px 14px;border-radius:8px;text-decoration:none">View Plans →</a>',
  '</div>'
].join('\n    ');

// -------------------------------------------------------------------
// iOS-only Help & Support tile (matches existing tile style)
// -------------------------------------------------------------------
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

// -------------------------------------------------------------------
// MAIN
// -------------------------------------------------------------------
console.log('\n╔══════════════════════════════════════════════════╗');
console.log('║ TMC_PATCH72 — Polish iOS dashboard               ║');
console.log('╚══════════════════════════════════════════════════╝');
console.log('Backup folder: ' + backupDir);
fs.mkdirSync(backupDir, { recursive: true });

try {
  // ===================================================================
  // STEP 1 — Replace iOS banner in dashboard.html
  // ===================================================================
  logStep('Step 1: Replace iOS banner in dashboard.html');

  const dashboardPath = path.join('public', 'dashboard.html');
  if (!fs.existsSync(dashboardPath)) throw new Error('public/dashboard.html not found');

  let dashContent = fs.readFileSync(dashboardPath, 'utf8');
  const dashOriginal = dashContent;

  if (dashContent.indexOf('TMC_PATCH72_IOS_BANNER') !== -1) {
    console.log('  ⏩ dashboard.html — new banner already present');
  } else {
    // Match the Patch 70 banner: from <!-- TMC_PATCH70_IOS_BANNER --> through to
    // the closing </div> of the banner. The banner ends with the button + closing div.
    const oldBannerRe = /<!--\s*TMC_PATCH70_IOS_BANNER\s*-->[\s\S]*?Open tapmycar\.io →<\/button>\s*<\/div>/;
    if (!oldBannerRe.test(dashContent)) {
      console.log('  ⚠ dashboard.html — Patch 70 banner not found, cannot replace');
    } else {
      backup(dashboardPath);
      dashContent = dashContent.replace(oldBannerRe, NEW_BANNER_DASHBOARD);
      console.log('  ✓ Replaced Subscription & Billing banner with Account banner');
    }
  }

  // ===================================================================
  // STEP 2 — Insert iOS-only Help & Support tile in dashboard action grid
  // ===================================================================
  logStep('Step 2: Insert iOS-only Help & Support tile');

  if (dashContent.indexOf('TMC_PATCH72_IOS_HELP_TILE') !== -1) {
    console.log('  ⏩ dashboard.html — Help & Support tile already inserted');
  } else {
    // Anchor: end of "Invite a Friend" tile.
    // Pattern: "Get discounts when friends buy a plan!</div>" + closing tile </div>
    const insertAfterRe = /(Get discounts when friends buy a plan!<\/div>\s*<\/div>)/;
    if (!insertAfterRe.test(dashContent)) {
      console.log('  ⚠ dashboard.html — Invite a Friend tile not found, cannot insert Help tile');
    } else {
      if (dashContent === dashOriginal) backup(dashboardPath);
      dashContent = dashContent.replace(insertAfterRe, function (m, captured) {
        return captured + '\n      ' + IOS_HELP_TILE;
      });
      console.log('  ✓ Inserted iOS-only Help & Support tile after Invite a Friend');
    }
  }

  // Save dashboard.html if changed
  if (dashContent !== dashOriginal) {
    fs.writeFileSync(dashboardPath, dashContent, { encoding: 'utf8' });
    console.log('\n  ✓ Saved updated dashboard.html');
  }

  // ===================================================================
  // STEP 3 — Replace iOS banner in manage.html
  // ===================================================================
  logStep('Step 3: Replace iOS banner in manage.html');

  const managePath = path.join('public', 'manage.html');
  if (!fs.existsSync(managePath)) {
    console.log('  ⚠ manage.html not found, skipping');
  } else {
    let manageContent = fs.readFileSync(managePath, 'utf8');
    const manageOriginal = manageContent;

    if (manageContent.indexOf('TMC_PATCH72_IOS_BANNER') !== -1) {
      console.log('  ⏩ manage.html — new banner already present');
    } else {
      const oldBannerRe = /<!--\s*TMC_PATCH70_IOS_BANNER\s*-->[\s\S]*?Open tapmycar\.io →<\/button>\s*<\/div>/;
      if (!oldBannerRe.test(manageContent)) {
        console.log('  ⚠ manage.html — Patch 70 banner not found, cannot replace');
      } else {
        backup(managePath);
        manageContent = manageContent.replace(oldBannerRe, NEW_BANNER_MANAGE);
        console.log('  ✓ Replaced Plan Upgrades banner with Plans banner');
      }
    }

    if (manageContent !== manageOriginal) {
      fs.writeFileSync(managePath, manageContent, { encoding: 'utf8' });
      console.log('  ✓ Saved updated manage.html');
    }
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

  // ===================================================================
  // SUCCESS
  // ===================================================================
  console.log('\n╔══════════════════════════════════════════════════╗');
  console.log('║ TMC_PATCH72 complete ✓                           ║');
  console.log('╚══════════════════════════════════════════════════╝');
  console.log('\nBackup folder: ' + backupDir);
  console.log('\nNext steps:');
  console.log('  1. git add -A');
  console.log('  2. git commit -m "TMC_PATCH72: Polish iOS dashboard"');
  console.log('  3. git push');
  console.log('  4. Wait ~60s for Vercel deploy');
  console.log('  5. Open tapmycar.io/dashboard.html in incognito (Ctrl+Shift+R)');
  console.log('  6. In DevTools console: document.body.classList.add("tmc-platform-ios")');
  console.log('  7. You should now see:');
  console.log('     - New white "Account" card (icon + label + Manage Account button)');
  console.log('     - 2x2 grid filled: [Demo Video | Pause Tag] / [Invite a Friend | Help & Support]');
  console.log('  8. Refresh page to reset (Ctrl+R)');
  console.log('  9. Reply "verified" and we proceed to Patch 73 (Capgo OTA)\n');

} catch (err) {
  console.error('\n✗ PATCH FAILED: ' + err.message);
  if (err.stack) console.error(err.stack);
  restoreAll();
  process.exit(1);
}
