#!/usr/bin/env node
/**
 * TMC_PATCH92 — Restore the landing-page tag (with QR)
 *
 *   What happened:
 *     - Patch 88 used /tag-example.png (had QR, good)
 *     - Patch 89 broke it by switching to /tapmycarintialstage.png
 *       (which is the BLANK version, no QR — wrong choice)
 *     - Patch 89 also removed the dynamic API loading from Patch 83
 *
 *   What this fixes:
 *     1. Static src → /tag-example.png (has QR visible)
 *     2. Dynamic loading restored: fetches hero_sticker_url from
 *        /api/get-branding (the same API the landing page uses).
 *        If the API returns a valid URL, swap the src — this gives
 *        you the EXACT same tag image as on tapmycar.io's landing page.
 *     3. Robust fallback: tests the API URL with a preload Image
 *        before swapping. If the API URL fails, keeps the static
 *        tag-example.png so it never breaks.
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
const backupDir = 'backup-restore-hero-tag-' + stamp;

function backup(filePath) {
  if (!fs.existsSync(filePath)) return;
  const dest = path.join(backupDir, filePath);
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.copyFileSync(filePath, dest);
}

console.log('\n╔══════════════════════════════════════════════════╗');
console.log('║ TMC_PATCH92 — Restore landing-page tag           ║');
console.log('╚══════════════════════════════════════════════════╝');
fs.mkdirSync(backupDir, { recursive: true });

try {
  const splashPath = path.join('public', 'splash.html');
  if (!fs.existsSync(splashPath)) throw new Error('public/splash.html not found');

  let s = fs.readFileSync(splashPath, 'utf8');
  const orig = s;
  backup(splashPath);

  // ====================================================================
  // FIX 1 — Static src back to /tag-example.png (has QR)
  // ====================================================================
  if (s.indexOf('src="/tapmycarintialstage.png"') !== -1) {
    s = s.replace(/src="\/tapmycarintialstage\.png"/g, 'src="/tag-example.png"');
    console.log('  ✓ Changed static tag src → /tag-example.png (has QR)');
  } else if (s.indexOf('src="/tag-example.png"') !== -1) {
    console.log('  ⏩ Static src already /tag-example.png');
  } else {
    console.log('  ⚠ Could not find expected tag src — manual check needed');
  }

  // ====================================================================
  // FIX 2 — Re-add dynamic loading from /api/get-branding
  // ====================================================================
  if (s.indexOf('TMC_PATCH92_HERO_STICKER') !== -1) {
    console.log('  ⏩ Dynamic hero sticker loader already present');
  } else {
    // Inject the loader at the start of the main <script> block.
    // We'll target the spot right before the existing run() function or
    // the existing animation trigger.
    const loaderCode =
      '  // TMC_PATCH92_HERO_STICKER — load the landing-page tag image dynamically\n' +
      '  (function loadHeroSticker(){\n' +
      '    try {\n' +
      '      var img = document.getElementById("tmc-onboarding-tag");\n' +
      '      if (!img) return;\n' +
      '      var STORAGE_KEY = "tmc_hero_sticker_url";\n' +
      '      // Try the sessionStorage cache first (fast)\n' +
      '      try {\n' +
      '        var cached = sessionStorage.getItem(STORAGE_KEY);\n' +
      '        if (cached && cached !== "null") {\n' +
      '          var test1 = new Image();\n' +
      '          test1.onload = function(){ img.src = cached; };\n' +
      '          test1.src = cached;\n' +
      '        }\n' +
      '      } catch(e){}\n' +
      '      // Fetch fresh URL from API\n' +
      '      fetch("/api/get-branding")\n' +
      '        .then(function(r){ return r.ok ? r.json() : null; })\n' +
      '        .then(function(data){\n' +
      '          if (data && data.ok && data.sticker_url) {\n' +
      '            var url = data.sticker_url;\n' +
      '            // Preload to verify the URL works before swapping\n' +
      '            var test2 = new Image();\n' +
      '            test2.onload = function(){\n' +
      '              img.src = url;\n' +
      '              try { sessionStorage.setItem(STORAGE_KEY, url); } catch(e){}\n' +
      '            };\n' +
      '            test2.onerror = function(){\n' +
      '              // keep static fallback — API URL failed to load\n' +
      '              try { sessionStorage.removeItem(STORAGE_KEY); } catch(e){}\n' +
      '            };\n' +
      '            test2.src = url;\n' +
      '          }\n' +
      '        })\n' +
      '        .catch(function(){ /* keep static fallback */ });\n' +
      '    } catch(e){ /* never throw */ }\n' +
      '  })();\n\n';

    // Anchor: inject right before "if (document.readyState" (from Patch 91)
    // OR before "window.addEventListener('load'" (older format)
    const anchor1 = /(\s*)(\/\/ TMC_PATCH91 start animation IMMEDIATELY)/;
    const anchor2 = /(\s*)(if \(document\.readyState === "loading"\))/;
    const anchor3 = /(\s*)(window\.addEventListener\('load',\s*function)/;

    if (anchor1.test(s)) {
      s = s.replace(anchor1, '\n' + loaderCode + '$1$2');
      console.log('  ✓ Injected dynamic loader (anchor: Patch 91 marker)');
    } else if (anchor2.test(s)) {
      s = s.replace(anchor2, '\n' + loaderCode + '$1$2');
      console.log('  ✓ Injected dynamic loader (anchor: readyState check)');
    } else if (anchor3.test(s)) {
      s = s.replace(anchor3, '\n' + loaderCode + '$1$2');
      console.log('  ✓ Injected dynamic loader (anchor: load event)');
    } else {
      // Last resort: inject right before </script> closing of the main script
      const lastScript = /(<\/script>\s*<\/body>)/;
      if (lastScript.test(s)) {
        s = s.replace(lastScript, '\n<script>\n' + loaderCode + '</script>\n$1');
        console.log('  ✓ Injected dynamic loader as inline script (fallback)');
      } else {
        console.log('  ⚠ Could not inject dynamic loader — no anchor found');
      }
    }
  }

  if (s !== orig) {
    fs.writeFileSync(splashPath, s, 'utf8');
    console.log('  ✓ Saved public/splash.html');
    if (fs.existsSync('splash.html')) fs.copyFileSync(splashPath, 'splash.html');
  }

  console.log('\n╔══════════════════════════════════════════════════╗');
  console.log('║ TMC_PATCH92 complete ✓                           ║');
  console.log('╚══════════════════════════════════════════════════╝');
  console.log('\nHow this works now:');
  console.log('  - When onboarding loads, the static tag-example.png shows first (has QR)');
  console.log('  - In parallel, fetch /api/get-branding to get the landing-page sticker URL');
  console.log('  - If the API URL loads successfully, swap to it (matches landing page)');
  console.log('  - If API fails for any reason, the static QR tag stays');
  console.log('');
  console.log('Next:');
  console.log('  npx cap sync android');
  console.log('  git add -A');
  console.log('  git commit -m "TMC_PATCH92: Restore landing-page tag with QR"');
  console.log('  git push');
  console.log('  Emulator: uninstall + Cold Boot + Clean + Run\n');

} catch (err) {
  console.error('\n✗ PATCH FAILED: ' + err.message);
  if (err.stack) console.error(err.stack);
  process.exit(1);
}
