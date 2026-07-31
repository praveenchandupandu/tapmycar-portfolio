const fs = require('fs');
const path = require('path');

const now = new Date();
const pad = n => String(n).padStart(2, '0');
const stamp = [now.getFullYear(), pad(now.getMonth()+1), pad(now.getDate()), pad(now.getHours()), pad(now.getMinutes())].join('-');
const backupDir = 'backup-patch113-' + stamp;
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
  console.error('\n[!] Restoring all files from backup...');
  for (const { orig, copy } of restoreQueue) {
    try { fs.copyFileSync(copy, orig); } catch (e) { console.error('  Failed to restore ' + orig + ': ' + e.message); }
  }
}

console.log('\n=== TMC_PATCH113 - Hide remaining in-app payment UI (post-rejection fix) ===');
console.log('Apple rejected the app citing 3.1.1 - found a working "Confirm and pay" upgrade');
console.log('modal in dashboard.html and manage.html that no earlier patch had ever hidden.');
console.log('This patch hides that modal plus every other remaining pricing/purchase trace.');

let anyChanged = false;

try {
  // ===================================================================
  // FIX 1 — manage.html: ensure #plan-standard is hidden (verify/re-apply patch99)
  // ===================================================================
  logStep('Fix 1: Verify #plan-standard is hidden on iOS (manage.html)');

  const managePath = path.join('public', 'manage.html');
  if (fs.existsSync(managePath)) {
    let content = fs.readFileSync(managePath, 'utf8');
    const original = content;

    if (content.includes('class="plan-card tmc-hide-on-ios" id="plan-standard"')) {
      console.log('  Already hidden - confirmed correct');
    } else if (content.includes('<div class="plan-card" id="plan-standard"')) {
      content = content.replace(
        '<div class="plan-card" id="plan-standard"',
        '<div class="plan-card tmc-hide-on-ios" id="plan-standard"'
      );
      console.log('  Fixed - #plan-standard was NOT hidden, now corrected');
    } else {
      console.log('  WARNING: #plan-standard not found in expected form - check manually');
    }

    // FIX 2 — manage.html: hide the entire "Confirm and pay" upgrade modal
    const oldOverlay = '<div id="upg-overlay" style="display:none;position:fixed;inset:0;background:rgba(0,0,0,.55);z-index:9999;align-items:flex-end;justify-content:center" onclick="if(event.target===this)closeUpgradeConfirm()">';
    const newOverlay = '<div id="upg-overlay" class="tmc-hide-on-ios" style="display:none;position:fixed;inset:0;background:rgba(0,0,0,.55);z-index:9999;align-items:flex-end;justify-content:center" onclick="if(event.target===this)closeUpgradeConfirm()">';

    if (content.includes(newOverlay)) {
      console.log('  #upg-overlay already hidden - confirmed correct');
    } else if (content.includes(oldOverlay)) {
      content = content.replace(oldOverlay, newOverlay);
      console.log('  Fixed - hid the "Confirm and pay" upgrade modal (#upg-overlay)');
    } else {
      console.log('  WARNING: #upg-overlay not found in expected form - check manually');
    }

    if (content !== original) {
      backup(managePath);
      fs.writeFileSync(managePath, content, 'utf8');
      anyChanged = true;
    }
  } else {
    console.log('  public/manage.html not found - skipped');
  }

  // ===================================================================
  // FIX 3 — dashboard.html: hide the entire "Confirm and pay" upgrade modal
  // ===================================================================
  logStep('Fix 3: Hide the "Confirm and pay" upgrade modal on dashboard.html');

  const dashPath = path.join('public', 'dashboard.html');
  if (fs.existsSync(dashPath)) {
    let content = fs.readFileSync(dashPath, 'utf8');
    const original = content;

    const oldOverlay = '<div id="dash-upg-overlay" style="display:none;position:fixed;inset:0;background:rgba(0,0,0,.55);z-index:9999;align-items:flex-end;justify-content:center" onclick="if(event.target===this)dashCloseUpgradeConfirm()">';
    const newOverlay = '<div id="dash-upg-overlay" class="tmc-hide-on-ios" style="display:none;position:fixed;inset:0;background:rgba(0,0,0,.55);z-index:9999;align-items:flex-end;justify-content:center" onclick="if(event.target===this)dashCloseUpgradeConfirm()">';

    if (content.includes(newOverlay)) {
      console.log('  #dash-upg-overlay already hidden - confirmed correct');
    } else if (content.includes(oldOverlay)) {
      content = content.replace(oldOverlay, newOverlay);
      console.log('  Fixed - hid the "Confirm and pay" upgrade modal (#dash-upg-overlay)');
      backup(dashPath);
      fs.writeFileSync(dashPath, content, 'utf8');
      anyChanged = true;
    } else {
      console.log('  WARNING: #dash-upg-overlay not found in expected form - check manually');
    }
  } else {
    console.log('  public/dashboard.html not found - skipped');
  }

  // ===================================================================
  // FIX 4 — settings.html: hide the referral reward claim box (includes $4.99 Coupon button)
  // ===================================================================
  logStep('Fix 4: Hide referral reward claim buttons on settings.html');

  const settingsPath = path.join('public', 'settings.html');
  if (fs.existsSync(settingsPath)) {
    let content = fs.readFileSync(settingsPath, 'utf8');
    const original = content;

    const oldBox = '<div id="ref-reward-box" style="display:none;background:#DCFCE7;border:1.5px solid #BBF7D0;border-radius:10px;padding:12px;margin-top:12px">';
    const newBox = '<div id="ref-reward-box" class="tmc-hide-on-ios" style="display:none;background:#DCFCE7;border:1.5px solid #BBF7D0;border-radius:10px;padding:12px;margin-top:12px">';

    if (content.includes(newBox)) {
      console.log('  #ref-reward-box already hidden - confirmed correct');
    } else if (content.includes(oldBox)) {
      content = content.replace(oldBox, newBox);
      console.log('  Fixed - hid referral reward claim buttons (#ref-reward-box)');
      backup(settingsPath);
      fs.writeFileSync(settingsPath, content, 'utf8');
      anyChanged = true;
    } else {
      console.log('  WARNING: #ref-reward-box not found in expected form - check manually');
    }
  } else {
    console.log('  public/settings.html not found - skipped');
  }

  // ===================================================================
  // FIX 5 — activity.html: hide the "Upgrade to see scan locations" overlay
  // ===================================================================
  logStep('Fix 5: Hide "Upgrade to see scan locations" overlay on activity.html');

  const activityPath = path.join('public', 'activity.html');
  if (fs.existsSync(activityPath)) {
    let content = fs.readFileSync(activityPath, 'utf8');
    const original = content;

    const oldMapUpgrade = '<div id="map-upgrade" style="display:none;position:absolute;top:0;left:0;right:0;bottom:0;z-index:10;background:rgba(255,255,255,.9);border-radius:14px;flex-direction:column;align-items:center;justify-content:center;text-align:center;padding:20px">';
    const newMapUpgrade = '<div id="map-upgrade" class="tmc-hide-on-ios" style="display:none;position:absolute;top:0;left:0;right:0;bottom:0;z-index:10;background:rgba(255,255,255,.9);border-radius:14px;flex-direction:column;align-items:center;justify-content:center;text-align:center;padding:20px">';

    if (content.includes(newMapUpgrade)) {
      console.log('  #map-upgrade already hidden - confirmed correct');
    } else if (content.includes(oldMapUpgrade)) {
      content = content.replace(oldMapUpgrade, newMapUpgrade);
      console.log('  Fixed - hid "Upgrade to see scan locations" overlay (#map-upgrade)');
      backup(activityPath);
      fs.writeFileSync(activityPath, content, 'utf8');
      anyChanged = true;
    } else {
      console.log('  WARNING: #map-upgrade not found in expected form - check manually');
    }
  } else {
    console.log('  public/activity.html not found - skipped');
  }

  console.log('\n=== TMC_PATCH113 complete ===');
  if (anyChanged) {
    console.log('\nNext steps:');
    console.log('  1. npx cap sync ios');
    console.log('  2. Bump build number (see previous pattern)');
    console.log('  3. git add -A && git commit -m "TMC_PATCH113: Hide remaining in-app payment UI (post-rejection fix)"');
    console.log('  4. git push');
    console.log('  5. New Codemagic build -> TestFlight -> reinstall and verify before resubmitting\n');
  } else {
    console.log('\nAll items already confirmed hidden - your live code may already be correct.');
    console.log('If Apple still rejected on 3.1.1, screenshot the exact screen the reviewer');
    console.log('would have seen and let\'s investigate further.\n');
  }

} catch (err) {
  console.error('\nPATCH FAILED: ' + err.message);
  if (err.stack) console.error(err.stack);
  restoreAll();
  process.exit(1);
}
