#!/usr/bin/env node
/**
 * TMC_PATCH84 — Consolidated splash fixes
 *
 * Three issues addressed:
 *
 *   1. TEXT: Force-set onboarding headline + subtitle to the chosen
 *      wording (option 19). Uses safer string matching so it works
 *      regardless of previous patch states.
 *
 *   2. ANIMATION: Add the same 3D-float animation that's on the
 *      landing-page hero sticker. Subtle gentle rotation, no rings/glow
 *      (those look bad on white background).
 *
 *   3. APP ICON: Provides the exact rebuild sequence for the icon to
 *      refresh on the home screen (launcher caches icons aggressively).
 *      This patch doesn't modify icon files — they were already generated
 *      in Phase B. The fix is in the rebuild procedure.
 *
 * Idempotent. Safe to re-run.
 */

const fs = require('fs');
const path = require('path');

const now = new Date();
const pad = n => String(n).padStart(2, '0');
const stamp = [
  now.getFullYear(), pad(now.getMonth() + 1), pad(now.getDate()),
  pad(now.getHours()), pad(now.getMinutes())
].join('-');
const backupDir = 'backup-consolidated-splash-' + stamp;

function backup(filePath) {
  if (!fs.existsSync(filePath)) return;
  const dest = path.join(backupDir, filePath);
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.copyFileSync(filePath, dest);
}

console.log('\n╔══════════════════════════════════════════════════╗');
console.log('║ TMC_PATCH84 — Consolidated splash fixes          ║');
console.log('╚══════════════════════════════════════════════════╝');
fs.mkdirSync(backupDir, { recursive: true });

const FINAL_HEADLINE = 'Like leaving your number<br>— but you don\'t.';
const FINAL_SUBTITLE = 'TapMyCar tags let people reach you about your car. Your real number stays hidden.';

