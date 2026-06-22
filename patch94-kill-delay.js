#!/usr/bin/env node
/**
 * TMC_PATCH94 — Kill the 3-4s orange delay + fix tag image
 *
 *   ISSUE 1 — Orange screen shows for 3-4s before animated splash
 *   ──────────────────────────────────────────────────────────────
 *   The Capacitor SplashScreen plugin's launchShowDuration:0 isn't
 *   being honored (or the WebView is just slow). Fix: explicit
 *   SplashScreen.hide() call FIRST THING in splash.html — fires as
 *   soon as the script parses, before anything else. We call it
 *   multiple times (now + DOMContentLoaded + 50ms + 200ms) to make
 *   absolutely sure the system splash hides.
 *
 *   ISSUE 2 — Broken tag image
 *   ──────────────────────────
 *   The /tag-example.png file is missing from your public/ folder
 *   (which is why the broken image placeholder shows). Download the
 *   tag-example.png file Claude generated and put it in public/ —
 *   then this patch verifies the static src is correct.
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
const backupDir = 'backup-kill-delay-' + stamp;

function backup(filePath) {
  if (!fs.existsSync(filePath)) return;
  const dest = path.join(backupDir, filePath);
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.copyFileSync(filePath, dest);
}

console.log('\n╔══════════════════════════════════════════════════╗');
console.log('║ TMC_PATCH94 — Kill orange delay + fix tag image  ║');
console.log('╚══════════════════════════════════════════════════╝');
fs.mkdirSync(backupDir, { recursive: true });

try {
  // Pre-flight: tag-example.png must exist in public/
  const tagFile = path.join('public', 'tag-example.png');
  if (!fs.existsSync(tagFile)) {
    console.error('\n  ⚠ public/tag-example.png NOT FOUND.');
    console.error('  Download tag-example.png from Claude and move it to public/ first:');
    console.error('  Move-Item -Path "$HOME\\Downloads\\tag-example.png" -Destination "public\\tag-example.png" -Force');
    console.error('  Then re-run this patch.');
    process.exit(1);
  }
  console.log('  ✓ public/tag-example.png present (' + (fs.statSync(tagFile).size / 1024).toFixed(0) + ' KB)');

  // ====================================================================
  // FIX 1 — Inject SplashScreen.hide() at the very start of splash.html
  // ====================================================================
  const splashPath = path.join('public', 'splash.html');
  if (!fs.existsSync(splashPath)) throw new Error('public/splash.html not found');

  let s = fs.readFileSync(splashPath, 'utf8');
  const sOrig = s;
  backup(splashPath);

  if (s.indexOf('TMC_PATCH94_SPLASH_HIDE') !== -1) {
    console.log('  ⏩ SplashScreen.hide() already injected');
  } else {
    // Inject immediately after the opening <body> tag.
    // This script runs BEFORE anything else in the body.
    const hideScript =
      '\n  <script>\n' +
      '    // TMC_PATCH94_SPLASH_HIDE — kill the system splash IMMEDIATELY\n' +
      '    (function(){\n' +
      '      function hide(){\n' +
      '        try {\n' +
      '          if (window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.SplashScreen) {\n' +
      '            window.Capacitor.Plugins.SplashScreen.hide({ fadeOutDuration: 0 });\n' +
      '          }\n' +
      '        } catch(e) {}\n' +
      '      }\n' +
      '      hide();\n' +
      '      setTimeout(hide, 0);\n' +
      '      setTimeout(hide, 50);\n' +
      '      setTimeout(hide, 150);\n' +
      '      if (document.readyState === "loading") {\n' +
      '        document.addEventListener("DOMContentLoaded", hide);\n' +
      '      }\n' +
      '      window.addEventListener("load", hide);\n' +
      '    })();\n' +
      '  </script>\n';

    const bodyOpenRe = /(<body[^>]*>)/;
    if (bodyOpenRe.test(s)) {
      s = s.replace(bodyOpenRe, '$1' + hideScript);
      console.log('  ✓ Injected SplashScreen.hide() at top of splash.html body');
    }
  }

  // ====================================================================
  // FIX 2 — Also inject hide() in index.html (since it loads first)
  // ====================================================================
  const indexPath = path.join('public', 'index.html');
  if (fs.existsSync(indexPath)) {
    let i = fs.readFileSync(indexPath, 'utf8');
    if (i.indexOf('TMC_PATCH94_SPLASH_HIDE') === -1) {
      backup(indexPath);
      const hideScript =
        '\n<script>\n' +
        '  // TMC_PATCH94_SPLASH_HIDE\n' +
        '  (function(){\n' +
        '    function hide(){ try { if (window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.SplashScreen) window.Capacitor.Plugins.SplashScreen.hide({ fadeOutDuration: 0 }); } catch(e){} }\n' +
        '    hide(); setTimeout(hide, 0); setTimeout(hide, 50); setTimeout(hide, 150);\n' +
        '  })();\n' +
        '</script>\n';

      // Inject right after opening <body>
      const bodyOpenRe = /(<body[^>]*>)/;
      if (bodyOpenRe.test(i)) {
        i = i.replace(bodyOpenRe, '$1' + hideScript);
        fs.writeFileSync(indexPath, i, 'utf8');
        console.log('  ✓ Injected SplashScreen.hide() in index.html too');
        if (fs.existsSync('index.html')) fs.copyFileSync(indexPath, 'index.html');
      }
    } else {
      console.log('  ⏩ index.html already has hide() injection');
    }
  }

  // ====================================================================
  // FIX 3 — Verify tag image src is /tag-example.png (not blank version)
  // ====================================================================
  if (s.indexOf('src="/tapmycarintialstage.png"') !== -1) {
    s = s.replace(/src="\/tapmycarintialstage\.png"/g, 'src="/tag-example.png"');
    console.log('  ✓ Fixed tag image src to /tag-example.png');
  } else if (s.indexOf('src="/tag-example.png"') !== -1) {
    console.log('  ⏩ Tag image src already /tag-example.png');
  }

  // ====================================================================
  // FIX 4 — Update capacitor.config.ts SplashScreen plugin config
  //         to ensure aggressive hide behavior
  // ====================================================================
  const configPath = 'capacitor.config.ts';
  if (fs.existsSync(configPath)) {
    let c = fs.readFileSync(configPath, 'utf8');
    let configChanged = false;
    if (c.indexOf('SplashScreen:') !== -1) {
      // Ensure key properties are set correctly
      // launchShowDuration should be 0, launchAutoHide true, fadeOutDuration 0
      backup(configPath);
      // Update launchShowDuration to 0 if not already
      if (!/launchShowDuration:\s*0/.test(c)) {
        c = c.replace(/launchShowDuration:\s*\d+/, 'launchShowDuration: 0');
        configChanged = true;
      }
      // Ensure launchAutoHide is true
      if (!/launchAutoHide:\s*true/.test(c)) {
        c = c.replace(/(SplashScreen:\s*\{)/, '$1\n      launchAutoHide: true,');
        configChanged = true;
      }
      if (configChanged) {
        fs.writeFileSync(configPath, c, 'utf8');
        console.log('  ✓ Updated SplashScreen plugin config (aggressive hide)');
      } else {
        console.log('  ⏩ SplashScreen config already aggressive');
      }
    }
  }

  if (s !== sOrig) {
    fs.writeFileSync(splashPath, s, 'utf8');
    console.log('  ✓ Saved public/splash.html');
    if (fs.existsSync('splash.html')) fs.copyFileSync(splashPath, 'splash.html');
  }

  console.log('\n╔══════════════════════════════════════════════════╗');
  console.log('║ TMC_PATCH94 complete ✓                           ║');
  console.log('╚══════════════════════════════════════════════════╝');
  console.log('\nNext PowerShell:');
  console.log('  npx cap sync android');
  console.log('  git add -A');
  console.log('  git commit -m "TMC_PATCH94: Kill splash delay + fix tag image"');
  console.log('  git push');
  console.log('');
  console.log('In Android Studio:');
  console.log('  Emulator: uninstall');
  console.log('  Build → Clean Project');
  console.log('  ▶ Run');
  console.log('');
  console.log('Expected:');
  console.log('  - Orange screen for <1 second (system splash gets hidden ASAP)');
  console.log('  - Animated splash starts almost immediately');
  console.log('  - Tag image with QR loads on onboarding\n');

} catch (err) {
  console.error('\n✗ PATCH FAILED: ' + err.message);
  process.exit(1);
}
