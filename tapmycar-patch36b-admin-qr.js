// ============================================================================
// TapMyCar - Patch 36b: Admin URL editing for knowmore + QR code download
//
// Adds:
//   1. SQL migration: 5 new rows in app_settings for the knowmore page URLs.
//      Run patch36b-migration.sql in Supabase BEFORE deploy.
//
//   2. update-settings.js: a new allowed slot 'knowmore.actions'.
//
//   3. knowmore.html: reads /api/get-settings on page load and shows/hides
//      buttons based on whether each URL is configured. App Store and
//      Google Play go from "soon" to active when URLs are filled.
//
//   4. New endpoint api/qr-knowmore.js: returns a 1230x1230px PNG of the
//      QR code for tapmycar.io/knowmore. Admin-only.
//
//   5. admin.html: a new card above the settings list with a big
//      "Download QR Code" button (linked to /api/qr-knowmore?key=...).
//
// Note: The 5 URL settings will automatically appear in the existing
// settings list (they're loaded from app_settings). No new admin form
// needed \u2014 the existing infrastructure handles it.
//
// Properties: idempotent, safeReplace, backs up files, validates JS.
// ============================================================================

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const ROOT = __dirname;
const API = path.join(ROOT, 'api');
const PUBLIC = path.join(ROOT, 'public');

const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 16);
const BACKUP_DIR = path.join(ROOT, `backup-patch36b-${ts}`);

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
log('TapMyCar Patch 36b \u2014 admin URL editing + QR download');
log('Backup: ' + path.relative(ROOT, BACKUP_DIR));
log('');
fs.mkdirSync(BACKUP_DIR, { recursive: true });

const MARKER = 'TMC_PATCH36B_KNOWMORE_ADMIN';

// =============================================================================
// 36b.1  SQL migration file
// =============================================================================

log('36b.1  patch36b-migration.sql: seed knowmore URL settings');
{
  const file = path.join(ROOT, 'patch36b-migration.sql');
  const sql = `-- ${MARKER}: seed app_settings rows for the knowmore page URLs
-- Run this in Supabase SQL Editor BEFORE deploying Patch 36b.
-- Idempotent: ON CONFLICT DO NOTHING so re-running is safe.

INSERT INTO app_settings (key, value, slots, setting_type, label, description, sort_order)
VALUES
  ('knowmore_website_url',
   'https://tapmycar.io',
   ARRAY['knowmore.actions']::text[],
   'url',
   'Website URL (knowmore)',
   'Big primary button on the sticker-back page. Default: tapmycar.io',
   200),

  ('knowmore_app_store_url',
   '',
   ARRAY['knowmore.actions']::text[],
   'url',
   'App Store URL (knowmore)',
   'Leave blank to show the App Store button as "soon" (greyed out).',
   201),

  ('knowmore_play_store_url',
   '',
   ARRAY['knowmore.actions']::text[],
   'url',
   'Google Play URL (knowmore)',
   'Leave blank to show the Google Play button as "soon" (greyed out).',
   202),

  ('knowmore_facebook_url',
   'https://facebook.com/tapmycar',
   ARRAY['knowmore.actions']::text[],
   'url',
   'Facebook URL (knowmore)',
   'Leave blank to hide the Facebook button.',
   203),

  ('knowmore_instagram_url',
   'https://instagram.com/tapmycar',
   ARRAY['knowmore.actions']::text[],
   'url',
   'Instagram URL (knowmore)',
   'Leave blank to hide the Instagram button.',
   204)
ON CONFLICT (key) DO NOTHING;

-- Verify:
-- SELECT key, value, slots, label, sort_order FROM app_settings
-- WHERE key LIKE 'knowmore_%' ORDER BY sort_order;
`;

  if (fs.existsSync(file)) {
    skip('patch36b-migration.sql (already exists)');
  } else {
    writeFile(file, sql);
    ok('patch36b-migration.sql: created');
  }
}

// =============================================================================
// 36b.2  api/update-settings.js: add 'knowmore.actions' to allowedSlots
// =============================================================================

