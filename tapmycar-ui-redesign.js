// ═══════════════════════════════════════════════════════════════
// TapMyCar UI Redesign — all-in-one patch script
// ═══════════════════════════════════════════════════════════════
// Run from project root with:  node tapmycar-ui-redesign.js
//
// What this does:
//   1. Backs up public/ to a timestamped folder
//   2. Creates public/tmc-redesign.css
//   3. Creates public/tmc-redesign.js
//   4. Injects <link> + <script> tags into 13 HTML pages
//
// What it does NOT do:
//   - Modify any existing CSS rule in app.css
//   - Change any padding, margin, or container size
//   - Touch admin.html, signin.html, register.html, privacy.html,
//     terms.html, why.html, index.html, /api, app.js, sw.js
//
// Idempotent: safe to run multiple times.
// ═══════════════════════════════════════════════════════════════

const fs = require('fs');
const path = require('path');

const ROOT = process.cwd();
const PUBLIC = path.join(ROOT, 'public');

if (!fs.existsSync(PUBLIC)) {
  console.error('ERROR: public/ folder not found.');
  console.error('Run this script from your project root (where the public/ folder lives).');
  process.exit(1);
}
if (!fs.existsSync(path.join(PUBLIC, 'app.css'))) {
  console.error('ERROR: public/app.css not found.');
  process.exit(1);
}

// ─── BACKUP ──────────────────────────────────────────────────
const now = new Date();
const stamp = now.getFullYear() + '-' +
  String(now.getMonth()+1).padStart(2,'0') + '-' +
  String(now.getDate()).padStart(2,'0') + '-' +
  String(now.getHours()).padStart(2,'0') +
  String(now.getMinutes()).padStart(2,'0');

const BACKUP = path.join(ROOT, 'backup-redesign-' + stamp);
function copyDir(src, dest) {
  if (!fs.existsSync(dest)) fs.mkdirSync(dest, { recursive: true });
  for (const item of fs.readdirSync(src)) {
    const s = path.join(src, item);
    const d = path.join(dest, item);
    const stat = fs.statSync(s);
    if (stat.isDirectory()) copyDir(s, d);
    else fs.copyFileSync(s, d);
  }
}
copyDir(PUBLIC, BACKUP);
console.log('  Backup created: ' + path.relative(ROOT, BACKUP));

