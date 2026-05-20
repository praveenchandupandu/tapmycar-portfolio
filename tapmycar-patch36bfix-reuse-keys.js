// ============================================================================
// TapMyCar - Patch 36b-fix: Use existing app_settings keys (no duplicates)
//
// Patch 36b created new keys (knowmore_app_store_url, knowmore_facebook_url,
// etc.) but the user's DB already has these keys:
//
//   app_store_url, play_store_url, social_facebook, social_instagram
//
// Creating duplicate keys with "knowmore_" prefix is wasteful and confusing
// for admin. Better: reuse the existing keys. They're already editable in
// the admin Settings tab.
//
// This patch:
//   1. Generates patch36b-fix-migration.sql to DELETE any duplicate
//      knowmore_* rows that 36b created (if it succeeded in inserting).
//   2. Rewrites the knowmore.html dynamic loader to read the EXISTING keys.
//   3. Updates the admin "Sticker Back Page" card to clarify which settings
//      control the knowmore page (it's the existing rows).
//   4. Removes the leftover 'knowmore.actions' allowed slot since we no
//      longer need it.
// ============================================================================

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const ROOT = __dirname;
const API = path.join(ROOT, 'api');
const PUBLIC = path.join(ROOT, 'public');

const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 16);
const BACKUP_DIR = path.join(ROOT, `backup-patch36bfix-${ts}`);

const log = (s) => console.log(s);
const ok = (s) => console.log('  \u2713 ' + s);
const skip = (s) => console.log('  \u00b7 ' + s + ' (already applied, skipped)');
const errExit = (s) => { console.error('  \u2717 ' + s); process.exit(1); };

function readFile(p) {
  if (!fs.existsSync(p)) errExit('File not found: ' + p);
  return fs.readFileSync(p, 'utf8');
}
function backup(file) {
  if (!fs.existsSync(file)) return;
  const rel = path.relative(ROOT, file);
  const dest = path.join(BACKUP_DIR, rel);
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.copyFileSync(file, dest);
}
function writeFile(p, content) {
  if (content.charCodeAt(0) === 0xFEFF) content = content.slice(1);
  fs.writeFileSync(p, content, 'utf8');
}
function safeReplace(content, oldStr, newStr) {
  const oldCRLF = oldStr.replace(/\n/g, '\r\n');
  if (content.includes(oldStr)) return content.replace(oldStr, () => newStr);
  if (content.includes(oldCRLF)) {
    const newCRLF = newStr.replace(/\n/g, '\r\n');
    return content.replace(oldCRLF, () => newCRLF);
  }
  return null;
}

log('');
log('TapMyCar Patch 36b-fix \u2014 reuse existing app_settings keys');
log('Backup: ' + path.relative(ROOT, BACKUP_DIR));
log('');
fs.mkdirSync(BACKUP_DIR, { recursive: true });

const MARKER = 'TMC_PATCH36BFIX_REUSE_KEYS';

// =============================================================================
// 36b-fix.1  SQL: remove duplicate knowmore_* rows if any were created
// =============================================================================

log('36b-fix.1  patch36bfix-migration.sql: cleanup script');
{
  const file = path.join(ROOT, 'patch36bfix-migration.sql');
  const sql = `-- ${MARKER}: remove duplicate knowmore_* rows
-- Safe to run even if no rows match (DELETE with no matches is a no-op).
-- This cleans up after Patch 36b which created duplicates.

DELETE FROM app_settings WHERE key LIKE 'knowmore_%';

-- Verify cleanup:
SELECT key, label FROM app_settings WHERE key LIKE 'knowmore_%';
-- (Should return 0 rows after deletion.)

-- Existing keys we reuse (already in your DB):
--   app_store_url     -> App Store button on /knowmore
--   play_store_url    -> Google Play button on /knowmore
--   social_facebook   -> Facebook button on /knowmore
--   social_instagram  -> Instagram button on /knowmore
--
-- These are editable in the admin Settings tab today \u2014 no migration needed.
`;
  if (fs.existsSync(file)) {
    skip('patch36bfix-migration.sql');
  } else {
    writeFile(file, sql);
    ok('patch36bfix-migration.sql: created');
  }
}

// =============================================================================
// 36b-fix.2  api/update-settings.js: remove 'knowmore.actions' slot
//             (was added by 36b but no longer needed)
// =============================================================================

