#!/usr/bin/env node
/**
 * TMC_PATCH73 — Right-align Manage and Account Settings buttons
 *
 * Three changes (each wraps an existing inline-flex button in a right-aligned
 * container so the button sits at the right edge of its parent card):
 *
 *   1. dashboard.html — top hero-card "Manage" button (in "Your tag is live" card)
 *   2. dashboard.html — iOS-only "Account Settings" button (in subscription banner)
 *   3. manage.html — iOS-only "View Plans" button (in plans banner)
 *
 * Buttons themselves are unchanged — same text, same styling, same onclick.
 * Only their position within the parent card changes (left → right).
 *
 * Idempotent. Marker-based skip on re-run. Backup before any change.
 *
 * Run from inside the tapmycar project folder:
 *   node patch73-right-align-buttons.js
 */

const fs = require('fs');
const path = require('path');

const now = new Date();
const pad = n => String(n).padStart(2, '0');
const stamp = [
  now.getFullYear(), pad(now.getMonth() + 1), pad(now.getDate()),
  pad(now.getHours()), pad(now.getMinutes())
].join('-');
const backupDir = 'backup-right-align-buttons-' + stamp;
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

// Markers for idempotence — each wrap uses a unique marker
const MARKER_TOP_MANAGE = '<!-- TMC_PATCH73_RIGHT_ALIGN_TOP_MANAGE -->';
const MARKER_ACCOUNT_BTN = '<!-- TMC_PATCH73_RIGHT_ALIGN_ACCOUNT -->';
const MARKER_PLANS_BTN = '<!-- TMC_PATCH73_RIGHT_ALIGN_PLANS -->';

console.log('\n╔══════════════════════════════════════════════════╗');
console.log('║ TMC_PATCH73 — Right-align buttons                ║');
console.log('╚══════════════════════════════════════════════════╝');
console.log('Backup folder: ' + backupDir);
fs.mkdirSync(backupDir, { recursive: true });

try {
  // ===================================================================
  // STEP 1 — Wrap top hero-card "Manage" button in dashboard.html
  // ===================================================================
  logStep('Step 1: Right-align hero-card Manage button in dashboard.html');

  const dashboardPath = path.join('public', 'dashboard.html');
  if (!fs.existsSync(dashboardPath)) throw new Error('public/dashboard.html not found');

  let dashContent = fs.readFileSync(dashboardPath, 'utf8');
  const dashOriginal = dashContent;

  if (dashContent.indexOf(MARKER_TOP_MANAGE) !== -1) {
    console.log('  ⏩ Hero-card Manage button already right-aligned');
  } else {
    // Match the entire Manage button div including its SVG arrow.
    // The button is styled with: background:#fff; border-radius:99px; display:inline-flex
    const topManageRe = /(<div\s+style="background:#fff;color:var\(--or\);font-size:12px;font-weight:700;padding:8px 16px;border-radius:99px;display:inline-flex;align-items:center;gap:5px"[^>]*>\s*Manage\s*<svg[^>]*>[\s\S]*?<\/svg>\s*<\/div>)/;
    if (!topManageRe.test(dashContent)) {
      console.log('  ⚠ Hero-card Manage button not found — skipping');
    } else {
      backup(dashboardPath);
      dashContent = dashContent.replace(topManageRe, function (m, btn) {
        return MARKER_TOP_MANAGE + '\n      <div style="text-align:right">' + btn + '</div>';
      });
      console.log('  ✓ Wrapped hero-card Manage button in right-aligned container');
    }
  }

  // ===================================================================
  // STEP 2 — Wrap Account Settings button in dashboard.html iOS banner
  // ===================================================================
  logStep('Step 2: Right-align Account Settings button in dashboard.html');

  if (dashContent.indexOf(MARKER_ACCOUNT_BTN) !== -1) {
    console.log('  ⏩ Account Settings button already right-aligned');
  } else {
    // Match the Account Settings anchor (in the TMC_PATCH72 iOS banner)
    const accountBtnRe = /(<a\s+href="javascript:void\(0\)"\s+onclick="window\.tmcOpenWeb\('\/billing'\)"\s+style="[^"]*">Account Settings<\/a>)/;
    if (!accountBtnRe.test(dashContent)) {
      console.log('  ⚠ Account Settings button not found — skipping');
    } else {
      if (dashContent === dashOriginal) backup(dashboardPath);
      dashContent = dashContent.replace(accountBtnRe, function (m, btn) {
        return MARKER_ACCOUNT_BTN + '<div style="text-align:right">' + btn + '</div>';
      });
      console.log('  ✓ Wrapped Account Settings button in right-aligned container');
    }
  }

  // Save dashboard.html if changed
  if (dashContent !== dashOriginal) {
    fs.writeFileSync(dashboardPath, dashContent, { encoding: 'utf8' });
    console.log('\n  ✓ Saved updated dashboard.html');
  }

  // ===================================================================
  // STEP 3 — Wrap View Plans button in manage.html iOS banner
  // ===================================================================
  logStep('Step 3: Right-align View Plans button in manage.html');

  const managePath = path.join('public', 'manage.html');
  if (!fs.existsSync(managePath)) {
    console.log('  ⚠ manage.html not found, skipping');
  } else {
    let manageContent = fs.readFileSync(managePath, 'utf8');
    const manageOriginal = manageContent;

    if (manageContent.indexOf(MARKER_PLANS_BTN) !== -1) {
      console.log('  ⏩ View Plans button already right-aligned');
    } else {
      const plansBtnRe = /(<a\s+href="javascript:void\(0\)"\s+onclick="window\.tmcOpenWeb\('\/manage'\)"\s+style="[^"]*">View Plans<\/a>)/;
      if (!plansBtnRe.test(manageContent)) {
        console.log('  ⚠ View Plans button not found — skipping');
      } else {
        backup(managePath);
        manageContent = manageContent.replace(plansBtnRe, function (m, btn) {
          return MARKER_PLANS_BTN + '<div style="text-align:right">' + btn + '</div>';
        });
        console.log('  ✓ Wrapped View Plans button in right-aligned container');
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

  console.log('\n╔══════════════════════════════════════════════════╗');
  console.log('║ TMC_PATCH73 complete ✓                           ║');
  console.log('╚══════════════════════════════════════════════════╝');
  console.log('\nBackup folder: ' + backupDir);
  console.log('\nNext steps:');
  console.log('  1. git add -A');
  console.log('  2. git commit -m "TMC_PATCH73: Right-align Manage and Account Settings buttons"');
  console.log('  3. git push');
  console.log('  4. Wait ~60s for Vercel deploy');
  console.log('  5. Hard refresh tapmycar.io/dashboard.html (Ctrl+Shift+R)');
  console.log('  6. The orange "Manage →" pill should now sit on the RIGHT of the hero card');
  console.log('  7. In DevTools console: document.body.classList.add("tmc-platform-ios")');
  console.log('  8. The "Account Settings" chip should now sit on the RIGHT of the white banner');
  console.log('  9. Reply "verified" — next is Patch 74 (Capgo OTA)\n');

} catch (err) {
  console.error('\n✗ PATCH FAILED: ' + err.message);
  if (err.stack) console.error(err.stack);
  restoreAll();
  process.exit(1);
}
