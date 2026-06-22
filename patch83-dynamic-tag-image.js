#!/usr/bin/env node
/**
 * TMC_PATCH83 — Load tag image dynamically from landing-page API
 *
 * The landing page loads the hero sticker image from /api/get-branding,
 * which returns the admin-uploaded sticker URL from Supabase. This is
 * the actual tag image Praveen wants to use.
 *
 * This patch updates splash.html to do the same — guaranteeing the
 * onboarding image matches whatever is shown on tapmycar.io's landing
 * page hero section.
 *
 * Strategy:
 *   1. Image starts with /tag-example.png as a silent fallback
 *   2. On page load, fetch /api/get-branding
 *   3. If sticker_url returned, swap the image source
 *   4. Cache via sessionStorage (matches landing.html pattern)
 *   5. If API fails, keep the fallback
 *
 * Idempotent. Safe to re-run.
 *
 * Run from inside the tapmycar project folder:
 *   node patch83-dynamic-tag-image.js
 */

const fs = require('fs');
const path = require('path');

const now = new Date();
const pad = n => String(n).padStart(2, '0');
const stamp = [
  now.getFullYear(), pad(now.getMonth() + 1), pad(now.getDate()),
  pad(now.getHours()), pad(now.getMinutes())
].join('-');
const backupDir = 'backup-dynamic-tag-' + stamp;

function backup(filePath) {
  if (!fs.existsSync(filePath)) return;
  const dest = path.join(backupDir, filePath);
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.copyFileSync(filePath, dest);
}

console.log('\n╔══════════════════════════════════════════════════╗');
console.log('║ TMC_PATCH83 — Dynamic tag image from API         ║');
console.log('╚══════════════════════════════════════════════════╝');
fs.mkdirSync(backupDir, { recursive: true });

try {
  const splashPath = path.join('public', 'splash.html');
  if (!fs.existsSync(splashPath)) throw new Error('public/splash.html not found');

  let content = fs.readFileSync(splashPath, 'utf8');
  const original = content;

  if (content.indexOf('TMC_PATCH83_DYNAMIC_STICKER') !== -1) {
    console.log('\n  ⏩ Dynamic tag loading already installed');
  } else {
    backup(splashPath);

    // ============================================================
    // CHANGE 1 — Add id to the tag image so JS can target it
    // ============================================================
    const imgRe = /<img src="\/tag-example\.png" alt="TapMyCar Tag"([^>]*)>/;
    if (imgRe.test(content)) {
      content = content.replace(imgRe, '<img id="tmc-onboarding-tag" src="/tag-example.png" alt="TapMyCar Tag"$1>');
      console.log('  ✓ Added id="tmc-onboarding-tag" to image');
    } else {
      // Maybe ID already added, or different image used
      if (content.indexOf('id="tmc-onboarding-tag"') !== -1) {
        console.log('  ⏩ Image already has id');
      } else {
        // Try a broader pattern matching tapmycarintialstage.png too
        const altImgRe = /<img src="\/(tag-example|tapmycarintialstage)\.png" alt="TapMyCar Tag"([^>]*)>/;
        if (altImgRe.test(content)) {
          content = content.replace(altImgRe, '<img id="tmc-onboarding-tag" src="/tag-example.png" alt="TapMyCar Tag"$2>');
          console.log('  ✓ Added id and standardized image src');
        } else {
          throw new Error('Could not find onboarding image to add id to');
        }
      }
    }

    // ============================================================
    // CHANGE 2 — Inject dynamic loading script before closing </script>
    // ============================================================
    // Find the existing <script> block that runs the animation
    // and add the sticker loading code right before window.addEventListener('load', ...)
    const scriptAnchorRe = /(  window\.addEventListener\('load', function\(\)\{ setTimeout\(run, 250\); \}\);)/;
    const newScript =
      "// TMC_PATCH83_DYNAMIC_STICKER — fetch the actual landing-page tag image\n" +
      "  (function loadHeroSticker(){\n" +
      "    var tagImg = document.getElementById('tmc-onboarding-tag');\n" +
      "    if (!tagImg) return;\n" +
      "    var STORAGE_KEY = 'tmc_hero_sticker_url';\n" +
      "    // Use cached URL first (matches landing.html pattern)\n" +
      "    try {\n" +
      "      var cached = sessionStorage.getItem(STORAGE_KEY);\n" +
      "      if (cached && cached !== 'null') tagImg.src = cached;\n" +
      "    } catch(e){}\n" +
      "    // Fetch fresh from API (in-flight while splash animation plays)\n" +
      "    fetch('/api/get-branding')\n" +
      "      .then(function(r){ return r.json(); })\n" +
      "      .then(function(d){\n" +
      "        var url = (d && d.ok && d.sticker_url) ? d.sticker_url : null;\n" +
      "        try { sessionStorage.setItem(STORAGE_KEY, url == null ? 'null' : url); } catch(e){}\n" +
      "        if (url && tagImg.src !== url) tagImg.src = url;\n" +
      "      })\n" +
      "      .catch(function(){ /* keep fallback */ });\n" +
      "  })();\n\n" +
      "  $1";

    if (scriptAnchorRe.test(content)) {
      content = content.replace(scriptAnchorRe, newScript);
      console.log('  ✓ Injected dynamic sticker loading script');
    } else {
      throw new Error('Could not find anchor for dynamic loading script');
    }

    fs.writeFileSync(splashPath, content, { encoding: 'utf8' });
    console.log('\n  ✓ Saved updated public/splash.html');

    if (fs.existsSync('splash.html')) {
      fs.copyFileSync(splashPath, 'splash.html');
      console.log('  ✓ Synced splash.html to project root');
    }
  }

  console.log('\n╔══════════════════════════════════════════════════╗');
  console.log('║ TMC_PATCH83 complete ✓                           ║');
  console.log('╚══════════════════════════════════════════════════╝');
  console.log('\nNext steps:');
  console.log('  1. npx cap sync android');
  console.log('  2. git add -A && git commit -m "TMC_PATCH83: Dynamic tag image from API" && git push');
  console.log('  3. Emulator: uninstall app');
  console.log('  4. Android Studio: Build → Clean Project → ▶ Run');
  console.log('  5. Open app — onboarding will show the SAME tag image as your landing page');
  console.log('     (because it loads from the same /api/get-branding endpoint)');
  console.log('  6. If you upload a new hero sticker in admin, the app reflects it too\n');

} catch (err) {
  console.error('\n✗ PATCH FAILED: ' + err.message);
  if (err.stack) console.error(err.stack);
  process.exit(1);
}