log('');
log('36b-fix.2  api/update-settings.js: remove knowmore.actions slot');
{
  const file = path.join(API, 'update-settings.js');
  const content = readFile(file);
  if (content.includes(MARKER)) {
    skip('update-settings.js');
  } else {
    backup(file);
    const oldSlots = `  /* TMC_PATCH36B_KNOWMORE_ADMIN: knowmore.actions slot for sticker-back page URLs */
  const allowedSlots = [
    'landing.hero',
    'landing.demo',
    'landing.footer',
    'dashboard.banner',
    'dashboard.help',
    'signin.footer',
    'knowmore.actions'
  ];`;
    const newSlots = `  /* ${MARKER}: 36b reused existing app_settings keys, so no new slot needed */
  const allowedSlots = [
    'landing.hero',
    'landing.demo',
    'landing.footer',
    'dashboard.banner',
    'dashboard.help',
    'signin.footer'
  ];`;
    const r = safeReplace(content, oldSlots, newSlots);
    if (!r) errExit('update-settings.js: 36b allowedSlots anchor not found');
    writeFile(file, r);
    execSync('node --check "' + file + '"', { stdio: 'pipe' });
    ok('update-settings.js: knowmore.actions slot removed');
  }
}

// =============================================================================
// 36b-fix.3  knowmore.html: rewrite dynamic loader to use existing keys
// =============================================================================

log('');
log('36b-fix.3  knowmore.html: rewrite to use existing app_settings keys');
{
  const file = path.join(PUBLIC, 'knowmore.html');
  const content = readFile(file);
  if (content.includes(MARKER)) {
    skip('knowmore.html');
  } else {
    backup(file);

    /* Find the script block added by 36b and replace it. */
    const oldScript = `<script>
/* TMC_PATCH36B_KNOWMORE_ADMIN: load URLs from app_settings and apply to buttons */
(function() {
  function applyUrls(settings) {
    /* Website */
    var web = settings.knowmore_website_url && settings.knowmore_website_url.value;
    if (web) {
      var a = document.getElementById('km-website-link');
      if (a) a.href = web;
    }

    /* App Store \u2014 if URL present, activate the button */
    var appStore = settings.knowmore_app_store_url && settings.knowmore_app_store_url.value;
    var appEl = document.getElementById('km-appstore-link');
    if (appEl && appStore) {
      appEl.href = appStore;
      appEl.classList.remove('e-soon');
      appEl.removeAttribute('target');
      appEl.setAttribute('target', '_blank');
      appEl.setAttribute('rel', 'noopener');
    }

    /* Google Play */
    var play = settings.knowmore_play_store_url && settings.knowmore_play_store_url.value;
    var playEl = document.getElementById('km-play-link');
    if (playEl && play) {
      playEl.href = play;
      playEl.classList.remove('e-soon');
      playEl.setAttribute('target', '_blank');
      playEl.setAttribute('rel', 'noopener');
    }

    /* Facebook \u2014 hide entirely if URL is blank */
    var fb = settings.knowmore_facebook_url && settings.knowmore_facebook_url.value;
    var fbEl = document.getElementById('km-fb-link');
    if (fbEl) {
      if (fb) {
        fbEl.href = fb;
      } else {
        fbEl.style.display = 'none';
      }
    }

    /* Instagram \u2014 hide if blank */
    var ig = settings.knowmore_instagram_url && settings.knowmore_instagram_url.value;
    var igEl = document.getElementById('km-ig-link');
    if (igEl) {
      if (ig) {
        igEl.href = ig;
      } else {
        igEl.style.display = 'none';
      }
    }
  }

  fetch('/api/get-settings')
    .then(function(r) { return r.ok ? r.json() : null; })
    .then(function(data) {
      if (data && data.settings) applyUrls(data.settings);
    })
    .catch(function() { /* silently keep defaults */ });
})();
</script>`;

    const newScript = `<script>
/* ${MARKER}: load URLs from EXISTING app_settings keys (reuse, no duplicates).
   Keys used:
     app_store_url        -> App Store button
     play_store_url       -> Google Play button
     social_facebook      -> Facebook button
     social_instagram     -> Instagram button
   The primary "Visit our website" button stays hardcoded to tapmycar.io
   since this page IS the sticker-back of tapmycar.io \u2014 no setting needed. */
(function() {
  function v(settings, key) {
    return (settings && settings[key] && settings[key].value) || '';
  }

  function applyUrls(settings) {
    /* App Store */
    var appStore = v(settings, 'app_store_url');
    var appEl = document.getElementById('km-appstore-link');
    if (appEl && appStore) {
      appEl.href = appStore;
      appEl.classList.remove('e-soon');
      appEl.setAttribute('target', '_blank');
      appEl.setAttribute('rel', 'noopener');
    }

    /* Google Play */
    var play = v(settings, 'play_store_url');
    var playEl = document.getElementById('km-play-link');
    if (playEl && play) {
      playEl.href = play;
      playEl.classList.remove('e-soon');
      playEl.setAttribute('target', '_blank');
      playEl.setAttribute('rel', 'noopener');
    }

    /* Facebook \u2014 hide entirely if URL is blank */
    var fb = v(settings, 'social_facebook');
    var fbEl = document.getElementById('km-fb-link');
    if (fbEl) {
      if (fb) fbEl.href = fb;
      else fbEl.style.display = 'none';
    }

    /* Instagram \u2014 hide if blank */
    var ig = v(settings, 'social_instagram');
    var igEl = document.getElementById('km-ig-link');
    if (igEl) {
      if (ig) igEl.href = ig;
      else igEl.style.display = 'none';
    }
  }

  fetch('/api/get-settings')
    .then(function(r) { return r.ok ? r.json() : null; })
    .then(function(data) {
      if (data && data.settings) applyUrls(data.settings);
    })
    .catch(function() { /* silently keep defaults */ });
})();
</script>`;

    const r = safeReplace(content, oldScript, newScript);
    if (!r) errExit('knowmore.html: 36b script anchor not found');
    writeFile(file, r);
    ok('knowmore.html: now reads from existing settings keys');
  }
}

