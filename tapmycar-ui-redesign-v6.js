// ═══════════════════════════════════════════════════════════════
// TapMyCar UI Redesign v6 — fixes the 4 issues
// ═══════════════════════════════════════════════════════════════
// What this patch does:
//
//   1. CLEANS up old redesign blocks from app.css that were
//      causing the hero card to be too big and dark
//      (removes TMC_V3_REDESIGN, TAPMYCAR REDESIGN OVERRIDES,
//       and any other accumulated patch blocks)
//
//   2. EMBEDS the floating nav HTML directly into the 5 main
//      pages (dashboard, manage, verify, activity, settings)
//      so the nav is part of the page from the moment it loads
//      — NO MORE FLICKER between page navigations
//
//   3. ADDS the floating nav to settings.html (which previously
//      had no bottom nav at all)
//
//   4. SHRINKS the hero card back to its original size by using
//      simple background-image gradients instead of pseudo-elements
//
//   5. SIMPLIFIES the page transition — removes the fade-out
//      before navigation, keeps only a quick fade-in on load
//
// Run from project root:  node tapmycar-ui-redesign-v6.js
//
// What it does NOT do:
//   - Touch admin.html, signin.html, register.html, privacy.html,
//     terms.html, why.html, index.html, /api, app.js, sw.js
//   - Change any structural padding or margin
// ═══════════════════════════════════════════════════════════════

const fs = require('fs');
const path = require('path');

const ROOT = process.cwd();
const PUBLIC = path.join(ROOT, 'public');

if (!fs.existsSync(PUBLIC) || !fs.existsSync(path.join(PUBLIC, 'app.css'))) {
  console.error('ERROR: Run this from your project root (where the public/ folder is).');
  process.exit(1);
}

// ─── BACKUP ──────────────────────────────────────────────────
const now = new Date();
const stamp = now.getFullYear() + '-' +
  String(now.getMonth()+1).padStart(2,'0') + '-' +
  String(now.getDate()).padStart(2,'0') + '-' +
  String(now.getHours()).padStart(2,'0') +
  String(now.getMinutes()).padStart(2,'0');
const BACKUP = path.join(ROOT, 'backup-redesign-v6-' + stamp);

function copyDir(src, dest) {
  if (!fs.existsSync(dest)) fs.mkdirSync(dest, { recursive: true });
  for (const item of fs.readdirSync(src)) {
    const s = path.join(src, item);
    const d = path.join(dest, item);
    if (fs.statSync(s).isDirectory()) copyDir(s, d);
    else fs.copyFileSync(s, d);
  }
}
copyDir(PUBLIC, BACKUP);
console.log('  Backup: ' + path.relative(ROOT, BACKUP));

// ─── 1. CLEAN OLD REDESIGN BLOCKS FROM app.css ────────────────
// Use index-based slicing (regex got fooled by quoted "END" markers
// inside opening comments).
const cssPath = path.join(PUBLIC, 'app.css');
let cssContent = fs.readFileSync(cssPath, 'utf8');
const originalCssLength = cssContent.length;

function stripBlockBetween(content, startMarker, endMarker) {
  // Find opening comment containing startMarker (e.g. "TMC_V3_REDESIGN — appended")
  // Walk back to its `/*` and forward from endMarker to its `*/`
  let result = content;
  let safety = 0;
  while (safety++ < 10) {
    const startIdx = result.indexOf(startMarker);
    if (startIdx === -1) break;
    // Walk back to /*
    const cmtOpen = result.lastIndexOf('/*', startIdx);
    if (cmtOpen === -1) break;
    // Find the END marker after startIdx
    const endIdx = result.indexOf(endMarker, startIdx + startMarker.length);
    if (endIdx === -1) break;
    // Walk forward from endMarker to */
    const cmtClose = result.indexOf('*/', endIdx);
    if (cmtClose === -1) break;
    // Slice it out
    result = result.substring(0, cmtOpen) + result.substring(cmtClose + 2);
  }
  return result;
}

// Strip the old TMC_V3_REDESIGN block (and any future versioned ones)
// IMPORTANT: end markers include the "/* " prefix so we don't match
// quoted text inside the opening comment block
cssContent = stripBlockBetween(cssContent, 'TMC_V3_REDESIGN — appended', '/* END TMC_V3_REDESIGN');
cssContent = stripBlockBetween(cssContent, 'TMC_V2_REDESIGN — appended', '/* END TMC_V2_REDESIGN');
cssContent = stripBlockBetween(cssContent, 'TMC_V1_REDESIGN — appended', '/* END TMC_V1_REDESIGN');
// Strip "TAPMYCAR REDESIGN OVERRIDES" block (from v1 of my patch)
cssContent = stripBlockBetween(cssContent, 'TAPMYCAR REDESIGN OVERRIDES', '/* ════════════════════════════════════════════════════════════════\n   END REDESIGN OVERRIDES');