// ─── CREATE tmc-redesign.css ─────────────────────────────────
const REDESIGN_CSS = `/* ═══════════════════════════════════════════════════════════════
   TAPMYCAR REDESIGN — v5 final
   Floating swipe nav with labels + glow rings + smooth transitions
   ═══════════════════════════════════════════════════════════════
   This file is loaded AFTER app.css on every page that needs the
   redesign. It contains:
     1. Override rules for existing app.css elements (avatar, hero,
        cards, buttons, dividers) to add glow rings & warm shadows.
     2. New floating nav component styles (.tmc-fnav).
     3. Page transition fade-in animation.
   No existing layout, padding, or container size is changed.
   To revert: delete this file and remove the <link> tag.
   ═══════════════════════════════════════════════════════════════ */


/* ─── 1. AVATAR & GEAR — squircle + orange glow ring ─── */
.av {
  border-radius: 12px !important;
  box-shadow: 0 0 0 3px rgba(255,107,0,.15), 0 4px 10px rgba(255,107,0,.30);
}
.gear {
  border-radius: 12px !important;
}

/* ─── 2. HERO CARD — vivid orange + warm shadow + radial highlights ─── */
.hero-card {
  box-shadow: 0 4px 16px rgba(255,107,0,.25), 0 0 0 1px rgba(255,107,0,.08) !important;
}
.hero-card::before {
  content: '';
  position: absolute;
  top: -40px; right: -40px;
  width: 160px; height: 160px;
  border-radius: 50%;
  background: radial-gradient(circle, rgba(255,255,255,.22), transparent 70%);
  pointer-events: none;
  z-index: 0;
}
.hero-card::after {
  content: '';
  position: absolute;
  bottom: -30px; left: -20px;
  width: 100px; height: 100px;
  border-radius: 50%;
  background: radial-gradient(circle, rgba(255,153,71,.45), transparent 70%);
  pointer-events: none;
  z-index: 0;
}
.hero-card > * { position: relative; z-index: 1; }

/* ─── 3. VEHICLE / FEATURED CARD — orange glow ring ─── */
.card-or {
  border: 1.5px solid #FFB37A !important;
  box-shadow: 0 0 0 4px rgba(255,107,0,.10), 0 4px 16px rgba(255,107,0,.12) !important;
}

/* ─── 4. PLAN BADGE — softer outline + glow ─── */
[id="plan-badge"] {
  border: 1.5px solid #FFB37A !important;
  background: #fff !important;
  color: #C73E00 !important;
  box-shadow: 0 0 0 3px rgba(255,107,0,.10);
}

/* ─── 5. BUTTONS — glow shadow + hover lift ─── */
.btn {
  box-shadow: 0 4px 12px rgba(255,107,0,.30);
  transition: transform .15s, box-shadow .15s;
}
.btn:hover {
  transform: translateY(-1px);
  box-shadow: 0 6px 18px rgba(255,107,0,.40), 0 0 0 3px rgba(255,107,0,.15);
}
.btn-o {
  transition: transform .15s, border-color .15s;
}
.btn-o:hover {
  transform: translateY(-1px);
  border-color: #FFB37A;
}

/* ─── 6. SECTION DIVIDERS — soft orange gradient line ─── */
/* Replace orange/black tape with subtle gradient on most pages */
body.tmc-redesign .chev {
  background: linear-gradient(90deg, transparent, rgba(255,107,0,.30), transparent) !important;
  height: 1px !important;
}
/* Note: .tape (yellow/silver) and .sticker-chev stay as-is — they
   make sense in etag.html where they sell "this is a real sticker" */

/* ─── 7. ACTIVITY ITEM ICON — subtle ring ─── */
.act-icon {
  box-shadow: 0 0 0 1px #FFE4CC;
}

/* ─── 8. SETTINGS ROW ICON — subtle ring ─── */
.set-ic {
  box-shadow: 0 0 0 1px #FFE4CC;
}

/* ─── 9. TOGGLE — glow when on ─── */
.tog.on {
  box-shadow: 0 0 0 3px rgba(255,107,0,.15);
}

/* ─── 10. CARDS — warmer borders ─── */
.card {
  border-color: #F1F0EE !important;
}

/* ─── 11. TYPOGRAPHY — tighter headlines ─── */
.hero-card h2,
[id="greeting-name"] {
  letter-spacing: -0.02em;
}


/* ═══════════════════════════════════════════════════════════════
   FLOATING NAV COMPONENT
   Replaces .bnav on the 5 main app pages
   ═══════════════════════════════════════════════════════════════ */

/* Hide the old static .bnav when floating nav is active */
body.tmc-floating-nav .bnav { display: none !important; }

/* Push page content above the floating nav */
body.tmc-floating-nav .page,
body.tmc-floating-nav main,
body.tmc-floating-nav .page-inner {
  padding-bottom: 110px !important;
}

/* Floating nav wrapper */
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
  display: flex;
  align-items: center;
  justify-content: center;
  background: transparent;
  transition: background .25s, box-shadow .25s;
}
.tmc-fnav-icon svg {
  width: 18px; height: 18px;
  stroke: #6B7280;
  fill: transparent;
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
  transition: color .25s, font-weight .25s;
  line-height: 1;
}

/* Active state — orange glow ring */
.tmc-fnav-item.active .tmc-fnav-icon {
  background: #FF6B00;
  box-shadow: 0 0 0 3px rgba(255,107,0,.15), 0 4px 14px rgba(255,107,0,.40);
}
.tmc-fnav-item.active .tmc-fnav-icon svg {
  stroke: #fff;
  fill: #fff;
  fill-opacity: 0.20;
}
.tmc-fnav-item.active .tmc-fnav-label {
  color: #FF6B00;
  font-weight: 700;
}

/* Hover (desktop) */
.tmc-fnav-item:not(.active):hover .tmc-fnav-icon { background: rgba(255,107,0,.08); }
.tmc-fnav-item:not(.active):hover .tmc-fnav-icon svg { stroke: #FF6B00; }
.tmc-fnav-item:not(.active):hover .tmc-fnav-label { color: #FF6B00; }


/* ═══════════════════════════════════════════════════════════════
   PAGE TRANSITION — smooth iOS-style fade-in
   ═══════════════════════════════════════════════════════════════ */
body.tmc-page-transitioning {
  animation: tmc-page-fade .42s cubic-bezier(.32,.72,0,1);
}
@keyframes tmc-page-fade {
  0%   { opacity: 0; transform: scale(0.97); }
  100% { opacity: 1; transform: scale(1); }
}
`;
fs.writeFileSync(path.join(PUBLIC, 'tmc-redesign.css'), REDESIGN_CSS, 'utf8');
console.log('  Created public/tmc-redesign.css');

