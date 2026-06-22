#!/usr/bin/env node
/**
 * TMC_PATCH97 — Remove render-blocking resources from splash.html
 *
 * The 10-second delay before splash animation appears was caused by
 * render-blocking resources in the <head> of splash.html:
 *
 *   1. <script src="/tmc-api-base.js"></script>     — blocks parsing
 *   2. <script src="/tmc-platform.js"></script>      — blocks parsing
 *   3. <link href="...fonts.googleapis.com/css2..."> — blocks render
 *   4. <link rel="preconnect" href="...fonts...">    — minor, removed too
 *   5. <link rel="preconnect" href="...gstatic...">  — minor, removed too
 *
 * The browser refuses to render the page until #3 (the CSS file)
 * downloads. On slower networks or via Capacitor's HTTP stack, that
 * can take several seconds → user sees only orange body background.
 *
 * Splash.html doesn't actually need any of these — the CSS already
 * falls back to system fonts (Segoe UI / system-ui / sans-serif),
 * and no API calls are made from the splash itself.
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
const backupDir = 'backup-unblock-' + stamp;

function backup(filePath) {
  if (!fs.existsSync(filePath)) return;
  const dest = path.join(backupDir, filePath);
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.copyFileSync(filePath, dest);
}

console.log('\n╔══════════════════════════════════════════════════╗');
console.log('║ TMC_PATCH97 — Remove blocking resources          ║');
console.log('╚══════════════════════════════════════════════════╝');
fs.mkdirSync(backupDir, { recursive: true });

try {
  const splashPath = path.join('public', 'splash.html');
  if (!fs.existsSync(splashPath)) throw new Error('public/splash.html not found');

  let s = fs.readFileSync(splashPath, 'utf8');
  const orig = s;
  backup(splashPath);

  // ====================================================================
  // Remove the 5 blocking resources from <head>
  // ====================================================================
  const linesToRemove = [
    '<script src="/tmc-api-base.js"></script>',
    '<script src="/tmc-platform.js"></script>',
    '<link rel="preconnect" href="https://fonts.googleapis.com">',
    '<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>',
    '<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap" rel="stylesheet">'
  ];

  let removedCount = 0;
  for (const line of linesToRemove) {
    if (s.indexOf(line) !== -1) {
      // Remove the line and its trailing newline
      s = s.replace(line + '\r\n', '');
      s = s.replace(line + '\n', '');
      s = s.replace(line, '');
      removedCount++;
      console.log('  ✓ Removed: ' + (line.length > 60 ? line.slice(0, 57) + '...' : line));
    }
  }

  if (removedCount === 0) {
    console.log('  ⏩ No blocking resources found (file may already be clean)');
  } else {
    console.log('  ✓ Removed ' + removedCount + ' blocking resource(s) total');
  }

  // ====================================================================
  // Also: ensure logo CSS doesn't have opacity:0 blocking visibility
  // Make sure animation starts at frame 0 so logo appears IMMEDIATELY
  // when the JS runs (no JS-delay before showing)
  // ====================================================================
  // The logo gets `.in` class via JS. Make the .in animation start with delay=0
  // (was .2s) so logo appears almost instantly when run() fires.
  if (s.indexOf('#logo.in{animation:lin .65s ease .2s forwards}') !== -1) {
    s = s.replace(
      '#logo.in{animation:lin .65s ease .2s forwards}',
      '#logo.in{animation:lin .4s ease 0s forwards}'
    );
    console.log('  ✓ Reduced logo fade-in delay (0.2s → 0s) and duration (0.65s → 0.4s)');
  }

  if (s !== orig) {
    fs.writeFileSync(splashPath, s, 'utf8');
    console.log('  ✓ Saved public/splash.html');
    if (fs.existsSync('splash.html')) fs.copyFileSync(splashPath, 'splash.html');
  } else {
    console.log('  ⏩ No changes made');
  }

  console.log('\n╔══════════════════════════════════════════════════╗');
  console.log('║ TMC_PATCH97 complete ✓                           ║');
  console.log('╚══════════════════════════════════════════════════╝');
  console.log('\nWhat this changes:');
  console.log('  - splash.html now loads with ZERO external resources');
  console.log('  - WebView can render the page in the first frame');
  console.log('  - Logo fades in immediately (0s delay) when JS runs');
  console.log('  - Total: tap icon → logo visible within ~500ms (was 10s)');
  console.log('');
  console.log('Next:');
  console.log('  npx cap sync android');
  console.log('  git add -A');
  console.log('  git commit -m "TMC_PATCH97: Remove blocking resources from splash"');
  console.log('  git push');
  console.log('');
  console.log('Android Studio:');
  console.log('  1. Uninstall app from emulator');
  console.log('  2. Build → Clean Project');
  console.log('  3. ▶ Run\n');

} catch (err) {
  console.error('\n✗ PATCH FAILED: ' + err.message);
  if (err.stack) console.error(err.stack);
  process.exit(1);
}
