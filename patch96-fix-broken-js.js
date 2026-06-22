#!/usr/bin/env node
/**
 * TMC_PATCH96 — Fix broken JS from Patch 95
 *
 * Patch 95's regex for the animation trigger matched too greedily and
 * mangled the JavaScript. The resulting file has invalid syntax like:
 *
 *   run(););
 *   } else {
 *     run();
 *   }
 *
 * That's a JS parse error → entire script fails → no animation → user
 * sees only orange background (which is what the screenshot shows).
 *
 * This patch:
 *   1. Finds the broken pattern
 *   2. Replaces it with a clean `run();` call
 *
 * Idempotent. Re-run safe.
 */

const fs = require('fs');
const path = require('path');

const now = new Date();
const pad = n => String(n).padStart(2, '0');
const stamp = [
  now.getFullYear(), pad(now.getMonth() + 1), pad(now.getDate()),
  pad(now.getHours()), pad(now.getMinutes())
].join('-');
const backupDir = 'backup-fix-broken-js-' + stamp;

function backup(filePath) {
  if (!fs.existsSync(filePath)) return;
  const dest = path.join(backupDir, filePath);
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.copyFileSync(filePath, dest);
}

console.log('\n╔══════════════════════════════════════════════════╗');
console.log('║ TMC_PATCH96 — Fix broken JS syntax               ║');
console.log('╚══════════════════════════════════════════════════╝');
fs.mkdirSync(backupDir, { recursive: true });

try {
  const splashPath = path.join('public', 'splash.html');
  if (!fs.existsSync(splashPath)) throw new Error('public/splash.html not found');

  let s = fs.readFileSync(splashPath, 'utf8');
  const orig = s;

  // ====================================================================
  // FIX — Detect and repair the broken pattern from Patch 95
  // ====================================================================
  // The broken code looks like:
  //   run();); } else { run(); }
  // (with possible whitespace variations)
  const brokenPattern = /run\(\);\s*\)\s*;\s*\}\s*else\s*\{\s*run\(\);\s*\}/;

  if (brokenPattern.test(s)) {
    backup(splashPath);
    s = s.replace(brokenPattern, 'run();');
    console.log('  ✓ Fixed broken JS syntax → clean run();');
  } else {
    console.log('  ⏩ No broken pattern found — file may already be clean');
  }

  // Also check for any other stray syntax errors from the bad replacement
  // Pattern: orphan `)`, `;`, `}` sequences that don't belong
  const orphanPattern = /run\(\);\s*\)\s*;/;
  if (orphanPattern.test(s)) {
    backup(splashPath);
    s = s.replace(orphanPattern, 'run();');
    console.log('  ✓ Fixed orphan `);` after run()');
  }

  // ====================================================================
  // SANITY — Make sure there's exactly ONE animation trigger now
  // ====================================================================
  // Count standalone `run();` calls (not inside function definitions)
  // For a clean state we want one immediate trigger.
  // If there are zero (script wouldn't start), inject one before </script>
  const standaloneRunCalls = (s.match(/^\s*run\(\);/gm) || []).length;
  console.log('  ℹ Standalone run() calls in file: ' + standaloneRunCalls);

  if (standaloneRunCalls === 0) {
    // No trigger — script wouldn't start animation. Inject one.
    // Find the last </script> tag inside the body's main inline script
    const scriptCloseRe = /(\}\s*<\/script>)/;
    if (scriptCloseRe.test(s)) {
      backup(splashPath);
      s = s.replace(scriptCloseRe, '\n  // TMC_PATCH96 ensure animation starts\n  run();\n$1');
      console.log('  ✓ Injected run() call before </script>');
    } else {
      console.log('  ⚠ No </script> tag found — cannot inject trigger');
    }
  }

  if (s !== orig) {
    fs.writeFileSync(splashPath, s, 'utf8');
    console.log('  ✓ Saved public/splash.html');
    if (fs.existsSync('splash.html')) fs.copyFileSync(splashPath, 'splash.html');
  }

  console.log('\n╔══════════════════════════════════════════════════╗');
  console.log('║ TMC_PATCH96 complete ✓                           ║');
  console.log('╚══════════════════════════════════════════════════╝');
  console.log('\nNext:');
  console.log('  npx cap sync android');
  console.log('  git add -A');
  console.log('  git commit -m "TMC_PATCH96: Fix broken JS from Patch 95"');
  console.log('  git push');
  console.log('');
  console.log('Android Studio:');
  console.log('  1. Uninstall app from emulator');
  console.log('  2. Build → Clean Project');
  console.log('  3. ▶ Run');
  console.log('');
  console.log('Expected: Splash animation now plays + tag-hero.png appears\n');

} catch (err) {
  console.error('\n✗ PATCH FAILED: ' + err.message);
  if (err.stack) console.error(err.stack);
  process.exit(1);
}
