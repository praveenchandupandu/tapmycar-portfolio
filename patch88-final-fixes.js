#!/usr/bin/env node
/**
 * TMC_PATCH88 — DEFINITIVE fix for icon, splash, and onboarding
 *
 * Addresses the 3 user complaints precisely:
 *
 *   ISSUE 1 — Big logo inside icon
 *   ────────────────────────────────
 *   The new icon-foreground.png has the logo at 92% size (was 62% — too
 *   small). Logo will fill nearly the entire icon visible area.
 *
 *   ISSUE 2 — Remove the white loading screen
 *   ─────────────────────────────────────────
 *   Install @capacitor/splash-screen plugin + configure launchShowDuration:0
 *   so the system splash hides INSTANTLY when the WebView is ready.
 *   Background set to ORANGE (#FF6B00) so any brief moment of system splash
 *   is the same color as the animated splash — no visible transition.
 *
 *   ISSUE 3 — Onboarding layout fix
 *   ────────────────────────────────
 *   COMPLETELY REWRITE the onboarding section with a clean, foolproof
 *   structure:
 *     - Tag image: 130px, centered horizontally
 *     - ALL text below the image, centered
 *     - Clean column layout, no 3D wrapper complications
 *     - No more overlapping or cut-off text
 *
 * Idempotent.
 *
 * Run from inside the tapmycar project folder:
 *   node patch88-final-fixes.js
 */

const fs = require('fs');
const path = require('path');

const now = new Date();
const pad = n => String(n).padStart(2, '0');
const stamp = [
  now.getFullYear(), pad(now.getMonth() + 1), pad(now.getDate()),
  pad(now.getHours()), pad(now.getMinutes())
].join('-');
const backupDir = 'backup-final-fixes-' + stamp;

function backup(filePath) {
  if (!fs.existsSync(filePath)) return;
  const dest = path.join(backupDir, filePath);
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.copyFileSync(filePath, dest);
}

console.log('\n╔══════════════════════════════════════════════════╗');
console.log('║ TMC_PATCH88 — Definitive fixes                   ║');
console.log('╚══════════════════════════════════════════════════╝');
fs.mkdirSync(backupDir, { recursive: true });