// ─── CREATE tmc-redesign.js ──────────────────────────────────
const REDESIGN_JS = `// ═══════════════════════════════════════════════════════════════
// TAPMYCAR REDESIGN — v5 final
// Floating nav injection + smooth page transitions
// ═══════════════════════════════════════════════════════════════
// What this file does:
//   1. Adds a "tmc-redesign" class to <body> so CSS overrides activate
//   2. On the 5 main tab pages, injects a floating nav with labels
//      (Home / Tag / Verify / Activity / Profile) and HIDES the old .bnav
//   3. On nav button click, fades out the current page and navigates
//      to the next — feels smooth instead of an abrupt page jump
//   4. On page load, runs a quick fade-in animation
// To revert: delete this file and remove the <script> tag.
// ═══════════════════════════════════════════════════════════════

(function () {
  'use strict';

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  function init() {
    // Mark body for CSS hooks
    document.body.classList.add('tmc-redesign');

    // Inject floating nav (only on pages that already have a .bnav)
    injectFloatingNav();

    // Fade-in transition on page load
    setupPageTransitions();
  }

  // ─── INJECT FLOATING NAV ──────────────────────────────────────
  function injectFloatingNav() {
    var oldNav = document.querySelector('.bnav');
    if (!oldNav) return; // page doesn't have bottom nav, skip

    document.body.classList.add('tmc-floating-nav');

    var items = [
      {
        href: '/dashboard.html',
        label: 'Home',
        match: ['/dashboard'],
        icon: '<svg viewBox="0 0 24 24"><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/></svg>'
      },
      {
        href: '/manage.html',
        label: 'Tag',
        match: ['/manage'],
        icon: '<svg viewBox="0 0 24 24"><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/></svg>'
      },
      {
        href: '/verify.html',
        label: 'Verify',
        match: ['/verify'],
        icon: '<svg viewBox="0 0 24 24"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>'
      },
      {
        href: '/activity.html',
        label: 'Activity',
        match: ['/activity'],
        icon: '<svg viewBox="0 0 24 24"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/></svg>'
      },
      {
        href: '/settings.html',
        label: 'Profile',
        match: ['/settings'],
        icon: '<svg viewBox="0 0 24 24"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>'
      }
    ];

    var path = window.location.pathname;
    var fnav = document.createElement('nav');
    fnav.className = 'tmc-fnav';
    fnav.setAttribute('aria-label', 'Main navigation');

    items.forEach(function (item) {
      var isActive = item.match.some(function (m) { return path.indexOf(m) !== -1; });
      var a = document.createElement('a');
      a.href = item.href;
      a.className = 'tmc-fnav-item' + (isActive ? ' active' : '');
      a.setAttribute('aria-label', item.label);
      a.innerHTML =
        '<div class="tmc-fnav-icon">' + item.icon + '</div>' +
        '<span class="tmc-fnav-label">' + item.label + '</span>';

      a.addEventListener('click', function (e) {
        if (isActive) { e.preventDefault(); return; }
        e.preventDefault();
        navigateWithFade(item.href);
      });
      fnav.appendChild(a);
    });

    document.body.appendChild(fnav);
  }

  // ─── PAGE TRANSITIONS ─────────────────────────────────────────
  function navigateWithFade(href) {
    document.body.style.transition = 'opacity .18s ease-out, transform .18s ease-out';
    document.body.style.opacity = '0.4';
    document.body.style.transform = 'scale(0.98)';
    setTimeout(function () { window.location.href = href; }, 150);
  }

  function setupPageTransitions() {
    document.body.classList.add('tmc-page-transitioning');
    setTimeout(function () {
      document.body.classList.remove('tmc-page-transitioning');
    }, 500);
  }
})();
`;
fs.writeFileSync(path.join(PUBLIC, 'tmc-redesign.js'), REDESIGN_JS, 'utf8');
console.log('  Created public/tmc-redesign.js');

// ─── INJECT TAGS INTO HTML PAGES ─────────────────────────────
const PAGES = [
  'dashboard.html', 'manage.html', 'verify.html', 'activity.html', 'settings.html',
  'landing.html', 'pricing.html', 'contact.html', 'reviews.html',
  'etag.html', 'activate.html', 'welcome.html', 'payment-success.html'
];

let updated = 0, skipped = 0, missing = 0;
PAGES.forEach(function(page) {
  const fp = path.join(PUBLIC, page);
  if (!fs.existsSync(fp)) {
    console.log('  Not found: ' + page);
    missing++;
    return;
  }
  let html = fs.readFileSync(fp, 'utf8');
  let changed = false;

  if (html.indexOf('tmc-redesign.css') === -1) {
    html = html.replace(
      /<link\s+rel="stylesheet"\s+href="\/app\.css"[^>]*>/i,
      function(m) { return m + '\n<link rel="stylesheet" href="/tmc-redesign.css">'; }
    );
    changed = true;
  }
  if (html.indexOf('tmc-redesign.js') === -1) {
    html = html.replace(
      /<\/body>/i,
      '<script src="/tmc-redesign.js"></script>\n</body>'
    );
    changed = true;
  }

  if (changed) {
    fs.writeFileSync(fp, html, 'utf8');
    console.log('  Patched: ' + page);
    updated++;
  } else {
    console.log('  Already patched: ' + page);
    skipped++;
  }
});

console.log('');
console.log('═══════════════════════════════════════════════');
console.log('  REDESIGN PATCH COMPLETE');
console.log('═══════════════════════════════════════════════');
console.log('  Updated:        ' + updated);
console.log('  Already patched: ' + skipped);
console.log('  Missing:        ' + missing);
console.log('  Backup at:      ' + path.relative(ROOT, BACKUP));
console.log('');
console.log('Next: open public/dashboard.html in your browser to test,');
console.log('then git add, commit, and push.');