log('');
log('36b.2  api/update-settings.js: register knowmore.actions slot');
{
  const file = path.join(API, 'update-settings.js');
  const content = readFile(file);
  if (content.includes(MARKER)) {
    skip('update-settings.js');
  } else {
    backup(file);
    const oldSlots = `  const allowedSlots = [
    'landing.hero',
    'landing.demo',
    'landing.footer',
    'dashboard.banner',
    'dashboard.help',
    'signin.footer'
  ];`;
    const newSlots = `  /* ${MARKER}: knowmore.actions slot for sticker-back page URLs */
  const allowedSlots = [
    'landing.hero',
    'landing.demo',
    'landing.footer',
    'dashboard.banner',
    'dashboard.help',
    'signin.footer',
    'knowmore.actions'
  ];`;
    const r = safeReplace(content, oldSlots, newSlots);
    if (!r) errExit('update-settings.js: allowedSlots anchor not found');
    writeFile(file, r);
    execSync('node --check "' + file + '"', { stdio: 'pipe' });
    ok('update-settings.js: knowmore.actions slot registered');
  }
}

// =============================================================================
// 36b.3  api/qr-knowmore.js: PNG endpoint for QR code download
// =============================================================================

log('');
log('36b.3  api/qr-knowmore.js: QR PNG endpoint');
{
  const file = path.join(API, 'qr-knowmore.js');
  if (fs.existsSync(file)) {
    const existing = readFile(file);
    if (existing.includes(MARKER)) {
      skip('qr-knowmore.js');
    } else {
      errExit('qr-knowmore.js exists without marker \u2014 manual review needed');
    }
  } else {
    const body = `// ${MARKER}
// GET /api/qr-knowmore
//
// Returns a high-resolution PNG of the QR code for tapmycar.io/knowmore,
// suitable for printing on the back of physical TapMyCar stickers.
//
// Admin-only: requires ?key=<ADMIN_SECRET_KEY> query parameter so the
// endpoint can be used as a direct download link with the "download"
// attribute on an anchor tag.
//
// Image: 1230x1230 px, 30% error correction (highest), pure black/white.

const QRCode = require('qrcode');

const TARGET_URL = 'https://tapmycar.io/knowmore';

module.exports = async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  // Admin auth via query param (so it works as a download link).
  const key = req.query && req.query.key;
  if (!key || key !== process.env.ADMIN_SECRET_KEY) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const buf = await QRCode.toBuffer(TARGET_URL, {
      type: 'png',
      errorCorrectionLevel: 'H',
      margin: 4,
      scale: 30,           /* 30 px per module = ~1230 px output */
      color: {
        dark: '#000000',
        light: '#FFFFFF'
      }
    });

    res.setHeader('Content-Type', 'image/png');
    res.setHeader('Content-Disposition', 'attachment; filename="tapmycar-knowmore-qr.png"');
    res.setHeader('Cache-Control', 'private, max-age=300');
    return res.send(buf);
  } catch (e) {
    console.error('qr-knowmore error:', e && e.message);
    return res.status(500).json({ error: 'QR generation failed' });
  }
};
`;
    writeFile(file, body);
    execSync('node --check "' + file + '"', { stdio: 'pipe' });
    ok('qr-knowmore.js: created and JS valid');
  }
}

// =============================================================================
// 36b.4  public/knowmore.html: fetch URLs dynamically + show/hide buttons
// =============================================================================

