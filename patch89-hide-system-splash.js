#!/usr/bin/env node
/**
 * TMC_PATCH89 — Hide system splash icon + fix broken tag image
 *
 *   FIX 1 — Hide Android system splash icon
 *   ─────────────────────────────────────────
 *   The Android 12+ system splash shows the launcher icon by default,
 *   creating that visible white circle on the orange background.
 *
 *   Solution: Set windowSplashScreenAnimatedIcon to a TRANSPARENT drawable.
 *   The OS will "show" this transparent icon, but it's invisible — user
 *   only sees the orange background, which matches the animated splash.
 *   Result: Tap icon → orange screen → animated splash starts → seamless.
 *
 *   FIX 2 — Fix broken tag image on onboarding
 *   ──────────────────────────────────────────
 *   Patch 83 added "dynamic loading" from /api/get-branding which was
 *   failing in the app (or returning a URL that couldn't be loaded).
 *   Solution: Remove the dynamic loading code entirely, use the local
 *   /tapmycarintialstage.png file which definitely exists.
 *
 * Idempotent.
 *
 * Run from inside the tapmycar project folder:
 *   node patch89-hide-system-splash.js
 */

const fs = require('fs');
const path = require('path');

const now = new Date();
const pad = n => String(n).padStart(2, '0');
const stamp = [
  now.getFullYear(), pad(now.getMonth() + 1), pad(now.getDate()),
  pad(now.getHours()), pad(now.getMinutes())
].join('-');
const backupDir = 'backup-hide-system-splash-' + stamp;

function backup(filePath) {
  if (!fs.existsSync(filePath)) return;
  const dest = path.join(backupDir, filePath);
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.copyFileSync(filePath, dest);
}

console.log('\n╔══════════════════════════════════════════════════╗');
console.log('║ TMC_PATCH89 — Hide system splash + fix tag       ║');
console.log('╚══════════════════════════════════════════════════╝');
fs.mkdirSync(backupDir, { recursive: true });

