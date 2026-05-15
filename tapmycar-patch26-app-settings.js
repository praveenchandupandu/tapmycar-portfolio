// ============================================================================
// TapMyCar - Patch 26: App Settings infrastructure
//
// Admin-configurable settings (URLs, emails, social handles) with per-slot
// toggles to control where each setting appears.
//
// What this adds:
//
// 26.1  Database
//   - New table `app_settings` (key, value, slots[], type, label, ...)
//   - Seed with 9 settings (App Store, Play Store, Demo video, etc)
//
// 26.2  Backend
//   - api/get-settings.js  -- public GET, returns all settings + slot config
//   - api/update-settings.js  -- admin-only POST, updates settings
//
// 26.3  Admin UI
//   - New "Settings" panel in admin sidebar
//   - Per-setting row: value input + 6 slot checkboxes
//   - Save persists to DB + audit-logs the change
//
// 26.4  Public pages
//   - landing.html: 3 slot containers (hero/demo/footer)
//   - dashboard.html: 2 slot containers (banner/help), REPLACE hardcoded
//     App Store/Play Store block
//   - signin.html: 1 slot container (footer)
//   - All pages fetch /api/get-settings on load and render appropriate slots
//
// Empty-value behavior:
//   - If a setting's value is blank/null -> the related element is hidden
//   - If a setting's slot toggle is OFF for the current page -> hidden there
//
// Slots:
//   - landing.hero    -- Landing page top (download badges)
//   - landing.demo    -- Landing page video section
//   - landing.footer  -- Landing page bottom (social icons, support email)
//   - dashboard.banner -- User dashboard "Get the app" tile
//   - dashboard.help  -- User dashboard help section
//   - signin.footer   -- Sign-in / register footer
//
// Settings seeded:
//   1. app_store_url     (App Store iOS link)
//   2. play_store_url    (Google Play link)
//   3. demo_video_url    (YouTube embed URL)
//   4. support_email     (Customer support email)
//   5. cs_phone          (Customer service phone, optional)
//   6. social_instagram  (Instagram URL)
//   7. social_twitter    (Twitter/X URL)
//   8. social_facebook   (Facebook URL)
//   9. social_linkedin   (LinkedIn URL)
//
// REQUIRES: Patches 1-25 applied. SQL migration runs before deploy.
// Properties: idempotent, validates JS, backs up touched files.
// ============================================================================

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const ROOT = __dirname;
const API = path.join(ROOT, 'api');
const PUBLIC = path.join(ROOT, 'public');

const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 16);
const BACKUP_DIR = path.join(ROOT, `backup-patch26-${ts}`);

const log = (s) => console.log(s);
const ok = (s) => console.log('  \u2713 ' + s);
const skip = (s) => console.log('  \u00b7 ' + s + ' (already applied, skipped)');
const warn = (s) => console.log('  ! ' + s);
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
function validateJs(p) {
  try { execSync('node --check "' + p + '"', { stdio: 'pipe' }); }
  catch (e) { errExit('JS syntax error in ' + p + '\n' + e.stderr.toString()); }
}
function tryReplace(content, oldStr, newStr) {
  if (content.includes(oldStr)) return content.replace(oldStr, newStr);
  const oldCRLF = oldStr.replace(/\n/g, '\r\n');
  if (content.includes(oldCRLF)) return content.replace(oldCRLF, newStr.replace(/\n/g, '\r\n'));
  return null;
}

log('');
log('TapMyCar Patch 26 \u2014 App Settings infrastructure');
log('Backup directory: ' + path.relative(ROOT, BACKUP_DIR));
log('');
fs.mkdirSync(BACKUP_DIR, { recursive: true });

const MARKER = 'TMC_PATCH26_APP_SETTINGS';

// ===========================================================================
// 26.2.a  api/get-settings.js — public read endpoint
// ===========================================================================

log('26.2.a  api/get-settings.js: create public read endpoint');
{
  const file = path.join(API, 'get-settings.js');
  if (fs.existsSync(file) && readFile(file).includes(MARKER)) {
    skip('get-settings.js (already exists)');
  } else {
    const body = `// ${MARKER}
// GET /api/get-settings
// Returns all app settings + their slot assignments. Public, no auth.
// Cached briefly (60s) since settings rarely change.

const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

module.exports = async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const { data, error } = await supabase
      .from('app_settings')
      .select('key, value, slots, setting_type, label, description, sort_order')
      .order('sort_order', { ascending: true });

    if (error) {
      console.error('get-settings error:', error.message);
      return res.status(500).json({ error: 'Failed to load settings' });
    }

    // Convert to keyed object for easier frontend access.
    const settings = {};
    (data || []).forEach(row => {
      settings[row.key] = {
        value: row.value || '',
        slots: row.slots || [],
        type: row.setting_type || 'url',
        label: row.label || row.key,
        description: row.description || ''
      };
    });

    // CDN cache 60s, browser 30s. Admin save invalidates by reload anyway.
    res.setHeader('Cache-Control', 'public, max-age=30, s-maxage=60');
    return res.json({ success: true, settings });
  } catch (e) {
    console.error('get-settings exception:', e && e.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
`;
    fs.writeFileSync(file, body, 'utf8');
    validateJs(file);
    ok('get-settings.js: created');
  }
}

