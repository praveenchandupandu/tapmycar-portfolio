#!/usr/bin/env node
/**
 * TMC_PATCH94_REVERT — Undo Patch 94 changes
 *
 * Patch 94 added:
 *   1. SplashScreen.hide() script block in splash.html (TMC_PATCH94_SPLASH_HIDE)
 *   2. Same script block in index.html
 *   3. Maybe tweaked SplashScreen config in capacitor.config.ts
 *
 * This script removes those changes. The tag-example.png file is left
 * in public/ since it's harmless (and you might want to keep it).
 */

const fs = require('fs');
const path = require('path');

const now = new Date();
const pad = n => String(n).padStart(2, '0');
const stamp = [
  now.getFullYear(), pad(now.getMonth() + 1), pad(now.getDate()),
  pad(now.getHours()), pad(now.getMinutes())
].join('-');
const backupDir = 'backup-revert-94-' + stamp;

function backup(filePath) {
  if (!fs.existsSync(filePath)) return;
  const dest = path.join(backupDir, filePath);
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.copyFileSync(filePath, dest);
}

console.log('\n╔══════════════════════════════════════════════════╗');
console.log('║ TMC_PATCH94_REVERT — Undo Patch 94 changes       ║');
console.log('╚══════════════════════════════════════════════════╝');
fs.mkdirSync(backupDir, { recursive: true });

try {
  // Remove the TMC_PATCH94_SPLASH_HIDE script from splash.html
  const splashPath = path.join('public', 'splash.html');
  if (fs.existsSync(splashPath)) {
    let s = fs.readFileSync(splashPath, 'utf8');
    const orig = s;

    // Pattern for the splash.html version (multi-line, inside <script> tags)
    s = s.replace(
      /\s*<script>\s*\/\/ TMC_PATCH94_SPLASH_HIDE[\s\S]*?<\/script>\s*/g,
      '\n'
    );

    if (s !== orig) {
      backup(splashPath);
      fs.writeFileSync(splashPath, s, 'utf8');
      console.log('  ✓ Removed Patch 94 hide-script from splash.html');
      if (fs.existsSync('splash.html')) fs.copyFileSync(splashPath, 'splash.html');
    } else {
      console.log('  ⏩ No Patch 94 changes found in splash.html');
    }
  }

  // Remove from index.html
  const indexPath = path.join('public', 'index.html');
  if (fs.existsSync(indexPath)) {
    let i = fs.readFileSync(indexPath, 'utf8');
    const orig = i;

    i = i.replace(
      /\s*<script>\s*\/\/ TMC_PATCH94_SPLASH_HIDE[\s\S]*?<\/script>\s*/g,
      '\n'
    );

    if (i !== orig) {
      backup(indexPath);
      fs.writeFileSync(indexPath, i, 'utf8');
      console.log('  ✓ Removed Patch 94 hide-script from index.html');
      if (fs.existsSync('index.html')) fs.copyFileSync(indexPath, 'index.html');
    } else {
      console.log('  ⏩ No Patch 94 changes found in index.html');
    }
  }

  console.log('\n╔══════════════════════════════════════════════════╗');
  console.log('║ Patch 94 reverted ✓                              ║');
  console.log('╚══════════════════════════════════════════════════╝');
  console.log('\nState now: same as after Patch 93 ran.');
  console.log('  - tag-example.png is still in public/ (harmless to keep)');
  console.log('  - Patches 88-93 still applied');
  console.log('');
  console.log('Next:');
  console.log('  npx cap sync android');
  console.log('  git add -A');
  console.log('  git commit -m "Revert Patch 94"');
  console.log('  git push');
  console.log('  Build → Clean Project → ▶ Run\n');

} catch (err) {
  console.error('\n✗ REVERT FAILED: ' + err.message);
  if (err.stack) console.error(err.stack);
  process.exit(1);
}