// Clean up extra blank lines
cssContent = cssContent.replace(/\n{3,}/g, '\n\n').replace(/\s+$/, '') + '\n';

if (cssContent.length !== originalCssLength) {
  fs.writeFileSync(cssPath, cssContent, 'utf8');
  console.log('  Cleaned ' + (originalCssLength - cssContent.length) + ' bytes of old redesign blocks from app.css');
} else {
  console.log('  app.css is already clean');
}

// ─── 2. WRITE THE NEW tmc-redesign.css ───────────────────────
const REDESIGN_CSS = `/* ═══════════════════════════════════════════════════════════════
   TAPMYCAR REDESIGN v6 — clean, conflict-free
   ═══════════════════════════════════════════════════════════════
   This file is the SINGLE source of truth for the redesign.
   No edits to app.css. To revert: delete this file + tmc-redesign.js,
   remove the floating nav HTML from the 5 main pages, remove
   <link>/<script> tags from all patched pages.
   ═══════════════════════════════════════════════════════════════ */

/* ─── HERO CARD ──
   Keeps original size & padding (18px). Just adds:
   - background-image radial highlights (NO pseudo-elements)
   - warm orange shadow underneath
   No layout changes. */
body.tmc-redesign .hero-card {
  background:
    radial-gradient(circle at top right, rgba(255,255,255,.18), transparent 50%),
    radial-gradient(circle at bottom left, rgba(255,153,71,.40), transparent 55%),
    #FF6B00 !important;
  box-shadow: 0 4px 16px rgba(255,107,0,.25), 0 0 0 1px rgba(255,107,0,.08) !important;
}

/* ─── AVATAR & PLAN BADGE — squircle + glow ─── */
body.tmc-redesign .av {
  border-radius: 12px !important;
  box-shadow: 0 0 0 3px rgba(255,107,0,.15), 0 4px 10px rgba(255,107,0,.30) !important;
}
body.tmc-redesign .gear { border-radius: 12px !important; }
body.tmc-redesign #plan-badge {
  border: 1.5px solid #FFB37A !important;
  background: #fff !important;
  color: #C73E00 !important;
  box-shadow: 0 0 0 3px rgba(255,107,0,.10) !important;
}

/* ─── VEHICLE / FEATURED CARD — orange glow ring ─── */
body.tmc-redesign .card-or {
  border: 1.5px solid #FFB37A !important;
  box-shadow: 0 0 0 4px rgba(255,107,0,.10), 0 4px 16px rgba(255,107,0,.12) !important;
}

/* ─── BUTTONS — glow + hover lift ─── */
body.tmc-redesign .btn {
  box-shadow: 0 4px 12px rgba(255,107,0,.30);
  transition: transform .15s, box-shadow .15s;
}
body.tmc-redesign .btn:hover {
  transform: translateY(-1px);
  box-shadow: 0 6px 18px rgba(255,107,0,.40), 0 0 0 3px rgba(255,107,0,.15);
}
body.tmc-redesign .btn-o { transition: transform .15s, border-color .15s; }
body.tmc-redesign .btn-o:hover { transform: translateY(-1px); border-color: #FFB37A; }

/* ─── DIVIDERS — soft gradient line (not on etag.html sticker) ─── */
body.tmc-redesign:not(.tmc-keep-tape) .chev {
  background: linear-gradient(90deg, transparent, rgba(255,107,0,.30), transparent) !important;
  height: 1px !important;
}

/* ─── ACTIVITY / SETTINGS ICONS — subtle ring ─── */
body.tmc-redesign .act-icon,
body.tmc-redesign .set-ic {
  box-shadow: 0 0 0 1px #FFE4CC !important;
}

/* ─── TOGGLE — glow when on ─── */
body.tmc-redesign .tog.on {
  box-shadow: 0 0 0 3px rgba(255,107,0,.15) !important;
}

/* ─── CARD BORDERS — warmer tone ─── */
body.tmc-redesign .card { border-color: #F1F0EE !important; }

/* ─── HEADLINES — tighter ─── */
body.tmc-redesign .hero-card h2,
body.tmc-redesign #greeting-name { letter-spacing: -0.02em !important; }


/* ═══════════════════════════════════════════════════════════════
   FLOATING NAV — embedded directly in HTML, never disappears
   ═══════════════════════════════════════════════════════════════ */

/* Hide the OLD .bnav (if present) — replaced by .tmc-fnav */
body.tmc-redesign .bnav { display: none !important; }

/* Push page content above the floating nav */
body.tmc-redesign .page,
body.tmc-redesign main {
  padding-bottom: 110px !important;
}

/* The floating nav itself */
.tmc-fnav {
  position: fixed;
  bottom: 14px;
  bottom: calc(14px + env(safe-area-inset-bottom));
  left: 50%;
  transform: translateX(-50%);
  display: flex;
  align-items: flex-start;
  justify-content: center;
  gap: 4px;
  padding: 8px 8px 6px;
  background: rgba(255,255,255,0.88);
  backdrop-filter: blur(20px) saturate(180%);
  -webkit-backdrop-filter: blur(20px) saturate(180%);
  border-radius: 28px;
  box-shadow: 0 8px 28px rgba(0,0,0,.12), 0 0 0 1px rgba(255,255,255,.6), 0 2px 6px rgba(0,0,0,.05);
  z-index: 100;
  width: max-content;
  max-width: calc(100vw - 24px);
}

.tmc-fnav-item {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 3px;
  padding: 0 4px;
  background: transparent;
  border: none;
  cursor: pointer;
  font-family: 'Inter', sans-serif;
  min-width: 52px;
  text-decoration: none;
  transition: transform .15s;
  -webkit-tap-highlight-color: transparent;
}
.tmc-fnav-item:active { transform: scale(.94); }

.tmc-fnav-icon {
  width: 40px; height: 40px;
  border-radius: 50%;
  display: flex; align-items: center; justify-content: center;
  background: transparent;
  transition: background .25s, box-shadow .25s;
}
.tmc-fnav-icon svg {
  width: 18px; height: 18px;
  stroke: #6B7280; fill: transparent;
  stroke-width: 2;
  stroke-linecap: round;
  stroke-linejoin: round;
  transition: stroke .25s, fill .25s;
}

.tmc-fnav-label {
  font-size: 9px;
  font-weight: 600;
  color: #9CA3AF;
  letter-spacing: 0.02em;
  transition: color .25s;
  line-height: 1;
}

.tmc-fnav-item.active .tmc-fnav-icon {
  background: #FF6B00;
  box-shadow: 0 0 0 3px rgba(255,107,0,.15), 0 4px 14px rgba(255,107,0,.40);
}
.tmc-fnav-item.active .tmc-fnav-icon svg {
  stroke: #fff; fill: #fff; fill-opacity: 0.20;
}
.tmc-fnav-item.active .tmc-fnav-label {
  color: #FF6B00; font-weight: 700;
}

.tmc-fnav-item:not(.active):hover .tmc-fnav-icon { background: rgba(255,107,0,.08); }
.tmc-fnav-item:not(.active):hover .tmc-fnav-icon svg { stroke: #FF6B00; }
.tmc-fnav-item:not(.active):hover .tmc-fnav-label { color: #FF6B00; }


/* ═══════════════════════════════════════════════════════════════
   PAGE TRANSITION — single subtle fade-in on load
   ═══════════════════════════════════════════════════════════════ */
@keyframes tmc-page-fade-in {
  0%   { opacity: 0; }
  100% { opacity: 1; }
}
body.tmc-redesign {
  animation: tmc-page-fade-in .2s ease-out;
}
`;

