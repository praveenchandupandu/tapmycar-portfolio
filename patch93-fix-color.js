#!/usr/bin/env node
/**
 * TMC_PATCH93 — Fix colorPrimary_tmc resource error
 *
 * Build was failing with:
 *   resource color/colorPrimary_tmc not found
 *
 * Cause: Patch 91 wrote a reference to @color/colorPrimary_tmc in
 * styles.xml but the matching <color> definition in colors.xml didn't
 * get added (the file's </resources> tag had different formatting).
 *
 * Fix: Skip the indirection entirely. Use the hex color #FF6B00
 * directly in styles.xml. No colors.xml change needed.
 *
 * Idempotent.
 */

const fs = require('fs');
const path = require('path');

const now = new Date();
const pad = n => String(n).padStart(2, '0');
const stamp = [
  now.getFullYear(), pad(now.getMonth() + 1), pad(now.getDate()),
  pad(now.getHours()), pad(now.getMinutes())
].join('-');
const backupDir = 'backup-fix-color-' + stamp;

function backup(filePath) {
  if (!fs.existsSync(filePath)) return;
  const dest = path.join(backupDir, filePath);
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.copyFileSync(filePath, dest);
}

console.log('\n╔══════════════════════════════════════════════════╗');
console.log('║ TMC_PATCH93 — Fix colorPrimary_tmc build error   ║');
console.log('╚══════════════════════════════════════════════════╝');
fs.mkdirSync(backupDir, { recursive: true });

try {
  // ====================================================================
  // FIX — Replace @color/colorPrimary_tmc with hex in styles.xml
  // ====================================================================
  const stylesPath = path.join('android', 'app', 'src', 'main', 'res', 'values', 'styles.xml');
  if (!fs.existsSync(stylesPath)) {
    throw new Error('styles.xml not found at ' + stylesPath);
  }

  let x = fs.readFileSync(stylesPath, 'utf8');
  const orig = x;

  if (x.indexOf('@color/colorPrimary_tmc') !== -1) {
    backup(stylesPath);
    x = x.replace(/@color\/colorPrimary_tmc/g, '#FF6B00');
    fs.writeFileSync(stylesPath, x, 'utf8');
    console.log('  ✓ Replaced @color/colorPrimary_tmc with #FF6B00 in styles.xml');
  } else if (x.indexOf('android:windowBackground">#FF6B00') !== -1) {
    console.log('  ⏩ styles.xml already uses hex color directly');
  } else {
    console.log('  ℹ No @color/colorPrimary_tmc reference found — checking other variants');
    // Also check for any remaining colorPrimary_tmc references just in case
    if (x.indexOf('colorPrimary_tmc') !== -1) {
      backup(stylesPath);
      x = x.replace(/colorPrimary_tmc/g, '').replace(/@color\//g, '#FF6B00');
      fs.writeFileSync(stylesPath, x, 'utf8');
      console.log('  ✓ Cleaned up any lingering references');
    }
  }

  // ====================================================================
  // CLEANUP — Also remove the (unused) colorPrimary_tmc from colors.xml
  // if it ended up there. Harmless either way, just keeps things clean.
  // ====================================================================
  const colorsPath = path.join('android', 'app', 'src', 'main', 'res', 'values', 'colors.xml');
  if (fs.existsSync(colorsPath)) {
    let cx = fs.readFileSync(colorsPath, 'utf8');
    if (cx.indexOf('colorPrimary_tmc') !== -1) {
      backup(colorsPath);
      cx = cx.replace(/\s*<color name="colorPrimary_tmc">[^<]*<\/color>\s*/g, '\n');
      fs.writeFileSync(colorsPath, cx, 'utf8');
      console.log('  ✓ Removed unused colorPrimary_tmc from colors.xml');
    }
  }

  console.log('\n╔══════════════════════════════════════════════════╗');
  console.log('║ TMC_PATCH93 complete ✓                           ║');
  console.log('╚══════════════════════════════════════════════════╝');
  console.log('\nNext:');
  console.log('  git add -A');
  console.log('  git commit -m "TMC_PATCH93: Fix colorPrimary_tmc resource error"');
  console.log('  git push');
  console.log('  Then in Android Studio: Build → Clean Project → ▶ Run\n');
  console.log('Build should succeed now.\n');

} catch (err) {
  console.error('\n✗ PATCH FAILED: ' + err.message);
  if (err.stack) console.error(err.stack);
  process.exit(1);
}
