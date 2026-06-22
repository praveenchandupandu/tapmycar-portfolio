#!/usr/bin/env node
/**
 * TMC_PATCH87 — Smaller tag, better layout, icon without orange
 *
 * Three things:
 *
 *   1. Tag scene: 150 → 110 (much smaller, won't overlap text)
 *
 *   2. Better arrangement:
 *      - Tighter padding on onboarding content
 *      - More vertical spacing between tag and text
 *      - Reduce the 3D rotation angle so the tag is more "still"
 *
 *   3. Icon update (handled by new PNG files, not by this script):
 *      - icon-background.png → WHITE (no orange)
 *      - icon-only.png and icon-foreground.png → transparent bg
 *
 *      Result: launcher shows colorful logo on WHITE circle, no extra orange.
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
const backupDir = 'backup-tag-smaller-' + stamp;

function backup(filePath) {
  if (!fs.existsSync(filePath)) return;
  const dest = path.join(backupDir, filePath);
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.copyFileSync(filePath, dest);
}

console.log('\n╔══════════════════════════════════════════════════╗');
console.log('║ TMC_PATCH87 — Smaller tag + better layout        ║');
console.log('╚══════════════════════════════════════════════════╝');
fs.mkdirSync(backupDir, { recursive: true });

try {
  const splashPath = path.join('public', 'splash.html');
  if (!fs.existsSync(splashPath)) throw new Error('public/splash.html not found');

  let s = fs.readFileSync(splashPath, 'utf8');
  const orig = s;
  backup(splashPath);

  // ====================================================================
  // CHANGE 1 — Reduce tag scene size further (any size → 110)
  // ====================================================================
  const sceneRe = /(\.tmc-tag-scene\{position:relative;width:)(\d+)(px;height:)(\d+)(px;margin:[^}]*\})/;
  if (sceneRe.test(s)) {
    s = s.replace(sceneRe, '.tmc-tag-scene{position:relative;width:110px;height:110px;margin:0 auto 24px;perspective:1000px}');
    console.log('  ✓ Reduced tag scene → 110×110');
  }

  // ====================================================================
  // CHANGE 2 — Less aggressive 3D rotation (was -14°/+14°, now -8°/+8°)
  // ====================================================================
  const floatRe = /@keyframes tmcTagFloat\{0%,100%\{transform:rotateY\(-14deg\) rotateX\(8deg\) translateY\(0\)\}50%\{transform:rotateY\(14deg\) rotateX\(-5deg\) translateY\(-8px\)\}\}/;
  if (floatRe.test(s)) {
    s = s.replace(floatRe, '@keyframes tmcTagFloat{0%,100%{transform:rotateY(-8deg) rotateX(4deg) translateY(0)}50%{transform:rotateY(8deg) rotateX(-3deg) translateY(-4px)}}');
    console.log('  ✓ Reduced 3D rotation angle (more subtle)');
  }

  // ====================================================================
  // CHANGE 3 — Better onboarding content spacing
  // ====================================================================
  // The .ob content area — adjust padding and gap
  const obContentRe = /(<div style="flex:1;display:flex;flex-direction:column;align-items:center;justify-content:center;padding:)32px 32px(;gap:)28px(">)/;
  if (obContentRe.test(s)) {
    s = s.replace(obContentRe, '$140px 32px$216px$3');
    console.log('  ✓ Tightened onboarding spacing (gap 28 → 16)');
  }

  // ====================================================================
  // CHANGE 4 — Headline size 20 → 18, tighter line-height
  // ====================================================================
  const headlineRe = /<div style="font-size:20px;font-weight:800;color:#111;margin-bottom:10px;line-height:1\.3">/;
  if (headlineRe.test(s)) {
    s = s.replace(headlineRe, '<div style="font-size:19px;font-weight:800;color:#111;margin-bottom:8px;line-height:1.3">');
    console.log('  ✓ Headline 20px → 19px');
  }

  // ====================================================================
  // CHANGE 5 — Subtitle slightly tighter
  // ====================================================================
  const subtitleRe = /<div style="font-size:14px;color:#666;line-height:1\.55;max-width:300px;margin:0 auto">/;
  if (subtitleRe.test(s)) {
    s = s.replace(subtitleRe, '<div style="font-size:13px;color:#666;line-height:1.5;max-width:280px;margin:0 auto">');
    console.log('  ✓ Subtitle 14px → 13px');
  }

  if (s !== orig) {
    fs.writeFileSync(splashPath, s, 'utf8');
    console.log('  ✓ Saved public/splash.html');
    if (fs.existsSync('splash.html')) fs.copyFileSync(splashPath, 'splash.html');
  }

  console.log('\n╔══════════════════════════════════════════════════╗');
  console.log('║ TMC_PATCH87 complete ✓                           ║');
  console.log('╚══════════════════════════════════════════════════╝');
  console.log('\n══════════════════════════════════════════════════════');
  console.log('STILL NEEDED — download 3 new icon files (no orange)');
  console.log('══════════════════════════════════════════════════════');
  console.log('');
  console.log('Replace the icon files in assets/ with the new ones from Claude');
  console.log('(they have NO orange background — just the logo):');
  console.log('');
  console.log('  Move-Item -Path "$HOME\\Downloads\\icon-only.png" -Destination "assets\\icon-only.png" -Force');
  console.log('  Move-Item -Path "$HOME\\Downloads\\icon-foreground.png" -Destination "assets\\icon-foreground.png" -Force');
  console.log('  Move-Item -Path "$HOME\\Downloads\\icon-background.png" -Destination "assets\\icon-background.png" -Force');
  console.log('  npx capacitor-assets generate --android');
  console.log('  npx cap sync android');
  console.log('  git add -A');
  console.log('  git commit -m "TMC_PATCH87: Tag size + white icon background"');
  console.log('  git push');
  console.log('');
  console.log('Then in Android Studio:');
  console.log('  Emulator: uninstall TapMyCar+');
  console.log('  Device Manager: Cold Boot Now (clears launcher icon cache)');
  console.log('  Wait for full boot');
  console.log('  Build → Clean Project');
  console.log('  ▶ Run\n');

} catch (err) {
  console.error('\n✗ PATCH FAILED: ' + err.message);
  process.exit(1);
}