// ===========================================================================
// 26.2.b  api/update-settings.js — admin write endpoint
// ===========================================================================

log('26.2.b  api/update-settings.js: create admin write endpoint');
{
  const file = path.join(API, 'update-settings.js');
  if (fs.existsSync(file) && readFile(file).includes(MARKER)) {
    skip('update-settings.js (already exists)');
  } else {
    const body = `// ${MARKER}
// POST /api/update-settings
// Admin-only. Updates one or more app_settings rows.
//
// Request body:
//   {
//     updates: [
//       { key: 'app_store_url', value: 'https://...', slots: ['landing.hero', 'dashboard.banner'] },
//       ...
//     ]
//   }
//
// Auth: x-admin-key header.

const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

// Optional audit hook (best-effort)
let _audit = null;
try { _audit = require('./_audit').audit; } catch (e) {}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  // Admin auth
  const adminKey = req.headers['x-admin-key'];
  if (adminKey !== process.env.ADMIN_SECRET_KEY) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const updates = (req.body && req.body.updates) || [];
  if (!Array.isArray(updates) || updates.length === 0) {
    return res.status(400).json({ error: 'updates array required' });
  }
  if (updates.length > 50) {
    return res.status(400).json({ error: 'Max 50 updates per request' });
  }

  const allowedSlots = [
    'landing.hero',
    'landing.demo',
    'landing.footer',
    'dashboard.banner',
    'dashboard.help',
    'signin.footer'
  ];

  const results = [];
  for (const u of updates) {
    if (!u || typeof u.key !== 'string' || !u.key.trim()) {
      results.push({ key: u && u.key, error: 'key required' });
      continue;
    }
    const key = u.key.trim().slice(0, 64);
    const value = u.value == null ? '' : String(u.value).slice(0, 2000);
    let slots = Array.isArray(u.slots) ? u.slots : [];
    slots = slots.filter(s => typeof s === 'string' && allowedSlots.includes(s));

    try {
      const { error } = await supabase
        .from('app_settings')
        .update({ value, slots, updated_at: new Date().toISOString(), updated_by: 'admin' })
        .eq('key', key);
      if (error) {
        results.push({ key, error: error.message });
      } else {
        results.push({ key, ok: true });
      }
    } catch (e) {
      results.push({ key, error: e && e.message });
    }
  }

  // Audit
  if (_audit) {
    try {
      _audit({
        actor: 'admin',
        action: 'update_settings',
        target_type: 'app_settings',
        meta: { keys: updates.map(u => u && u.key).filter(Boolean), count: updates.length }
      });
    } catch (e) {}
  }

  return res.json({ success: true, results });
};
`;
    fs.writeFileSync(file, body, 'utf8');
    validateJs(file);
    ok('update-settings.js: created');
  }
}

// ===========================================================================
// 26.4.a  public/app-settings.js — frontend renderer used by all public pages
// ===========================================================================

