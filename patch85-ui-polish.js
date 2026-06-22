#!/usr/bin/env node
/**
 * TMC_PATCH85 — UI polish: tag size, chatbot position, splash bg
 *
 * Three changes:
 *
 *   1. TAG SIZE: Reduce the onboarding tag scene from 240×240 to 200×200
 *      (smaller, less overpowering on the onboarding screen).
 *
 *   2. CHATBOT POSITION: On signin.html and register.html, move the
 *      floating orange chat bubble UP so it doesn't overlap the
 *      Sign In / Sign Up button. The chat bubble's default position
 *      (bottom:24px) puts it right on top of the primary CTA.
 *
 *   3. SPLASH BACKGROUND: The system splash image (Android shows it
 *      briefly before WebView loads) was on a WHITE background, then
 *      our HTML splash uses ORANGE — that white→orange flash is what
 *      Praveen is seeing as "two logos". This patch regenerates the
 *      static splash with ORANGE background so the transition is
 *      seamless. (Requires the new splash.png file + cap-assets regen.)
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
const backupDir = 'backup-ui-polish-' + stamp;

function backup(filePath) {
  if (!fs.existsSync(filePath)) return;
  const dest = path.join(backupDir, filePath);
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.copyFileSync(filePath, dest);
}

console.log('\n╔══════════════════════════════════════════════════╗');
console.log('║ TMC_PATCH85 — Tag size + chatbot + splash bg     ║');
console.log('╚══════════════════════════════════════════════════╝');
fs.mkdirSync(backupDir, { recursive: true });

const CHAT_REPOSITION_BLOCK =
'<style id="tmc-chat-reposition">\n' +
'/* TMC_PATCH85_CHAT_REPOSITION — lift the floating chat bubble above the primary CTA */\n' +
'#tmc-chat-bubble { bottom: 130px !important; }\n' +
'#tmc-chat-badge  { bottom: 178px !important; }\n' +
'#tmc-chat-window { bottom: 196px !important; }\n' +
'@media(max-width:400px){ #tmc-chat-window { bottom: 196px !important; } }\n' +
'</style>';

try {
  // ====================================================================
  // CHANGE 1 — Reduce tag scene size in splash.html (240 → 200)
  // ====================================================================
  const splashPath = path.join('public', 'splash.html');
  if (fs.existsSync(splashPath)) {
    let s = fs.readFileSync(splashPath, 'utf8');
    const sOrig = s;
    backup(splashPath);

    // The .tmc-tag-scene rule was added by Patch 84 with width:240px;height:240px
    const sceneRe = /\.tmc-tag-scene\{position:relative;width:240px;height:240px;margin:0 auto 24px;perspective:1000px\}/;
    if (sceneRe.test(s)) {
      s = s.replace(sceneRe, '.tmc-tag-scene{position:relative;width:200px;height:200px;margin:0 auto 22px;perspective:1000px}');
      console.log('  ✓ Reduced tag scene 240 → 200');
    } else if (/width:200px;height:200px;margin:0 auto 22px/.test(s)) {
      console.log('  ⏩ Tag scene already at 200×200');
    } else {
      console.log('  ⚠ Could not find tag scene CSS — skipping');
    }

    if (s !== sOrig) {
      fs.writeFileSync(splashPath, s, 'utf8');
      console.log('  ✓ Saved public/splash.html');
      if (fs.existsSync('splash.html')) fs.copyFileSync(splashPath, 'splash.html');
    }
  }

  // ====================================================================
  // CHANGE 2 — Reposition chatbot on signin.html
  // ====================================================================
  const signinPath = path.join('public', 'signin.html');
  if (fs.existsSync(signinPath)) {
    let c = fs.readFileSync(signinPath, 'utf8');
    if (c.indexOf('TMC_PATCH85_CHAT_REPOSITION') !== -1) {
      console.log('  ⏩ signin.html chat already repositioned');
    } else {
      backup(signinPath);
      // Inject the style block right before </head>
      const headCloseRe = /(<\/head>)/;
      if (headCloseRe.test(c)) {
        c = c.replace(headCloseRe, CHAT_REPOSITION_BLOCK + '\n$1');
        fs.writeFileSync(signinPath, c, 'utf8');
        console.log('  ✓ Repositioned chat bubble on signin.html (bottom: 130px)');
        if (fs.existsSync('signin.html')) fs.copyFileSync(signinPath, 'signin.html');
      }
    }
  }

  // ====================================================================
  // CHANGE 3 — Reposition chatbot on register.html (same fix)
  // ====================================================================
  const registerPath = path.join('public', 'register.html');
  if (fs.existsSync(registerPath)) {
    let c = fs.readFileSync(registerPath, 'utf8');
    if (c.indexOf('TMC_PATCH85_CHAT_REPOSITION') !== -1) {
      console.log('  ⏩ register.html chat already repositioned');
    } else {
      backup(registerPath);
      const headCloseRe = /(<\/head>)/;
      if (headCloseRe.test(c)) {
        c = c.replace(headCloseRe, CHAT_REPOSITION_BLOCK + '\n$1');
        fs.writeFileSync(registerPath, c, 'utf8');
        console.log('  ✓ Repositioned chat bubble on register.html');
        if (fs.existsSync('register.html')) fs.copyFileSync(registerPath, 'register.html');
      }
    }
  }

  console.log('\n╔══════════════════════════════════════════════════╗');
  console.log('║ TMC_PATCH85 (code part) complete ✓               ║');
  console.log('╚══════════════════════════════════════════════════╝');
  console.log('\nIMPORTANT — Now do these in PowerShell:');
  console.log('');
  console.log('  1. Replace the splash images with new orange-bg versions');
  console.log('     (download splash.png and splash-dark.png from Claude)');
  console.log('     Then:');
  console.log('       Move-Item -Path "$HOME\\Downloads\\splash.png" -Destination "assets\\splash.png" -Force');
  console.log('       Move-Item -Path "$HOME\\Downloads\\splash-dark.png" -Destination "assets\\splash-dark.png" -Force');
  console.log('');
  console.log('  2. Regenerate splash assets:');
  console.log('       npx capacitor-assets generate --android');
  console.log('');
  console.log('  3. Sync, commit, push:');
  console.log('       npx cap sync android');
  console.log('       git add -A');
  console.log('       git commit -m "TMC_PATCH85: Tag size + chat reposition + orange splash"');
  console.log('       git push');
  console.log('');
  console.log('  4. In Android Studio:');
  console.log('       Emulator: uninstall app');
  console.log('       Build → Clean Project');
  console.log('       ▶ Run');
  console.log('');
  console.log('After rebuild, you should see:');
  console.log('  - Splash transition is seamless (orange throughout, no white flash)');
  console.log('  - Onboarding tag is smaller and more proportional');
  console.log('  - Chat bubble sits above Sign In button (no overlap)\n');

} catch (err) {
  console.error('\n✗ PATCH FAILED: ' + err.message);
  if (err.stack) console.error(err.stack);
  process.exit(1);
}