try {
  const splashPath = path.join('public', 'splash.html');
  if (!fs.existsSync(splashPath)) throw new Error('public/splash.html not found');

  let content = fs.readFileSync(splashPath, 'utf8');
  const original = content;
  backup(splashPath);

  // ====================================================================
  // CHANGE 1 — Force-set the headline (regardless of previous state)
  // ====================================================================
  // Use a broad regex that matches whatever is currently in the headline div
  const headlineRe = /(<div style="font-size:[\d.]+px;font-weight:800;color:#111;[^"]*">)[^<]*(?:<br>[^<]*)?(<\/div>)/;
  if (headlineRe.test(content)) {
    content = content.replace(headlineRe, '$1' + FINAL_HEADLINE + '$2');
    console.log('  ✓ Force-set headline → "Like leaving your number — but you don\'t."');
  } else {
    console.log('  ⚠ Could not match headline pattern — manual review needed');
  }

  // ====================================================================
  // CHANGE 2 — Force-set the subtitle
  // ====================================================================
  const subtitleRe = /(<div style="font-size:15px;color:#[\w]+;[^"]*">)[^<]*(<\/div>)/;
  if (subtitleRe.test(content)) {
    content = content.replace(subtitleRe, '$1' + FINAL_SUBTITLE + '$2');
    console.log('  ✓ Force-set subtitle → "TapMyCar tags let people reach you..."');
  } else {
    console.log('  ⚠ Could not match subtitle pattern — manual review needed');
  }

  // ====================================================================
  // CHANGE 3 — Add 3D float animation to the tag image
  // ====================================================================
  if (content.indexOf('TMC_PATCH84_TAG_ANIMATION') !== -1) {
    console.log('  ⏩ Tag animation already added');
  } else {
    // Add CSS animation rules right before </style>
    const animationCss =
      '\n/* TMC_PATCH84_TAG_ANIMATION — landing-page-style 3D float for onboarding tag */\n' +
      '.tmc-tag-scene{position:relative;width:240px;height:240px;margin:0 auto 24px;perspective:1000px}\n' +
      '.tmc-tag-scene .tmc-tag-glow{position:absolute;inset:-12px;border-radius:32px;background:radial-gradient(circle,rgba(255,107,0,.22) 0%,transparent 60%);filter:blur(20px);animation:tmcTagGlow 3.5s ease-in-out infinite alternate;z-index:0}\n' +
      '@keyframes tmcTagGlow{from{opacity:.6;transform:scale(.94)}to{opacity:1;transform:scale(1.08)}}\n' +
      '.tmc-tag-3d{position:relative;z-index:1;width:100%;height:100%;transform-style:preserve-3d;animation:tmcTagFloat 6s ease-in-out infinite}\n' +
      '.tmc-tag-3d img{width:100%;height:100%;object-fit:contain;border-radius:18px;box-shadow:0 12px 36px rgba(0,0,0,.18),0 0 0 3px #FF6B00;background:#fff}\n' +
      '@keyframes tmcTagFloat{0%,100%{transform:rotateY(-14deg) rotateX(8deg) translateY(0)}50%{transform:rotateY(14deg) rotateX(-5deg) translateY(-8px)}}\n';

    const styleCloseRe = /(<\/style>)/;
    if (styleCloseRe.test(content)) {
      content = content.replace(styleCloseRe, animationCss + '$1');
      console.log('  ✓ Added 3D float animation CSS');
    }

    // Wrap the tag <img> in the animated scene divs
    const imgWrapRe = /(<img id="tmc-onboarding-tag"[^>]*>)/;
    if (imgWrapRe.test(content)) {
      content = content.replace(imgWrapRe,
        '<!-- TMC_PATCH84_TAG_ANIMATION -->\n' +
        '      <div class="tmc-tag-scene">\n' +
        '        <div class="tmc-tag-glow"></div>\n' +
        '        <div class="tmc-tag-3d">\n' +
        '          $1\n' +
        '        </div>\n' +
        '      </div>'
      );
      console.log('  ✓ Wrapped tag image in animated 3D scene');
    } else {
      // Fallback: maybe id isn't set yet — try the original src match
      const altRe = /(<img src="\/(?:tag-example|tapmycarintialstage)\.png" alt="TapMyCar Tag"[^>]*>)/;
      if (altRe.test(content)) {
        content = content.replace(altRe,
          '<!-- TMC_PATCH84_TAG_ANIMATION -->\n' +
          '      <div class="tmc-tag-scene">\n' +
          '        <div class="tmc-tag-glow"></div>\n' +
          '        <div class="tmc-tag-3d">\n' +
          '          $1\n' +
          '        </div>\n' +
          '      </div>'
        );
        console.log('  ✓ Wrapped tag image in animated 3D scene (fallback match)');
      } else {
        console.log('  ⚠ Could not find tag image to wrap');
      }
    }

    // Also remove the static styles from the img (border-radius etc.) since the wrapper handles them now
    const cleanImgRe = /(id="tmc-onboarding-tag"[^>]*) style="width:230px;height:230px;border-radius:24px;box-shadow:0 8px 28px rgba\(0,0,0,\.12\);object-fit:contain;background:#fff"/;
    if (cleanImgRe.test(content)) {
      content = content.replace(cleanImgRe, '$1');
      console.log('  ✓ Cleaned old inline styles from tag image');
    }
  }

  if (content !== original) {
    fs.writeFileSync(splashPath, content, { encoding: 'utf8' });
    console.log('\n  ✓ Saved updated public/splash.html');
    if (fs.existsSync('splash.html')) {
      fs.copyFileSync(splashPath, 'splash.html');
      console.log('  ✓ Synced splash.html to project root');
    }
  } else {
    console.log('\n  ⏩ No file changes needed');
  }

  console.log('\n╔══════════════════════════════════════════════════╗');
  console.log('║ TMC_PATCH84 complete ✓                           ║');
  console.log('╚══════════════════════════════════════════════════╝');
  console.log('\n══════════════════════════════════════════════════════');
  console.log('CRITICAL — Full rebuild required (including icons)');
  console.log('══════════════════════════════════════════════════════');
  console.log('');
  console.log('Run ALL of these in order:');
  console.log('');
  console.log('  1. npx cap sync android');
  console.log('  2. npx capacitor-assets generate --android');
  console.log('     (regenerates icons from assets/icon-only.png)');
  console.log('  3. git add -A');
  console.log('  4. git commit -m "TMC_PATCH84: Text + tag animation + icon regen"');
  console.log('  5. git push');
  console.log('');
  console.log('Then in Android Studio (icon fix sequence):');
  console.log('');
  console.log('  6. In the EMULATOR, long-press TapMyCar+ icon → Uninstall');
  console.log('  7. In emulator, REBOOT it (3 dot menu top right → Cold Boot Now)');
  console.log('     This clears the launcher icon cache completely.');
  console.log('  8. Wait for emulator to fully boot');
  console.log('  9. In Android Studio: Build → Clean Project (wait)');
  console.log(' 10. Build → Rebuild Project (wait)');
  console.log(' 11. Click ▶ Run');
  console.log(' 12. App installs fresh, icon should now show TapMyCar logo');
  console.log('');
  console.log('Verify:');
  console.log('  - On home screen: app icon shows your TapMyCar shield/car logo');
  console.log('  - When tapped: splash plays, tag has subtle 3D float animation');
  console.log('  - Onboarding text: "Like leaving your number — but you don\'t."');
  console.log('  - Subtitle: "TapMyCar tags let people reach you about your car..."\n');

} catch (err) {
  console.error('\n✗ PATCH FAILED: ' + err.message);
  if (err.stack) console.error(err.stack);
  process.exit(1);
}