log('26.4.a  public/app-settings.js: shared frontend renderer');
{
  const file = path.join(PUBLIC, 'app-settings.js');
  if (fs.existsSync(file) && readFile(file).includes(MARKER)) {
    skip('app-settings.js (already exists)');
  } else {
    const body = `// ${MARKER}
// Shared frontend module: fetches /api/get-settings and renders the
// settings into named slot containers on the current page.
//
// Usage on a page:
//   <div data-tmc-slot="landing.hero"></div>
//   <script src="/app-settings.js"></script>
//
// Slot containers receive innerHTML based on which settings include
// the slot in their slots[] array.
//
// Slot \u2192 setting rendering:
//   landing.hero    \u2192 App Store + Play Store badges (download row)
//   landing.demo    \u2192 Demo video embed (YouTube iframe)
//   landing.footer  \u2192 Social icons + support email (icon row)
//   dashboard.banner \u2192 App Store + Play Store badges
//   dashboard.help  \u2192 Support email link
//   signin.footer   \u2192 Support email link

(function() {
  function esc(s) {
    return String(s == null ? '' : s).replace(/[<>&"']/g, c => ({'<':'&lt;','>':'&gt;','&':'&amp;','"':'&quot;',"'":'&#39;'}[c]));
  }

  function youTubeEmbed(url) {
    // Accept https://youtu.be/X, https://www.youtube.com/watch?v=X, or https://www.youtube.com/embed/X
    if (!url) return '';
    var m = url.match(/(?:youtu\\.be\\/|v=|\\/embed\\/)([A-Za-z0-9_-]{6,20})/);
    if (m) return 'https://www.youtube.com/embed/' + m[1];
    // Vimeo
    var v = url.match(/vimeo\\.com\\/(\\d+)/);
    if (v) return 'https://player.vimeo.com/video/' + v[1];
    return url; // assume it's already an embed URL
  }

  function badgesHtml(settings, slotId) {
    var appStore = settings.app_store_url;
    var playStore = settings.play_store_url;
    var hasApp = appStore && appStore.value && (appStore.slots || []).indexOf(slotId) >= 0;
    var hasPlay = playStore && playStore.value && (playStore.slots || []).indexOf(slotId) >= 0;
    if (!hasApp && !hasPlay) return '';
    var parts = [];
    if (hasApp) {
      parts.push(
        '<a href="' + esc(appStore.value) + '" target="_blank" rel="noopener" class="tmc-badge tmc-badge-app" aria-label="Download on the App Store">' +
          '<svg width="20" height="20" viewBox="0 0 24 24" fill="#fff" aria-hidden="true"><path d="M18.71 19.5c-.83 1.24-1.71 2.45-3.05 2.47-1.34.03-1.77-.79-3.29-.79-1.53 0-2 .77-3.27.82-1.31.05-2.3-1.32-3.14-2.53C4.25 17 2.94 12.45 4.7 9.39c.87-1.52 2.43-2.48 4.12-2.51 1.28-.02 2.5.87 3.29.87.78 0 2.26-1.07 3.8-.91.65.03 2.47.26 3.64 1.98-.09.06-2.17 1.28-2.15 3.81.03 3.02 2.65 4.03 2.68 4.04-.03.07-.42 1.44-1.38 2.83M13 3.5c.73-.83 1.94-1.46 2.94-1.5.13 1.17-.34 2.35-1.04 3.19-.69.85-1.83 1.51-2.95 1.42-.15-1.15.41-2.35 1.05-3.11z"/></svg>' +
          '<span><small>Download on the</small><strong>App Store</strong></span>' +
        '</a>'
      );
    }
    if (hasPlay) {
      parts.push(
        '<a href="' + esc(playStore.value) + '" target="_blank" rel="noopener" class="tmc-badge tmc-badge-play" aria-label="Get it on Google Play">' +
          '<svg width="20" height="20" viewBox="0 0 24 24" aria-hidden="true"><path d="M3 20.5v-17c0-.83 1-.83 1.5-.5l14 8.5-14 8.5c-.5.33-1.5.33-1.5-.5z" fill="#34A853"/><path d="M3 3.5l8.5 8.5L3 20.5z" fill="#4285F4"/><path d="M17 15.5l-5.5-3.5 5.5-3.5 2 2.1c.7.7.7 2.3 0 3z" fill="#FBBC05"/></svg>' +
          '<span><small>Get it on</small><strong>Google Play</strong></span>' +
        '</a>'
      );
    }
    return '<div class="tmc-badges">' + parts.join('') + '</div>';
  }

  function videoHtml(settings, slotId) {
    var dv = settings.demo_video_url;
    if (!dv || !dv.value || (dv.slots || []).indexOf(slotId) < 0) return '';
    var embed = youTubeEmbed(dv.value);
    if (!embed) return '';
    return '<div class="tmc-video"><iframe src="' + esc(embed) + '" frameborder="0" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture" allowfullscreen loading="lazy" title="Demo video"></iframe></div>';
  }

  function socialHtml(settings, slotId) {
    var entries = [
      { key: 'social_instagram', label: 'Instagram', path: '<path d="M16 11.37a4 4 0 1 1-7.94 1.18A4 4 0 0 1 16 11.37z"/><path d="M17.5 6.5h.01"/><rect x="2" y="2" width="20" height="20" rx="5" ry="5"/>' },
      { key: 'social_twitter',   label: 'Twitter / X', path: '<path d="M23 3a10.9 10.9 0 0 1-3.14 1.53 4.48 4.48 0 0 0-7.86 3v1A10.66 10.66 0 0 1 3 4s-4 9 5 13a11.64 11.64 0 0 1-7 2c9 5 20 0 20-11.5a4.5 4.5 0 0 0-.08-.83A7.72 7.72 0 0 0 23 3z"/>' },
      { key: 'social_facebook',  label: 'Facebook', path: '<path d="M18 2h-3a5 5 0 0 0-5 5v3H7v4h3v8h4v-8h3l1-4h-4V7a1 1 0 0 1 1-1h3z"/>' },
      { key: 'social_linkedin',  label: 'LinkedIn', path: '<path d="M16 8a6 6 0 0 1 6 6v7h-4v-7a2 2 0 0 0-4 0v7h-4v-7a6 6 0 0 1 6-6z"/><rect x="2" y="9" width="4" height="12"/><circle cx="4" cy="4" r="2"/>' }
    ];
    var icons = entries.filter(function(e) {
      var s = settings[e.key];
      return s && s.value && (s.slots || []).indexOf(slotId) >= 0;
    }).map(function(e) {
      var s = settings[e.key];
      return '<a href="' + esc(s.value) + '" target="_blank" rel="noopener" aria-label="' + esc(e.label) + '" class="tmc-social"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' + e.path + '</svg></a>';
    }).join('');
    return icons;
  }

  function supportEmailHtml(settings, slotId) {
    var s = settings.support_email;
    if (!s || !s.value || (s.slots || []).indexOf(slotId) < 0) return '';
    return '<a href="mailto:' + esc(s.value) + '" class="tmc-support-email">' + esc(s.value) + '</a>';
  }

  function csPhoneHtml(settings, slotId) {
    var s = settings.cs_phone;
    if (!s || !s.value || (s.slots || []).indexOf(slotId) < 0) return '';
    return '<a href="tel:' + esc(s.value.replace(/[^+0-9]/g, '')) + '" class="tmc-support-phone">' + esc(s.value) + '</a>';
  }

  // Render the right combo of widgets per slot.
  function renderSlot(el, settings) {
    var slotId = el.dataset.tmcSlot;
    var html = '';
    if (slotId === 'landing.hero' || slotId === 'dashboard.banner') {
      html += badgesHtml(settings, slotId);
    } else if (slotId === 'landing.demo') {
      html += videoHtml(settings, slotId);
    } else if (slotId === 'landing.footer') {
      var social = socialHtml(settings, slotId);
      var email = supportEmailHtml(settings, slotId);
      var phone = csPhoneHtml(settings, slotId);
      var inner = (social ? '<div class="tmc-social-row">' + social + '</div>' : '') +
                  ((email || phone) ? '<div class="tmc-contact-row">' + email + (email && phone ? '<span class="tmc-dot">\u00b7</span>' : '') + phone + '</div>' : '');
      html += inner;
    } else if (slotId === 'dashboard.help' || slotId === 'signin.footer') {
      var email2 = supportEmailHtml(settings, slotId);
      var phone2 = csPhoneHtml(settings, slotId);
      html += (email2 || phone2) ? '<div class="tmc-contact-row">' + email2 + (email2 && phone2 ? '<span class="tmc-dot">\u00b7</span>' : '') + phone2 + '</div>' : '';
    }
    el.innerHTML = html;
    el.style.display = html ? '' : 'none';
  }

  function renderAll(settings) {
    var slots = document.querySelectorAll('[data-tmc-slot]');
    slots.forEach(function(el) { renderSlot(el, settings); });
  }

  function fetchAndRender() {
    var slots = document.querySelectorAll('[data-tmc-slot]');
    if (slots.length === 0) return;
    fetch('/api/get-settings').then(function(r) { return r.json(); }).then(function(d) {
      if (!d || !d.success || !d.settings) return;
      renderAll(d.settings);
    }).catch(function() {});
  }

  // Inject the minimum CSS needed once.
  function injectCss() {
    if (document.getElementById('tmc-settings-css')) return;
    var st = document.createElement('style');
    st.id = 'tmc-settings-css';
    st.textContent = [
      '.tmc-badges{display:flex;gap:10px;flex-wrap:wrap}',
      '.tmc-badge{display:inline-flex;align-items:center;gap:10px;background:#0F1B2F;color:#fff;text-decoration:none;padding:9px 14px;border-radius:12px;font-family:inherit;transition:transform .12s}',
      '.tmc-badge:hover{transform:translateY(-2px)}',
      '.tmc-badge span{display:flex;flex-direction:column;line-height:1.1}',
      '.tmc-badge small{font-size:9px;opacity:.75;font-weight:500}',
      '.tmc-badge strong{font-size:14px;font-weight:800;letter-spacing:.01em}',
      '.tmc-video{position:relative;width:100%;max-width:560px;aspect-ratio:16/9;border-radius:16px;overflow:hidden;background:#000;margin:0 auto;box-shadow:0 10px 30px rgba(0,0,0,.3)}',
      '.tmc-video iframe{position:absolute;inset:0;width:100%;height:100%;border:0}',
      '.tmc-social-row{display:flex;gap:14px;justify-content:center;margin:8px 0}',
      '.tmc-social{display:inline-flex;align-items:center;justify-content:center;width:36px;height:36px;border-radius:50%;background:rgba(255,255,255,.08);color:#fff;text-decoration:none;transition:background .12s}',
      '.tmc-social:hover{background:rgba(255,107,0,.2);color:#FF6B00}',
      '.tmc-social svg{width:16px;height:16px}',
      '.tmc-contact-row{display:flex;gap:10px;justify-content:center;align-items:center;font-size:12px;color:#9CA3AF;font-weight:500;margin:4px 0}',
      '.tmc-support-email,.tmc-support-phone{color:#FF6B00;text-decoration:none;font-weight:600}',
      '.tmc-support-email:hover,.tmc-support-phone:hover{text-decoration:underline}',
      '.tmc-dot{color:#6B7280;font-weight:700}'
    ].join('\\n');
    document.head.appendChild(st);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function() { injectCss(); fetchAndRender(); });
  } else {
    injectCss();
    fetchAndRender();
  }

  // Expose for admin live-preview if needed
  window.__tmcRenderSettings = renderAll;
})();
`;
    fs.writeFileSync(file, body, 'utf8');
    ok('app-settings.js: created');
  }
}

