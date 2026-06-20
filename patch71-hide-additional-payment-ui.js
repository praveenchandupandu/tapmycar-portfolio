#!/usr/bin/env node
/**
 * TMC_PATCH71 — Hide additional iOS payment UI in dashboard.html
 *
 * Patch 70 missed two payment UI elements that need to be hidden in the
 * iOS app under Path A:
 *
 *   1. #gift-expiry-banner — the "Your free trial is ending soon / Subscribe now"
 *      banner. Has a "Subscribe now" button that calls p35dStartRenew() → Stripe.
 *
 *   2. The "Place Order" tile in the 2x2 action grid. Links to /pricing.html
 *      (Patch 69's page-guard redirects from /pricing.html in iOS, but the
 *      tile itself shouldn't be visible — it's a payment CTA).
 *      This tile has no ID, so we match it by its unique onclick attribute.
 *
 * Goals:
 *   1. Add class="tmc-hide-on-ios" to #gift-expiry-banner in dashboard.html
 *   2. Add class="tmc-hide-on-ios" to the "Place Order" tile (matched by onclick)
 *   3. Mirror public/*.html → project root
 *
 * Behavior:
 *   - Website: no visible change (CSS classes inert without .tmc-platform-ios)
 *   - iOS app: gift expiry banner and Place Order tile hidden
 *
 * Run from inside the tapmycar project folder:
 *   node patch71-hide-additional-payment-ui.js
 */

const fs = require('fs');
const path = require('path');

// -------------------------------------------------------------------
// Backup folder
// -------------------------------------------------------------------
const now = new Date();
const pad = n => String(n).padStart(2, '0');
const stamp = [
  now.getFullYear(),
  pad(now.getMonth() + 1),
  pad(now.getDate()),
  pad(now.getHours()),
  pad(now.getMinutes()),
].join('-');
const backupDir = 'backup-hide-additional-payment-' + stamp;

const restoreQueue = [];

function logStep(label) { console.log('\n=== ' + label + ' ==='); }

function backup(filePath) {
  if (!fs.existsSync(filePath)) return;
  const dest = path.join(backupDir, filePath);
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.copyFileSync(filePath, dest);
  restoreQueue.push({ orig: filePath, copy: dest });
}

function restoreAll() {
  console.error('\n⚠ Restoring all files from backup...');
  for (const { orig, copy } of restoreQueue) {
    try { fs.copyFileSync(copy, orig); }
    catch (e) { console.error('  Failed to restore ' + orig + ': ' + e.message); }
  }
  console.error('Restore complete. Backup folder kept at: ' + backupDir);
}

// -------------------------------------------------------------------
// Helpers
// -------------------------------------------------------------------

