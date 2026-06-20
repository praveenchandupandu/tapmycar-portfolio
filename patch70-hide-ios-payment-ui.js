#!/usr/bin/env node
/**
 * TMC_PATCH70 — iOS Path A enforcement: hide payment UI + meta tag fix
 *
 * Goals:
 *   1. Add <meta name="mobile-web-app-capable" content="yes"> alongside the
 *      deprecated apple-mobile-web-app-capable in all public/*.html files
 *   2. Add class="tmc-hide-on-ios" to known payment UI elements:
 *      - dashboard.html: #renewal-card, #upgrade-banner-etag, #upgrade-banner-standard
 *      - manage.html: #plan-premium
 *   3. Insert iOS-only "Manage at tapmycar.io" banner divs in dashboard.html
 *      and manage.html, before the hidden payment elements
 *   4. Mirror public/*.html → project root
 *
 * Behavior:
 *   - Website: no visible change (CSS classes inert without .tmc-platform-ios body class)
 *   - iOS app: payment cards/banners hidden, iOS-only "Manage at tapmycar.io" shown
 *   - Backward compatible. Idempotent.
 *
 * Run from inside the tapmycar project folder:
 *   node patch70-hide-ios-payment-ui.js
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
const backupDir = 'backup-hide-ios-payment-' + stamp;

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
  // Match opening tag containing id="ID" (id may be in any attribute order)
  const re = new RegExp('<([a-zA-Z][a-zA-Z0-9]*)([^>]*\\bid=["\']' + id + '["\'][^>]*)>', 'g');
  let matched = false;
  const out = html.replace(re, function (full, tagName, attrs) {
    matched = true;
    const classMatch = attrs.match(/\bclass=(["'])([^"']*)\1/);
    if (classMatch) {
      const existingClasses = classMatch[2].split(/\s+/).filter(Boolean);
      if (existingClasses.indexOf(newClass) !== -1) return full; // already has it
      const newClassesStr = existingClasses.concat(newClass).join(' ');
      const newAttrs = attrs.replace(classMatch[0], 'class=' + classMatch[1] + newClassesStr + classMatch[1]);
      return '<' + tagName + newAttrs + '>';
    }
    return '<' + tagName + ' class="' + newClass + '"' + attrs + '>';
  });
  return { html: out, matched: matched };
}

// Insert HTML before an element identified by id. Idempotent via marker check.
function insertBeforeElementById(html, id, htmlToInsert, markerStr) {
  if (markerStr && html.indexOf(markerStr) !== -1) return { html: html, matched: true, alreadyDone: true };
  const re = new RegExp('(<[a-zA-Z][a-zA-Z0-9]*[^>]*\\bid=["\']' + id + '["\'][^>]*>)');
  let matched = false;
  const out = html.replace(re, function (full) {
    matched = true;
    return htmlToInsert + '\n    ' + full;
  });
  return { html: out, matched: matched, alreadyDone: false };
}

// Add mobile-web-app-capable meta tag after apple-mobile-web-app-capable.
// Idempotent — won't add if already present.
function fixMetaTag(html) {
  if (html.indexOf('name="mobile-web-app-capable"') !== -1 ||
      html.indexOf("name='mobile-web-app-capable'") !== -1) {
    return { html: html, modified: false };
  }
  const applePattern = /(<meta\s+name=["']apple-mobile-web-app-capable["']\s+content=["']yes["']\s*\/?>)(\s*\r?\n?)/i;
  if (!applePattern.test(html)) {
    return { html: html, modified: false };
  }
  const newTag = '<meta name="mobile-web-app-capable" content="yes">';
  const out = html.replace(applePattern, function (match, tag, ws) {
    var wsPart = ws || '\n';
    return tag + wsPart + '  ' + newTag + '\n';
  });
  return { html: out, modified: true };
}

// -------------------------------------------------------------------
// iOS-only banner templates
// -------------------------------------------------------------------

const IOS_BANNER_MARKER = '<!-- TMC_PATCH70_IOS_BANNER -->';

const IOS_BANNER_DASHBOARD = [
  IOS_BANNER_MARKER,
  '<div class="tmc-ios-only" style="background:#1A1A1A;color:#fff;border-radius:14px;padding:16px;margin-bottom:14px;text-align:center;font-family:Inter,system-ui,sans-serif">',
  '  <div style="font-size:14px;font-weight:700;margin-bottom:6px">Subscription &amp; Billing</div>',
  '  <div style="font-size:12px;color:#9CA3AF;margin-bottom:12px;line-height:1.4">Manage your plan, renewals, and payment methods on the web</div>',
  '  <button onclick="window.tmcOpenWeb(\'/billing\')" style="background:#fff;color:#1A1A1A;border:0;font-weight:700;font-size:13px;padding:10px 20px;border-radius:10px;cursor:pointer">Open tapmycar.io →</button>',
  '</div>'
].join('\n    ');

const IOS_BANNER_MANAGE = [
  IOS_BANNER_MARKER,
  '<div class="tmc-ios-only" style="background:#1A1A1A;color:#fff;border-radius:14px;padding:16px;margin-bottom:14px;text-align:center;font-family:Inter,system-ui,sans-serif">',
  '  <div style="font-size:14px;font-weight:700;margin-bottom:6px">Plan Upgrades</div>',
  '  <div style="font-size:12px;color:#9CA3AF;margin-bottom:12px;line-height:1.4">Compare plans and upgrade your subscription on the web</div>',
  '  <button onclick="window.tmcOpenWeb(\'/manage\')" style="background:#fff;color:#1A1A1A;border:0;font-weight:700;font-size:13px;padding:10px 20px;border-radius:10px;cursor:pointer">Open tapmycar.io →</button>',
  '</div>'
].join('\n    ');

// -------------------------------------------------------------------
// MAIN
// -------------------------------------------------------------------
console.log('\n╔══════════════════════════════════════════════════╗');
console.log('║ TMC_PATCH70 — Hide iOS payment UI                ║');
console.log('╚══════════════════════════════════════════════════╝');
console.log('Backup folder: ' + backupDir);
fs.mkdirSync(backupDir, { recursive: true });

try {
  // ===================================================================
  // STEP 1 — Fix mobile-web-app-capable meta tag in all HTML files
  // ===================================================================
  logStep('Step 1: Fix mobile-web-app-capable meta tag in all HTML files');

  const publicDir = 'public';
  const htmlFiles = fs.readdirSync(publicDir).filter(f => f.endsWith('.html'));
  console.log('  Found ' + htmlFiles.length + ' HTML files');

  let metaFixed = 0, metaSkipped = 0, metaNotFound = 0;

  for (const file of htmlFiles) {
    const filePath = path.join(publicDir, file);
    const content = fs.readFileSync(filePath, 'utf8');

    if (content.indexOf('name="mobile-web-app-capable"') !== -1) {
      metaSkipped++;
      continue;
    }

    const result = fixMetaTag(content);
    if (!result.modified) {
      metaNotFound++;
      continue;
    }

    backup(filePath);
    fs.writeFileSync(filePath, result.html, { encoding: 'utf8' });
    metaFixed++;
  }
  console.log('  Meta tag: ' + metaFixed + ' fixed, ' + metaSkipped + ' already done, ' + metaNotFound + ' had no apple tag');

  // ===================================================================
  // STEP 2 — Add tmc-hide-on-ios class to dashboard.html payment UI
  // ===================================================================
  logStep('Step 2: Add tmc-hide-on-ios to payment UI in dashboard.html');

  const dashboardPath = path.join(publicDir, 'dashboard.html');
  if (!fs.existsSync(dashboardPath)) throw new Error('dashboard.html not found in public/');

  let dashContent = fs.readFileSync(dashboardPath, 'utf8');
  const dashOriginal = dashContent;

  const dashTargets = ['renewal-card', 'upgrade-banner-etag', 'upgrade-banner-standard'];
  for (const id of dashTargets) {
    const result = addClassToElementById(dashContent, id, 'tmc-hide-on-ios');
    if (!result.matched) {
      console.log('  ⚠ dashboard.html — element #' + id + ' not found, skipping');
      continue;
    }
    if (result.html === dashContent) {
      console.log('  ⏩ dashboard.html — #' + id + ' already has tmc-hide-on-ios');
    } else {
      console.log('  ✓ dashboard.html — added tmc-hide-on-ios to #' + id);
      dashContent = result.html;
    }
  }

  // ===================================================================
  // STEP 3 — Insert iOS-only banner in dashboard.html before #renewal-card
  // ===================================================================
  logStep('Step 3: Insert iOS-only banner in dashboard.html');

  const dashBanner = insertBeforeElementById(dashContent, 'renewal-card', IOS_BANNER_DASHBOARD, IOS_BANNER_MARKER);
  if (dashBanner.alreadyDone) {
    console.log('  ⏩ dashboard.html — iOS banner already inserted');
  } else if (!dashBanner.matched) {
    console.log('  ⚠ dashboard.html — could not find #renewal-card to anchor banner, skipping');
  } else {
    console.log('  ✓ dashboard.html — inserted iOS-only banner');
    dashContent = dashBanner.html;
  }

  if (dashContent !== dashOriginal) {
    backup(dashboardPath);
    fs.writeFileSync(dashboardPath, dashContent, { encoding: 'utf8' });
  }

  // ===================================================================
  // STEP 4 — Add tmc-hide-on-ios to manage.html payment UI + insert banner
  // ===================================================================
  logStep('Step 4: Update manage.html (hide #plan-premium, insert iOS banner)');

  const managePath = path.join(publicDir, 'manage.html');
  if (!fs.existsSync(managePath)) {
    console.log('  ⚠ manage.html not found, skipping');
  } else {
    let manageContent = fs.readFileSync(managePath, 'utf8');
    const manageOriginal = manageContent;

    const manageResult = addClassToElementById(manageContent, 'plan-premium', 'tmc-hide-on-ios');
    if (!manageResult.matched) {
      console.log('  ⚠ manage.html — #plan-premium not found, skipping class add');
    } else if (manageResult.html === manageContent) {
      console.log('  ⏩ manage.html — #plan-premium already has tmc-hide-on-ios');
    } else {
      console.log('  ✓ manage.html — added tmc-hide-on-ios to #plan-premium');
      manageContent = manageResult.html;
    }

    const manageBanner = insertBeforeElementById(manageContent, 'plan-premium', IOS_BANNER_MANAGE, IOS_BANNER_MARKER);
    if (manageBanner.alreadyDone) {
      console.log('  ⏩ manage.html — iOS banner already inserted');
    } else if (!manageBanner.matched) {
      console.log('  ⚠ manage.html — could not find #plan-premium to anchor banner');
    } else {
      console.log('  ✓ manage.html — inserted iOS-only banner');
      manageContent = manageBanner.html;
    }

    if (manageContent !== manageOriginal) {
      backup(managePath);
      fs.writeFileSync(managePath, manageContent, { encoding: 'utf8' });
    }
  }

  // ===================================================================
  // STEP 5 — Mirror public/*.html → project root
  // ===================================================================
  logStep('Step 5: Sync public/*.html → project root');

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
  console.log('║ TMC_PATCH70 complete ✓                           ║');
  console.log('╚══════════════════════════════════════════════════╝');
  console.log('\nBackup folder: ' + backupDir);
  console.log('\nNext steps:');
  console.log('  1. git add -A');
  console.log('  2. git commit -m "TMC_PATCH70: Hide iOS payment UI + meta tag fix"');
  console.log('  3. git push');
  console.log('  4. Wait ~60s for Vercel deploy');
  console.log('  5. Open tapmycar.io in incognito');
  console.log('  6. Log in, visit /dashboard.html — renewal/upgrade banners should LOOK');
  console.log('     IDENTICAL to before (CSS classes inert on web)');
  console.log('  7. Open DevTools console — the apple-mobile-web-app-capable deprecation');
  console.log('     warning should be GONE');
  console.log('  8. Optional iOS preview: in DevTools console, type:');
  console.log('       document.body.classList.add("tmc-platform-ios")');
  console.log('     The renewal card, upgrade banners should disappear and the iOS-only');
  console.log('     "Subscription & Billing" banner should appear. Then refresh to reset.');
  console.log('  9. Reply "verified" and we proceed to Patch 71\n');

} catch (err) {
  console.error('\n✗ PATCH FAILED: ' + err.message);
  if (err.stack) console.error(err.stack);
  restoreAll();
  process.exit(1);
}
