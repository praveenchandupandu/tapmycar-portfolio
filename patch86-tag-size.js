#!/usr/bin/env node
/**
 * TMC_PATCH86 — Reduce onboarding tag size + title size
 *
 *   1. Tag scene: 200 → 150 (more proportional, less dominant)
 *   2. Headline font: 26px → 20px (smaller, more elegant)
 *
 * Note: App icon is updated SEPARATELY via the 3 new icon PNG files
 * (icon-only.png, icon-foreground.png, icon-background.png) which need
 * to be placed in assets/ folder. The patch script doesn't touch those.
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
const backupDir = 'backup-tag-size-' + stamp;

function backup(filePath) {
  if (!fs.existsSync(filePath)) return;
  const dest = path.join(backupDir, filePath);
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.copyFileSync(filePath, dest);
}

console.log('\n╔══════════════════════════════════════════════════╗');
console.log('║ TMC_PATCH86 — Reduce tag + title size            ║');
console.log('╚══════════════════════════════════════════════════╝');
fs.mkdirSync(backupDir, { recursive: true });

try {
  const splashPath = path.join('public', 'splash.html');
  if (!fs.existsSync(splashPath)) throw new Error('public/splash.html not found');

  let s = fs.readFileSync(splashPath, 'utf8');
  const orig = s;
  backup(splashPath);

  // Reduce tag scene from 200 → 150
  const sceneRe = /\.tmc-tag-scene\{position:relative;width:200px;height:200px;margin:0 auto 22px;perspective:1000px\}/;
  if (sceneRe.test(s)) {
    s = s.replace(sceneRe, '.tmc-tag-scene{position:relative;width:150px;height:150px;margin:0 auto 20px;perspective:1000px}');
    console.log('  ✓ Reduced tag scene 200 → 150');
  } else if (/width:150px;height:150px;margin:0 auto 20px/.test(s)) {
    console.log('  ⏩ Tag scene already at 150×150');
  } else {
    // Fall back: try to match any tag-scene width and reduce
    const broadRe = /(\.tmc-tag-scene\{position:relative;width:)(\d+)(px;height:)(\d+)(px;margin:[^}]*\})/;
    if (broadRe.test(s)) {
      s = s.replace(broadRe, '$1150$3150$5');
      console.log('  ✓ Reduced tag scene to 150×150 (broad match)');
    } else {
      console.log('  ⚠ Could not find tag scene CSS — skipping');
    }
  }

  // Reduce headline font 26px → 20px
  const headlineRe = /<div style="font-size:26px;font-weight:800;color:#111;margin-bottom:14px;line-height:1\.25">/;
  if (headlineRe.test(s)) {
    s = s.replace(headlineRe, '<div style="font-size:20px;font-weight:800;color:#111;margin-bottom:10px;line-height:1.3">');
    console.log('  ✓ Reduced headline font 26px → 20px');
  } else if (/font-size:20px;font-weight:800;color:#111;margin-bottom:10px/.test(s)) {
    console.log('  ⏩ Headline already at 20px');
  } else {
    // Broad fallback
    const headlineBroadRe = /(<div style="font-size:)(\d+)(px;font-weight:800;color:#111;)/;
    if (headlineBroadRe.test(s)) {
      s = s.replace(headlineBroadRe, '$120$3');
      console.log('  ✓ Reduced headline font to 20px (broad match)');
    }
  }

  // Slight subtitle reduction too, for proportion
  const subtitleRe = /<div style="font-size:15px;color:#555;line-height:1\.55;max-width:320px;margin:0 auto">/;
  if (subtitleRe.test(s)) {
    s = s.replace(subtitleRe, '<div style="font-size:14px;color:#666;line-height:1.55;max-width:300px;margin:0 auto">');
    console.log('  ✓ Reduced subtitle font 15px → 14px');
  }

  if (s !== orig) {
    fs.writeFileSync(splashPath, s, 'utf8');
    console.log('  ✓ Saved public/splash.html');
    if (fs.existsSync('splash.html')) fs.copyFileSync(splashPath, 'splash.html');
  }

  console.log('\n╔══════════════════════════════════════════════════╗');
  console.log('║ TMC_PATCH86 complete ✓                           ║');
  console.log('╚══════════════════════════════════════════════════╝');
  console.log('\n══════════════════════════════════════════════════════');
  console.log('NEXT STEPS — Update icon files too');
  console.log('══════════════════════════════════════════════════════');
  console.log('');
  console.log('Download these 3 NEW icon files from Claude:');
  console.log('  • icon-only.png        (logo on orange background)');
  console.log('  • icon-foreground.png  (logo with safe-zone padding for adaptive icons)');
  console.log('  • icon-background.png  (solid orange)');
  console.log('');
  console.log('Then run:');
  console.log('');
  console.log('  Move-Item -Path "$HOME\\Downloads\\icon-only.png" -Destination "assets\\icon-only.png" -Force');
  console.log('  Move-Item -Path "$HOME\\Downloads\\icon-foreground.png" -Destination "assets\\icon-foreground.png" -Force');
  console.log('  Move-Item -Path "$HOME\\Downloads\\icon-background.png" -Destination "assets\\icon-background.png" -Force');
  console.log('  npx capacitor-assets generate --android');
  console.log('  npx cap sync android');
  console.log('  git add -A');
  console.log('  git commit -m "TMC_PATCH86: Smaller tag + better icon"');
  console.log('  git push');
  console.log('');
  console.log('Then in Android Studio:');
  console.log('  Emulator: uninstall TapMyCar+');
  console.log('  Cold boot emulator (Device Manager → dropdown → Cold Boot Now)');
  console.log('  Wait for emulator full boot');
  console.log('  Build → Clean Project');
  console.log('  ▶ Run');
  console.log('');
  console.log('Result:');
  console.log('  - App icon on home: full TapMyCar shield with car/QR/wordmark on orange');
  console.log('  - Onboarding tag: noticeably smaller (150×150)');
  console.log('  - Headline: smaller, more elegant\n');

} catch (err) {
  console.error('\n✗ PATCH FAILED: ' + err.message);
  process.exit(1);
}