// Add a class to an element identified by id. Handles tags with and without
// an existing class attribute. Idempotent — won't add if already present.
function addClassToElementById(html, id, newClass) {
  const re = new RegExp('<([a-zA-Z][a-zA-Z0-9]*)([^>]*\\bid=["\']' + id + '["\'][^>]*)>', 'g');
  let matched = false;
  const out = html.replace(re, function (full, tagName, attrs) {
    matched = true;
    const classMatch = attrs.match(/\bclass=(["'])([^"']*)\1/);
    if (classMatch) {
      const existingClasses = classMatch[2].split(/\s+/).filter(Boolean);
      if (existingClasses.indexOf(newClass) !== -1) return full;
      const newClassesStr = existingClasses.concat(newClass).join(' ');
      const newAttrs = attrs.replace(classMatch[0], 'class=' + classMatch[1] + newClassesStr + classMatch[1]);
      return '<' + tagName + newAttrs + '>';
    }
    return '<' + tagName + ' class="' + newClass + '"' + attrs + '>';
  });
  return { html: out, matched: matched };
}

// Add class to a div matched by a unique onclick attribute pattern.
// Idempotent — won't add if class is already there.
function addClassToDivByOnclick(html, onclickValue, newClass) {
  // Match: <div ... onclick="EXACT_VALUE" ...>
  // The onclickValue is matched literally (escape regex special chars first)
  const escapedOnclick = onclickValue.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const re = new RegExp('<div([^>]*\\bonclick=["\']' + escapedOnclick + '["\'][^>]*)>', 'g');
  let matched = false;
  const out = html.replace(re, function (full, attrs) {
    matched = true;
    const classMatch = attrs.match(/\bclass=(["'])([^"']*)\1/);
    if (classMatch) {
      const existingClasses = classMatch[2].split(/\s+/).filter(Boolean);
      if (existingClasses.indexOf(newClass) !== -1) return full;
      const newClassesStr = existingClasses.concat(newClass).join(' ');
      const newAttrs = attrs.replace(classMatch[0], 'class=' + classMatch[1] + newClassesStr + classMatch[1]);
      return '<div' + newAttrs + '>';
    }
    return '<div class="' + newClass + '"' + attrs + '>';
  });
  return { html: out, matched: matched };
}

// -------------------------------------------------------------------
// MAIN
// -------------------------------------------------------------------
console.log('\n╔══════════════════════════════════════════════════╗');
console.log('║ TMC_PATCH71 — Hide additional iOS payment UI     ║');
console.log('╚══════════════════════════════════════════════════╝');
console.log('Backup folder: ' + backupDir);
fs.mkdirSync(backupDir, { recursive: true });

try {
  const dashboardPath = path.join('public', 'dashboard.html');
  if (!fs.existsSync(dashboardPath)) throw new Error('public/dashboard.html not found');

  let dashContent = fs.readFileSync(dashboardPath, 'utf8');
  const dashOriginal = dashContent;

  // ===================================================================
  // STEP 1 — Add tmc-hide-on-ios to #gift-expiry-banner
  // ===================================================================
  logStep('Step 1: Add tmc-hide-on-ios to #gift-expiry-banner');

  const giftBannerResult = addClassToElementById(dashContent, 'gift-expiry-banner', 'tmc-hide-on-ios');
  if (!giftBannerResult.matched) {
    console.log('  ⚠ #gift-expiry-banner not found — skipping');
  } else if (giftBannerResult.html === dashContent) {
    console.log('  ⏩ #gift-expiry-banner already has tmc-hide-on-ios');
  } else {
    console.log('  ✓ Added tmc-hide-on-ios to #gift-expiry-banner');
    dashContent = giftBannerResult.html;
  }

  // ===================================================================
  // STEP 2 — Add tmc-hide-on-ios to the "Place Order" tile
  // ===================================================================
  logStep('Step 2: Add tmc-hide-on-ios to the Place Order tile');

  // The Place Order tile is identified by this unique onclick attribute
  const placeOrderOnclick = "window.location.href='/pricing.html'";

  const placeOrderResult = addClassToDivByOnclick(dashContent, placeOrderOnclick, 'tmc-hide-on-ios');
  if (!placeOrderResult.matched) {
    console.log('  ⚠ Place Order tile (onclick=' + placeOrderOnclick + ') not found — skipping');
    console.log('     This is unexpected. The tile may have been refactored.');
  } else if (placeOrderResult.html === dashContent) {
    console.log('  ⏩ Place Order tile already has tmc-hide-on-ios');
  } else {
    console.log('  ✓ Added tmc-hide-on-ios to Place Order tile');
    dashContent = placeOrderResult.html;
  }

  // ===================================================================
  // STEP 3 — Save dashboard.html if changed
  // ===================================================================
  if (dashContent !== dashOriginal) {
    backup(dashboardPath);
    fs.writeFileSync(dashboardPath, dashContent, { encoding: 'utf8' });
    console.log('\n  ✓ Saved updated dashboard.html');
  } else {
    console.log('\n  ⏩ No changes needed to dashboard.html');
  }

  // ===================================================================
  // STEP 4 — Mirror public/*.html → project root
  // ===================================================================
  logStep('Step 4: Sync public/*.html → project root');

  const publicDir = 'public';
  const htmlFiles = fs.readdirSync(publicDir).filter(f => f.endsWith('.html'));
  let synced = 0, skippedSync = 0;
  for (const file of htmlFiles) {
    const src = path.join(publicDir, file);
    const dest = file;
    if (!fs.existsSync(dest)) { skippedSync++; continue; }
    try { fs.copyFileSync(src, dest); synced++; }
    catch (e) { console.log('  ⚠ Could not sync ' + file + ': ' + e.message); }
  }
  console.log('  ✓ Synced ' + synced + ' HTML files to root (' + skippedSync + ' not present at root, skipped)');

  // ===================================================================
  // SUCCESS
  // ===================================================================
  console.log('\n╔══════════════════════════════════════════════════╗');
  console.log('║ TMC_PATCH71 complete ✓                           ║');
  console.log('╚══════════════════════════════════════════════════╝');
  console.log('\nBackup folder: ' + backupDir);
  console.log('\nNext steps:');
  console.log('  1. git add -A');
  console.log('  2. git commit -m "TMC_PATCH71: Hide additional iOS payment UI"');
  console.log('  3. git push');
  console.log('  4. Wait ~60s for Vercel deploy');
  console.log('  5. Open tapmycar.io/dashboard.html in incognito (Ctrl+Shift+R for hard refresh)');
  console.log('  6. In DevTools console: document.body.classList.add("tmc-platform-ios")');
  console.log('  7. The "Your family drives too" banner, "Place Order" tile, and');
  console.log('     gift expiry banner should ALL disappear.');
  console.log('  8. The black "Subscription & Billing" iOS banner should appear.');
  console.log('  9. Refresh page to reset (Ctrl+R).');
  console.log(' 10. Reply "verified" and we proceed to Patch 72 (Capgo OTA)\n');

} catch (err) {
  console.error('\n✗ PATCH FAILED: ' + err.message);
  if (err.stack) console.error(err.stack);
  restoreAll();
  process.exit(1);
}
