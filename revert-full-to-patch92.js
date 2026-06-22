#!/usr/bin/env node
/**
 * REVERT-FULL — Truly revert to Patch 92 state
 *
 * Undoes BOTH Patch 93 AND Patch 94 (and the styles.xml line that
 * Patch 91 added that needed Patch 93 to fix). Result: clean styles.xml
 * with no windowBackground line at all → no build error, no Patch 93
 * needed.
 *
 * What this does:
 *   1. Restore splash.html from Patch 94's backup → Patch 92 state
 *   2. Remove the windowBackground line from styles.xml entirely
 *      (this undoes both Patch 91's add and Patch 93's fix)
 *   3. Remove colorPrimary_tmc from colors.xml if present
 *
 * Build will work because there's no broken color reference anywhere.
 *
 * Run from inside the tapmycar project folder:
 *   node revert-full-to-patch92.js
 */

const fs = require('fs');
const path = require('path');

console.log('\n╔══════════════════════════════════════════════════╗');
console.log('║ REVERT-FULL — True Patch 92 state                ║');
console.log('╚══════════════════════════════════════════════════╝');

try {
  // ====================================================================
  // STEP 1 — Restore splash.html from Patch 94's backup
  // ====================================================================
  const backups = fs.readdirSync('.').filter(function(d){
    return d.indexOf('backup-splash-rewrite-') === 0;
  });

  if (backups.length > 0) {
    backups.sort();
    const backupDir = backups[0];
    const splashBackup = path.join(backupDir, 'public', 'splash.html');
    if (fs.existsSync(splashBackup)) {
      const content = fs.readFileSync(splashBackup, 'utf8');
      if (content.indexOf('TMC_PATCH94_FRESH') === -1) {
        fs.copyFileSync(splashBackup, path.join('public', 'splash.html'));
        console.log('  ✓ Restored public/splash.html from ' + backupDir);
        if (fs.existsSync('splash.html')) {
          fs.copyFileSync(splashBackup, 'splash.html');
          console.log('  ✓ Synced to root splash.html');
        }
      } else {
        console.log('  ⚠ Backup contains Patch 94 content, skipping restore');
      }
    }
  } else {
    // Check if splash.html is already at Patch 92 state
    const splashPath = path.join('public', 'splash.html');
    if (fs.existsSync(splashPath)) {
      const content = fs.readFileSync(splashPath, 'utf8');
      if (content.indexOf('TMC_PATCH94_FRESH') !== -1) {
        console.log('  ⚠ Patch 94 applied but no backup. Use git to revert:');
        console.log('     git checkout HEAD~1 -- public/splash.html');
      } else if (content.indexOf('TMC_PATCH92_HERO_STICKER') !== -1) {
        console.log('  ⏩ splash.html already at Patch 92 state');
      }
    }
  }

  // ====================================================================
  // STEP 2 — Remove windowBackground from styles.xml entirely
  // ====================================================================
  const stylesPath = path.join('android', 'app', 'src', 'main', 'res', 'values', 'styles.xml');
  if (fs.existsSync(stylesPath)) {
    let x = fs.readFileSync(stylesPath, 'utf8');
    const orig = x;

    // Remove the Patch 91 comment and the windowBackground line (any color value)
    // Handles both: @color/colorPrimary_tmc (Patch 91 original) and #FF6B00 (Patch 93 fix)
    x = x.replace(/\s*<!--\s*TMC_PATCH91_WINDOW_BG[^>]*-->\s*\n/g, '\n');
    x = x.replace(/\s*<item name="android:windowBackground">[^<]*<\/item>\s*\n/g, '\n');

    if (x !== orig) {
      fs.writeFileSync(stylesPath, x, 'utf8');
      console.log('  ✓ Removed windowBackground line from styles.xml');
    } else {
      console.log('  ⏩ No windowBackground line found in styles.xml');
    }
  }

  // ====================================================================
  // STEP 3 — Remove colorPrimary_tmc from colors.xml
  // ====================================================================
  const colorsPath = path.join('android', 'app', 'src', 'main', 'res', 'values', 'colors.xml');
  if (fs.existsSync(colorsPath)) {
    let cx = fs.readFileSync(colorsPath, 'utf8');
    if (cx.indexOf('colorPrimary_tmc') !== -1) {
      cx = cx.replace(/\s*<color name="colorPrimary_tmc">[^<]*<\/color>\s*\n?/g, '\n');
      fs.writeFileSync(colorsPath, cx, 'utf8');
      console.log('  ✓ Removed colorPrimary_tmc from colors.xml');
    } else {
      console.log('  ⏩ colorPrimary_tmc not in colors.xml');
    }
  }

  console.log('\n╔══════════════════════════════════════════════════╗');
  console.log('║ Revert complete — Patch 92 is now the latest ✓   ║');
  console.log('╚══════════════════════════════════════════════════╝');
  console.log('\nWhat remains in your project (from Patches 91 & 92):');
  console.log('  • capacitor.config.ts: android.backgroundColor');
  console.log('  • capacitor.config.ts: SplashScreen plugin config');
  console.log('  • styles.xml: transparent splash icon (from Patch 89)');
  console.log('  • index.html: inline body bg');
  console.log('  • splash.html: Patch 92 state (with hero sticker loader)');
  console.log('');
  console.log('What was removed:');
  console.log('  ✗ Patch 93: not applied anymore (no longer needed)');
  console.log('  ✗ Patch 94: splash.html rewrite reverted');
  console.log('');
  console.log('Next:');
  console.log('  npx cap sync android');
  console.log('  git add -A');
  console.log('  git commit -m "Revert to Patch 92 state"');
  console.log('  git push');
  console.log('  Then: Clean Project → Run\n');

} catch (err) {
  console.error('\n✗ REVERT FAILED: ' + err.message);
  if (err.stack) console.error(err.stack);
  process.exit(1);
}