// ===========================================================================
// 26.4.b  Inject app-settings.js + slot containers into public pages
// ===========================================================================

log('');
log('26.4.b  landing.html: inject slots + script');
{
  const file = path.join(PUBLIC, 'landing.html');
  const content = readFile(file);
  if (content.includes(MARKER)) {
    skip('landing.html (already patched)');
  } else {
    backup(file);
    let updated = content;

    // Add hero badges slot right after the existing "Get App" CTA row.
    // Anchor on the closing of the install-app block.
    const oldGetApp = `  <a href="/register.html" style="background:#FF6B00;color:#fff;font-size:12px;font-weight:700;padding:8px 16px;border-radius:10px;text-decoration:none">Get App</a>
</div>`;
    const newGetApp = `  <a href="/register.html" style="background:#FF6B00;color:#fff;font-size:12px;font-weight:700;padding:8px 16px;border-radius:10px;text-decoration:none">Get App</a>
</div>

<!-- ${MARKER}: landing.hero slot (download badges) -->
<div data-tmc-slot="landing.hero" style="padding:20px 24px 8px;display:flex;justify-content:center"></div>

<!-- ${MARKER}: landing.demo slot (demo video) -->
<div data-tmc-slot="landing.demo" style="padding:24px;display:flex;justify-content:center"></div>`;

    let r = tryReplace(updated, oldGetApp, newGetApp);
    if (!r) warn('landing.html: Get App anchor not found, slots NOT injected near hero');
    else updated = r;

    // Add footer slot right above the existing footer pipe-separated links.
    const oldFooter = `<!-- FOOTER -->
<div class="footer">`;
    const newFooter = `<!-- FOOTER -->
<!-- ${MARKER}: landing.footer slot (social + support) -->
<div data-tmc-slot="landing.footer" style="padding:14px 24px 0;text-align:center"></div>
<div class="footer">`;

    let r2 = tryReplace(updated, oldFooter, newFooter);
    if (!r2) warn('landing.html: footer anchor not found, footer slot NOT added');
    else updated = r2;

    // Add the script tag before </body>.
    const oldBody = `</script>


`;
    // safer anchor — the serviceWorker register block end
    const swEnd = `if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('/sw.js');
}
</script>`;
    const swEndNew = `if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('/sw.js');
}
</script>
<!-- ${MARKER}: settings renderer -->
<script src="/app-settings.js" defer></script>`;
    let r3 = tryReplace(updated, swEnd, swEndNew);
    if (!r3) warn('landing.html: service worker anchor not found, script tag NOT added');
    else updated = r3;

    writeFile(file, updated);
    ok('landing.html: slots + script wired');
  }
}