log('');
log('36b.4  public/knowmore.html: dynamic URL loading');
{
  const file = path.join(PUBLIC, 'knowmore.html');
  const content = readFile(file);
  if (content.includes(MARKER)) {
    skip('knowmore.html');
  } else {
    backup(file);

    /* Add id attributes to the buttons so JS can target them. */

    /* Website link: add id="km-website-link" */
    const oldWebsite = `  <a class="e-primary" href="https://tapmycar.io" target="_blank" rel="noopener">`;
    const newWebsite = `  <a class="e-primary" id="km-website-link" href="https://tapmycar.io" target="_blank" rel="noopener">`;
    let updated = safeReplace(content, oldWebsite, newWebsite);
    if (!updated) errExit('knowmore.html: website link anchor not found');

    /* App Store: add id */
    const oldAppStore = `      <a class="e-store e-soon" href="javascript:void(0)">
        <div><svg width="22" height="22" viewBox="0 0 24 24" fill="#fff"><path d="M17.05 20.28`;
    const newAppStore = `      <a class="e-store e-soon" id="km-appstore-link" href="javascript:void(0)">
        <div><svg width="22" height="22" viewBox="0 0 24 24" fill="#fff"><path d="M17.05 20.28`;
    updated = safeReplace(updated, oldAppStore, newAppStore);
    if (!updated) errExit('knowmore.html: App Store link anchor not found');

    /* Google Play: add id */
    const oldPlay = `      <a class="e-store e-soon" href="javascript:void(0)">
        <div><svg width="22" height="22" viewBox="0 0 24 24"><path fill="#34A853"`;
    const newPlay = `      <a class="e-store e-soon" id="km-play-link" href="javascript:void(0)">
        <div><svg width="22" height="22" viewBox="0 0 24 24"><path fill="#34A853"`;
    updated = safeReplace(updated, oldPlay, newPlay);
    if (!updated) errExit('knowmore.html: Google Play link anchor not found');

    /* Facebook: add id */
    const oldFB = `      <a class="e-social e-social-fb" href="https://facebook.com/tapmycar" target="_blank" rel="noopener">`;
    const newFB = `      <a class="e-social e-social-fb" id="km-fb-link" href="https://facebook.com/tapmycar" target="_blank" rel="noopener">`;
    updated = safeReplace(updated, oldFB, newFB);
    if (!updated) errExit('knowmore.html: Facebook anchor not found');

    /* Instagram: add id */
    const oldIG = `      <a class="e-social e-social-ig" href="https://instagram.com/tapmycar" target="_blank" rel="noopener">`;
    const newIG = `      <a class="e-social e-social-ig" id="km-ig-link" href="https://instagram.com/tapmycar" target="_blank" rel="noopener">`;
    updated = safeReplace(updated, oldIG, newIG);
    if (!updated) errExit('knowmore.html: Instagram anchor not found');

    /* Add the dynamic-loading script before </body> */
    const oldClose = `</div>

</body>
</html>
`;
    const newClose = `</div>

<script>
/* ${MARKER}: load URLs from app_settings and apply to buttons */
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
</script>

</body>
</html>
`;
    updated = safeReplace(updated, oldClose, newClose);
    if (!updated) errExit('knowmore.html: close anchor not found');

    writeFile(file, updated);
    ok('knowmore.html: dynamic URL loader installed');
  }
}

// =============================================================================
// 36b.5  public/admin.html: Download QR Code button
// =============================================================================

