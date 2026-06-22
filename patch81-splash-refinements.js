#!/usr/bin/env node
/**
 * TMC_PATCH81 — Splash & onboarding refinements
 *
 * Three changes to public/splash.html:
 *
 *   1. SPLASH LOGO: Replace the generic shield+checkmark SVG with the
 *      actual TapMyCar logo (/icon-512.png). Tagline updated to
 *      "Privacy for you. Safety for your Car."
 *      The "TapMyCar•" wordmark is removed because the icon already
 *      contains the brand name (avoids redundancy).
 *
 *   2. ONBOARDING IMAGE: Replace the generic QR grid SVG with the actual
 *      TapMyCar tag design (/tapmycarintialstage.png) — same visual as
 *      the physical NFC sticker product. Adds rounded corners + shadow
 *      for product-card feel.
 *
 *   3. BUTTONS:
 *      - "Get started free" → "Sign Up" (goes to /register.html now)
 *      - "Already have an account? Sign in" splits into two:
 *        plain text "Already have an account?" + tappable "Sign in"
 *        button (goes to /signin.html)
 *
 * Idempotent. Safe to re-run.
 *
 * Run from inside the tapmycar project folder:
 *   node patch81-splash-refinements.js
 */

const fs = require('fs');
const path = require('path');

const now = new Date();
const pad = n => String(n).padStart(2, '0');
const stamp = [
  now.getFullYear(), pad(now.getMonth() + 1), pad(now.getDate()),
  pad(now.getHours()), pad(now.getMinutes())
].join('-');
const backupDir = 'backup-splash-refinements-' + stamp;

function backup(filePath) {
  if (!fs.existsSync(filePath)) return;
  const dest = path.join(backupDir, filePath);
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.copyFileSync(filePath, dest);
}

console.log('\n╔══════════════════════════════════════════════════╗');
console.log('║ TMC_PATCH81 — Splash & onboarding refinements    ║');
console.log('╚══════════════════════════════════════════════════╝');
fs.mkdirSync(backupDir, { recursive: true });