// ─── dashboard.html — replace hardcoded App Store/Play Store with slot ───
log('');
log('26.4.c  dashboard.html: replace hardcoded badges with slot');
{
  const file = path.join(PUBLIC, 'dashboard.html');
  const content = readFile(file);
  if (content.includes(MARKER)) {
    skip('dashboard.html (already patched)');
  } else {
    backup(file);
    let updated = content;

    const oldBadges = `  <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px">
    <a href="https://apps.apple.com/app/tapmycar" target="_blank" style="background:#fff;border-radius:12px;padding:10px 12px;display:flex;align-items:center;gap:8px;text-decoration:none">
      <svg width="18" height="18" viewBox="0 0 24 24" fill="#111"><path d="M18.71 19.5c-.83 1.24-1.71 2.45-3.05 2.47-1.34.03-1.77-.79-3.29-.79-1.53 0-2 .77-3.27.82-1.31.05-2.3-1.32-3.14-2.53C4.25 17 2.94 12.45 4.7 9.39c.87-1.52 2.43-2.48 4.12-2.51 1.28-.02 2.5.87 3.29.87.78 0 2.26-1.07 3.8-.91.65.03 2.47.26 3.64 1.98-.09.06-2.17 1.28-2.15 3.81.03 3.02 2.65 4.03 2.68 4.04-.03.07-.42 1.44-1.38 2.83M13 3.5c.73-.83 1.94-1.46 2.94-1.5.13 1.17-.34 2.35-1.04 3.19-.69.85-1.83 1.51-2.95 1.42-.15-1.15.41-2.35 1.05-3.11z"/></svg>
      <div>
        <div style="font-size:8px;color:#666;font-weight:500">Download on the</div>
        <div style="font-size:12px;font-weight:800;color:#111">App Store</div>
      </div>
    </a>
    <a href="https://play.google.com/store/apps/tapmycar" target="_blank" style="background:#fff;border-radius:12px;padding:10px 12px;display:flex;align-items:center;gap:8px;text-decoration:none">
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none"><path d="M3 20.5v-17c0-.83 1-.83 1.5-.5l14 8.5-14 8.5c-.5.33-1.5.33-1.5-.5z" fill="#34A853"/><path d="M3 3.5l8.5 8.5L3 20.5V3.5z" fill="#4285F4"/><path d="M11.5 12l5.5 3.5-3-3 3-3-5.5 3.5z" fill="#FBBC05"/><path d="M17 15.5l-5.5-3.5 5.5-3.5 2 2.1c.7.7.7 2.3 0 3l-2 2z" fill="#EA4335"/></svg>
      <div>
        <div style="font-size:8px;color:#666;font-weight:500">Get it on</div>
        <div style="font-size:12px;font-weight:800;color:#111">Google Play</div>
      </div>
    </a>
  </div>`;
    const newBadges = `  <!-- ${MARKER}: dashboard.banner slot (replaces hardcoded App Store / Play Store) -->
  <div data-tmc-slot="dashboard.banner"></div>`;
    let r = tryReplace(updated, oldBadges, newBadges);
    if (!r) warn('dashboard.html: hardcoded badges anchor not found');
    else updated = r;

    // Add a help slot before bottom nav
    const oldNav = `<!-- BOTTOM NAV -->`;
    const newNav = `<!-- ${MARKER}: dashboard.help slot (support email/phone) -->
<div data-tmc-slot="dashboard.help" style="padding:0 24px 14px;display:flex;justify-content:center"></div>

<!-- BOTTOM NAV -->`;
    let r2 = tryReplace(updated, oldNav, newNav);
    if (!r2) warn('dashboard.html: bottom nav anchor not found, help slot NOT added');
    else updated = r2;

    // Add app-settings.js script
    const oldBodyEnd = `</body>`;
    const newBodyEnd = `<!-- ${MARKER} -->
<script src="/app-settings.js" defer></script>
</body>`;
    if (updated.includes(oldBodyEnd) || updated.includes(oldBodyEnd.replace(/\n/g, '\r\n'))) {
      updated = updated.replace(oldBodyEnd, newBodyEnd);
    }

    writeFile(file, updated);
    ok('dashboard.html: hardcoded badges replaced + help slot + script');
  }
}

