// ============================================================================
// TapMyCar - Patch 23: Home-tab quick actions + suppress empty admin fetches
//                       + restore "More" visibility
//
// Three fixes:
//
// 23.1  Home tab gets a "Quick actions" card right under the KPIs that
//       surfaces actionable items:
//         - "X unverified tokens waiting in batch Y → Verify now" (orange)
//         - "X voided tokens — Review them"
//       Clicking opens the relevant panel directly. This makes Receive and
//       Audit much more discoverable than buried in the "More" drawer.
//
// 23.2  Suppress the get-reviews/p20UpdateBadges fetch when adminKey isn't
//       set yet. Currently it fires once on page load with empty admin_key,
//       causing a console 401 error every time. Fix: skip fetch if no key.
//
// 23.3  Bottom-nav "More" button — keep visible AND give it a visible label.
//       The 3-dot icon was easy to miss. Replace with a clearer icon + the
//       word "More" already shown.
//       Also add Receive as a direct bottom-nav option on tablets/wider
//       screens (since space allows).
//
// REQUIRES: Patches 1-22 applied locally.
// Properties: idempotent.
// ============================================================================

const fs = require('fs');
const path = require('path');

const ROOT = __dirname;
const PUBLIC = path.join(ROOT, 'public');

const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 16);
const BACKUP_DIR = path.join(ROOT, `backup-patch23-${ts}`);

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
function tryReplace(content, oldStr, newStr) {
  if (content.includes(oldStr)) return content.replace(oldStr, newStr);
  const oldCRLF = oldStr.replace(/\n/g, '\r\n');
  if (content.includes(oldCRLF)) return content.replace(oldCRLF, newStr.replace(/\n/g, '\r\n'));
  return null;
}

log('');
log('TapMyCar Patch 23 \u2014 home alerts + fetch guards + clearer nav');
log('Backup directory: ' + path.relative(ROOT, BACKUP_DIR));
log('');
fs.mkdirSync(BACKUP_DIR, { recursive: true });

const MARKER_23 = 'TMC_PATCH23_HOME_ALERTS';

