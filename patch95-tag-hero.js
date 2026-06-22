#!/usr/bin/env node
/**
 * TMC_PATCH95 — Tag image + immediate splash trigger
 *
 *   FIX 1 — Use the actual landing-page tag image
 *   ──────────────────────────────────────────────
 *   tag-hero.png (Praveen's confirmed landing-page sticker) goes into
 *   public/. splash.html src points to /tag-hero.png — static, always
 *   loads, no API dependency, never breaks.
 *
 *   FIX 2 — Remove the broken dynamic API loader
 *   ─────────────────────────────────────────────
 *   The fetch('/api/get-branding') loader has been causing intermittent
 *   image breakage. Now that we have the image locally, no dynamic call
 *   needed. Strip it out entirely.
 *
 *   FIX 3 — Make sure animation starts IMMEDIATELY
 *   ────────────────────────────────────────────────
 *   Replace any setTimeout/load-handler with synchronous trigger that
 *   fires the moment the script executes. Reduces perceived delay.
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
const backupDir = 'backup-tag-hero-' + stamp;

function backup(filePath) {
  if (!fs.existsSync(filePath)) return;
  const dest = path.join(backupDir, filePath);
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.copyFileSync(filePath, dest);
}

console.log('\n╔══════════════════════════════════════════════════╗');
console.log('║ TMC_PATCH95 — Tag image + immediate splash       ║');
console.log('╚══════════════════════════════════════════════════╝');
fs.mkdirSync(backupDir, { recursive: true });

try {
  // Pre-check: verify tag-hero.png was placed in public/
  const tagPath = path.join('public', 'tag-hero.png');
  if (!fs.existsSync(tagPath)) {
    console.error('\n  ✗ public/tag-hero.png NOT FOUND.');
    console.error('  Move-Item -Path "$HOME\\Downloads\\tag-hero.png" -Destination "public\\tag-hero.png" -Force');
    console.error('  Then re-run this patch.');
    process.exit(1);
  }
  const tagSize = fs.statSync(tagPath).size;
  console.log('  ✓ public/tag-hero.png present (' + (tagSize / 1024).toFixed(0) + ' KB)');

  const splashPath = path.join('public', 'splash.html');
  if (!fs.existsSync(splashPath)) throw new Error('public/splash.html not found');

  let s = fs.readFileSync(splashPath, 'utf8');
  const orig = s;
  backup(splashPath);

  // ====================================================================
  // FIX 1 — Replace any tag image src with /tag-hero.png
  // ====================================================================
  // Possible existing srcs: /tag-example.png, /tapmycarintialstage.png
  const srcsToReplace = [
    /src="\/tag-example\.png"/g,
    /src="\/tapmycarintialstage\.png"/g,
    /src="\/tag-hero\.png"/g  // ensure idempotency
  ];
  let replacedSrc = false;
  for (const re of srcsToReplace) {
    if (re.test(s)) {
      s = s.replace(re, 'src="/tag-hero.png"');
      replacedSrc = true;
    }
  }
  if (replacedSrc) {
    console.log('  ✓ Tag image src → /tag-hero.png');
  } else {
    console.log('  ⚠ No tag img src pattern found — splash.html may have been heavily modified');
  }

  // ====================================================================
  // FIX 2 — Strip the dynamic API loader (TMC_PATCH92_HERO_STICKER / 83)
  // ====================================================================
  const dynamicLoaders = [
    /\/\/ TMC_PATCH92_HERO_STICKER[\s\S]*?\}\)\(\);\s*/,
    /\/\/ TMC_PATCH83_DYNAMIC_STICKER[\s\S]*?\}\)\(\);\s*/,
    /\(function loadHeroSticker\(\)\{[\s\S]*?\}\)\(\);\s*/
  ];
  let strippedLoader = false;
  for (const re of dynamicLoaders) {
    if (re.test(s)) {
      s = s.replace(re, '');
      strippedLoader = true;
    }
  }
  if (strippedLoader) {
    console.log('  ✓ Removed dynamic API loader (no longer needed)');
  } else {
    console.log('  ⏩ No dynamic loader present (already clean)');
  }

  // ====================================================================
  // FIX 3 — Force animation trigger to be IMMEDIATE
  // ====================================================================
  // Replace any "wait for load" patterns with synchronous trigger
  const triggerPatterns = [
    {
      from: /window\.addEventListener\('load',\s*function\(\)\s*\{\s*setTimeout\(run,\s*\d+\);\s*\}\);/,
      to: "run();"
    },
    {
      from: /window\.addEventListener\("load",\s*function\(\)\s*\{\s*setTimeout\(run,\s*\d+\);\s*\}\);/,
      to: "run();"
    },
    {
      from: /document\.addEventListener\('DOMContentLoaded',\s*function\(\)\{\s*run\(\);\s*\}\);/,
      to: "run();"
    },
    {
      from: /if \(document\.readyState === "loading"\)[\s\S]*?run\(\);\s*\}/,
      to: "run();"
    },
    {
      from: /setTimeout\(run,\s*\d+\)/,
      to: "run()"
    }
  ];
  let triggerFixed = false;
  for (const { from, to } of triggerPatterns) {
    if (from.test(s)) {
      s = s.replace(from, to);
      triggerFixed = true;
      break; // first match wins
    }
  }
  if (triggerFixed) {
    console.log('  ✓ Animation trigger now fires immediately on script load');
  } else {
    console.log('  ⏩ Animation trigger already immediate');
  }

  if (s !== orig) {
    fs.writeFileSync(splashPath, s, 'utf8');
    console.log('  ✓ Saved public/splash.html');
    if (fs.existsSync('splash.html')) fs.copyFileSync(splashPath, 'splash.html');
  } else {
    console.log('  ⏩ No file changes needed');
  }

  console.log('\n╔══════════════════════════════════════════════════╗');
  console.log('║ TMC_PATCH95 complete ✓                           ║');
  console.log('╚══════════════════════════════════════════════════╝');
  console.log('\nNext:');
  console.log('  npx cap sync android');
  console.log('  git add -A');
  console.log('  git commit -m "TMC_PATCH95: Landing-page tag image + immediate splash"');
  console.log('  git push');
  console.log('');
  console.log('Android Studio:');
  console.log('  1. Uninstall app from emulator');
  console.log('  2. Build → Clean Project');
  console.log('  3. ▶ Run');
  console.log('');
  console.log('Expected:');
  console.log('  - Tag on onboarding = full landing-page tag with QR + buttons');
  console.log('  - Animation triggers as soon as splash.html loads (no setTimeout delay)\n');

} catch (err) {
  console.error('\n✗ PATCH FAILED: ' + err.message);
  if (err.stack) console.error(err.stack);
  process.exit(1);
}