// ─── signin.html — add a footer slot ───
log('');
log('26.4.d  signin.html: add footer slot');
{
  const file = path.join(PUBLIC, 'signin.html');
  if (!fs.existsSync(file)) {
    log('  \u00b7 signin.html not found, skipped');
  } else {
    const content = readFile(file);
    if (content.includes(MARKER)) {
      skip('signin.html (already patched)');
    } else {
      backup(file);
      let updated = content;

      // Inject slot + script before </body>.
      const oldBody = `</body>`;
      const newBody = `<!-- ${MARKER}: signin.footer slot -->
<div data-tmc-slot="signin.footer" style="padding:12px 24px 24px;text-align:center"></div>
<script src="/app-settings.js" defer></script>
</body>`;
      if (updated.includes(oldBody) || updated.includes(oldBody.replace(/\n/g, '\r\n'))) {
        updated = updated.replace(oldBody, newBody);
        writeFile(file, updated);
        ok('signin.html: footer slot + script wired');
      } else {
        warn('signin.html: </body> not found, skipped');
      }
    }
  }
}

// ===========================================================================
// 26.3  Admin Settings panel
// ===========================================================================

log('');
log('26.3  admin.html: add Settings panel');
{
  const file = path.join(PUBLIC, 'admin.html');
  const content = readFile(file);
  if (content.includes(MARKER)) {
    skip('admin.html (already patched)');
  } else {
    backup(file);
    let updated = content;

    // Insert CSS for the settings panel
    const cssAnchor = `/* TMC_PATCH24_CATCHUP_ALERTS: home quick-action alerts */`;
    const cssAddition = `/* ${MARKER}: Settings panel */
.p26-settings-list{display:flex;flex-direction:column;gap:14px}
.p26-setting-row{background:var(--surface);border:1.5px solid var(--border);border-radius:14px;padding:14px}
.p26-setting-label{font-size:13px;font-weight:700;color:var(--text);margin-bottom:2px}
.p26-setting-desc{font-size:11px;color:var(--text-3);margin-bottom:10px;line-height:1.4}
.p26-setting-input{width:100%;height:40px;border:1.5px solid var(--border);border-radius:var(--r);padding:0 14px;font-size:13px;background-color:var(--bg-elev) !important;color:var(--text) !important;outline:none;font-family:inherit;margin-bottom:10px}
.p26-setting-input:focus{border-color:var(--brand)}
.p26-slots-label{font-size:10px;color:var(--text-3);font-weight:700;text-transform:uppercase;letter-spacing:.5px;margin-bottom:6px}
.p26-slots-grid{display:flex;flex-wrap:wrap;gap:6px}
.p26-slot-chip{display:inline-flex;align-items:center;gap:6px;padding:5px 10px;background:var(--bg-elev);border:1.5px solid var(--border);border-radius:99px;font-size:11px;color:var(--text-3);font-weight:600;cursor:pointer;transition:all .15s}
.p26-slot-chip.on{background:rgba(255,107,0,.12);border-color:var(--brand);color:var(--brand)}
.p26-slot-chip input{margin:0;width:12px;height:12px;accent-color:var(--brand);cursor:pointer}
.p26-save-bar{position:sticky;bottom:0;background:rgba(7,10,23,.95);backdrop-filter:blur(8px);padding:14px 0;margin:0 -14px -14px;border-top:1px solid var(--border);display:flex;gap:10px;align-items:center;justify-content:flex-end}
.p26-save-bar .gen-btn{height:40px;padding:0 24px}
.p26-save-status{font-size:11px;color:var(--text-3);font-weight:600}
/* TMC_PATCH24_CATCHUP_ALERTS: home quick-action alerts */`;

    let r = tryReplace(updated, cssAnchor, cssAddition);
    if (!r) errExit('admin.html: CSS anchor for patch 23 not found');
    updated = r;

    // Insert the panel HTML right before the close of <main class="main">.
    // Anchor on existing panel-audit or panel-inventory closing.
    // We add a fresh panel-settings panel.
    // Place it after panel-leads which has stable structure.
    const panelAnchor = `<!-- TAGS TAB -->`;
    const panelAddition = `<!-- ${MARKER}: Settings panel -->
<div class="panel" id="panel-settings">
  <div class="asl">Site Settings</div>
  <div class="kpi-sub" style="margin-bottom:14px;padding:0 4px">Configure URLs and toggles that appear on landing, dashboard, and sign-in pages.</div>
  <div id="p26-settings-list" class="p26-settings-list"><div class="empty">Loading settings\u2026</div></div>
  <div class="p26-save-bar">
    <span class="p26-save-status" id="p26-save-status"></span>
    <button class="gen-btn" id="p26-save-btn" onclick="p26Save()">Save all changes</button>
  </div>
</div>

<!-- TAGS TAB -->`;
    let r2 = tryReplace(updated, panelAnchor, panelAddition);
    if (!r2) errExit('admin.html: TAGS TAB anchor not found');
    updated = r2;

    // Add a sidebar entry for Settings — anchor on existing audit sidebar item if present.
    // Find a stable sidebar entry to insert before.
    const sbAnchor = `<button class="sb-item" data-tab="receive" onclick="navTo('receive')">`;
    const sbAddition = `<button class="sb-item" data-tab="settings" onclick="navTo('settings')"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg><span>Settings</span></button>
<button class="sb-item" data-tab="receive" onclick="navTo('receive')">`;
    if (updated.includes(sbAnchor)) {
      updated = updated.replace(sbAnchor, sbAddition);
    }

    // Add the JS at end of inline scripts. Anchor on a stable Patch 24 marker.
    const jsAnchor = `window.p23OpenVoided = p23OpenVoided;`;
    const jsAddition = `window.p23OpenVoided = p23OpenVoided;

// ${MARKER}: Settings panel
let p26Settings = {};
const P26_SLOTS = [
  { id: 'landing.hero',     label: 'Landing hero' },
  { id: 'landing.demo',     label: 'Landing demo video' },
  { id: 'landing.footer',   label: 'Landing footer' },
  { id: 'dashboard.banner', label: 'Dashboard banner' },
  { id: 'dashboard.help',   label: 'Dashboard help' },
  { id: 'signin.footer',    label: 'Sign-in footer' }
];

function p26Esc(s) {
  return String(s == null ? '' : s).replace(/[<>&"']/g, c => ({'<':'&lt;','>':'&gt;','&':'&amp;','"':'&quot;',"'":'&#39;'}[c]));
}

async function p26Load() {
  const list = document.getElementById('p26-settings-list');
  if (!list) return;
  list.innerHTML = '<div class="empty">Loading settings\u2026</div>';
  try {
    const res = await fetch('/api/get-settings');
    const data = await res.json();
    if (!data || !data.settings) { list.innerHTML = '<div class="empty">No settings found</div>'; return; }
    p26Settings = data.settings;
    p26Render();
  } catch (e) {
    list.innerHTML = '<div class="empty">Failed to load: ' + p26Esc(e && e.message) + '</div>';
  }
}

function p26Render() {
  const list = document.getElementById('p26-settings-list');
  if (!list) return;
  const keys = Object.keys(p26Settings).sort(function(a, b) {
    return (p26Settings[a] && (p26Settings[a].sort_order || 0)) - (p26Settings[b] && (p26Settings[b].sort_order || 0));
  });
  if (keys.length === 0) {
    list.innerHTML = '<div class="empty">No settings configured. Seed the table first.</div>';
    return;
  }
  list.innerHTML = keys.map(function(key) {
    const s = p26Settings[key];
    const v = s.value || '';
    const slots = s.slots || [];
    const inputType = s.type === 'email' ? 'email' : (s.type === 'phone' ? 'tel' : 'url');
    const slotsHtml = P26_SLOTS.map(function(slot) {
      const on = slots.indexOf(slot.id) >= 0;
      return '<label class="p26-slot-chip ' + (on ? 'on' : '') + '">' +
        '<input type="checkbox" data-key="' + p26Esc(key) + '" data-slot="' + p26Esc(slot.id) + '"' + (on ? ' checked' : '') + ' onchange="p26ToggleSlot(this)">' +
        p26Esc(slot.label) +
      '</label>';
    }).join('');
    return '<div class="p26-setting-row">' +
      '<div class="p26-setting-label">' + p26Esc(s.label || key) + '</div>' +
      (s.description ? '<div class="p26-setting-desc">' + p26Esc(s.description) + '</div>' : '') +
      '<input type="' + inputType + '" class="p26-setting-input" data-key="' + p26Esc(key) + '" value="' + p26Esc(v) + '" oninput="p26TouchValue(this)" placeholder="Leave blank to hide everywhere">' +
      '<div class="p26-slots-label">Show on these pages:</div>' +
      '<div class="p26-slots-grid">' + slotsHtml + '</div>' +
    '</div>';
  }).join('');
}

function p26TouchValue(input) {
  const key = input.dataset.key;
  if (p26Settings[key]) p26Settings[key].value = input.value;
  p26MarkDirty();
}
function p26ToggleSlot(checkbox) {
  const key = checkbox.dataset.key;
  const slot = checkbox.dataset.slot;
  if (!p26Settings[key]) return;
  const slots = (p26Settings[key].slots || []).slice();
  const idx = slots.indexOf(slot);
  if (checkbox.checked && idx < 0) slots.push(slot);
  if (!checkbox.checked && idx >= 0) slots.splice(idx, 1);
  p26Settings[key].slots = slots;
  // Update parent chip styling
  checkbox.parentElement.classList.toggle('on', checkbox.checked);
  p26MarkDirty();
}
function p26MarkDirty() {
  const st = document.getElementById('p26-save-status');
  if (st) st.textContent = 'Unsaved changes';
}

async function p26Save() {
  const btn = document.getElementById('p26-save-btn');
  const st = document.getElementById('p26-save-status');
  if (btn) { btn.disabled = true; btn.textContent = 'Saving\u2026'; }
  const updates = Object.keys(p26Settings).map(function(key) {
    return { key, value: p26Settings[key].value || '', slots: p26Settings[key].slots || [] };
  });
  try {
    const res = await fetch('/api/update-settings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-admin-key': adminKey },
      body: JSON.stringify({ updates })
    });
    const data = await res.json();
    if (data.success) {
      if (st) st.textContent = 'Saved \u2713';
      setTimeout(function() { if (st && st.textContent === 'Saved \u2713') st.textContent = ''; }, 3000);
    } else {
      if (st) st.textContent = 'Save failed: ' + (data.error || 'unknown');
    }
  } catch (e) {
    if (st) st.textContent = 'Network error';
  }
  if (btn) { btn.disabled = false; btn.textContent = 'Save all changes'; }
}

// Auto-load Settings panel on navigation
(function() {
  const orig = window.navTo;
  if (typeof orig === 'function' && !orig.__p26wrapped) {
    const wrapped = function(id) {
      const ret = orig.apply(this, arguments);
      if (id === 'settings') p26Load();
      return ret;
    };
    wrapped.__p26wrapped = true;
    window.navTo = wrapped;
  }
})();

window.p26Load = p26Load;
window.p26Save = p26Save;
window.p26ToggleSlot = p26ToggleSlot;
window.p26TouchValue = p26TouchValue;`;

    let r3 = tryReplace(updated, jsAnchor, jsAddition);
    if (!r3) errExit('admin.html: patch 23 JS anchor not found');
    updated = r3;

    // Add TAB_TITLES entry so the page title updates
    const titlesAnchor = `tags: { title: 'Tags', sub: 'All tokens in the system' }`;
    const titlesAddition = `tags: { title: 'Tags', sub: 'All tokens in the system' },
  settings: { title: 'Settings', sub: 'URLs and toggles for the public site' } /* ${MARKER} */`;
    // Reverse the order so the existing line ends with a comma if it doesn't already.
    if (updated.includes(titlesAnchor)) {
      updated = updated.replace(titlesAnchor, titlesAddition);
    }

    writeFile(file, updated);
    ok('admin.html: Settings panel + sidebar item + JS wired');
  }
}