try {
  const splashPath = path.join('public', 'splash.html');
  if (!fs.existsSync(splashPath)) {
    throw new Error('public/splash.html not found — run Patch 80 first');
  }

  let content = fs.readFileSync(splashPath, 'utf8');
  const original = content;

  // Marker for idempotence
  if (content.indexOf('TMC_PATCH81') !== -1) {
    console.log('\n  ⏩ Splash already updated by Patch 81');
  } else {
    backup(splashPath);

    // ============================================================
    // CHANGE 1 — Splash logo: replace shield+checkmark with icon-512.png
    // ============================================================
    // The block we're replacing — everything from <div class="shield"> through
    // the closing </div> of .btag.
    const oldLogoBlock = /<div class="shield">[\s\S]*?<\/div>\s*<div class="bname">[\s\S]*?<\/div>\s*<div class="btag">[^<]*<\/div>/;
    const newLogoBlock =
      '<!-- TMC_PATCH81 logo image -->\n' +
      '    <img class="logo-img" src="/icon-512.png" alt="TapMyCar">\n' +
      '    <div class="btag">Privacy for you. Safety for your Car.</div>';

    if (!oldLogoBlock.test(content)) {
      throw new Error('Could not find splash logo block to replace');
    }
    content = content.replace(oldLogoBlock, newLogoBlock);
    console.log('  ✓ Replaced splash logo: icon-512.png + new tagline');

    // ============================================================
    // CHANGE 1b — Add CSS for .logo-img and update .btag font size
    // ============================================================
    // Find the .btag CSS rule and add .logo-img rule before it
    const cssAnchor = /.btag\{font-size:14px;color:rgba\(255,255,255,\.7\);letter-spacing:\.05em;font-weight:500\}/;
    const newCss =
      '.logo-img{width:180px;height:180px;display:block;margin:0 auto 18px;filter:drop-shadow(0 6px 20px rgba(0,0,0,.18))}\n' +
      '.btag{font-size:15px;color:#fff;letter-spacing:.02em;font-weight:600;text-align:center}';

    if (cssAnchor.test(content)) {
      content = content.replace(cssAnchor, newCss);
      console.log('  ✓ Added .logo-img CSS, enhanced .btag style');
    } else {
      console.log('  ⚠ Could not find .btag CSS — skipping CSS update');
    }

    // ============================================================
    // CHANGE 2 — Onboarding image: replace QR grid SVG with tag image
    // ============================================================
    const oldQrBlock = /<div style="width:130px;height:130px;border-radius:32px;background:#FFF3EC;display:flex;align-items:center;justify-content:center">\s*<svg[\s\S]*?<\/svg>\s*<\/div>/;
    const newQrBlock =
      '<!-- TMC_PATCH81 tag image -->\n' +
      '      <img src="/tapmycarintialstage.png" alt="TapMyCar Tag" ' +
      'style="width:220px;height:220px;border-radius:24px;box-shadow:0 8px 28px rgba(0,0,0,.12);object-fit:contain;background:#fff">';

    if (oldQrBlock.test(content)) {
      content = content.replace(oldQrBlock, newQrBlock);
      console.log('  ✓ Replaced onboarding QR grid with actual tag image');
    } else {
      console.log('  ⚠ Could not find onboarding QR block — skipping');
    }

    // ============================================================
    // CHANGE 3 — Buttons: Sign Up + separate Sign in
    // ============================================================
    const oldButtons = /<button class="cta-primary" id="ob-cta">Get started free<\/button>\s*<button class="cta-link" id="ob-signin">Already have an account\? Sign in<\/button>/;
    const newButtons =
      '<!-- TMC_PATCH81 buttons -->\n' +
      '      <button class="cta-primary" id="ob-cta">Sign Up</button>\n' +
      '      <div class="signin-row">\n' +
      '        <span class="signin-text">Already have an account?</span>\n' +
      '        <button class="cta-link" id="ob-signin">Sign in</button>\n' +
      '      </div>';

    if (oldButtons.test(content)) {
      content = content.replace(oldButtons, newButtons);
      console.log('  ✓ Updated buttons: "Sign Up" + separate "Sign in"');
    } else {
      console.log('  ⚠ Could not find old buttons — skipping');
    }

    // CSS for signin-row
    const ctaCssAnchor = /\.cta-link\{color:#FF6B00;font-size:13px;font-weight:600;padding:12px 0;text-align:center;background:transparent;border:none;cursor:pointer;width:100%;font-family:inherit\}/;
    const newCtaCss =
      '.cta-link{color:#FF6B00;font-size:14px;font-weight:700;padding:6px 0;background:transparent;border:none;cursor:pointer;font-family:inherit}\n' +
      '.signin-row{display:flex;justify-content:center;align-items:center;gap:6px;padding:6px 0}\n' +
      '.signin-text{color:#777;font-size:14px;font-weight:500}';
    if (ctaCssAnchor.test(content)) {
      content = content.replace(ctaCssAnchor, newCtaCss);
      console.log('  ✓ Updated .cta-link and added .signin-row CSS');
    }

    // ============================================================
    // CHANGE 4 — Sign Up button now routes to /register.html (was /signin.html)
    // ============================================================
    const oldCtaJs = /document\.getElementById\('ob-cta'\)\.addEventListener\('click', function \(\) \{\s*window\.location\.replace\('\/signin\.html'\);\s*\}\);/;
    const newCtaJs =
      "document.getElementById('ob-cta').addEventListener('click', function () {\n" +
      "    window.location.replace('/register.html');  // TMC_PATCH81: Sign Up -> register\n" +
      "  });";
    if (oldCtaJs.test(content)) {
      content = content.replace(oldCtaJs, newCtaJs);
      console.log('  ✓ Sign Up button now routes to /register.html');
    }

    fs.writeFileSync(splashPath, content, { encoding: 'utf8' });
    console.log('\n  ✓ Saved updated public/splash.html');

    // Sync to root
    if (fs.existsSync('splash.html')) {
      fs.copyFileSync(splashPath, 'splash.html');
      console.log('  ✓ Synced splash.html to project root');
    }
  }

  console.log('\n╔══════════════════════════════════════════════════╗');
  console.log('║ TMC_PATCH81 complete ✓                           ║');
  console.log('╚══════════════════════════════════════════════════╝');
  console.log('\nIMPORTANT — Next steps:');
  console.log('  1. npx cap sync android');
  console.log('  2. git add -A && git commit -m "TMC_PATCH81: Splash refinements" && git push');
  console.log('  3. Emulator: uninstall app');
  console.log('  4. Android Studio: Build → Clean Project → ▶ Run');
  console.log('  5. Open app — should see:');
  console.log('     • Splash: actual TapMyCar logo + "Privacy for you. Safety for your Car."');
  console.log('     • Onboarding: actual tag design (TAP OR SCAN / URGENT)');
  console.log('     • "Sign Up" button (orange) + "Already have an account? Sign in" below');
  console.log('  6. Tap Sign Up → /register.html');
  console.log('  7. Tap Sign in (the orange word) → /signin.html\n');

} catch (err) {
  console.error('\n✗ PATCH FAILED: ' + err.message);
  if (err.stack) console.error(err.stack);
  process.exit(1);
}