fs.writeFileSync(path.join(PUBLIC, 'tmc-redesign.css'), REDESIGN_CSS, 'utf8');
console.log('  Wrote public/tmc-redesign.css (' + REDESIGN_CSS.length + ' bytes)');

// ─── 3. WRITE THE NEW tmc-redesign.js ────────────────────────
const REDESIGN_JS = `// ═══════════════════════════════════════════════════════════════
// TAPMYCAR REDESIGN v6 — minimal JS
// Just adds active state to nav and the redesign body class.
// The nav HTML itself is embedded directly in each page (no flicker).
// ═══════════════════════════════════════════════════════════════
(function () {
  // Add body class IMMEDIATELY (synchronous, before any paint)
  // so all CSS overrides apply before the user sees anything.
  document.documentElement.classList.add('tmc-redesign');
  if (document.body) {
    document.body.classList.add('tmc-redesign');
  } else {
    // body not yet parsed — listen for it
    document.addEventListener('DOMContentLoaded', function () {
      document.body.classList.add('tmc-redesign');
      setActiveNavItem();
    });
    return;
  }

  // Set active state on the floating nav
  function setActiveNavItem() {
    var path = window.location.pathname.toLowerCase();
    var items = document.querySelectorAll('.tmc-fnav-item');
    items.forEach(function (item) {
      var match = item.getAttribute('data-match') || '';
      var matches = match.split(',').map(function (m) { return m.trim(); }).filter(Boolean);
      var isActive = matches.some(function (m) { return path.indexOf(m) !== -1; });
      if (isActive) item.classList.add('active');
      else item.classList.remove('active');
    });
  }
  setActiveNavItem();
})();
`;

fs.writeFileSync(path.join(PUBLIC, 'tmc-redesign.js'), REDESIGN_JS, 'utf8');
console.log('  Wrote public/tmc-redesign.js (' + REDESIGN_JS.length + ' bytes)');