try {
  // ====================================================================
  // FIX 1A — Create transparent drawable in android/app/src/main/res/drawable/
  // ====================================================================
  const drawableDir = path.join('android', 'app', 'src', 'main', 'res', 'drawable');
  const transparentDrawable = path.join(drawableDir, 'transparent_splash_icon.xml');

  if (!fs.existsSync(drawableDir)) {
    throw new Error('android/ folder not found — run npx cap add android first');
  }

  const transparentDrawableXml =
    '<?xml version="1.0" encoding="utf-8"?>\n' +
    '<!-- TMC_PATCH89: invisible icon so the Android 12+ system splash shows ONLY the background color, not the launcher icon. -->\n' +
    '<shape xmlns:android="http://schemas.android.com/apk/res/android" android:shape="rectangle">\n' +
    '    <solid android:color="@android:color/transparent" />\n' +
    '    <size android:width="1dp" android:height="1dp" />\n' +
    '</shape>\n';

  fs.writeFileSync(transparentDrawable, transparentDrawableXml, 'utf8');
  console.log('  ✓ Created transparent_splash_icon.xml drawable');

  // ====================================================================
  // FIX 1B — Update styles.xml to use the transparent splash icon
  // ====================================================================
  const stylesPath = path.join('android', 'app', 'src', 'main', 'res', 'values', 'styles.xml');
  if (!fs.existsSync(stylesPath)) {
    throw new Error('android/app/src/main/res/values/styles.xml not found');
  }

  let stylesContent = fs.readFileSync(stylesPath, 'utf8');
  const stylesOrig = stylesContent;
  backup(stylesPath);

  // Ensure windowSplashScreenBackground is set to orange (might already be from Patch 88)
  if (stylesContent.indexOf('windowSplashScreenBackground') === -1) {
    const themeRe = /(<style name="AppTheme\.NoActionBarLaunch"[^>]*>)/;
    if (themeRe.test(stylesContent)) {
      stylesContent = stylesContent.replace(themeRe,
        '$1\n        <item name="windowSplashScreenBackground">#FF6B00</item>'
      );
      console.log('  ✓ Added windowSplashScreenBackground = #FF6B00');
    }
  } else {
    console.log('  ⏩ windowSplashScreenBackground already set');
  }

  // Add windowSplashScreenAnimatedIcon pointing to our transparent drawable
  if (stylesContent.indexOf('windowSplashScreenAnimatedIcon') === -1) {
    // Insert after windowSplashScreenBackground line
    const bgLineRe = /(<item name="windowSplashScreenBackground">[^<]*<\/item>)/;
    if (bgLineRe.test(stylesContent)) {
      stylesContent = stylesContent.replace(bgLineRe,
        '$1\n        <!-- TMC_PATCH89: transparent icon hides the launcher icon during system splash -->\n' +
        '        <item name="windowSplashScreenAnimatedIcon">@drawable/transparent_splash_icon</item>\n' +
        '        <item name="windowSplashScreenIconBackgroundColor">#FF6B00</item>'
      );
      console.log('  ✓ Added windowSplashScreenAnimatedIcon = @drawable/transparent_splash_icon');
      console.log('  ✓ Added windowSplashScreenIconBackgroundColor = orange (hides any platter)');
    }
  } else {
    // Already exists - update it to point to our transparent drawable
    stylesContent = stylesContent.replace(
      /<item name="windowSplashScreenAnimatedIcon">[^<]*<\/item>/,
      '<item name="windowSplashScreenAnimatedIcon">@drawable/transparent_splash_icon</item>'
    );
    console.log('  ✓ Updated windowSplashScreenAnimatedIcon to transparent');
  }

  if (stylesContent !== stylesOrig) {
    fs.writeFileSync(stylesPath, stylesContent, 'utf8');
    console.log('  ✓ Saved styles.xml');
  }

  // ====================================================================
  // FIX 2 — Use local tag image, remove dynamic loading code
  // ====================================================================
  const splashPath = path.join('public', 'splash.html');
  if (fs.existsSync(splashPath)) {
    let s = fs.readFileSync(splashPath, 'utf8');
    const sOrig = s;
    backup(splashPath);

    // Change tag image src from /tag-example.png to /tapmycarintialstage.png
    s = s.replace(/src="\/tag-example\.png"/g, 'src="/tapmycarintialstage.png"');
    console.log('  ✓ Changed tag image src to /tapmycarintialstage.png');

    // Remove the entire loadHeroSticker IIFE from Patch 83 (it was breaking the image)
    const heroStickerRe = /\/\/ TMC_PATCH83_DYNAMIC_STICKER[\s\S]*?\(\)\;\n\n/;
    if (heroStickerRe.test(s)) {
      s = s.replace(heroStickerRe, '');
      console.log('  ✓ Removed broken dynamic image loading code (Patch 83)');
    } else {
      // Try alternative pattern
      const altRe = /\(function loadHeroSticker\(\)\{[\s\S]*?\}\)\(\);\s*/;
      if (altRe.test(s)) {
        s = s.replace(altRe, '');
        console.log('  ✓ Removed dynamic loading IIFE');
      }
    }

    if (s !== sOrig) {
      fs.writeFileSync(splashPath, s, 'utf8');
      console.log('  ✓ Saved public/splash.html');
      if (fs.existsSync('splash.html')) fs.copyFileSync(splashPath, 'splash.html');
    }
  }

  console.log('\n╔══════════════════════════════════════════════════╗');
  console.log('║ TMC_PATCH89 complete ✓                           ║');
  console.log('╚══════════════════════════════════════════════════╝');
  console.log('\nNext steps:');
  console.log('  1. npx cap sync android');
  console.log('  2. git add -A');
  console.log('  3. git commit -m "TMC_PATCH89: Hide system splash icon + fix tag image"');
  console.log('  4. git push');
  console.log('');
  console.log('Then in Android Studio:');
  console.log('  5. Emulator: uninstall TapMyCar+');
  console.log('  6. Device Manager → ▼ → Cold Boot Now (clears icon cache)');
  console.log('  7. Wait for full reboot');
  console.log('  8. Build → Clean Project');
  console.log('  9. ▶ Run');
  console.log('');
  console.log('Expected result:');
  console.log('  - Tap app icon → ORANGE screen only (no icon visible)');
  console.log('  - Animated splash begins immediately on the same orange bg');
  console.log('  - One continuous orange experience, no white circle');
  console.log('  - Onboarding tag image loads correctly\n');

} catch (err) {
  console.error('\n✗ PATCH FAILED: ' + err.message);
  if (err.stack) console.error(err.stack);
  process.exit(1);
}
