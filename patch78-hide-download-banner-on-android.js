#!/usr/bin/env node
/**
 * TMC_PATCH78 — Hide App Download Banner on ALL native platforms (not just iOS)
 *
 * In Patch 75 we added class="tmc-hide-on-ios" to the dashboard's
 * "Get the TapMyCar App / Free to Download" banner. But that only hides
 * on iOS. The same banner shows on Android, where it's equally
 * nonsensical (user is already in the app).
 *
 * Fix: change tmc-hide-on-ios → tmc-hide-in-app on this specific element.
 *   - tmc-hide-on-ios:   hides only when tmcPlatform === 'ios'
 *   - tmc-hide-in-app:   hides on any native platform (iOS + Android)
 *
 * Other tmc-hide-on-ios usages (payment UI) stay as iOS-only — Android
 * keeps full Stripe payment UI per our architecture decisions.
 *
 * Idempotent. Safe to re-run.
 *
 * Run from inside the tapmycar project folder:
 *   node patch78-hide-download-banner-on-android.js
 */

const fs = require('fs');
const path = require('path');

const now = new Date();
const pad = n => String(n).padStart(2, '0');
const stamp = [
  now.getFullYear(), pad(now.getMonth() + 1), pad(now.getDate()),
  pad(now.getHours()), pad(now.getMinutes())
].join('-');
const backupDir = 'backup-download-banner-android-' + stamp;

function backup(filePath) {
  if (!fs.existsSync(filePath)) return;
  const dest = path.join(backupDir, filePath);
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.copyFileSync(filePath, dest);
}

console.log('\n╔══════════════════════════════════════════════════╗');
console.log('║ TMC_PATCH78 — Hide Download Banner on Android    ║');
console.log('╚══════════════════════════════════════════════════╝');
fs.mkdirSync(backupDir, { recursive: true });

try {
  const dashboardPath = path.join('public', 'dashboard.html');
  if (!fs.existsSync(dashboardPath)) throw new Error('public/dashboard.html not found');

  let content = fs.readFileSync(dashboardPath, 'utf8');
  const original = content;

  // The pattern to match: the App Download Banner with tmc-hide-on-ios class.
  // After Patch 75, the HTML looks like:
  //   <!-- 7. APP DOWNLOAD BANNER -->
  //   <div class="tmc-hide-on-ios" style="margin:0 12px 14px;background:linear-gradient...
  //
  // We need to change tmc-hide-on-ios to tmc-hide-in-app on THIS specific
  // div only (not other tmc-hide-on-ios elements like #renewal-card etc).

  const alreadyDoneRe = /<!--\s*7\.\s*APP DOWNLOAD BANNER\s*-->\s*<div\s+class="tmc-hide-in-app"/;
  if (alreadyDoneRe.test(content)) {
    console.log('\n  ⏩ App Download Banner already uses tmc-hide-in-app');
  } else {
    // Match the comment + opening div with tmc-hide-on-ios class
    const re = /(<!--\s*7\.\s*APP DOWNLOAD BANNER\s*-->\s*<div\s+class=")tmc-hide-on-ios(")/;
    if (!re.test(content)) {
      // Maybe Patch 75 wasn't applied — try a more lenient match
      const lenientRe = /(<!--\s*7\.\s*APP DOWNLOAD BANNER\s*-->\s*<div)(\s+style="margin:0 12px 14px;background:linear-gradient)/;
      if (lenientRe.test(content)) {
        backup(dashboardPath);
        content = content.replace(lenientRe, '$1 class="tmc-hide-in-app"$2');
        console.log('\n  ✓ Added tmc-hide-in-app to App Download Banner (was previously unclassed)');
      } else {
        throw new Error('Could not find App Download Banner in dashboard.html');
      }
    } else {
      backup(dashboardPath);
      content = content.replace(re, '$1tmc-hide-in-app$2');
      console.log('\n  ✓ Changed App Download Banner class: tmc-hide-on-ios → tmc-hide-in-app');
    }
  }

  if (content !== original) {
    fs.writeFileSync(dashboardPath, content, { encoding: 'utf8' });
    console.log('  ✓ Saved updated dashboard.html');
  }

  // Sync to root
  if (fs.existsSync('dashboard.html')) {
    fs.copyFileSync(dashboardPath, 'dashboard.html');
    console.log('  ✓ Synced dashboard.html to project root');
  }

  console.log('\n╔══════════════════════════════════════════════════╗');
  console.log('║ TMC_PATCH78 complete ✓                           ║');
  console.log('╚══════════════════════════════════════════════════╝');
  console.log('\nIMPORTANT — Next steps:');
  console.log('  1. npx cap sync android');
  console.log('  2. git add -A && git commit -m "TMC_PATCH78: Hide download banner on Android" && git push');
  console.log('  3. In emulator: long-press TapMyCar+ icon → Uninstall');
  console.log('  4. In Android Studio: ▶ Run');
  console.log('  5. Sign back in, scroll dashboard to bottom');
  console.log('  6. The orange "Get the TapMyCar App" banner should be GONE');
  console.log('  7. Reply "verified"\n');

} catch (err) {
  console.error('\n✗ PATCH FAILED: ' + err.message);
  if (err.stack) console.error(err.stack);
  process.exit(1);
}
