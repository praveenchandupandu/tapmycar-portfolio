#!/usr/bin/env node
/**
 * TMC_PATCH77 — Use canonical www.tapmycar.io URL
 *
 * Root cause of "Network error" on sign-in:
 *   - App fetches https://tapmycar.io/api/send-otp
 *   - Vercel returns 307 redirect to https://www.tapmycar.io/api/send-otp
 *   - HTTP spec: POST requests can't auto-follow redirects
 *   - Result: app sees the 307 as a failure, shows "Network error"
 *
 * Fix:
 *   - Update tmc-api-base.js API_BASE → https://www.tapmycar.io
 *   - Update tmc-page-guard.js redirect URL → https://www.tapmycar.io
 *
 * No more redirect chain. Direct hit to canonical URL.
 *
 * Idempotent. Safe to re-run.
 *
 * Run from inside the tapmycar project folder:
 *   node patch77-use-www-canonical.js
 */

const fs = require('fs');
const path = require('path');

const now = new Date();
const pad = n => String(n).padStart(2, '0');
const stamp = [
  now.getFullYear(), pad(now.getMonth() + 1), pad(now.getDate()),
  pad(now.getHours()), pad(now.getMinutes())
].join('-');
const backupDir = 'backup-www-canonical-' + stamp;

function logStep(label) { console.log('\n=== ' + label + ' ==='); }
function backup(filePath) {
  if (!fs.existsSync(filePath)) return;
  const dest = path.join(backupDir, filePath);
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.copyFileSync(filePath, dest);
}

console.log('\n╔══════════════════════════════════════════════════╗');
console.log('║ TMC_PATCH77 — Use canonical www URL              ║');
console.log('╚══════════════════════════════════════════════════╝');
fs.mkdirSync(backupDir, { recursive: true });

try {
  // ===================================================================
  // STEP 1 — Update tmc-api-base.js
  // ===================================================================
  logStep('Step 1: Update tmc-api-base.js API_BASE to www.tapmycar.io');

  const apiBasePath = path.join('public', 'tmc-api-base.js');
  if (!fs.existsSync(apiBasePath)) throw new Error('public/tmc-api-base.js not found');

  let content = fs.readFileSync(apiBasePath, 'utf8');
  const original = content;

  // Already updated?
  if (content.indexOf('https://www.tapmycar.io') !== -1) {
    console.log('  ⏩ API_BASE already uses www.tapmycar.io');
  } else {
    // Replace the API_BASE line — handle both double and single quotes
    const re = /var\s+API_BASE\s*=\s*["']https:\/\/tapmycar\.io["']\s*;/;
    if (!re.test(content)) {
      throw new Error('Could not find API_BASE line in tmc-api-base.js');
    }
    backup(apiBasePath);
    content = content.replace(re, 'var API_BASE = "https://www.tapmycar.io";');
    fs.writeFileSync(apiBasePath, content, { encoding: 'utf8' });
    console.log('  ✓ Updated API_BASE to https://www.tapmycar.io');
  }

  // Sanity check JS
  const { execSync } = require('child_process');
  try {
    execSync('node --check "' + apiBasePath + '"', { stdio: 'pipe' });
    console.log('  ✓ Syntax valid');
  } catch (e) {
    throw new Error('tmc-api-base.js failed node --check');
  }

  // ===================================================================
  // STEP 2 — Update tmc-page-guard.js
  // ===================================================================
  logStep('Step 2: Update tmc-page-guard.js redirect URL to www.tapmycar.io');

  const guardPath = path.join('public', 'tmc-page-guard.js');
  if (!fs.existsSync(guardPath)) {
    console.log('  ⚠ tmc-page-guard.js not found, skipping');
  } else {
    let guardContent = fs.readFileSync(guardPath, 'utf8');
    const guardOriginal = guardContent;

    // Look for the URL construction line
    const urlRe = /'https:\/\/tapmycar\.io'\s*\+\s*webPath/;
    if (urlRe.test(guardContent)) {
      backup(guardPath);
      guardContent = guardContent.replace(urlRe, "'https://www.tapmycar.io' + webPath");
      fs.writeFileSync(guardPath, guardContent, { encoding: 'utf8' });
      console.log('  ✓ Updated page-guard redirect URL to https://www.tapmycar.io');

      try {
        execSync('node --check "' + guardPath + '"', { stdio: 'pipe' });
        console.log('  ✓ Syntax valid');
      } catch (e) {
        throw new Error('tmc-page-guard.js failed node --check');
      }
    } else if (guardContent.indexOf('https://www.tapmycar.io') !== -1) {
      console.log('  ⏩ page-guard already uses www.tapmycar.io');
    } else {
      console.log('  ⚠ Could not find the URL construction line in page-guard — skipping');
    }
  }

  // ===================================================================
  // STEP 3 — Mirror public/ → root (for /tmc-api-base.js, /tmc-page-guard.js)
  // ===================================================================
  logStep('Step 3: Sync updated public/*.js files → project root');

  const filesToSync = ['tmc-api-base.js', 'tmc-page-guard.js'];
  for (const file of filesToSync) {
    const src = path.join('public', file);
    const dest = file;
    if (fs.existsSync(src) && fs.existsSync(dest)) {
      fs.copyFileSync(src, dest);
      console.log('  ✓ Synced ' + file + ' to root');
    }
  }

  console.log('\n╔══════════════════════════════════════════════════╗');
  console.log('║ TMC_PATCH77 complete ✓                           ║');
  console.log('╚══════════════════════════════════════════════════╝');
  console.log('\nIMPORTANT — Next steps (must run ALL of these):');
  console.log('  1. npx cap sync android');
  console.log('     (copies updated JS files to android/ bundle)');
  console.log('  2. git add -A && git commit -m "TMC_PATCH77: Use canonical www URL" && git push');
  console.log('  3. In emulator: long-press TapMyCar+ icon → Uninstall');
  console.log('  4. In Android Studio: Build → Clean Project');
  console.log('  5. Click ▶ Run to install fresh');
  console.log('  6. Open app → tap Sign in → enter email → tap Send code');
  console.log('  7. OTP email should arrive 🎉\n');

} catch (err) {
  console.error('\n✗ PATCH FAILED: ' + err.message);
  if (err.stack) console.error(err.stack);
  process.exit(1);
}