log('');
log('36b.5  public/admin.html: Download QR Code button + helper');
{
  const file = path.join(PUBLIC, 'admin.html');
  const content = readFile(file);
  if (content.includes(MARKER)) {
    skip('admin.html');
  } else {
    backup(file);

    /* Insert a new card above the settings list in the settings panel. */
    const oldPanel = `<!-- TMC_PATCH26_APP_SETTINGS: Settings panel -->
<div class="panel" id="panel-settings">
  <div class="asl">Site Settings</div>
  <div class="kpi-sub" style="margin-bottom:14px;padding:0 4px">Configure URLs and toggles that appear on landing, dashboard, and sign-in pages.</div>
  <div id="p26-settings-list" class="p26-settings-list"><div class="empty">Loading settings\u2026</div></div>`;

    const newPanel = `<!-- TMC_PATCH26_APP_SETTINGS: Settings panel -->
<div class="panel" id="panel-settings">
  <div class="asl">Site Settings</div>
  <div class="kpi-sub" style="margin-bottom:14px;padding:0 4px">Configure URLs and toggles that appear on landing, dashboard, sign-in, and sticker-back pages.</div>

  <!-- ${MARKER}: Sticker-back QR download card -->
  <div style="background:linear-gradient(135deg,#0E0E0E,#1a0e1c);color:#fff;border-radius:14px;padding:18px;margin-bottom:18px;display:flex;align-items:center;gap:16px;flex-wrap:wrap">
    <div style="flex:1;min-width:200px">
      <div style="font-size:11px;font-weight:700;letter-spacing:0.12em;text-transform:uppercase;color:#FFAB6D;margin-bottom:6px">Sticker Back Page</div>
      <div style="font-size:15px;font-weight:700;line-height:1.35;margin-bottom:4px">QR Code for tapmycar.io/knowmore</div>
      <div style="font-size:12px;color:rgba(255,255,255,0.65);line-height:1.5">High-resolution PNG (1230\u00d71230 px), ready to print on the back of physical stickers.</div>
    </div>
    <button class="gen-btn success" onclick="p36bDownloadQr()" style="white-space:nowrap">
      <svg viewBox="0 0 24 24" width="14" height="14" style="vertical-align:-2px;margin-right:6px" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>Download QR Code
    </button>
  </div>

  <div id="p26-settings-list" class="p26-settings-list"><div class="empty">Loading settings\u2026</div></div>`;

    let updated = safeReplace(content, oldPanel, newPanel);
    if (!updated) errExit('admin.html: settings panel anchor not found');

    /* Add the p36bDownloadQr function near other JS functions. Insert
       just before the p26Save function definition. */
    const oldSave = `async function p26Save() {`;
    const newSave = `// ${MARKER}: Download QR Code for knowmore page.
function p36bDownloadQr() {
  /* adminKey is the global var populated from localStorage.tmc_admin_key */
  var k = (typeof adminKey === 'string' && adminKey) ? adminKey : '';
  if (!k) {
    alert('Admin key not loaded. Refresh the page and try again.');
    return;
  }
  /* Direct browser download via anchor element. */
  var a = document.createElement('a');
  a.href = '/api/qr-knowmore?key=' + encodeURIComponent(k);
  a.download = 'tapmycar-knowmore-qr.png';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
}

async function p26Save() {`;
    updated = safeReplace(updated, oldSave, newSave);
    if (!updated) errExit('admin.html: p26Save anchor not found');

    writeFile(file, updated);
    ok('admin.html: QR download button + helper added');
  }
}

log('');
log('==============================================================');
log('Patch 36b complete.');
log('Backup folder: ' + path.relative(ROOT, BACKUP_DIR));
log('');
log('==== DEPLOY \u2014 IN ORDER ====');
log('');
log('STEP 1: Run the SQL migration in Supabase');
log('  Open Supabase \u2192 SQL Editor');
log('  Open patch36b-migration.sql in a text editor');
log('  Copy contents and paste into Supabase SQL Editor');
log('  Click Run.');
log('');
log('STEP 2: Verify migration succeeded');
log('  SELECT key, value, label FROM app_settings');
log('  WHERE key LIKE (knowmore_%) ORDER BY sort_order;');
log('  [replace (xxx) with single-quoted xxx in the SQL editor]');
log('  Expected: 5 rows (website, app_store, play_store, facebook, instagram)');
log('');
log('STEP 3: Deploy code');
log('  git add -A');
log('  git commit -m "Patch 36b: knowmore admin URL editing + QR download"');
log('  git push');
log('  Wait ~60 sec.');
log('');
log('STEP 4: Test in admin');
log('  Open https://tapmycar.io/admin.html \u2192 Settings tab');
log('  You should see:');
log('    \u2022 A dark card at the top: "QR Code for tapmycar.io/knowmore"');
log('      with a "Download QR Code" button (click it \u2192 PNG downloads)');
log('    \u2022 5 new input rows below the existing ones:');
log('       - Website URL (knowmore)');
log('       - App Store URL (knowmore)');
log('       - Google Play URL (knowmore)');
log('       - Facebook URL (knowmore)');
log('       - Instagram URL (knowmore)');
log('  Test by entering a fake App Store URL like https://apps.apple.com/app/test');
log('  Click Save all changes.');
log('  Open https://tapmycar.io/knowmore on your phone (hard refresh):');
log('  The App Store button should now be black/active (no longer "soon").');
log('==============================================================');