// =============================================================================
// 36b-fix.4  admin.html: update the QR card description to clarify
// =============================================================================

log('');
log('36b-fix.4  admin.html: update QR card description');
{
  const file = path.join(PUBLIC, 'admin.html');
  const content = readFile(file);
  if (content.includes(MARKER)) {
    skip('admin.html');
  } else {
    backup(file);

    const oldDesc = `<div style="font-size:12px;color:rgba(255,255,255,0.65);line-height:1.5">High-resolution PNG (1230\u00d71230 px), ready to print on the back of physical stickers.</div>`;
    const newDesc = `<div style="font-size:12px;color:rgba(255,255,255,0.65);line-height:1.5"><!--${MARKER}-->High-resolution PNG (1230\u00d71230 px), ready to print on the back of physical stickers. To change the buttons shown on /knowmore, edit App Store URL, Play Store URL, Facebook URL, and Instagram URL in the settings below.</div>`;

    const r = safeReplace(content, oldDesc, newDesc);
    if (!r) errExit('admin.html: QR card description anchor not found');
    writeFile(file, r);
    ok('admin.html: QR card description clarified');
  }
}

log('');
log('==============================================================');
log('Patch 36b-fix complete.');
log('Backup folder: ' + path.relative(ROOT, BACKUP_DIR));
log('');
log('==== DEPLOY \u2014 IN ORDER ====');
log('');
log('STEP 1: Run cleanup SQL in Supabase (safe even if 36b inserts failed)');
log('  Open patch36bfix-migration.sql, copy contents into Supabase SQL Editor.');
log('  Click Run. Deletes any knowmore_* rows.');
log('');
log('STEP 2: Deploy code');
log('  git add -A');
log('  git commit -m "Patch 36b-fix: reuse existing app_settings keys"');
log('  git push');
log('  Wait ~60 sec.');
log('');
log('STEP 3: Test in admin');
log('  Open https://tapmycar.io/admin.html \u2192 Settings tab');
log('  You will see your EXISTING settings (App Store URL, Play Store URL,');
log('  Facebook URL, Instagram URL) \u2014 no duplicates.');
log('  These same settings now drive the /knowmore page buttons.');
log('  ');
log('  Test: set App Store URL to https://apps.apple.com/app/safari/id1146562112');
log('  Save. Hard refresh /knowmore on your phone. App Store button activates.');
log('');
log('STEP 4: Download a fresh QR code via the "Download QR Code" button.');
log('==============================================================');