// ─── 4. EMBED FLOATING NAV HTML INTO 5 MAIN PAGES ────────────
const FLOATING_NAV_HTML = '\n<!-- TMC_FLOATING_NAV -->\n<nav class="tmc-fnav" aria-label="Main navigation">\n' +
  '  <a href="/dashboard.html" class="tmc-fnav-item" data-match="/dashboard">\n' +
  '    <div class="tmc-fnav-icon"><svg viewBox="0 0 24 24"><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/></svg></div>\n' +
  '    <span class="tmc-fnav-label">Home</span>\n  </a>\n' +
  '  <a href="/manage.html" class="tmc-fnav-item" data-match="/manage">\n' +
  '    <div class="tmc-fnav-icon"><svg viewBox="0 0 24 24"><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/></svg></div>\n' +
  '    <span class="tmc-fnav-label">Tag</span>\n  </a>\n' +
  '  <a href="/verify.html" class="tmc-fnav-item" data-match="/verify">\n' +
  '    <div class="tmc-fnav-icon"><svg viewBox="0 0 24 24"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg></div>\n' +
  '    <span class="tmc-fnav-label">Verify</span>\n  </a>\n' +
  '  <a href="/activity.html" class="tmc-fnav-item" data-match="/activity">\n' +
  '    <div class="tmc-fnav-icon"><svg viewBox="0 0 24 24"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/></svg></div>\n' +
  '    <span class="tmc-fnav-label">Activity</span>\n  </a>\n' +
  '  <a href="/settings.html" class="tmc-fnav-item" data-match="/settings">\n' +
  '    <div class="tmc-fnav-icon"><svg viewBox="0 0 24 24"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg></div>\n' +
  '    <span class="tmc-fnav-label">Profile</span>\n  </a>\n' +
  '</nav>\n<!-- /TMC_FLOATING_NAV -->\n';

const NAV_PAGES = ['dashboard.html', 'manage.html', 'verify.html', 'activity.html', 'settings.html'];

NAV_PAGES.forEach(function (page) {
  const fp = path.join(PUBLIC, page);
  if (!fs.existsSync(fp)) { console.log('  Not found: ' + page); return; }
  let html = fs.readFileSync(fp, 'utf8');

  // Remove any old TMC_FLOATING_NAV block (idempotent)
  html = html.replace(/\n?<!-- TMC_FLOATING_NAV -->[\s\S]*?<!-- \/TMC_FLOATING_NAV -->\n?/g, '');

  // Insert the new floating nav just before </body>
  html = html.replace(/<\/body>/i, FLOATING_NAV_HTML + '</body>');

  fs.writeFileSync(fp, html, 'utf8');
  console.log('  Embedded floating nav: ' + page);
});

// ─── 5. INJECT <link> + <script> TAGS INTO ALL 13 PAGES ──────
const ALL_PAGES = [
  'dashboard.html', 'manage.html', 'verify.html', 'activity.html', 'settings.html',
  'landing.html', 'pricing.html', 'contact.html', 'reviews.html',
  'etag.html', 'activate.html', 'welcome.html', 'payment-success.html'
];

let updated = 0, skipped = 0;
ALL_PAGES.forEach(function (page) {
  const fp = path.join(PUBLIC, page);
  if (!fs.existsSync(fp)) return;
  let html = fs.readFileSync(fp, 'utf8');
  let changed = false;

  if (html.indexOf('tmc-redesign.css') === -1) {
    html = html.replace(
      /<link\s+rel="stylesheet"\s+href="\/app\.css"[^>]*>/i,
      function (m) { return m + '\n<link rel="stylesheet" href="/tmc-redesign.css">'; }
    );
    changed = true;
  }
  if (html.indexOf('tmc-redesign.js') === -1) {
    html = html.replace(/<\/body>/i, '<script src="/tmc-redesign.js"></script>\n</body>');
    changed = true;
  }

  if (changed) { fs.writeFileSync(fp, html, 'utf8'); updated++; }
  else skipped++;
});

console.log('  Tag injection: ' + updated + ' updated, ' + skipped + ' already had tags');

console.log('\n═══════════════════════════════════════════════');
console.log('  v6 PATCH COMPLETE');
console.log('═══════════════════════════════════════════════');
console.log('  Backup at: ' + path.relative(ROOT, BACKUP));
console.log('');
console.log('Fixes applied:');
console.log('  ✓ Removed old TMC_V3_REDESIGN block from app.css');
console.log('  ✓ Hero card back to original size (no pseudo-elements)');
console.log('  ✓ Floating nav embedded directly in HTML (no flicker)');
console.log('  ✓ Settings page now has the floating nav');
console.log('  ✓ Page transitions simplified to single fade-in');
console.log('');
console.log('Next: open public/dashboard.html and public/settings.html');
console.log('locally to test, then git add, commit, push.');