log('');
log('==============================================================');
log('Patch 26 complete.');
log('Backup folder: ' + path.relative(ROOT, BACKUP_DIR));
log('');
log('==============================================================');
log('REQUIRED: Run this SQL in Supabase BEFORE deploying');
log('==============================================================');
log('');
log('CREATE TABLE IF NOT EXISTS public.app_settings (');
log('  key TEXT PRIMARY KEY,');
log('  value TEXT,');
log('  slots TEXT[] DEFAULT \'{}\',');
log('  setting_type TEXT DEFAULT \'url\',');
log('  label TEXT,');
log('  description TEXT,');
log('  sort_order INT DEFAULT 0,');
log('  updated_at TIMESTAMPTZ DEFAULT NOW(),');
log('  updated_by TEXT');
log(');');
log('');
log('INSERT INTO public.app_settings (key, value, slots, setting_type, label, description, sort_order) VALUES');
log('  (\'app_store_url\',   \'\', \'{}\', \'url\',   \'App Store URL\',       \'iOS App Store link. Leave blank to hide everywhere.\',  10),');
log('  (\'play_store_url\',  \'\', \'{}\', \'url\',   \'Play Store URL\',      \'Google Play link. Leave blank to hide everywhere.\',  20),');
log('  (\'demo_video_url\',  \'\', \'{}\', \'url\',   \'Demo video URL\',      \'YouTube or Vimeo URL. Will be embedded as an iframe.\',30),');
log('  (\'support_email\',   \'support@tapmycar.io\', \'{landing.footer,dashboard.help,signin.footer}\', \'email\', \'Support email\',       \'Customer support email.\', 40),');
log('  (\'cs_phone\',        \'\', \'{}\', \'phone\', \'Customer service phone\', \'Phone number with country code.\', 50),');
log('  (\'social_instagram\',\'\', \'{}\', \'url\',   \'Instagram URL\',       \'Your Instagram profile URL.\', 60),');
log('  (\'social_twitter\',  \'\', \'{}\', \'url\',   \'Twitter / X URL\',     \'Your Twitter / X profile URL.\', 70),');
log('  (\'social_facebook\', \'\', \'{}\', \'url\',   \'Facebook URL\',        \'Your Facebook page URL.\', 80),');
log('  (\'social_linkedin\', \'\', \'{}\', \'url\',   \'LinkedIn URL\',        \'Your LinkedIn page URL.\', 90)');
log('ON CONFLICT (key) DO NOTHING;');
log('');
log('==============================================================');
log('Deploy:');
log('  git add -A');
log('  git commit -m "Patch 26: app settings infrastructure"');
log('  git push');
log('  Wait ~60 seconds for Vercel.');
log('');
log('Use:');
log('  1. Admin > Settings panel');
log('  2. For each setting: paste URL/value');
log('  3. Tick the slot toggles where you want it to appear');
log('  4. Click "Save all changes"');
log('  5. Load landing.html / dashboard.html / signin.html to see results.');
log('  6. Empty URL OR all slots OFF = invisible. No broken links.');
log('==============================================================');