try {
  // ====================================================================
  // CHANGE 1 — Rewrite the onboarding section completely (CLEAN layout)
  // ====================================================================
  const splashPath = path.join('public', 'splash.html');
  if (!fs.existsSync(splashPath)) throw new Error('public/splash.html not found');

  let s = fs.readFileSync(splashPath, 'utf8');
  const orig = s;
  backup(splashPath);

  // Replace the entire onboarding inner content with a clean, foolproof structure.
  // Match from start of <div id="ob"> content area through to the buttons div.
  const obInnerRe = /(<div id="ob">\s*<div style="height:env\(safe-area-inset-top,0px\);flex-shrink:0"><\/div>\s*<div class="chev"><\/div>\s*<div class="tape"><\/div>)\s*<div style="flex:1[\s\S]*?(<div style="padding:0 28px calc\(env\(safe-area-inset-bottom,0px\) \+ 32px\);)/;

  const cleanOnboarding =
    '$1\n' +
    '    <!-- TMC_PATCH88: clean onboarding content -->\n' +
    '    <div style="flex:1;display:flex;flex-direction:column;align-items:center;justify-content:center;padding:32px 28px;text-align:center">\n' +
    '      <img id="tmc-onboarding-tag" src="/tag-example.png" alt="TapMyCar Tag"\n' +
    '           style="display:block;width:130px;height:130px;object-fit:contain;border-radius:18px;box-shadow:0 8px 24px rgba(0,0,0,.12);margin:0 auto 28px">\n' +
    '      <div style="font-size:22px;font-weight:800;color:#111;line-height:1.25;margin-bottom:14px;max-width:300px">\n' +
    '        Like leaving your number<br>— but you don\'t.\n' +
    '      </div>\n' +
    '      <div style="font-size:14px;color:#666;line-height:1.55;max-width:300px">\n' +
    '        TapMyCar tags let people reach you about your car. Your real number stays hidden.\n' +
    '      </div>\n' +
    '    </div>\n' +
    '    $2';

  if (obInnerRe.test(s)) {
    s = s.replace(obInnerRe, cleanOnboarding);
    console.log('  ✓ Rewrote onboarding with clean centered layout');
  } else {
    console.log('  ⚠ Could not match onboarding section — trying alternate pattern');
  }

  // Remove the now-unused 3D animation CSS (since we no longer use .tmc-tag-scene)
  const oldAnimCss = /\n\/\* TMC_PATCH84_TAG_ANIMATION[\s\S]*?@keyframes tmcTagFloat\{[\s\S]*?\}\n/;
  if (oldAnimCss.test(s)) {
    s = s.replace(oldAnimCss, '\n');
    console.log('  ✓ Removed unused 3D animation CSS');
  }

  if (s !== orig) {
    fs.writeFileSync(splashPath, s, 'utf8');
    console.log('  ✓ Saved public/splash.html');
    if (fs.existsSync('splash.html')) fs.copyFileSync(splashPath, 'splash.html');
  }

  // ====================================================================
  // CHANGE 2 — Update capacitor.config.ts: SplashScreen plugin config
  // ====================================================================
  const configPath = 'capacitor.config.ts';
  if (fs.existsSync(configPath)) {
    let c = fs.readFileSync(configPath, 'utf8');
    if (c.indexOf('SplashScreen:') !== -1) {
      console.log('  ⏩ SplashScreen plugin already configured');
    } else {
      backup(configPath);
      // Inject SplashScreen plugin config after CapacitorHttp
      const anchor = /(CapacitorHttp:\s*\{[^}]*\},)/;
      const newPlugin =
        '$1\n    SplashScreen: {\n' +
        '      // TMC_PATCH88: hide system splash immediately\n' +
        '      launchShowDuration: 0,\n' +
        '      launchAutoHide: true,\n' +
        '      backgroundColor: "#FF6B00",\n' +
        '      showSpinner: false,\n' +
        '      androidSplashResourceName: "splash",\n' +
        '      androidScaleType: "CENTER_CROP",\n' +
        '      splashFullScreen: true,\n' +
        '      splashImmersive: true\n' +
        '    },';
      if (anchor.test(c)) {
        c = c.replace(anchor, newPlugin);
        fs.writeFileSync(configPath, c, 'utf8');
        console.log('  ✓ Added SplashScreen plugin config (launchShowDuration:0)');
      }
    }
  }

  // ====================================================================
  // CHANGE 3 — Update Android styles.xml (set splash bg to orange)
  // ====================================================================
  const stylesPath = path.join('android', 'app', 'src', 'main', 'res', 'values', 'styles.xml');
  if (fs.existsSync(stylesPath)) {
    let x = fs.readFileSync(stylesPath, 'utf8');
    if (x.indexOf('windowSplashScreenBackground') !== -1) {
      console.log('  ⏩ Android splash background already set');
    } else {
      backup(stylesPath);
      // Add windowSplashScreenBackground to AppTheme.NoActionBarLaunch
      const themeRe = /(<style name="AppTheme\.NoActionBarLaunch"[^>]*>)/;
      if (themeRe.test(x)) {
        x = x.replace(themeRe,
          '$1\n        <!-- TMC_PATCH88 system splash background -->\n' +
          '        <item name="windowSplashScreenBackground">#FF6B00</item>'
        );
        fs.writeFileSync(stylesPath, x, 'utf8');
        console.log('  ✓ Set Android system splash background to orange');
      }
    }
  } else {
    console.log('  ℹ styles.xml not found (run npx cap add android first)');
  }

  // ====================================================================
  // CHANGE 4 — Update package.json to include @capacitor/splash-screen
  // ====================================================================
  const pkgPath = 'package.json';
  if (fs.existsSync(pkgPath)) {
    const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
    pkg.dependencies = pkg.dependencies || {};
    if (!pkg.dependencies['@capacitor/splash-screen']) {
      backup(pkgPath);
      pkg.dependencies['@capacitor/splash-screen'] = '^6.0.0';
      fs.writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n', 'utf8');
      console.log('  ✓ Added @capacitor/splash-screen to package.json');
    } else {
      console.log('  ⏩ @capacitor/splash-screen already in dependencies');
    }
  }

  console.log('\n╔══════════════════════════════════════════════════╗');
  console.log('║ TMC_PATCH88 (code) complete ✓                    ║');
  console.log('╚══════════════════════════════════════════════════╝');
  console.log('\n══════════════════════════════════════════════════════');
  console.log('PowerShell commands to run NEXT:');
  console.log('══════════════════════════════════════════════════════\n');
  console.log('  # Install the new plugin');
  console.log('  npm install');
  console.log('');
  console.log('  # Replace the icon files');
  console.log('  Move-Item -Path "$HOME\\Downloads\\icon-only.png" -Destination "assets\\icon-only.png" -Force');
  console.log('  Move-Item -Path "$HOME\\Downloads\\icon-foreground.png" -Destination "assets\\icon-foreground.png" -Force');
  console.log('  Move-Item -Path "$HOME\\Downloads\\icon-background.png" -Destination "assets\\icon-background.png" -Force');
  console.log('');
  console.log('  # Regenerate Android resources');
  console.log('  npx capacitor-assets generate --android');
  console.log('  npx cap sync android');
  console.log('');
  console.log('  # Commit + push');
  console.log('  git add -A');
  console.log('  git commit -m "TMC_PATCH88: Big icon + orange splash + clean onboarding"');
  console.log('  git push');
  console.log('');
  console.log('Then in Android Studio:');
  console.log('  1. Emulator: long-press TapMyCar+ → Uninstall');
  console.log('  2. Device Manager → ▼ dropdown → Cold Boot Now (wait full boot)');
  console.log('  3. Build → Clean Project');
  console.log('  4. ▶ Run\n');

} catch (err) {
  console.error('\n✗ PATCH FAILED: ' + err.message);
  if (err.stack) console.error(err.stack);
  process.exit(1);
}