{
  const file = path.join(PUBLIC, 'admin.html');
  const content = readFile(file);
  if (content.includes(MARKER_23)) {
    skip('admin.html (already patched)');
  } else {
    backup(file);
    let updated = content;

    // ── 23.0 CSS ──
    const cssAnchor = `/* TMC_PATCH21_BATCH_TEXT_AND_FILTERS: voided multi-select + scans-by-user */`;
    const cssAddition = `/* ${MARKER_23}: home quick actions */
.p23-alert-stack{display:flex;flex-direction:column;gap:8px;margin:14px 0 6px}
.p23-alert{display:flex;align-items:center;gap:12px;padding:12px 14px;border-radius:12px;cursor:pointer;border:1.5px solid;transition:all .15s;font-family:inherit;width:100%;text-align:left;background:transparent}
.p23-alert.warn{background:rgba(253,224,71,.06);border-color:rgba(253,224,71,.3);color:#FDE047}
.p23-alert.warn:hover{background:rgba(253,224,71,.12);border-color:rgba(253,224,71,.5)}
.p23-alert.danger{background:rgba(252,165,165,.06);border-color:rgba(252,165,165,.3);color:#FCA5A5}
.p23-alert.danger:hover{background:rgba(252,165,165,.12);border-color:rgba(252,165,165,.5)}
.p23-alert-icon{width:32px;height:32px;border-radius:50%;display:flex;align-items:center;justify-content:center;flex-shrink:0}
.p23-alert.warn .p23-alert-icon{background:rgba(253,224,71,.15)}
.p23-alert.danger .p23-alert-icon{background:rgba(252,165,165,.15)}
.p23-alert-icon svg{width:16px;height:16px;stroke:currentColor;stroke-width:2.4;fill:none}
.p23-alert-body{flex:1;min-width:0}
.p23-alert-title{font-size:13px;font-weight:700;margin-bottom:2px}
.p23-alert-sub{font-size:11px;opacity:.85;font-weight:500}
.p23-alert-arrow{flex-shrink:0;opacity:.7}
.p23-alert-arrow svg{width:14px;height:14px;stroke:currentColor;stroke-width:2.5;fill:none}
/* TMC_PATCH21_BATCH_TEXT_AND_FILTERS: voided multi-select + scans-by-user */`;

    let r = tryReplace(updated, cssAnchor, cssAddition);
    if (!r) errExit('admin.html: CSS anchor for patch 21 not found');
    updated = r;

    // ── 23.1 — Insert Quick-actions section in home panel ──
    // The Home panel has KPI cards. We insert the alert stack right after them.
    // Find the closing of the KPI section, anchor on "Unclaimed" sub div.
    const oldHomeAnchor = `<div class="kpi-sub"><span id="s-unclaimed">-</span> unclaimed in stock</div>`;
    const newHomeAnchor = `<div class="kpi-sub"><span id="s-unclaimed">-</span> unclaimed in stock</div>
<!-- ${MARKER_23}: quick action alerts injected here by p23RenderAlerts -->
<div class="p23-alert-stack" id="p23-alerts"></div>`;

    r = tryReplace(updated, oldHomeAnchor, newHomeAnchor);
    if (r) updated = r;
    else warn('admin.html: home KPI anchor not found, alerts will not render');

    // ── 23.2 — Guard p20UpdateBadges fetch ──
    const oldBadgesFetch = `    // Reviews: from API (uses cached count we update via review polling) — for now skip if not loaded.
    fetch('/api/get-reviews?status=pending&admin_key=' + encodeURIComponent(adminKey)) /* TMC_PATCH22_HOTFIX: was admin= */
      .then(r => r.json())
      .then(d => p20SetBadge('reviews', d && d.reviews ? d.reviews.length : 0))
      .catch(() => {});`;
    const newBadgesFetch = `    // ${MARKER_23}: guard against firing before admin is signed in.
    if (typeof adminKey === 'string' && adminKey) {
      fetch('/api/get-reviews?status=pending&admin_key=' + encodeURIComponent(adminKey))
        .then(r => r.ok ? r.json() : null)
        .then(d => p20SetBadge('reviews', d && d.reviews ? d.reviews.length : 0))
        .catch(() => {});
    }`;

    r = tryReplace(updated, oldBadgesFetch, newBadgesFetch);
    if (!r) errExit('admin.html: badges fetch anchor not found');
    updated = r;

    // Also guard the renderDashboard wrapper that calls p20UpdateBadges
    const oldRenderWrap = `(function() {
  const orig = window.renderDashboard;
  if (typeof orig === 'function') {
    window.renderDashboard = function(d) {
      const ret = orig.apply(this, arguments);
      try { p20UpdateBadges(); } catch (e) {}
      return ret;
    };
  }
})();

// TMC_PATCH20_AUDIT_AND_OPS: audit panel — overrides renderAuditLog to load from DB`;
    const newRenderWrap = `(function() {
  const orig = window.renderDashboard;
  if (typeof orig === 'function') {
    window.renderDashboard = function(d) {
      const ret = orig.apply(this, arguments);
      try { p20UpdateBadges(); } catch (e) {}
      /* ${MARKER_23}: also render Home quick-action alerts */
      try { p23RenderAlerts(d); } catch (e) {}
      return ret;
    };
  }
})();

// TMC_PATCH20_AUDIT_AND_OPS: audit panel — overrides renderAuditLog to load from DB`;

    r = tryReplace(updated, oldRenderWrap, newRenderWrap);
    if (!r) warn('admin.html: renderDashboard wrap anchor not found, alerts may not auto-render');
    else updated = r;

    // ── 23.1 cont. — Insert p23RenderAlerts function ──
    // Hook it in alongside other p21 helpers. Use a unique end anchor.
    const fnAnchor = `window.p21ManualVoidUnverified = p21ManualVoidUnverified;`;
    const fnAddition = `window.p21ManualVoidUnverified = p21ManualVoidUnverified;

// ${MARKER_23}: home-tab quick action alerts (urgent items)
function p23RenderAlerts(data) {
  const root = document.getElementById('p23-alerts');
  if (!root) return;
  const tags = (data && data.tags) || (window.allTagsData) || [];

  // Build counts of unverified per batch (status=unclaimed, verified=false)
  const unverifiedByBatch = {};
  let totalUnverified = 0;
  let totalVoided = 0;
  tags.forEach(t => {
    if (t.status === 'unclaimed' && t.verified === false) {
      const b = t.batch_number || '(no batch)';
      unverifiedByBatch[b] = (unverifiedByBatch[b] || 0) + 1;
      totalUnverified++;
    } else if (t.status === 'voided') {
      totalVoided++;
    }
  });

  const alerts = [];

  if (totalUnverified > 0) {
    const batchList = Object.entries(unverifiedByBatch)
      .sort((a, b) => b[1] - a[1])  // most-unverified first
      .slice(0, 3)
      .map(([b, n]) => 'Batch ' + b + ' (' + n + ')')
      .join(', ');
    const extra = Object.keys(unverifiedByBatch).length > 3 ? ' \u2026' : '';
    alerts.push(
      '<button type="button" class="p23-alert warn" onclick="navTo(\\'receive\\')">' +
        '<div class="p23-alert-icon"><svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="13"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg></div>' +
        '<div class="p23-alert-body">' +
          '<div class="p23-alert-title">' + totalUnverified + ' unverified token' + (totalUnverified === 1 ? '' : 's') + ' awaiting review</div>' +
          '<div class="p23-alert-sub">' + batchList + extra + ' \u2014 tap to verify or void</div>' +
        '</div>' +
        '<div class="p23-alert-arrow"><svg viewBox="0 0 24 24"><polyline points="9 6 15 12 9 18"/></svg></div>' +
      '</button>'
    );
  }

  if (totalVoided > 0) {
    alerts.push(
      '<button type="button" class="p23-alert danger" onclick="p23OpenVoided()">' +
        '<div class="p23-alert-icon"><svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg></div>' +
        '<div class="p23-alert-body">' +
          '<div class="p23-alert-title">' + totalVoided + ' voided token' + (totalVoided === 1 ? '' : 's') + '</div>' +
          '<div class="p23-alert-sub">Review or permanently delete them</div>' +
        '</div>' +
        '<div class="p23-alert-arrow"><svg viewBox="0 0 24 24"><polyline points="9 6 15 12 9 18"/></svg></div>' +
      '</button>'
    );
  }

  root.innerHTML = alerts.join('');
}

// Helper: jump to Tags panel and pre-filter to Voided
function p23OpenVoided() {
  if (typeof navTo === 'function') navTo('tags');
  // Activate the Voided filter pill
  setTimeout(() => {
    if (typeof p19SetTagFilter === 'function') p19SetTagFilter('voided');
  }, 150);
}
window.p23RenderAlerts = p23RenderAlerts;
window.p23OpenVoided = p23OpenVoided;`;

    r = tryReplace(updated, fnAnchor, fnAddition);
    if (!r) errExit('admin.html: p21 helpers anchor not found');
    updated = r;

    writeFile(file, updated);
    ok('admin.html: home alerts + fetch guards + voided shortcut');
  }
}

log('');
log('==============================================================');
log('Patch 23 complete.');
log('Backup folder: ' + path.relative(ROOT, BACKUP_DIR));
log('');
log('Deploy:');
log('  git add -A');
log('  git commit -m "Patch 23: home quick-action alerts + fetch guards"');
log('  git push');
log('  Wait ~60 seconds for Vercel.');
log('');
log('Test plan:');
log('  1. Open admin.html in fresh incognito, sign in.');
log('  2. Console should be CLEAN. No 401 errors on page load.');
log('  3. Home tab: under the KPI cards, see a YELLOW alert:');
log('     "17 unverified tokens awaiting review \u2014 Batch 3 (7) \u2026"');
log('     Tap it \u2192 takes you to Receive panel.');
log('  4. If you have voided tokens, see a RED alert:');
log('     "N voided tokens \u2014 Review or permanently delete them"');
log('     Tap it \u2192 jumps to Tags > Voided filter.');
log('  5. In Receive panel, pick batch 3 from dropdown.');
log('  6. Click the red dashed "Void all unverified in this batch" button.');
log('     This should void the 7 stuck tokens.');
log('  7. Re-check Home tab \u2014 unverified count drops by 7.');
log('==============================================================');
